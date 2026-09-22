/**
 * HTTP API for test sends. Two routes:
 *
 *   GET  /api/send-test/status  -> is sending possible, from where, to whom
 *   POST /api/send-test         -> send one test email to up to 10 recipients
 *
 * The browser never sees credentials; it only sees this API. Guards, in order:
 * enabled flag, body validation, recipient policy, body size cap, rate limit.
 *
 * Who may receive is `config.recipientPolicy`: an allow-list, or any valid
 * address when SES_ALLOWED_RECIPIENTS is "*" (see server/config.ts). The
 * recipient guards run before the rate limiter so a refused send costs no
 * token, and they are all-or-nothing: one bad address refuses the request.
 *
 * The rate limit stays per REQUEST, not per recipient: 5 sends per minute, so
 * up to 50 recipients a minute. Counting per recipient would refuse a normal
 * ten-address send outright, which is the wrong trade for a proof of concept
 * behind a password gate (ADR-17).
 */
import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { z } from 'zod'
import type { Authenticator, Identity } from './auth.ts'
import {
  checkPassword,
  createDisabledAuthenticator,
  createSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from './auth.ts'
import type { SendServerConfig, StudioFeatures } from './config.ts'
import { DEFAULT_STUDIO_FEATURES } from './config.ts'
import type { EmailSender, SenderPreflight } from './emailSender.ts'
import { apiError } from './http.ts'
import type { ObjectStore } from './objectStore.ts'
import type { TemplateStore } from './templateStore.ts'
import { registerTemplateRoutes } from './templateRoutes.ts'
import { registerUploadRoutes } from './uploadRoutes.ts'

/** The cap on the message body: HTML and the plain-text part together. */
export const MAX_HTML_BYTES = 500 * 1024
/** At most five reply-to addresses, matching what the dialog offers. */
export const MAX_REPLY_TO = 5
/** Friendly cap, applied after de-duplication, so one send is one readable To header. */
export const MAX_RECIPIENTS_PER_SEND = 10
export const TEST_SUBJECT_PREFIX = '[TEST] '
/** Custom header the browser must send; browsers only allow it after a CORS preflight, which this server never grants. */
export const STUDIO_REQUEST_HEADER = 'x-studio-send'
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** Trimmed first: a pasted address often arrives with spaces around it. */
const recipient = z.string().trim().pipe(z.email())

/**
 * Control characters are refused in the two fields that are echoed elsewhere:
 * in the subject a CR/LF would be a header injection in raw MIME, and in the
 * template id it would forge a second line in the audit log below.
 */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

const sendRequestSchema = z.object({
  // A single string is still accepted so a stale browser tab, and the curl
  // example in docs/SENDING.md, keep working. 50 is only an absurd-input
  // bound; MAX_RECIPIENTS_PER_SEND is the friendly cap, applied after dedupe.
  to: z.union([recipient, z.array(recipient).min(1).max(50)]),
  subject: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => !CONTROL_CHARACTERS.test(value), 'Subject must not contain control characters'),
  html: z.string().min(1),
  /**
   * The plain-text alternative part. Optional so an older browser tab, and the
   * curl example in docs/SENDING.md, keep working; empty means HTML only.
   */
  text: z.string().max(200_000).optional(),
  /**
   * Where replies go. NOT checked against SES_ALLOWED_RECIPIENTS: nothing is
   * delivered to a reply-to address, so the rule that protects recipients has
   * nothing to protect here. It is still de-duplicated, control-char checked
   * and capped, because it lands in a mail header.
   */
  replyTo: z
    .union([recipient, z.array(recipient).min(1).max(MAX_REPLY_TO)])
    .optional()
    .refine(
      (value) => value === undefined || !asList(value).some((address) => CONTROL_CHARACTERS.test(address)),
      'Reply-to must not contain control characters',
    ),
  templateId: z
    .string()
    .min(1)
    .max(100)
    .refine((value) => !CONTROL_CHARACTERS.test(value), 'templateId must not contain control characters'),
})

export type SendRequest = z.infer<typeof sendRequestSchema>

/**
 * Which requests the API trusts, decided by the adapter that hosts it:
 * - loopback: Host and Origin must be localhost (the Node send server, bound to 127.0.0.1)
 * - same-origin: Origin, when present, must equal Host (the Cloudflare Worker on a public hostname)
 * Both stop cross-site browser requests; loopback additionally stops DNS rebinding.
 */
