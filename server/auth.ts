/**
 * Who is making this request?
 *
 * In production the studio sits behind Cloudflare Access. Access authenticates
 * the visitor (company SSO, one-time PIN, whatever the Access policy says) and
 * then forwards the request to this Worker with a signed JSON Web Token in the
 * `Cf-Access-Jwt-Assertion` header. This file is the part that does NOT trust
 * that header blindly: it verifies the token's signature against Cloudflare's
 * public keys before believing a single claim inside it.
 *
 * Why verify at all, when Access already checked? Because the Worker has a
 * public `*.workers.dev` hostname as well as the Access-protected one. Anyone
 * who finds that hostname bypasses Access entirely and can send whatever
 * headers they like. Verifying the signature is what makes the header
 * meaningful rather than decorative.
 *
 * Salesforce parallel: this is the same reason you validate a signed SAML
 * assertion instead of trusting a username parameter on the request.
 *
 * This file is runtime neutral: no `node:*` imports. Signature checking uses
 * WebCrypto (`crypto.subtle`), which exists in both Workers and Node 20+.
 */

/**
 * The runtime's public-key type, derived from the WebCrypto API itself rather
 * than named directly: `CryptoKey` is a DOM type in Node's typings and a class
 * in the Workers typings, and this file has to compile against both.
 */
type VerifyKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>

/** Who the request is from, once proven. Only the email is used today. */
export interface Identity {
  readonly email: string
}

/**
 * The result of trying to identify a caller. A failure carries a sentence the
 * API can return, so a 401 explains itself instead of being a bare status code.
 */
export type AuthResult =
  { readonly ok: true; readonly identity: Identity } | { readonly ok: false; readonly reason: string }

/** What the API calls on every `/api/*` request. */
export interface Authenticator {
  /** A short label used in logs and in the status route, never a secret. */
  readonly mode: 'cloudflare-access' | 'developer' | 'password' | 'disabled'
  authenticate(headers: Headers): Promise<AuthResult>
}

/** Name of the cookie the password gate sets once the right password is given. */
export const SESSION_COOKIE = 'studio_session'

/** How long one password sign-in lasts before the gate asks again. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60

/** The header Cloudflare Access adds to every request it forwards. */
export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion'

/** How long verified signing keys are reused before Cloudflare is asked again. */
export const JWKS_CACHE_MS = 60 * 60 * 1000

/** Never refetch the key set more often than this, even on an unknown key id. */
const JWKS_MIN_REFETCH_MS = 5 * 60 * 1000

/** Tolerance for small clock differences between Cloudflare and this runtime. */
const CLOCK_SKEW_SECONDS = 60

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * How this deployment identifies callers.
 *
 * - `cloudflare-access`: verify a real Access JWT. This is production.
 * - `developer`: trust a fixed email from configuration. Local only: it exists
 *   so `npm run dev` and the Playwright suite do not need a tunnel or a login.
 * - `none`: nothing is configured, so nothing is trusted and every `/api/*`
 *   request is refused. Fail closed, loudly, rather than fail open quietly.
 */
export type AuthConfig =
  | { readonly mode: 'cloudflare-access'; readonly teamDomain: string; readonly aud: string }
  | { readonly mode: 'password'; readonly password: string }
  | { readonly mode: 'developer'; readonly email: string }
  | { readonly mode: 'none'; readonly reason: string }

/**
 * Reads the auth settings out of environment variables (Worker `vars` and
 * secrets, or `process.env` for the Node adapter).
 *
 * Access configuration wins over the developer identity, so leaving a stale
 * `STUDIO_DEV_IDENTITY` in an environment can never downgrade a real
 * deployment to "trust whatever this variable says".
 */
