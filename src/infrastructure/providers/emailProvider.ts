/**
 * Email provider boundary (browser side).
 *
 * The browser never holds credentials. Test sends go through the local send
 * server (`npm run server`), which the app reaches via the `/api` proxy. When
 * that server is not running or not enabled, the provider reports
 * `connected: false` with a reason and the UI keeps sending disabled.
 *
 * Responses from the server are an untrusted boundary: they are parsed with
 * Zod before use.
 */
import { z } from 'zod'
import { DEFAULT_STUDIO_FEATURES, type StudioFeatures } from '@/domain'

export interface OutgoingTestEmail {
  /** One or more addresses; the server sends a single email to all of them. */
  readonly to: readonly string[]
  readonly subject: string
  readonly html: string
  /**
   * The plain-text alternative part. Sent alongside the HTML rather than
   * instead of it, so a text-only client shows the same message (plan §3.9).
   * '' means the render produced none and the email goes out HTML-only.
   */
  readonly text: string
  /**
   * Where replies go, at most five addresses. Optional, and deliberately NOT
   * subject to SES_ALLOWED_RECIPIENTS: nothing is delivered to a reply-to
   * address, so the allow-list that protects recipients does not apply.
   */
  readonly replyTo?: readonly string[]
  readonly templateId: string
}

export interface ProviderPreflight {
  readonly ok: boolean
  readonly message: string
  readonly sandbox?: boolean
  readonly identityVerified?: boolean
}

export type ProviderStatus =
  | {
      readonly connected: false
      readonly reason: string
      /** Reported even when sending is off: feature flags are independent of SES. */
      readonly features: StudioFeatures
    }
  | {
      readonly connected: true
      readonly features: StudioFeatures
      readonly provider: string
      readonly mode: 'live' | 'dry-run'
      readonly from: string
      /** 'any' = the server accepts any valid address the user types. */
      readonly recipientPolicy: 'any' | 'allow-list'
      /** Empty when the policy is 'any'; there is nothing to list. */
      readonly allowedRecipients: readonly string[]
      readonly maxRecipientsPerSend: number
      readonly region: string
      readonly preflight?: ProviderPreflight
    }

export type SendOutcome =
  | {
      readonly status: 'sent'
      readonly mode: 'live' | 'dry-run'
      readonly messageId: string
      readonly to: readonly string[]
      readonly from: string
      readonly subject: string
      readonly sentAt: string
    }
  | { readonly status: 'not-sent'; readonly code: string; readonly message: string }

export interface EmailProvider {
  /** Stable identifier, e.g. "send-server". */
  readonly id: string
  /** Human readable label shown in the UI. */
  readonly label: string
  getStatus(): Promise<ProviderStatus>
  send(email: OutgoingTestEmail): Promise<SendOutcome>
}

export const SENDING_DISABLED_REASON =
  'Sending is disabled. Start the local send server with `npm run server` and enable it in .env to send test emails.'

/** Never sends. Used in tests and as a safe fallback. */
export class NoSendEmailProvider implements EmailProvider {
  readonly id = 'no-send'
  readonly label = 'No-send (local)'

  async getStatus(): Promise<ProviderStatus> {
    return { connected: false, reason: SENDING_DISABLED_REASON, features: DEFAULT_STUDIO_FEATURES }
  }

  async send(): Promise<SendOutcome> {
    return { status: 'not-sent', code: 'sending-disabled', message: SENDING_DISABLED_REASON }
  }
}

/**
 * Mirrors `StudioFeatures` in server/config.ts. The default keeps an older
 * server (which sends no `features` object at all) working, and "on" is the
 * right reading: the flag exists to switch something OFF deliberately.
 */
const featuresSchema = z.object({ visualEditor: z.boolean().default(true) }).default(DEFAULT_STUDIO_FEATURES)