export type HostPolicy = 'loopback' | 'same-origin'

/** Hono context values this app sets. `identity` is set by the auth middleware. */
type Variables = { identity: Identity }

export interface AppDependencies {
  readonly config: SendServerConfig
  readonly sender: EmailSender | null
  /** Defaults to the strict loopback rule so a forgotten option never widens access. */
  readonly hostPolicy?: HostPolicy
  /**
   * Who the caller is. Defaults to refusing everything, so an adapter that
   * forgets to pass one fails closed instead of serving an open API.
   */
  readonly authenticator?: Authenticator
  /**
   * Set only in the shared-password mode. Enables `POST /api/session`, which
   * trades the password for a signed cookie, and `DELETE /api/session`, which
   * clears it. Absent in every other mode, so the endpoint simply does not
   * exist when there is no password to check.
   */
  readonly passwordGate?: { readonly password: string }
  /**
   * Where templates are stored. Optional, unlike `sender`, so the existing
   * `createApp` call sites and tests compile unchanged; absent or null means
   * the template routes answer 503 storage-unavailable while sending keeps working.
   */
  readonly templateStore?: TemplateStore | null
  /** Where uploaded images are stored (R2 in the Worker). Absent or null -> uploads answer 503. */
  readonly objectStore?: ObjectStore | null
  /**
   * Which optional parts of the studio are switched on. Defaults to all of
   * them, so an adapter that forgets to pass any keeps the studio complete.
   */
  readonly features?: StudioFeatures
  /** Injectable clock for tests. */
  readonly now?: () => number
}

/** The sign-in route, which cannot itself require a signed-in caller. */
export const SESSION_ROUTE = '/api/session'

/** Wrong guesses allowed per minute before the gate stops answering. */
export const LOGIN_ATTEMPTS_PER_MINUTE = 10

/** How long a preflight result is reused before SES is asked again. */
export const PREFLIGHT_CACHE_MS = 60_000