export function loadAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const teamDomain = clean(env.ACCESS_TEAM_DOMAIN)
  const aud = clean(env.ACCESS_AUD)
  const password = clean(env.STUDIO_PASSWORD)
  const devIdentity = clean(env.STUDIO_DEV_IDENTITY)

  if (teamDomain && aud) {
    // Accept either "team.cloudflareaccess.com" or a full URL, and keep the host only.
    return { mode: 'cloudflare-access', teamDomain: hostOf(teamDomain), aud }
  }
  if (teamDomain || aud) {
    return {
      mode: 'none',
      reason: 'Cloudflare Access is half configured: ACCESS_TEAM_DOMAIN and ACCESS_AUD are both required.',
    }
  }
  if (password) {
    // A short password is worse than none, because it invites the belief that
    // the site is protected. Refuse rather than pretend.
    if (password.length < MIN_PASSWORD_LENGTH) {
      return {
        mode: 'none',
        reason: `STUDIO_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.`,
      }
    }
    return { mode: 'password', password }
  }
  if (devIdentity) {
    return { mode: 'developer', email: devIdentity }
  }
  return {
    mode: 'none',
    reason:
      'No authentication is configured. Set ACCESS_TEAM_DOMAIN and ACCESS_AUD (production), ' +
      'STUDIO_PASSWORD (shared password gate) or STUDIO_DEV_IDENTITY (local only). See docs/DEPLOYMENT.md.',
  }
}

/** Short enough to type, long enough that guessing it is not worth trying. */
export const MIN_PASSWORD_LENGTH = 12

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === '' ? undefined : trimmed
}

/** "https://team.cloudflareaccess.com/" and "team.cloudflareaccess.com" both give the host. */
function hostOf(value: string): string {
  const withScheme = value.includes('://') ? value : `https://${value}`
  try {
    return new URL(withScheme).host.toLowerCase()
  } catch {
    return value.replace(/\/+$/, '').toLowerCase()
  }
}

// ---------------------------------------------------------------------------
// Authenticators
// ---------------------------------------------------------------------------

export interface AuthenticatorOptions {
  /** Defaults to the global `fetch`. Injected by tests so they never hit the network. */
  readonly fetch?: (url: string) => Promise<Response>
  /** Injectable clock, in milliseconds, for tests. */
  readonly now?: () => number
}

/** Builds the authenticator described by the configuration. */
export function createAuthenticator(config: AuthConfig, options: AuthenticatorOptions = {}): Authenticator {
  switch (config.mode) {
    case 'cloudflare-access':
      return createAccessAuthenticator(config.teamDomain, config.aud, options)
    case 'password':
      return createPasswordAuthenticator(config.password, options)
    case 'developer':
      return createDeveloperAuthenticator(config.email)
    case 'none':
      return createDisabledAuthenticator(config.reason)
  }
}

// ---------------------------------------------------------------------------
// The shared password gate
// ---------------------------------------------------------------------------

/**
 * A single shared password, exchanged once for a signed session cookie.
 *
 * Be clear about what this is and is not. It proves someone knew a secret; it
 * does NOT tell you who they are, it cannot be revoked for one person without
 * changing it for everyone, and anyone who is told the password can pass it on.
 * Cloudflare Access gives per-person identity and revocation; this does not.
 * It exists so a test deployment is not simply open to the internet.
 *
 * What it does do properly:
 * - the password is never stored in the cookie, only an HMAC of the expiry
 * - the cookie is HttpOnly, so page scripts cannot read it
 * - comparisons are constant time, so response timing does not leak the secret
 * - sessions expire, and the signature is checked before the expiry is believed
 */
export function createPasswordAuthenticator(
  password: string,
  options: AuthenticatorOptions = {},
): Authenticator {
  const now = options.now ?? (() => Date.now())
  return {
    mode: 'password',
    async authenticate(headers) {
      const cookie = readCookie(headers.get('cookie'), SESSION_COOKIE)
      if (!cookie) {
        return { ok: false, reason: 'This studio is password protected. Sign in to continue.' }
      }
      const valid = await verifySessionToken(cookie, password, Math.floor(now() / 1000))
      if (!valid) {
        return { ok: false, reason: 'Your session has expired or is not valid. Sign in again.' }
      }
      // There is no person behind a shared password, and the log should not
      // imply otherwise.
      return { ok: true, identity: { email: 'shared-password' } }
    },
  }
}

/** True when `candidate` is the configured password. Constant time. */
export async function checkPassword(candidate: string, password: string): Promise<boolean> {
  // Hashing first means the comparison is over two fixed-length digests, so a
  // wrong-length guess cannot be detected from how long the compare took.
  const [a, b] = await Promise.all([sha256(candidate), sha256(password)])
  return constantTimeEqual(a, b)
}

