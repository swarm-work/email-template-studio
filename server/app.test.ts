import { describe, expect, it, vi } from 'vitest'
import {
  createApp,
  createRateLimiter,
  LOGIN_ATTEMPTS_PER_MINUTE,
  MAX_HTML_BYTES,
  PREFLIGHT_CACHE_MS,
  rejectForeignRequest,
  STUDIO_REQUEST_HEADER,
  TEST_SUBJECT_PREFIX,
} from './app.ts'
import type { SendServerConfig } from './config.ts'
import {
  createDeveloperAuthenticator,
  createDisabledAuthenticator,
  createPasswordAuthenticator,
} from './auth.ts'
import { createDryRunSender, type EmailSender } from './emailSender.ts'

/** Every existing test predates authentication; they all run as one known developer. */
const testAuth = createDeveloperAuthenticator('tester@example.test')

const enabledConfig: SendServerConfig = {
  enabled: true,
  port: 8787,
  dryRun: true,
  region: 'us-east-1',
  from: 'sender@example.com',
  allowedRecipients: ['qa@example.com'],
  rateLimitPerMinute: 2,
}

const validBody = {
  to: 'qa@example.com',
  subject: 'Hello',
  html: '<p>hi</p>',
  templateId: 'welcome-verification',
}

const LOCAL_HEADERS = {
  'content-type': 'application/json',
  host: '127.0.0.1:8787',
  [STUDIO_REQUEST_HEADER]: '1',
}

function post(
  app: ReturnType<typeof createApp>,
  body: unknown,
  headers: Record<string, string> = LOCAL_HEADERS,
) {
  return app.request('/api/send-test', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('send server API', () => {
  it('reports a disabled server and refuses to send', async () => {
    const app = createApp({
      authenticator: testAuth,
      config: { enabled: false, port: 8787, reason: 'off' },
      sender: null,
    })
    const status = await app.request('/api/send-test/status', { headers: { host: 'localhost:8787' } })
    expect(await status.json()).toEqual({
      enabled: false,
      provider: 'amazon-ses',
      reason: 'off',
      user: 'tester@example.test',
    })
    const response = await post(app, validBody)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ status: 'error', code: 'sending-disabled' })
  })

  it('reports an enabled server without leaking anything but from/recipients/region', async () => {
    const app = createApp({
      authenticator: testAuth,
      config: enabledConfig,
      sender: createDryRunSender(() => {}),
    })
    const body = await (
      await app.request('/api/send-test/status', { headers: { host: 'localhost:8787' } })
    ).json()
    expect(body).toEqual({
      enabled: true,
      user: 'tester@example.test',
      provider: 'amazon-ses',
      mode: 'dry-run',
      from: 'sender@example.com',
      allowedRecipients: ['qa@example.com'],
      region: 'us-east-1',
      rateLimitPerMinute: 2,
      preflight: { ok: true, message: 'Dry run: no AWS calls are made.' },
    })
  })

  it('validates the body', async () => {
    const app = createApp({
      authenticator: testAuth,
      config: enabledConfig,
      sender: createDryRunSender(() => {}),
    })
    expect((await post(app, '{not json')).status).toBe(400)
    const response = await post(app, { ...validBody, to: 'nope' })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      status: 'error',
      code: 'invalid-request',
      issues: [{ path: 'to' }],
    })
  })

  it('refuses recipients outside the allow-list, case-insensitively', async () => {
    const app = createApp({
      authenticator: testAuth,
      config: enabledConfig,
      sender: createDryRunSender(() => {}),
    })
    const refused = await post(app, { ...validBody, to: 'someone-else@example.com' })
    expect(refused.status).toBe(403)
    expect(await refused.json()).toMatchObject({ code: 'recipient-not-allowed' })
    const accepted = await post(app, { ...validBody, to: 'QA@example.com' })
    expect(accepted.status).toBe(200)
    // Sent to the allow-list's spelling, not the caller's.
    expect(await accepted.json()).toMatchObject({ to: 'qa@example.com' })
  })

  it('caps the HTML size', async () => {
    const app = createApp({
      authenticator: testAuth,
      config: enabledConfig,
      sender: createDryRunSender(() => {}),
    })
    const response = await post(app, { ...validBody, html: 'x'.repeat(MAX_HTML_BYTES + 1) })
    expect(response.status).toBe(400)
  })

  it('sends through the sender with the [TEST] prefix and the configured from address', async () => {
    const sent: unknown[] = []
    const sender: EmailSender = {
      mode: 'live',
      async send(email) {
        sent.push(email)
        return { messageId: 'ses-123' }
      },
      async preflight() {
        return { ok: true, message: 'fake' }
      },
    }
    const app = createApp({
      authenticator: testAuth,
      config: enabledConfig,
      sender,
      now: () => 1_700_000_000_000,
    })
    const response = await post(app, { ...validBody, subject: 'Verify your email' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      status: 'sent',
      mode: 'live',
      messageId: 'ses-123',
      to: 'qa@example.com',
      from: 'sender@example.com',
      subject: `${TEST_SUBJECT_PREFIX}Verify your email`,
      templateId: 'welcome-verification',
      sentAt: '2023-11-14T22:13:20.000Z',
    })
    expect(sent).toEqual([
      {
        from: 'sender@example.com',
        to: 'qa@example.com',
        subject: '[TEST] Verify your email',
        html: '<p>hi</p>',
      },
    ])
  })

  it('surfaces provider failures as 502 without crashing', async () => {
    const sender: EmailSender = {
      mode: 'live',
      send: vi.fn(async () => {
        throw new Error('Email address is not verified')
      }),
      async preflight() {
        return { ok: false, message: 'unverified' }
      },
    }
    const app = createApp({ authenticator: testAuth, config: enabledConfig, sender })
    const response = await post(app, validBody)
    expect(response.status).toBe(502)
    expect(await response.json()).toMatchObject({
      code: 'provider-error',
      message: /Send failed: Error: Email address is not verified/,
    })
  })

  it('rate limits per minute', async () => {
    let clock = 0
    const app = createApp({
      authenticator: testAuth,
      config: enabledConfig,
      sender: createDryRunSender(() => {}),
      now: () => clock,
    })
    expect((await post(app, validBody)).status).toBe(200)
    expect((await post(app, validBody)).status).toBe(200)
    expect((await post(app, validBody)).status).toBe(429)
    clock += 61_000
    expect((await post(app, validBody)).status).toBe(200)
  })
})

