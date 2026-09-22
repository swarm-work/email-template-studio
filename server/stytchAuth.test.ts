/**
 * Tests for Stytch B2B session token verification.
 *
 * Like the Cloudflare Access tests next door, these generate a real RSA key pair
 * and sign real JWTs, so the signature check is exercised rather than stubbed.
 * The only thing faked is `fetch`, standing in for Stytch's JWKS endpoint.
 *
 * No Stytch account is needed to run these: the test mints its own tokens. What
 * they cannot prove is that the literals match a REAL Stytch token - that is
 * what decoding one in the dashboard settles (docs/STYTCH_PLAN.md section 6).
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createAuthenticator,
  createStytchAuthenticator,
  loadAuthConfig,
  STYTCH_EMAIL_CLAIM_PATHS,
  STYTCH_SESSION_COOKIE,
} from './auth.ts'

type VerifyKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>
type TestKeyPair = { privateKey: VerifyKey; publicKey: VerifyKey }
type TestJwk = Record<string, unknown>

const PROJECT_ID = 'project-test-11111111-2222-4333-8444-555555555555'
const LIVE_PROJECT_ID = 'project-live-11111111-2222-4333-8444-555555555555'
const KID = 'stytch-key-1'
const OTHER_KID = 'stytch-key-2'
const NOW_MS = 1_760_000_000_000
const NOW_SECONDS = Math.floor(NOW_MS / 1000)
const EMAIL = 'person@swarm.work'

let keyPair: TestKeyPair
let otherKeyPair: TestKeyPair
let publicJwk: TestJwk
let otherPublicJwk: TestJwk

beforeAll(async () => {
  const params = {
    name: 'RSASSA-PKCS1-v1_5',
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: 'SHA-256',
  }
  keyPair = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as TestKeyPair
  otherKeyPair = (await crypto.subtle.generateKey(params, true, ['sign', 'verify'])) as TestKeyPair
  publicJwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as TestJwk
  otherPublicJwk = (await crypto.subtle.exportKey('jwk', otherKeyPair.publicKey)) as TestJwk
})

function base64Url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === 'string' ? bytes : String.fromCharCode(...Array.from(bytes))
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Signs a Stytch-shaped session JWT. `claims`/`header` merge over the defaults. */
async function makeToken(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  signingKey: VerifyKey = keyPair.privateKey,
): Promise<string> {
  const fullHeader = { alg: 'RS256', kid: KID, typ: 'JWT', ...header }
  const fullClaims = {
    iss: `stytch.com/${PROJECT_ID}`,
    aud: [PROJECT_ID],
    sub: 'member-test-99999999-8888-4777-8666-555555555555',
    exp: NOW_SECONDS + 300,
    nbf: NOW_SECONDS - 10,
    email: EMAIL,
    // The nested session claim carries the SESSION expiry, hours away. Nothing
    // may read this for freshness; the outer `exp` is the one that counts.
    'https://stytch.com/session': {
      id: 'session-test-1',
      started_at: '2026-09-22T00:00:00Z',
      expires_at: '2026-09-22T12:00:00Z',
    },
    ...claims,
  }
  const headerPart = base64Url(JSON.stringify(fullHeader))
  const payloadPart = base64Url(JSON.stringify(fullClaims))
  const data = new TextEncoder().encode(`${headerPart}.${payloadPart}`)
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKey, data)
  return `${headerPart}.${payloadPart}.${base64Url(new Uint8Array(signature))}`
}

function jwksFetch(jwks?: unknown) {
  const body = jwks ?? { keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] }
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
}

function authenticatorWith(fetchImpl: ReturnType<typeof jwksFetch>, now: () => number = () => NOW_MS) {
  return createStytchAuthenticator(PROJECT_ID, { fetch: fetchImpl, now })
}

function cookieHeaders(token: string, name = STYTCH_SESSION_COOKIE): Headers {
  return new Headers({ cookie: `${name}=${token}` })
}