/** Mints `<expiry>.<signature>` for the session cookie. */
export async function createSessionToken(
  password: string,
  nowSeconds: number,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): Promise<string> {
  const expiry = nowSeconds + ttlSeconds
  return `${expiry}.${await signExpiry(expiry, password)}`
}

/** Checks the signature FIRST, then the expiry it claims. */
export async function verifySessionToken(
  token: string,
  password: string,
  nowSeconds: number,
): Promise<boolean> {
  const separator = token.indexOf('.')
  if (separator <= 0) return false
  const expiryText = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  if (!/^\d+$/.test(expiryText)) return false

  // Verify before trusting: an unsigned expiry is just a number the caller chose.
  const expected = await signExpiry(Number(expiryText), password)
  if (!constantTimeEqual(new TextEncoder().encode(signature), new TextEncoder().encode(expected))) {
    return false
  }
  return Number(expiryText) > nowSeconds
}

/** HMAC-SHA256 over the expiry, keyed by the password, as base64url. */
async function signExpiry(expiry: number, password: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`session:${expiry}`))
  return base64UrlEncode(new Uint8Array(signature))
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

/** Compares without an early exit, so the time taken does not reveal the prefix. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index]
  return difference === 0
}

/** Reads one cookie out of a Cookie header, without a cookie library. */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim()
  }
  return undefined
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Trusts a fixed email. Local development and tests only. */
export function createDeveloperAuthenticator(email: string): Authenticator {
  return {
    mode: 'developer',
    async authenticate() {
      return { ok: true, identity: { email } }
    },
  }
}

/** Refuses everything, with the reason the configuration gave. */
export function createDisabledAuthenticator(reason: string): Authenticator {
  return {
    mode: 'disabled',
    async authenticate() {
      return { ok: false, reason }
    },
  }
}

/**
 * Verifies a real Cloudflare Access JWT.
 *
 * The checks, in order, are all required; skipping any one of them makes the
 * others pointless:
 *   1. the token is present and has three parts
 *   2. the algorithm is RS256 (never trust the token's own "alg: none")
 *   3. the signature matches one of the team's published public keys
 *   4. the issuer is this team
 *   5. the audience contains THIS application's tag, so a token minted for a
 *      different Access app in the same team cannot be replayed here
 *   6. the token is not expired and not used before its time
 */