describe('same-machine guards', () => {
  const app = () =>
    createApp({ authenticator: testAuth, config: enabledConfig, sender: createDryRunSender(() => {}) })

  it('rejects foreign Host headers (DNS rebinding) on every route', async () => {
    const status = await app().request('/api/send-test/status', { headers: { host: 'evil.example:8787' } })
    expect(status.status).toBe(403)
    expect((await post(app(), validBody, { ...LOCAL_HEADERS, host: 'evil.example' })).status).toBe(403)
  })

  it('rejects cross-site Origins even from a local Host', async () => {
    const response = await post(app(), validBody, { ...LOCAL_HEADERS, origin: 'https://attacker.example' })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'forbidden-origin' })
    const viaVite = await post(app(), validBody, {
      ...LOCAL_HEADERS,
      host: 'localhost:5173',
      origin: 'http://localhost:5173',
    })
    expect(viaVite.status).toBe(200)
  })

  it('requires a JSON content type and the studio header (both force a CORS preflight)', async () => {
    const plain = await post(app(), validBody, {
      host: '127.0.0.1:8787',
      'content-type': 'text/plain',
      [STUDIO_REQUEST_HEADER]: '1',
    })
    expect(plain.status).toBe(415)
    const noHeader = await post(app(), validBody, {
      host: '127.0.0.1:8787',
      'content-type': 'application/json',
    })
    expect(noHeader.status).toBe(400)
  })

  it('does not double an existing [TEST] prefix, whatever its spacing', async () => {
    const sent: string[] = []
    const sender: EmailSender = {
      mode: 'live',
      async send(email) {
        sent.push(email.subject)
        return { messageId: 'x' }
      },
      async preflight() {
        return { ok: true, message: 'fake' }
      },
    }
    const app = createApp({ authenticator: testAuth, config: enabledConfig, sender })
    await post(app, { ...validBody, subject: '[TEST]Already' })
    await post(app, { ...validBody, subject: '[test] lower' })
    expect(sent).toEqual(['[TEST]Already', '[test] lower'])
  })

  it('rejects subjects with control characters', async () => {
    const response = await post(app(), { ...validBody, subject: 'Hi\r\nBcc: x@y.z' })
    expect(response.status).toBe(400)
  })

  it('same-origin policy accepts any Host but refuses a foreign Origin', () => {
    const policy = 'same-origin'
    expect(rejectForeignRequest('studio.example.workers.dev', undefined, policy)).toBeNull()
    expect(
      rejectForeignRequest('studio.example.workers.dev', 'https://studio.example.workers.dev', policy),
    ).toBeNull()
    expect(
      rejectForeignRequest('Studio.Example.workers.dev', 'https://studio.example.workers.dev', policy),
    ).toBeNull()
    expect(rejectForeignRequest('localhost:4173', 'http://localhost:4173', policy)).toBeNull()
    expect(rejectForeignRequest('studio.example.workers.dev', 'https://attacker.example', policy)).toMatch(
      /Cross-site/,
    )
    expect(rejectForeignRequest('localhost:4173', 'http://localhost:5173', policy)).toMatch(/Cross-site/)
    expect(rejectForeignRequest(undefined, undefined, policy)).toMatch(/Host/)
  })

  it('an app with the same-origin policy serves a public hostname', async () => {
    const app = createApp({
      authenticator: testAuth,
      config: enabledConfig,
      sender: createDryRunSender(() => {}),
      hostPolicy: 'same-origin',
    })
    const status = await app.request('/api/send-test/status', {
      headers: { host: 'studio.example.workers.dev' },
    })
    expect(status.status).toBe(200)
    const crossSite = await post(app, validBody, {
      ...LOCAL_HEADERS,
      host: 'studio.example.workers.dev',
      origin: 'https://attacker.example',
    })
    expect(crossSite.status).toBe(403)
  })

  it('rejectForeignRequest understands ports and IPv6 hosts', () => {
    expect(rejectForeignRequest('localhost:8787', undefined)).toBeNull()
    expect(rejectForeignRequest('[::1]:8787', 'http://localhost:5173')).toBeNull()
    expect(rejectForeignRequest(undefined, undefined)).toMatch(/Host/)
    expect(rejectForeignRequest('127.0.0.1', 'not a url')).toMatch(/Origin/)
    expect(rejectForeignRequest('127.0.0.1:8787', 'null')).toMatch(/Origin/)
  })
})