describe('loadAuthConfig with Stytch', () => {
  it('selects Stytch when a project id is set', () => {
    expect(loadAuthConfig({ STYTCH_PROJECT_ID: PROJECT_ID })).toEqual({
      mode: 'stytch',
      projectId: PROJECT_ID,
    })
  })

  it('refuses a malformed project id without throwing, and says what it wanted', () => {
    const config = loadAuthConfig({ STYTCH_PROJECT_ID: 'not-a-project-id' })
    expect(config.mode).toBe('none')
    // A thrown ConfigError here would become a 500 the browser gate cannot read.
    expect(config.mode === 'none' && config.reason).toContain('project-test-')
  })

  it('treats an empty project id as unset, so .dev.vars can switch Stytch off', () => {
    expect(loadAuthConfig({ STYTCH_PROJECT_ID: '  ', STUDIO_DEV_IDENTITY: EMAIL })).toEqual({
      mode: 'developer',
      email: EMAIL,
    })
  })

  it('lets Cloudflare Access win over Stytch', () => {
    const config = loadAuthConfig({
      ACCESS_TEAM_DOMAIN: 'swarm.cloudflareaccess.com',
      ACCESS_AUD: 'aud-1',
      STYTCH_PROJECT_ID: PROJECT_ID,
    })
    expect(config.mode).toBe('cloudflare-access')
  })

  it('lets Stytch win over the shared password, so removing it is the rollback', () => {
    const config = loadAuthConfig({
      STYTCH_PROJECT_ID: PROJECT_ID,
      STUDIO_PASSWORD: 'a-long-enough-password',
    })
    expect(config.mode).toBe('stytch')
  })

  it('falls back to the password gate once the project id is removed', () => {
    const config = loadAuthConfig({ STUDIO_PASSWORD: 'a-long-enough-password' })
    expect(config.mode).toBe('password')
  })

  it('is wired into createAuthenticator', () => {
    const authenticator = createAuthenticator({ mode: 'stytch', projectId: PROJECT_ID })
    expect(authenticator.mode).toBe('stytch')
  })
})

