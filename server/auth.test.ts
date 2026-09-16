/**
 * Tests for Cloudflare Access token verification.
 *
 * These generate a real RSA key pair with WebCrypto and sign real JWTs, so the
 * signature check is exercised for what it is rather than stubbed out. The only
 * thing faked is `fetch`, which stands in for Cloudflare's certs endpoint.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  ACCESS_JWT_HEADER,
  createAccessAuthenticator,
  createAuthenticator,
  createDeveloperAuthenticator,
  checkPassword,
  createDisabledAuthenticator,
  createPasswordAuthenticator,
  createSessionToken,
  readCookie,
  SESSION_COOKIE,
  verifySessionToken,
  loadAuthConfig,
} from './auth.ts'

/** Key types derived from the API, so this compiles under Node and Workers typings alike. */
type VerifyKey = Awaited<ReturnType<typeof crypto.subtle.importKey>>
type TestKeyPair = { privateKey: VerifyKey; publicKey: VerifyKey }
type TestJwk = Record<string, unknown>

const TEAM_DOMAIN = 'swarm.cloudflareaccess.com'
const AUD = 'a1b2c3d4e5f6'
const KID = 'test-key-1'
const NOW_MS = 1_760_000_000_000
const NOW_SECONDS = Math.floor(NOW_MS / 1000)

let keyPair: TestKeyPair
let publicJwk: TestJwk

beforeAll(async () => {
  keyPair = (await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  )) as TestKeyPair
  publicJwk = (await crypto.subtle.exportKey('jwk', keyPair.publicKey)) as TestJwk
})

function base64Url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === 'string' ? bytes : String.fromCharCode(...Array.from(bytes))
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Signs a JWT with the test key. `header` and `claims` are merged over sane defaults. */
async function makeToken(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  signingKey: VerifyKey = keyPair.privateKey,
): Promise<string> {
  const fullHeader = { alg: 'RS256', kid: KID, typ: 'JWT', ...header }
  const fullClaims = {
    iss: `https://${TEAM_DOMAIN}`,
    aud: [AUD],
    email: 'person@swarm.work',
    exp: NOW_SECONDS + 600,
    nbf: NOW_SECONDS - 10,
    ...claims,
  }
  const headerPart = base64Url(JSON.stringify(fullHeader))
  const payloadPart = base64Url(JSON.stringify(fullClaims))
  const data = new TextEncoder().encode(`${headerPart}.${payloadPart}`)
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signingKey, data)
  return `${headerPart}.${payloadPart}.${base64Url(new Uint8Array(signature))}`
}

/** A fake certs endpoint that serves the test public key. */
function certsFetch(jwks: unknown = { keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] }) {
  return vi.fn(async () => new Response(JSON.stringify(jwks), { status: 200 }))
}

function authenticatorWith(fetchImpl: ReturnType<typeof certsFetch>) {
  return createAccessAuthenticator(TEAM_DOMAIN, AUD, { fetch: fetchImpl, now: () => NOW_MS })
}

function headersWith(token: string): Headers {
  return new Headers({ [ACCESS_JWT_HEADER]: token })
}

describe('loadAuthConfig', () => {
  it('uses Cloudflare Access when both variables are present', () => {
    expect(loadAuthConfig({ ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUD })).toEqual({
      mode: 'cloudflare-access',
      teamDomain: TEAM_DOMAIN,
      aud: AUD,
    })
  })

  it('accepts a full URL for the team domain and keeps only the host', () => {
    const config = loadAuthConfig({ ACCESS_TEAM_DOMAIN: `https://${TEAM_DOMAIN}/`, ACCESS_AUD: AUD })
    expect(config).toMatchObject({ mode: 'cloudflare-access', teamDomain: TEAM_DOMAIN })
  })

  it('refuses a half configured Access setup rather than falling back', () => {
    const config = loadAuthConfig({
      ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
      STUDIO_DEV_IDENTITY: 'dev@example.test',
    })
    expect(config.mode).toBe('none')
  })

  it('prefers Access over a stale developer identity', () => {
    const config = loadAuthConfig({
      ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
      ACCESS_AUD: AUD,
      STUDIO_DEV_IDENTITY: 'dev@example.test',
    })
    expect(config.mode).toBe('cloudflare-access')
  })

  it('falls back to the developer identity when Access is not configured', () => {
    expect(loadAuthConfig({ STUDIO_DEV_IDENTITY: 'dev@example.test' })).toEqual({
      mode: 'developer',
      email: 'dev@example.test',
    })
  })

  it('configures nothing when nothing is set, and says why', () => {
    const config = loadAuthConfig({})
    expect(config.mode).toBe('none')
    expect(config.mode === 'none' && config.reason).toContain('ACCESS_TEAM_DOMAIN')
  })

  it('treats empty strings as unset', () => {
    expect(loadAuthConfig({ ACCESS_TEAM_DOMAIN: '  ', ACCESS_AUD: '' }).mode).toBe('none')
  })
})