describe('preflight caching', () => {
  it('asks the sender once per cache window', async () => {
    let clock = 0
    let calls = 0
    const sender: EmailSender = {
      mode: 'live',
      async send() {
        return { messageId: 'x' }
      },
      async preflight() {
        calls += 1
        return { ok: true, message: `call ${calls}` }
      },
    }
    const app = createApp({ authenticator: testAuth, config: enabledConfig, sender, now: () => clock })
    const local = { headers: { host: 'localhost:8787' } }
    await app.request('/api/send-test/status', local)
    await app.request('/api/send-test/status', local)
    expect(calls).toBe(1)
    clock += PREFLIGHT_CACHE_MS + 1
    await app.request('/api/send-test/status', local)
    expect(calls).toBe(2)
  })
})

describe('createRateLimiter', () => {
  it('never allows when the limit is zero', () => {
    expect(createRateLimiter(0, () => 0).tryAcquire()).toBe(false)
  })
})

describe('authentication', () => {
  const sender = createDryRunSender(() => {})

  it('refuses every API route when no authenticator is supplied (fail closed)', async () => {
    const app = createApp({ config: enabledConfig, sender })
    const status = await app.request('/api/send-test/status', { headers: { host: 'localhost:8787' } })
    expect(status.status).toBe(401)
    expect(await status.json()).toMatchObject({ status: 'error', code: 'unauthenticated' })

    const send = await post(app, validBody)
    expect(send.status).toBe(401)
  })

  it('refuses a request the authenticator rejects, and says why', async () => {
    const app = createApp({
      authenticator: createDisabledAuthenticator('token was not signed by this team'),
      config: enabledConfig,
      sender,
    })
    const response = await app.request('/api/send-test/status', { headers: { host: 'localhost:8787' } })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ message: 'token was not signed by this team' })
  })

  it('checks the origin before the identity, so a cross-site call is refused as such', async () => {
    const app = createApp({ config: enabledConfig, sender })
    const response = await app.request('/api/send-test/status', {
      headers: { host: 'localhost:8787', origin: 'https://evil.example' },
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'forbidden-origin' })
  })

  it('names the authenticated caller in the status response', async () => {
    const app = createApp({ authenticator: testAuth, config: enabledConfig, sender })
    const body = await (
      await app.request('/api/send-test/status', { headers: { host: 'localhost:8787' } })
    ).json()
    expect(body).toMatchObject({ user: 'tester@example.test' })
  })
})

