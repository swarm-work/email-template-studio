/**
 * Signs and verifies outgoing webhooks using the Standard Webhooks scheme
 * (docs/PLATFORM_PLAN.md decision 38): a secret shaped `whsec_<base64>`, a
 * per-delivery id and Unix-second timestamp, and
 * `webhook-signature: v1,<base64 HMAC-SHA256>` over `"<id>.<timestamp>.<body>"`.
 *
 * WebCrypto only (`crypto.subtle`, plus `atob`/`btoa` for base64 - all three
 * are ordinary global Web APIs, not Node-specific), so this one file runs
 * unchanged in the Cloudflare Worker that sends webhooks, in the browser (for
 * a "send a test webhook" button), and in Node (this repo's local server and
 * its tests). Like every other file under `shared/`, it may import only `zod`.
 */
import { z } from 'zod'

const WHSEC_PREFIX = 'whsec_'

/** The three headers Standard Webhooks sends with every delivery. */
export interface WebhookHeaders {
  readonly 'webhook-id': string
  readonly 'webhook-timestamp': string
  readonly 'webhook-signature': string
}

export const webhookHeadersSchema = z.object({
  'webhook-id': z.string().min(1),
  'webhook-timestamp': z.string().min(1),
  'webhook-signature': z.string().min(1),
})

/** Why a signature was rejected, so a failed delivery's log line can say something useful. */
export type VerifyWebhookResult =
  { readonly valid: true } | { readonly valid: false; readonly reason: string }

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

// No explicit return type here: TypeScript's own inference gives the precise
// `Uint8Array<ArrayBuffer>` that `crypto.subtle.importKey` wants. Annotating it
// as the bare `Uint8Array` widens it to `Uint8Array<ArrayBufferLike>` (which
// also covers a `SharedArrayBuffer`-backed view) and WebCrypto's types refuse that.
function base64ToBytes(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

const textEncoder = new TextEncoder()

/**
 * `whsec_<base64>` -> the raw HMAC key. The prefix is just a label (so a secret
 * is recognisable at a glance, the way a Stripe key's prefix is); it is
 * stripped, and the rest is base64-decoded to get the actual key bytes.
 */
// No explicit `Promise<CryptoKey>` return type: with no DOM lib loaded (this
// file is checked under a Node-only tsconfig too), `CryptoKey` is a global
// *value* (a constructor) from @types/node, not a type name, so writing it as
// a type annotation fails there. Letting inference flow from
// `crypto.subtle.importKey`'s own return type sidesteps the name entirely.
function importHmacKey(secret: string) {
  if (!secret.startsWith(WHSEC_PREFIX)) {
    throw new Error(`Webhook secret must start with "${WHSEC_PREFIX}"`)
  }
  const keyBytes = base64ToBytes(secret.slice(WHSEC_PREFIX.length))
  return crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

/** The exact bytes that get signed: `id`, `timestamp`, and `body` joined by literal periods. */
function signedContent(id: string, timestampSeconds: number, body: string): string {
  return `${id}.${timestampSeconds}.${body}`
}

/**
 * Signs one webhook delivery. Returns the full `webhook-signature` header
 * value, e.g. `"v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0="`.
 */
export async function signWebhook(
  secret: string,
  id: string,
  timestampSeconds: number,
  body: string,
): Promise<string> {
  const key = await importHmacKey(secret)
  const signatureBytes = await crypto.subtle.sign(
    'HMAC',
    key,
    textEncoder.encode(signedContent(id, timestampSeconds, body)),
  )
  return `v1,${bytesToBase64(new Uint8Array(signatureBytes))}`
}

/** Same-length, constant-time byte comparison, so a timing attack can't guess a valid signature one byte at a time. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

/**
 * Verifies one incoming (or, for a receiver testing their own endpoint,
 * outgoing) webhook. Never throws: any problem - a missing header, a
 * signature in the wrong shape, a stale timestamp, a wrong secret - comes back
 * as `{ valid: false, reason }`.
 *
 * `webhook-signature` may hold several space-separated `v1,<base64>` values
 * (a secret rotation sends both the old and new signature); this accepts the
 * delivery if ANY of them matches.
 */
export async function verifyWebhook(
  secret: string,
  headers: WebhookHeaders,
  body: string,
  nowSeconds: number,
  toleranceSeconds = 300,
): Promise<VerifyWebhookResult> {
  const parsedHeaders = webhookHeadersSchema.safeParse(headers)
  if (!parsedHeaders.success) return { valid: false, reason: 'Missing or empty webhook headers.' }

  const id = parsedHeaders.data['webhook-id']
  const timestampText = parsedHeaders.data['webhook-timestamp']
  const signatureHeader = parsedHeaders.data['webhook-signature']

  const timestamp = Number(timestampText)
  if (!Number.isFinite(timestamp)) return { valid: false, reason: 'webhook-timestamp is not a number.' }

  const age = nowSeconds - timestamp
  if (age > toleranceSeconds) return { valid: false, reason: 'Timestamp is too old.' }
  if (age < -toleranceSeconds) return { valid: false, reason: 'Timestamp is in the future.' }

  let expectedBytes: Uint8Array
  try {
    const key = await importHmacKey(secret)
    const signatureBytes = await crypto.subtle.sign(
      'HMAC',
      key,
      textEncoder.encode(signedContent(id, timestamp, body)),
    )
    expectedBytes = new Uint8Array(signatureBytes)
  } catch (error) {
    return { valid: false, reason: `Could not compute the expected signature: ${String(error)}` }
  }

  // "v1,<base64> v1,<base64> ..." - accept if any candidate matches.
  const candidates = signatureHeader.split(' ').filter((candidate) => candidate.length > 0)
  for (const candidate of candidates) {
    const [version, encoded] = candidate.split(',', 2)
    if (version !== 'v1' || !encoded) continue
    let candidateBytes: Uint8Array
    try {
      candidateBytes = base64ToBytes(encoded)
    } catch {
      continue // not valid base64 - try the next candidate rather than failing outright
    }
    if (constantTimeEqual(candidateBytes, expectedBytes)) return { valid: true }
  }
  return { valid: false, reason: 'No signature in webhook-signature matched.' }
}