describe('createDisabledAuthenticator', () => {
  it('refuses every request with the configured reason', async () => {
    const result = await createDisabledAuthenticator('nothing configured').authenticate(new Headers())
    expect(result).toEqual({ ok: false, reason: 'nothing configured' })
  })
})

describe('createDeveloperAuthenticator', () => {
  it('returns the fixed identity regardless of headers', async () => {
    const result = await createDeveloperAuthenticator('dev@example.test').authenticate(new Headers())
    expect(result).toEqual({ ok: true, identity: { email: 'dev@example.test' } })
  })
})

describe('createAccessAuthenticator', () => {
  it('accepts a correctly signed, current token and returns the email', async () => {
    const auth = authenticatorWith(certsFetch())
    const result = await auth.authenticate(headersWith(await makeToken()))
    expect(result).toEqual({ ok: true, identity: { email: 'person@swarm.work' } })
  })

  it('refuses a request with no token', async () => {
    const result = await authenticatorWith(certsFetch()).authenticate(new Headers())
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toContain('No Cloudflare Access token')
  })

  it('refuses a token whose signature does not match', async () => {
    const [headerPart, payloadPart, signaturePart] = (await makeToken()).split('.')
    // Change a character in the middle of the signature. The last character is
    // a poor choice: base64url's final symbol carries spare bits that can decode
    // to the very same bytes, so flipping it may not change the signature at all.
    const index = 10
    const swapped = signaturePart[index] === 'A' ? 'B' : 'A'
    const tampered = `${headerPart}.${payloadPart}.${signaturePart.slice(0, index)}${swapped}${signaturePart.slice(index + 1)}`
    const result = await authenticatorWith(certsFetch()).authenticate(headersWith(tampered))
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toMatch(/signature/i)
  })

  it('refuses a token signed by a different key', async () => {
    const other = (await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    )) as TestKeyPair
    const token = await makeToken({}, {}, other.privateKey)
    const result = await authenticatorWith(certsFetch()).authenticate(headersWith(token))
    expect(result).toMatchObject({ ok: false })
  })

  it('refuses "alg: none", which carries no signature at all', async () => {
    const headerPart = base64Url(JSON.stringify({ alg: 'none', kid: KID }))
    const payloadPart = base64Url(
      JSON.stringify({
        iss: `https://${TEAM_DOMAIN}`,
        aud: [AUD],
        email: 'attacker@evil.test',
        exp: NOW_SECONDS + 600,
      }),
    )
    const result = await authenticatorWith(certsFetch()).authenticate(
      headersWith(`${headerPart}.${payloadPart}.`),
    )
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toMatch(/algorithm/i)
  })

  it('refuses a token minted for a different Access application', async () => {
    const token = await makeToken({ aud: ['some-other-app'] })
    const result = await authenticatorWith(certsFetch()).authenticate(headersWith(token))
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toContain('different application')
  })

  it('refuses a token from a different team', async () => {
    const token = await makeToken({ iss: 'https://someone-else.cloudflareaccess.com' })
    const result = await authenticatorWith(certsFetch()).authenticate(headersWith(token))
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toMatch(/issued by/i)
  })

  it('refuses an expired token', async () => {
    const token = await makeToken({ exp: NOW_SECONDS - 3600 })
    const result = await authenticatorWith(certsFetch()).authenticate(headersWith(token))
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toContain('expired')
  })

  it('refuses a token that is not valid yet', async () => {
    const token = await makeToken({ nbf: NOW_SECONDS + 3600 })
    const result = await authenticatorWith(certsFetch()).authenticate(headersWith(token))
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toContain('not valid yet')
  })

  it('accepts a single-string audience as well as an array', async () => {
    const token = await makeToken({ aud: AUD })
    const result = await authenticatorWith(certsFetch()).authenticate(headersWith(token))
    expect(result).toMatchObject({ ok: true })
  })

  it('refuses a verified token that carries no email', async () => {
    const token = await makeToken({ email: undefined })
    const result = await authenticatorWith(certsFetch()).authenticate(headersWith(token))
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toContain('no email claim')
  })

  it('refuses a token that is not three dot separated parts', async () => {
    const result = await authenticatorWith(certsFetch()).authenticate(headersWith('not-a-jwt'))
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toContain('well formed')
  })

  it('fetches the key set once and reuses it across requests', async () => {
    const fetchImpl = certsFetch()
    const auth = authenticatorWith(fetchImpl)
    const token = await makeToken()
    await auth.authenticate(headersWith(token))
    await auth.authenticate(headersWith(token))
    await auth.authenticate(headersWith(token))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('does not authenticate when the key set cannot be reached', async () => {
    const failing = vi.fn(async () => new Response('nope', { status: 500 }))
    const auth = createAccessAuthenticator(TEAM_DOMAIN, AUD, { fetch: failing, now: () => NOW_MS })
    const result = await auth.authenticate(headersWith(await makeToken()))
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toContain('Could not load')
  })

  it('refuses a token naming a key id the team does not publish', async () => {
    const token = await makeToken({}, { kid: 'unknown-key' })
    const result = await authenticatorWith(certsFetch()).authenticate(headersWith(token))
    expect(result).toMatchObject({ ok: false })
    expect(result.ok === false && result.reason).toContain('unknown key')
  })
})

describe('createAuthenticator', () => {
  it('builds the authenticator the configuration asks for', () => {
    expect(createAuthenticator({ mode: 'developer', email: 'a@b.test' }).mode).toBe('developer')
    expect(createAuthenticator({ mode: 'none', reason: 'x' }).mode).toBe('disabled')
    expect(createAuthenticator({ mode: 'cloudflare-access', teamDomain: TEAM_DOMAIN, aud: AUD }).mode).toBe(
      'cloudflare-access',
    )
    expect(createAuthenticator({ mode: 'password', password: 'a-long-enough-password' }).mode).toBe(
      'password',
    )
  })
})

describe('password gate', () => {
  const PASSWORD = 'correct-horse-battery-staple'
  const nowSeconds = Math.floor(NOW_MS / 1000)

  it('accepts the right password and refuses the wrong one', async () => {
    expect(await checkPassword(PASSWORD, PASSWORD)).toBe(true)
    expect(await checkPassword('wrong', PASSWORD)).toBe(false)
    expect(await checkPassword('', PASSWORD)).toBe(false)
    // A guess that is a prefix of the real password must not be treated as close.
    expect(await checkPassword(PASSWORD.slice(0, -1), PASSWORD)).toBe(false)
  })

  it('mints a token that verifies with the same password', async () => {
    const token = await createSessionToken(PASSWORD, nowSeconds)
    expect(await verifySessionToken(token, PASSWORD, nowSeconds)).toBe(true)
  })

  it('refuses a token signed with a different password', async () => {
    const token = await createSessionToken('some-other-password', nowSeconds)
    expect(await verifySessionToken(token, PASSWORD, nowSeconds)).toBe(false)
  })

  it('refuses an expired token', async () => {
    const token = await createSessionToken(PASSWORD, nowSeconds, 60)
    expect(await verifySessionToken(token, PASSWORD, nowSeconds + 3600)).toBe(false)
  })

  it('refuses a token whose expiry was edited to a later time', async () => {
    const token = await createSessionToken(PASSWORD, nowSeconds, 60)
    const forged = `${nowSeconds + 999_999}.${token.split('.')[1]}`
    expect(await verifySessionToken(forged, PASSWORD, nowSeconds)).toBe(false)
  })

  it('refuses malformed tokens instead of throwing', async () => {
    for (const bad of ['', '.', 'nodot', 'abc.def', `${nowSeconds}.`, `.${nowSeconds}`]) {
      expect(await verifySessionToken(bad, PASSWORD, nowSeconds)).toBe(false)
    }
  })

  it('authenticates a request carrying a valid session cookie', async () => {
    const auth = createPasswordAuthenticator(PASSWORD, { now: () => NOW_MS })
    const token = await createSessionToken(PASSWORD, nowSeconds)
    const headers = new Headers({ cookie: `${SESSION_COOKIE}=${token}` })
    expect(await auth.authenticate(headers)).toMatchObject({ ok: true })
  })

  it('refuses a request with no cookie, and one with a forged cookie', async () => {
    const auth = createPasswordAuthenticator(PASSWORD, { now: () => NOW_MS })
    expect(await auth.authenticate(new Headers())).toMatchObject({ ok: false })
    const forged = new Headers({ cookie: `${SESSION_COOKIE}=999999999.notasignature` })
    expect(await auth.authenticate(forged)).toMatchObject({ ok: false })
  })

  it('finds its cookie among others', () => {
    expect(readCookie(`a=1; ${SESSION_COOKIE}=xyz; b=2`, SESSION_COOKIE)).toBe('xyz')
    expect(readCookie('other=1', SESSION_COOKIE)).toBeUndefined()
    expect(readCookie(null, SESSION_COOKIE)).toBeUndefined()
  })

  it('refuses a password shorter than the minimum rather than pretending to protect', () => {
    const config = loadAuthConfig({ STUDIO_PASSWORD: 'short' })
    expect(config.mode).toBe('none')
    expect(config.mode === 'none' && config.reason).toContain('at least')
  })

  it('uses the password mode for a long enough password', () => {
    expect(loadAuthConfig({ STUDIO_PASSWORD: PASSWORD })).toEqual({ mode: 'password', password: PASSWORD })
  })

  it('prefers Cloudflare Access over a password when both are set', () => {
    const config = loadAuthConfig({
      ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
      ACCESS_AUD: AUD,
      STUDIO_PASSWORD: PASSWORD,
    })
    expect(config.mode).toBe('cloudflare-access')
  })

  it('prefers a password over a developer identity', () => {
    const config = loadAuthConfig({ STUDIO_PASSWORD: PASSWORD, STUDIO_DEV_IDENTITY: 'dev@example.test' })
    expect(config.mode).toBe('password')
  })
})