describe('the password sign-in route', () => {
  const PASSWORD = 'correct-horse-battery-staple'
  const sender = createDryRunSender(() => {})

  /** An app in the shared-password mode, exactly as the Worker builds it. */
  function passwordApp(now = () => 1_760_000_000_000) {
    return createApp({
      config: enabledConfig,
      sender,
      authenticator: createPasswordAuthenticator(PASSWORD, { now }),
      passwordGate: { password: PASSWORD },
      now,
    })
  }

  function signIn(app: ReturnType<typeof createApp>, password: string) {
    return app.request('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost:8787' },
      body: JSON.stringify({ password }),
    })
  }

  it('refuses the API before sign-in and names the mode so the UI can prompt', async () => {
    const response = await passwordApp().request('/api/send-test/status', {
      headers: { host: 'localhost:8787' },
    })
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'unauthenticated', mode: 'password' })
  })

  it('sets an HttpOnly, SameSite cookie for the right password', async () => {
    const response = await signIn(passwordApp(), PASSWORD)
    expect(response.status).toBe(200)
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('studio_session=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    // The password itself must never travel back to the browser.
    expect(cookie).not.toContain(PASSWORD)
  })

  it('lets the API through once the cookie is presented', async () => {
    const app = passwordApp()
    const cookie = (await signIn(app, PASSWORD)).headers.get('set-cookie') ?? ''
    const sessionCookie = cookie.split(';')[0]
    const response = await app.request('/api/send-test/status', {
      headers: { host: 'localhost:8787', cookie: sessionCookie },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ user: 'shared-password' })
  })

  it('refuses the wrong password without a cookie', async () => {
    const response = await signIn(passwordApp(), 'not-the-password')
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(await response.json()).toMatchObject({ code: 'invalid-password' })
  })

  it('throttles guessing', async () => {
    const app = passwordApp(() => 1_760_000_000_000)
    for (let attempt = 0; attempt < LOGIN_ATTEMPTS_PER_MINUTE; attempt += 1) {
      expect((await signIn(app, 'wrong')).status).toBe(401)
    }
    const throttled = await signIn(app, 'wrong')
    expect(throttled.status).toBe(429)
    // Still throttled even if the next guess happens to be correct.
    expect((await signIn(app, PASSWORD)).status).toBe(429)
  })

  it('clears the cookie on sign out', async () => {
    const response = await passwordApp().request('/api/session', {
      method: 'DELETE',
      headers: { host: 'localhost:8787' },
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('has no sign-in route at all when there is no password gate', async () => {
    const app = createApp({ authenticator: testAuth, config: enabledConfig, sender })
    const response = await signIn(app, PASSWORD)
    expect(response.status).toBe(404)
  })
})