describe('createStytchAuthenticator', () => {
  it('accepts a correctly signed token and returns the email', async () => {
    const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(await makeToken()))
    expect(result).toEqual({ ok: true, identity: { email: EMAIL } })
  })

  it('refuses a request with no Stytch cookie', async () => {
    const result = await authenticatorWith(jwksFetch()).authenticate(new Headers())
    expect(result).toMatchObject({ ok: false })
  })

  it('ignores an unrelated cookie of another name', async () => {
    const headers = cookieHeaders(await makeToken(), 'some_other_cookie')
    const result = await authenticatorWith(jwksFetch()).authenticate(headers)
    expect(result).toMatchObject({ ok: false })
  })

  it('refuses a token that is not three parts', async () => {
    const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders('not.a-jwt'))
    expect(result).toMatchObject({ ok: false })
  })

  it('refuses a token whose payload is not JSON', async () => {
    const junk = `${base64Url('{"alg":"RS256","kid":"stytch-key-1"}')}.${base64Url('not json')}.sig`
    const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(junk))
    expect(result).toMatchObject({ ok: false })
  })

  it('refuses alg none', async () => {
    const token = await makeToken({}, { alg: 'none' })
    const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toContain('algorithm')
  })

  it('refuses a symmetric algorithm', async () => {
    const token = await makeToken({}, { alg: 'HS256' })
    const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
    expect(result).toMatchObject({ ok: false })
  })

  it('refuses a token that names no signing key', async () => {
    const token = await makeToken({}, { kid: undefined })
    const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
    expect(result).toMatchObject({ ok: false })
  })

  it('refuses a token signed by the wrong key', async () => {
    const token = await makeToken({}, {}, otherKeyPair.privateKey)
    const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toContain('signature')
  })

  it('refuses a token whose key id is not in the published set', async () => {
    const token = await makeToken({}, { kid: OTHER_KID })
    const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toContain('unknown key')
  })

  it('refuses when the JWKS endpoint cannot be reached, and says so', async () => {
    const failing = vi.fn(async () => new Response('nope', { status: 500 }))
    const authenticator = createStytchAuthenticator(PROJECT_ID, { fetch: failing, now: () => NOW_MS })
    const result = await authenticator.authenticate(cookieHeaders(await makeToken()))
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toContain('Stytch signing keys')
  })

  describe('the issuer, which is the easiest thing to get wrong', () => {
    it('accepts the scheme-less spelling', async () => {
      const token = await makeToken({ iss: `stytch.com/${PROJECT_ID}` })
      const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
      expect(result).toMatchObject({ ok: true })
    })

    it('accepts the https spelling too, so one missing scheme is not a lockout', async () => {
      const token = await makeToken({ iss: `https://stytch.com/${PROJECT_ID}` })
      const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
      expect(result).toMatchObject({ ok: true })
    })

    it('still refuses another project, and names what it received', async () => {
      const token = await makeToken({ iss: 'stytch.com/project-test-someone-else-0000' })
      const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
      expect(result).toMatchObject({ ok: false })
      // Quoting both sides is what makes a wrong literal a 30 second fix.
      expect(result.ok === false && result.reason).toContain('someone-else')
      expect(result.ok === false && result.reason).toContain(PROJECT_ID)
    })

    it('refuses a token with no issuer at all', async () => {
      const token = await makeToken({ iss: undefined })
      const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
      expect(result).toMatchObject({ ok: false })
    })
  })

  describe('audience', () => {
    it('accepts a bare string audience', async () => {
      const token = await makeToken({ aud: PROJECT_ID })
      const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
      expect(result).toMatchObject({ ok: true })
    })

    it('refuses a token minted for a different project', async () => {
      const token = await makeToken({ aud: [LIVE_PROJECT_ID] })
      const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
      expect(result).toMatchObject({ ok: false })
      expect(result.ok === false && result.reason).toContain('different project')
    })
  })

  describe('expiry, where there are two and only one is right', () => {
    it('refuses an expired token', async () => {
      const token = await makeToken({ exp: NOW_SECONDS - 120 })
      const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
      expect(result).toMatchObject({ ok: false })
      expect(result.ok === false && result.reason).toContain('expired')
    })

    it('tolerates a token just inside the clock skew', async () => {
      const token = await makeToken({ exp: NOW_SECONDS - 30 })
      const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
      expect(result).toMatchObject({ ok: true })
    })

    it('refuses a token that is not valid yet', async () => {
      const token = await makeToken({ nbf: NOW_SECONDS + 600 })
      const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
      expect(result).toMatchObject({ ok: false })
    })

    it('does NOT accept an expired token because the session is still open', async () => {
      // The trap: outer exp long past, nested session expires_at hours away.
      // Reading the wrong one accepts hours-old tokens and looks correct.
      const token = await makeToken({
        exp: NOW_SECONDS - 7200,
        'https://stytch.com/session': { expires_at: '2099-01-01T00:00:00Z' },
      })
      const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
      expect(result).toMatchObject({ ok: false })
    })
  })

  describe('subject', () => {
    it('refuses an empty subject rather than logging a blank author', async () => {
      const token = await makeToken({ sub: '   ' })
      const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
      expect(result).toMatchObject({ ok: false })
      expect(result.ok === false && result.reason).toContain('subject')
    })

    it('refuses a missing subject', async () => {
      const token = await makeToken({ sub: undefined })
      const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
      expect(result).toMatchObject({ ok: false })
    })
  })

  describe('finding the email address', () => {
    it('reads a top-level email_address claim', async () => {
      const token = await makeToken({ email: undefined, email_address: EMAIL })
      const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
      expect(result).toEqual({ ok: true, identity: { email: EMAIL } })
    })

    it('reads a namespaced member claim', async () => {
      const token = await makeToken({
        email: undefined,
        'https://stytch.com/member': { email_address: EMAIL },
      })
      const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
      expect(result).toEqual({ ok: true, identity: { email: EMAIL } })
    })

    it('trims surrounding whitespace', async () => {
      const token = await makeToken({ email: `  ${EMAIL}  ` })
      const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
      expect(result).toEqual({ ok: true, identity: { email: EMAIL } })
    })

    it('ignores a non-string value rather than writing "[object Object]" into the log', async () => {
      const token = await makeToken({ email: { address: EMAIL } })
      const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
      expect(result).toMatchObject({ ok: false })
    })

    it('refuses when no email is present, and lists the claims that ARE', async () => {
      const token = await makeToken({ email: undefined })
      const result = await authenticatorWith(jwksFetch()).authenticate(cookieHeaders(token))
      expect(result).toMatchObject({ ok: false })
      // This message is the whole point: it turns a total lockout that reads
      // like a signature failure into a one-line fix.
      expect(result.ok === false && result.reason).toContain('iss')
      expect(result.ok === false && result.reason).toContain('sub')
    })

    it('keeps the search list ordered from most to least specific', () => {
      expect(STYTCH_EMAIL_CLAIM_PATHS[0]).toEqual(['email'])
      expect(STYTCH_EMAIL_CLAIM_PATHS.every((path) => path.length >= 1)).toBe(true)
    })
  })

  describe('the key cache', () => {
    it('reuses keys across requests instead of fetching every time', async () => {
      const fetchImpl = jwksFetch()
      const authenticator = authenticatorWith(fetchImpl)
      await authenticator.authenticate(cookieHeaders(await makeToken()))
      await authenticator.authenticate(cookieHeaders(await makeToken()))
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('collapses a burst of concurrent requests into one fetch', async () => {
      const fetchImpl = jwksFetch()
      const authenticator = authenticatorWith(fetchImpl)
      const token = await makeToken()
      await Promise.all([
        authenticator.authenticate(cookieHeaders(token)),
        authenticator.authenticate(cookieHeaders(token)),
        authenticator.authenticate(cookieHeaders(token)),
      ])
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('refetches after a rotation once the cache has gone stale', async () => {
      // A MUTABLE clock on purpose. With a frozen one, `now() - fetchedAt` is
      // permanently zero, the staleness branch never runs, and this test would
      // pass while asserting nothing.
      let clock = NOW_MS
      let served: unknown = { keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] }
      const fetchImpl = vi.fn(async () => new Response(JSON.stringify(served), { status: 200 }))
      const authenticator = createStytchAuthenticator(PROJECT_ID, { fetch: fetchImpl, now: () => clock })

      const first = await authenticator.authenticate(cookieHeaders(await makeToken()))
      expect(first).toMatchObject({ ok: true })
      expect(fetchImpl).toHaveBeenCalledTimes(1)

      // Stytch rotates: the old kid is gone, a new one signs from here on.
      served = { keys: [{ ...otherPublicJwk, kid: OTHER_KID, alg: 'RS256', use: 'sig' }] }
      clock = NOW_MS + 2 * 60 * 60 * 1000

      // Minted against the ADVANCED clock: a token still carrying the original
      // five-minute expiry would be genuinely expired two hours later, and this
      // test would fail for a reason that has nothing to do with rotation.
      const laterSeconds = Math.floor(clock / 1000)
      const rotated = await makeToken(
        { exp: laterSeconds + 300, nbf: laterSeconds - 10 },
        { kid: OTHER_KID },
        otherKeyPair.privateKey,
      )
      const second = await authenticator.authenticate(cookieHeaders(rotated))
      expect(second).toMatchObject({ ok: true })
      expect(fetchImpl).toHaveBeenCalledTimes(2)
    })

    it('does not refetch on an unknown key id inside the refetch floor', async () => {
      const fetchImpl = jwksFetch()
      const authenticator = authenticatorWith(fetchImpl)
      await authenticator.authenticate(cookieHeaders(await makeToken()))
      // Same instant, so the floor applies: a made-up kid must not be usable to
      // hammer Stytch's endpoint through us.
      const bogus = await makeToken({}, { kid: 'invented' })
      const result = await authenticator.authenticate(cookieHeaders(bogus))
      expect(result).toMatchObject({ ok: false })
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    it('refuses a key set with no usable RSA keys', async () => {
      const authenticator = authenticatorWith(jwksFetch({ keys: [{ kty: 'oct', kid: KID }] }))
      const result = await authenticator.authenticate(cookieHeaders(await makeToken()))
      expect(result).toMatchObject({ ok: false })
    })
  })

  describe('test and live are separate worlds', () => {
    it('asks test.stytch.com for a test project', async () => {
      const fetchImpl = jwksFetch()
      await createStytchAuthenticator(PROJECT_ID, { fetch: fetchImpl, now: () => NOW_MS }).authenticate(
        cookieHeaders(await makeToken()),
      )
      expect(fetchImpl).toHaveBeenCalledWith(`https://test.stytch.com/v1/b2b/sessions/jwks/${PROJECT_ID}`)
    })

    it('asks api.stytch.com for a live project', async () => {
      const fetchImpl = jwksFetch()
      await createStytchAuthenticator(LIVE_PROJECT_ID, { fetch: fetchImpl, now: () => NOW_MS }).authenticate(
        cookieHeaders(await makeToken()),
      )
      expect(fetchImpl).toHaveBeenCalledWith(`https://api.stytch.com/v1/b2b/sessions/jwks/${LIVE_PROJECT_ID}`)
    })
  })
})