export function createApp({
  config,
  sender,
  hostPolicy = 'loopback',
  authenticator = createDisabledAuthenticator(
    'No authenticator was configured for this server, so every API request is refused.',
  ),
  passwordGate,
  templateStore = null,
  objectStore = null,
  features = DEFAULT_STUDIO_FEATURES,
  now = () => Date.now(),
}: AppDependencies) {
  const app = new Hono<{ Variables: Variables }>()
  const limiter = createRateLimiter(config.enabled ? config.rateLimitPerMinute : 0, now)
  const loginLimiter = createRateLimiter(LOGIN_ATTEMPTS_PER_MINUTE, now)
  const preflight = createPreflightCache(config, sender, now)

  // Rejects foreign Host (DNS rebinding, loopback policy only) and cross-site
  // browser requests (foreign Origin) before any route runs.
  app.use('/api/*', async (c, next) => {
    const problem = rejectForeignRequest(c.req.header('host'), c.req.header('origin'), hostPolicy)
    if (problem) return c.json({ status: 'error', code: 'forbidden-origin', message: problem }, 403)
    await next()
  })

  // Every /api/* route needs a caller we can name. In production that proof is
  // a verified Cloudflare Access JWT; locally it is a fixed developer identity.
  // This runs after the Host/Origin check so an unauthenticated cross-site
  // request is still refused for the more specific reason.
  app.use('/api/*', async (c, next) => {
    // The sign-in route is how a caller becomes authenticated, so it cannot
    // require an authenticated caller. It does its own password check.
    if (c.req.path === SESSION_ROUTE) return next()
    const result = await authenticator.authenticate(c.req.raw.headers)
    if (!result.ok) {
      return c.json(
        // `mode` lets the browser tell "show a password box" apart from
        // "redirect to the identity provider". It names a mechanism, not a secret.
        { status: 'error', code: 'unauthenticated', mode: authenticator.mode, message: result.reason },
        401,
      )
    }
    c.set('identity', result.identity)
    await next()
  })

  // Registered AFTER the two middlewares above, so every template and upload
  // route already has a checked origin and a named caller. `GET /media/:key`
  // lives outside /api/* and is deliberately public (see uploadRoutes.ts).
  registerTemplateRoutes(app, { templateStore, now })
  registerUploadRoutes(app, { objectStore })

  // The last line of defence: anything a handler THROWS (a D1 outage, a row that
  // does not parse, a duplicate primary key) would otherwise leave Hono's
  // plain-text "Internal Server Error" - the one response the browser cannot
  // parse with `apiErrorSchema`. The real error is logged here and never sent:
  // a database message is no business of the browser's.
  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse()
    console.error('[api] unhandled error', error)
    return apiError(c, 500, 'unexpected', 'Something went wrong on the server. Try again.')
  })

  if (passwordGate) {
    /** Trades the shared password for a signed, HttpOnly session cookie. */
    app.post(SESSION_ROUTE, async (c) => {
      if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) {
        return c.json(
          { status: 'error', code: 'invalid-request', message: 'Content-Type must be application/json.' },
          415,
        )
      }
      // Throttled before the password is even looked at, so this is not a
      // convenient oracle to guess against.
      if (!loginLimiter.tryAcquire()) {
        return c.json(
          {
            status: 'error',
            code: 'rate-limited',
            message: 'Too many attempts. Wait a minute and try again.',
          },
          429,
        )
      }

      let body: unknown
      try {
        body = await c.req.json()
      } catch {
        return c.json(
          { status: 'error', code: 'invalid-request', message: 'Request body must be JSON.' },
          400,
        )
      }
      const parsed = z.object({ password: z.string().min(1).max(200) }).safeParse(body)
      if (!parsed.success) {
        return c.json({ status: 'error', code: 'invalid-request', message: 'A password is required.' }, 400)
      }

      if (!(await checkPassword(parsed.data.password, passwordGate.password))) {
        // Deliberately vague, and deliberately the same shape and timing as a
        // success: nothing here should help someone narrow down the password.
        return c.json(
          { status: 'error', code: 'invalid-password', message: 'That password is not correct.' },
          401,
        )
      }

      const token = await createSessionToken(passwordGate.password, Math.floor(now() / 1000))
      c.header('set-cookie', sessionCookie(token, c.req.url, SESSION_TTL_SECONDS))
      return c.json({ status: 'signed-in', expiresInSeconds: SESSION_TTL_SECONDS })
    })

    /** Signs out by replacing the cookie with an already-expired one. */
    app.delete(SESSION_ROUTE, (c) => {
      c.header('set-cookie', sessionCookie('', c.req.url, 0))
      return c.json({ status: 'signed-out' })
    })
  }

  app.get('/api/send-test/status', async (c) => {
    // The signed-in email is echoed back so the UI can show who Access let in.
    const user = c.get('identity').email
    if (!config.enabled) {
      // `features` is reported on BOTH branches: which workspaces the studio
      // offers has nothing to do with whether SES is reachable, and a studio
      // with sending switched off still has to know its editor is switched on.
      return c.json({
        enabled: false as const,
        provider: 'amazon-ses',
        reason: config.reason,
        user,
        // How the caller was identified. The 401 body already carries this; it
        // names a mechanism, not a secret. The browser uses it to decide whether
        // a sign-out control makes sense - it does under Stytch, and does not
        // under Access (the identity provider owns that) or the shared password
        // (there is no person to sign out).
        authMode: authenticator.mode,
        features,
      })
    }
    return c.json({
      enabled: true as const,
      provider: 'amazon-ses',
      user,
      authMode: authenticator.mode,
      features,
      mode: sender?.mode ?? 'dry-run',
      from: config.from,
      recipientPolicy: config.recipientPolicy,
      maxRecipientsPerSend: MAX_RECIPIENTS_PER_SEND,
      // Kept even when the policy is 'any' (then empty), so a browser tab
      // loaded before this field existed still parses the response.
      allowedRecipients: config.allowedRecipients,
      region: config.region,
      rateLimitPerMinute: config.rateLimitPerMinute,
      preflight: await preflight(),
    })
  })

  app.post('/api/send-test', async (c) => {
    if (!config.enabled || sender === null) {
      return c.json(
        {
          status: 'error',
          code: 'sending-disabled',
          message: config.enabled ? 'No sender configured.' : config.reason,
        },
        503,
      )
    }

    // Both checks force a CORS preflight for cross-site callers; the server never answers OPTIONS, so browsers refuse.
    if (!c.req.header('content-type')?.toLowerCase().startsWith('application/json')) {
      return c.json(
        { status: 'error', code: 'invalid-request', message: 'Content-Type must be application/json.' },
        415,
      )
    }
    if (c.req.header(STUDIO_REQUEST_HEADER) !== '1') {
      return c.json(
        { status: 'error', code: 'invalid-request', message: `Missing ${STUDIO_REQUEST_HEADER} header.` },
        400,
      )
    }

    let body: unknown
    try {
      body = await c.req.json()
    } catch {
      return c.json({ status: 'error', code: 'invalid-request', message: 'Request body must be JSON.' }, 400)
    }
    const parsed = sendRequestSchema.safeParse(body)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }))
      return c.json(
        { status: 'error', code: 'invalid-request', message: 'Invalid send request.', issues },
        400,
      )
    }
    const request = parsed.data

    const { to, refused } = resolveRecipients(request.to, config)
    // Every refusal is logged like the success line below, so one `wrangler
    // tail` grep for [send-test] shows both what was sent and what was tried.
    const refuse = (reason: string, addresses: readonly string[]) => {
      console.warn(`[send-test] refused by ${c.get('identity').email}: ${reason} (${addresses.join(', ')})`)
    }

    if (to.length > MAX_RECIPIENTS_PER_SEND) {
      refuse('too many recipients', to)
      return c.json(
        {
          status: 'error',
          code: 'too-many-recipients',
          message: `Up to ${MAX_RECIPIENTS_PER_SEND} recipients per test send; this request had ${to.length}.`,
        },
        400,
      )
    }

    // The studio mailing itself would look like a loop to SES and to a reader.
    if (to.some((address) => address.toLowerCase() === config.from.toLowerCase())) {
      refuse("the studio's own sender address", to)
      return c.json(
        {
          status: 'error',
          code: 'recipient-not-allowed',
          message: "The studio's own sender address cannot be a test recipient.",
        },
        403,
      )
    }

    if (refused.length > 0) {
      refuse('not in SES_ALLOWED_RECIPIENTS', refused)
      return c.json(
        {
          status: 'error',
          code: 'recipient-not-allowed',
          message: `These addresses are not in SES_ALLOWED_RECIPIENTS: ${refused.join(', ')}.`,
        },
        403,
      )
    }

    // One message, one budget: the two parts travel in the same email, so the
    // cap is on their sum rather than on the HTML alone.
    const encoder = new TextEncoder()
    const bodyBytes = encoder.encode(request.html).length + encoder.encode(request.text ?? '').length
    if (bodyBytes > MAX_HTML_BYTES) {
      return c.json(
        {
          status: 'error',
          code: 'invalid-request',
          message: `HTML and plain text together are larger than ${MAX_HTML_BYTES / 1024} KB.`,
        },
        400,
      )
    }

    if (!limiter.tryAcquire()) {
      return c.json(
        {
          status: 'error',
          code: 'rate-limited',
          message: `Limit of ${config.rateLimitPerMinute} test sends per minute reached. Try again shortly.`,
        },
        429,
      )
    }

    const subject = /^\[TEST\]/i.test(request.subject)
      ? request.subject
      : `${TEST_SUBJECT_PREFIX}${request.subject}`
    const replyTo = dedupe(asList(request.replyTo))
    try {
      const receipt = await sender.send({
        from: config.from,
        to,
        subject,
        html: request.html,
        text: request.text,
        replyTo: replyTo.length > 0 ? replyTo : undefined,
      })
      // The requester is logged so a surprising send can be traced to a person.
      const who = to.length === 1 ? to[0] : `${to.length} recipients: ${to.join(', ')}`
      const replyToNote = replyTo.length > 0 ? ` reply-to ${replyTo.join(', ')}` : ''
      console.log(
        `[send-test] ${sender.mode} "${subject}" -> ${who}${replyToNote} by ${c.get('identity').email} (template ${request.templateId}) message ${receipt.messageId}`,
      )
      return c.json({
        status: 'sent',
        mode: sender.mode,
        messageId: receipt.messageId,
        to,
        from: config.from,
        subject,
        templateId: request.templateId,
        sentAt: new Date(now()).toISOString(),
      })
    } catch (error) {
      console.error('[send-test] provider error', error)
      return c.json(
        {
          status: 'error',
          code: 'provider-error',
          message: `Send failed: ${describeProviderError(error)}`,
        },
        502,
      )
    }
  })

  return app
}

