/**
 * The one place that talks to Amazon SES.
 *
 * This file is runtime neutral: no `node:*` imports, no AWS SDK. It calls the
 * SES v2 REST API over plain `fetch`, with requests signed by `aws4fetch`
 * (about 2.5 KB, uses only WebCrypto). That is what lets the same code run in
 * the local Node send server AND in the Cloudflare Worker, which cannot load
 * the AWS SDK: the SDK reaches for Node built-ins and for a credential
 * provider chain (`~/.aws`) that does not exist in a Worker isolate.
 *
 * Credentials are passed in from `server/config.ts`. They are never read from
 * ambient state here and never logged.
 *
 * The three SES operations used, all on `https://email.<region>.amazonaws.com`:
 *   POST /v2/email/outbound-emails   send one email          (SendEmail)
 *   GET  /v2/email/account           quota + sandbox status  (GetAccount)
 *   GET  /v2/email/identities/{id}   is this sender verified (GetEmailIdentity)
 */
import { AwsClient } from 'aws4fetch'
import { z } from 'zod'
import type { AwsCredentials } from './config.ts'
import type { EmailSender } from './emailSender.ts'

/** The subset of `fetch` this module uses. Injectable so tests never touch the network. */
export type FetchLike = (request: Request) => Promise<Response>

export interface SesSenderOptions {
  readonly region: string
  readonly credentials: AwsCredentials
  readonly configurationSet?: string
  /** Defaults to the regional SES endpoint. Overridden by tests and by VPC endpoints. */
  readonly endpoint?: string
  /** Defaults to the global `fetch`. */
  readonly fetch?: FetchLike
}

/**
 * An error SES itself returned, carrying the AWS error type as `name`
 * (for example `NotFoundException`, `MessageRejected`, `AccessDeniedException`)
 * so callers can branch on it and so the API surfaces a useful one-liner.
 */
export class SesApiError extends Error {
  readonly status: number
  constructor(name: string, message: string, status: number) {
    super(message)
    this.name = name
    this.status = status
  }
}

// SES returns more fields than these; `z.object` ignores the rest by default.
const sendResponseSchema = z.object({ MessageId: z.string().optional() })
const accountResponseSchema = z.object({
  ProductionAccessEnabled: z.boolean().optional(),
  SendQuota: z
    .object({
      Max24HourSend: z.number().optional(),
      SentLast24Hours: z.number().optional(),
    })
    .optional(),
})
const identityResponseSchema = z.object({ VerifiedForSendingStatus: z.boolean().optional() })

/** Real sender. Signs every request with the credentials it is given. */
export function createSesSender(options: SesSenderOptions): EmailSender {
  const client = new AwsClient({
    accessKeyId: options.credentials.accessKeyId,
    secretAccessKey: options.credentials.secretAccessKey,
    sessionToken: options.credentials.sessionToken,
    // Stated rather than inferred from the hostname: SES signs as "ses" while
    // its endpoint is called "email", and an inferred mismatch is a signature
    // error that reads like a credentials problem.
    service: 'ses',
    region: options.region,
  })
  const baseUrl = (options.endpoint ?? `https://email.${options.region}.amazonaws.com`).replace(/\/+$/, '')
  const doFetch: FetchLike = options.fetch ?? ((request) => fetch(request))

  /** Signs, sends, and turns a non-2xx response into a SesApiError. Returns parsed JSON. */
  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
    const signed = await client.sign(`${baseUrl}${path}`, {
      method,
      // Signed together with the body; SES rejects an unsigned content type.
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const response = await doFetch(signed)
    const text = await response.text()
    const payload: unknown = text === '' ? {} : safeJsonParse(text)
    if (!response.ok) throw toSesApiError(response, payload, text)
    return payload
  }

  return {
    mode: 'live',
    async send(email) {
      const payload = await call('POST', '/v2/email/outbound-emails', {
        FromEmailAddress: email.from,
        // One SES call for the whole list: everyone in To can see the others.
        Destination: { ToAddresses: [...email.to] },
        // Omitted entirely when unset: SES rejects an explicit null.
        ...(options.configurationSet ? { ConfigurationSetName: options.configurationSet } : {}),
        Content: {
          Simple: {
            Subject: { Data: email.subject, Charset: 'UTF-8' },
            Body: { Html: { Data: email.html, Charset: 'UTF-8' } },
          },
        },
      })
      const parsed = sendResponseSchema.safeParse(payload)
      return { messageId: (parsed.success ? parsed.data.MessageId : undefined) ?? 'unknown' }
    },

    async preflight(from) {
      try {
        const account = accountResponseSchema.parse(await call('GET', '/v2/email/account'))
        const identityVerified = await isIdentityVerified(call, from)
        const sandbox = account.ProductionAccessEnabled !== true
        const parts = [
          identityVerified
            ? `Sender ${from} is verified in ${options.region}.`
            : `Sender ${from} is NOT verified in ${options.region}; SES will reject sends.`,
          sandbox
            ? 'Account is in the SES sandbox: recipients must be verified identities.'
            : 'Account has production access.',
        ]
        return {
          ok: identityVerified,
          message: parts.join(' '),
          sandbox,
          identityVerified,
          dailyQuota: account.SendQuota?.Max24HourSend,
          sentLast24Hours: account.SendQuota?.SentLast24Hours,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, message: `Could not reach Amazon SES: ${message}` }
      }
    },
  }
}

/** Checks the address itself, then its domain (addresses on a verified domain are valid senders). */
async function isIdentityVerified(
  call: (method: 'GET', path: string) => Promise<unknown>,
  from: string,
): Promise<boolean> {
  const domain = from.split('@')[1] ?? ''
  for (const identity of [from, domain]) {
    if (!identity) continue
    try {
      const result = identityResponseSchema.parse(
        await call('GET', `/v2/email/identities/${encodeURIComponent(identity)}`),
      )
      if (result.VerifiedForSendingStatus === true) return true
    } catch (error) {
      // NotFoundException means "no such identity", which is an answer, not a failure.
      // Anything else (bad credentials, throttling) must surface to the caller.
      if (!(error instanceof SesApiError && error.name === 'NotFoundException')) throw error
    }
  }
  return false
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * SES reports the error type in the `x-amzn-errortype` header (sometimes suffixed
 * with a URL) and the sentence in the body, under `message` or `Message`.
 * Falls back to the status code so an HTML error page from a proxy still reads sensibly.
 */
function toSesApiError(response: Response, payload: unknown, rawBody: string): SesApiError {
  const header = response.headers.get('x-amzn-errortype') ?? ''
  const record = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {}
  const type =
    header.split(':')[0].trim() ||
    String(record.__type ?? '')
      .split('#')
      .pop() ||
    `SesHttp${response.status}`
  const message =
    (typeof record.message === 'string' && record.message) ||
    (typeof record.Message === 'string' && record.Message) ||
    rawBody.slice(0, 200) ||
    response.statusText ||
    `HTTP ${response.status}`
  return new SesApiError(type, message, response.status)
}