const statusSchema = z.union([
  z.object({ enabled: z.literal(false), reason: z.string(), features: featuresSchema }),
  z.object({
    enabled: z.literal(true),
    features: featuresSchema,
    provider: z.string(),
    mode: z.enum(['live', 'dry-run']),
    from: z.string(),
    // Defaults keep an older server (which sends neither field) working, and
    // both defaults are the safe reading: a closed list of at most ten.
    recipientPolicy: z.enum(['any', 'allow-list']).default('allow-list'),
    allowedRecipients: z.array(z.string()),
    maxRecipientsPerSend: z.number().int().positive().default(10),
    region: z.string(),
    preflight: z
      .object({
        ok: z.boolean(),
        message: z.string(),
        sandbox: z.boolean().optional(),
        identityVerified: z.boolean().optional(),
      })
      .optional(),
  }),
])

const sendResponseSchema = z.union([
  z.object({
    status: z.literal('sent'),
    mode: z.enum(['live', 'dry-run']),
    messageId: z.string(),
    to: z.array(z.string()),
    from: z.string(),
    subject: z.string(),
    sentAt: z.string(),
  }),
  z.object({ status: z.literal('error'), code: z.string(), message: z.string() }),
])

export const SERVER_NOT_RUNNING_REASON =
  'Send server not reachable. Start it in another terminal with `npm run server`.'

/** Talks to the local send server through the Vite `/api` proxy. */
export class HttpTestEmailProvider implements EmailProvider {
  readonly id = 'send-server'
  readonly label = 'Amazon SES via local send server'
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(baseUrl = '/api/send-test', fetchImpl: typeof fetch = (...args) => fetch(...args)) {
    this.baseUrl = baseUrl
    this.fetchImpl = fetchImpl
  }

  async getStatus(): Promise<ProviderStatus> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseUrl}/status`, { headers: { accept: 'application/json' } })
    } catch {
      return { connected: false, reason: SERVER_NOT_RUNNING_REASON, features: DEFAULT_STUDIO_FEATURES }
    }
    if (!response.ok)
      return { connected: false, reason: SERVER_NOT_RUNNING_REASON, features: DEFAULT_STUDIO_FEATURES }

    const parsed = statusSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success)
      return {
        connected: false,
        reason: 'The send server returned an unexpected status response.',
        features: DEFAULT_STUDIO_FEATURES,
      }
    if (!parsed.data.enabled)
      return { connected: false, reason: parsed.data.reason, features: parsed.data.features }
    const {
      features,
      provider,
      mode,
      from,
      recipientPolicy,
      allowedRecipients,
      maxRecipientsPerSend,
      region,
      preflight,
    } = parsed.data
    return {
      connected: true,
      features,
      provider,
      mode,
      from,
      recipientPolicy,
      allowedRecipients,
      maxRecipientsPerSend,
      region,
      preflight,
    }
  }

  async send(email: OutgoingTestEmail): Promise<SendOutcome> {
    let response: Response
    try {
      response = await this.fetchImpl(this.baseUrl, {
        method: 'POST',
        // The custom header is required by the server; cross-site pages cannot send it without a CORS preflight.
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-studio-send': '1' },
        body: JSON.stringify(email),
      })
    } catch {
      return { status: 'not-sent', code: 'server-unreachable', message: SERVER_NOT_RUNNING_REASON }
    }
    const parsed = sendResponseSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) {
      // The Vite proxy answers 5xx with an HTML page when the send server is down.
      if (response.status >= 500)
        return { status: 'not-sent', code: 'server-unreachable', message: SERVER_NOT_RUNNING_REASON }
      return {
        status: 'not-sent',
        code: 'unexpected-response',
        message: `The send server answered with HTTP ${response.status}.`,
      }
    }
    if (parsed.data.status === 'error') {
      return { status: 'not-sent', code: parsed.data.code, message: parsed.data.message }
    }
    const { mode, messageId, to, from, subject, sentAt } = parsed.data
    return { status: 'sent', mode, messageId, to, from, subject, sentAt }
  }
}

export const emailProvider: EmailProvider = new HttpTestEmailProvider()