/** One optional address or a list of them, always as a list. */
function asList(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  return Array.isArray(value) ? value : [value]
}

/** Removes duplicates case-insensitively, keeping the first spelling typed. */
function dedupe(addresses: readonly string[]): string[] {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const raw of addresses) {
    const address = raw.trim()
    const key = address.toLowerCase()
    if (address === '' || seen.has(key)) continue
    seen.add(key)
    kept.push(address)
  }
  return kept
}

/**
 * Turns the request's `to` into the addresses to send to, plus the ones the
 * policy refuses. Duplicates are removed case-insensitively, keeping the first
 * spelling. In 'allow-list' mode the allow-list's own spelling wins (so the
 * server, not the caller, decides what the To header says); in 'any' mode the
 * caller's spelling is kept and nothing is ever refused here.
 */
export function resolveRecipients(
  requested: string | string[],
  config: Extract<SendServerConfig, { enabled: true }>,
): { to: string[]; refused: string[] } {
  const seen = new Set<string>()
  const to: string[] = []
  const refused: string[] = []
  for (const raw of Array.isArray(requested) ? requested : [requested]) {
    const address = raw.trim()
    const key = address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    if (config.recipientPolicy === 'any') {
      to.push(address)
      continue
    }
    const allowed = config.allowedRecipients.find((candidate) => candidate.toLowerCase() === key)
    if (allowed === undefined) refused.push(address)
    else to.push(allowed)
  }
  return { to, refused }
}