export function createAccessAuthenticator(
  teamDomain: string,
  aud: string,
  options: AuthenticatorOptions = {},
): Authenticator {
  const doFetch = options.fetch ?? ((url: string) => fetch(url))
  const now = options.now ?? (() => Date.now())
  const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`
  const issuer = `https://${teamDomain}`

  /** kid -> imported public key, plus when the set was last fetched. */
  let keys = new Map<string, VerifyKey>()
  let fetchedAt = 0
  let inFlight: Promise<void> | null = null

  async function refreshKeys(): Promise<void> {
    // Collapse concurrent refreshes: a burst of requests must cause one fetch.
    if (inFlight) return inFlight
    inFlight = (async () => {
      const response = await doFetch(certsUrl)
      if (!response.ok) {
        throw new Error(`Access key set returned HTTP ${response.status}`)
      }
      const payload = (await response.json()) as { keys?: JsonWebKeyLike[] }
      const imported = new Map<string, VerifyKey>()
      for (const jwk of payload.keys ?? []) {
        if (!jwk.kid || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) continue
        try {
          imported.set(jwk.kid, await importVerifyKey(jwk))
        } catch {
          // A key we cannot import is skipped rather than fatal: the set may
          // contain a future algorithm while the one we need is still valid.
        }
      }
      if (imported.size === 0) throw new Error('Access key set contained no usable RSA keys')
      keys = imported
      fetchedAt = now()
    })()
    try {
      await inFlight
    } finally {
      inFlight = null
    }
  }

  /** Returns the key for `kid`, refetching once if it is unknown or stale. */
  async function keyFor(kid: string): Promise<VerifyKey | undefined> {
    const stale = now() - fetchedAt > JWKS_CACHE_MS
    if (keys.size === 0 || stale) await refreshKeys()
    const known = keys.get(kid)
    if (known) return known
    // Unknown key id: Cloudflare rotates keys, so fetch again - but not more
    // often than JWKS_MIN_REFETCH_MS, so a bogus kid cannot be used to hammer
    // the certs endpoint through us.
    if (now() - fetchedAt > JWKS_MIN_REFETCH_MS) {
      await refreshKeys()
      return keys.get(kid)
    }
    return undefined
  }

  return {
    mode: 'cloudflare-access',
    async authenticate(headers) {
      const token = headers.get(ACCESS_JWT_HEADER)
      if (!token) {
        return { ok: false, reason: 'No Cloudflare Access token on the request.' }
      }

      const parts = token.split('.')
      if (parts.length !== 3) {
        return { ok: false, reason: 'Access token is not a well formed JWT.' }
      }
      const [headerPart, payloadPart, signaturePart] = parts

      let header: { alg?: string; kid?: string }
      let claims: AccessClaims
      try {
        header = JSON.parse(decodeBase64Url(headerPart)) as { alg?: string; kid?: string }
        claims = JSON.parse(decodeBase64Url(payloadPart)) as AccessClaims
      } catch {
        return { ok: false, reason: 'Access token header or payload is not valid JSON.' }
      }

      // Pinning the algorithm is what stops the classic "alg: none" and
      // "alg: HS256 signed with the public key" forgeries.
      if (header.alg !== 'RS256') {
        return { ok: false, reason: `Unsupported Access token algorithm: ${header.alg ?? 'none'}.` }
      }
      if (!header.kid) {
        return { ok: false, reason: 'Access token does not name a signing key.' }
      }

      let key: VerifyKey | undefined
      try {
        key = await keyFor(header.kid)
      } catch (error) {
        // A network or format problem reaching Cloudflare is not the caller's
        // fault, but it still must not authenticate them.
        return { ok: false, reason: `Could not load the Access signing keys: ${messageOf(error)}` }
      }
      if (!key) {
        return { ok: false, reason: 'Access token was signed by an unknown key.' }
      }

      const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`)
      let signature: Uint8Array
      try {
        signature = decodeBase64UrlBytes(signaturePart)
      } catch {
        return { ok: false, reason: 'Access token signature is not valid base64url.' }
      }
      const verified = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed)
      if (!verified) {
        return { ok: false, reason: 'Access token signature did not verify.' }
      }

      const problem = checkClaims(claims, issuer, aud, Math.floor(now() / 1000))
      if (problem) return { ok: false, reason: problem }

      const email = claims.email?.trim()
      if (!email) {
        return { ok: false, reason: 'Access token carries no email claim.' }
      }
      return { ok: true, identity: { email } }
    },
  }
}

interface AccessClaims {
  readonly iss?: string
  readonly aud?: string | string[]
  readonly exp?: number
  readonly nbf?: number
  readonly email?: string
}

/** Returns a reason to refuse, or null when every claim is acceptable. */
function checkClaims(claims: AccessClaims, issuer: string, aud: string, nowSeconds: number): string | null {
  if (claims.iss !== issuer) {
    return `Access token was issued by ${claims.iss ?? 'nobody'}, not ${issuer}.`
  }
  const audiences = typeof claims.aud === 'string' ? [claims.aud] : (claims.aud ?? [])
  if (!audiences.includes(aud)) {
    return 'Access token was issued for a different application.'
  }
  if (typeof claims.exp !== 'number' || claims.exp + CLOCK_SKEW_SECONDS < nowSeconds) {
    return 'Access token has expired.'
  }
  if (typeof claims.nbf === 'number' && claims.nbf - CLOCK_SKEW_SECONDS > nowSeconds) {
    return 'Access token is not valid yet.'
  }
  return null
}

// ---------------------------------------------------------------------------
// Small crypto and encoding helpers
// ---------------------------------------------------------------------------

interface JsonWebKeyLike {
  kid?: string
  kty?: string
  n?: string
  e?: string
}

/** Imports one RSA public key from the JWKS for signature verification only. */
async function importVerifyKey(jwk: JsonWebKeyLike): Promise<VerifyKey> {
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
}

/** base64url (JWT flavour: no padding, `-` and `_`) to a UTF-8 string. */
function decodeBase64Url(value: string): string {
  return new TextDecoder().decode(decodeBase64UrlBytes(value))
}

function decodeBase64UrlBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