/** Sliding one-minute window. `limit` 0 means nothing is ever allowed. */
export function createRateLimiter(limit: number, now: () => number) {
  const stamps: number[] = []
  return {
    tryAcquire(): boolean {
      const cutoff = now() - 60_000
      while (stamps.length > 0 && stamps[0] < cutoff) stamps.shift()
      if (stamps.length >= limit) return false
      stamps.push(now())
      return true
    },
  }
}

/** Runs the sender's read-only preflight at most once per cache window. */
function createPreflightCache(config: SendServerConfig, sender: EmailSender | null, now: () => number) {
  let cached: { at: number; result: Promise<SenderPreflight> } | null = null
  return (): Promise<SenderPreflight> => {
    if (!config.enabled || sender === null)
      return Promise.resolve({ ok: false, message: 'Sending is disabled.' })
    if (cached && now() - cached.at < PREFLIGHT_CACHE_MS) return cached.result
    const result = sender.preflight(config.from)
    cached = { at: now(), result }
    // Do not cache failures: a fixed credential or identity should show up on the next check.
    void result.then((outcome) => {
      if (!outcome.ok) cached = null
    })
    return result
  }
}

/** Returns a reason to refuse, or null when Host and Origin (if present) satisfy the policy. */
export function rejectForeignRequest(
  host: string | undefined,
  origin: string | undefined,
  policy: HostPolicy = 'loopback',
): string | null {
  if (!host) return 'Requests without a Host header are not accepted.'
  if (policy === 'loopback' && !LOCAL_HOSTNAMES.has(hostnameOf(host)))
    return 'Requests are only accepted from this machine (Host must be localhost).'
  // `Origin: null` comes from opaque contexts (sandboxed iframes, file: pages); nothing legitimate uses it here.
  if (origin) {
    let originUrl: URL
    try {
      originUrl = new URL(origin)
    } catch {
      return 'Origin header is not a valid URL.'
    }
    const sameOrigin =
      policy === 'loopback'
        ? LOCAL_HOSTNAMES.has(originUrl.hostname)
        : originUrl.host.toLowerCase() === host.toLowerCase()
    if (!sameOrigin) return 'Cross-site requests are not accepted.'
  }
  return null
}

function hostnameOf(hostHeader: string): string {
  // "localhost:8787", "127.0.0.1:8787" or "[::1]:8787"
  const bracketed = /^(\[[^\]]+\])(?::\d+)?$/.exec(hostHeader)
  if (bracketed) return bracketed[1]
  return hostHeader.replace(/:\d+$/, '').toLowerCase()
}

/**
 * Builds the Set-Cookie value for the session.
 *
 * - HttpOnly: page scripts cannot read it, so an injected script cannot steal the session
 * - SameSite=Strict: the browser will not attach it to requests started by another site
 * - Secure: only over HTTPS. Omitted on plain http://localhost, where the browser
 *   would otherwise drop the cookie and local development would silently not work.
 */
function sessionCookie(token: string, requestUrl: string, maxAgeSeconds: number): string {
  const isHttps = requestUrl.startsWith('https://')
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (isHttps) attributes.push('Secure')
  return attributes.join('; ')
}

/** One line, bounded length: enough for a developer to act on, no stack traces. */
function describeProviderError(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return raw.replace(/\s+/g, ' ').slice(0, 300)
}
