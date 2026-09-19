import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUDIO_FEATURES } from '@/domain'
import { HttpTestEmailProvider, NoSendEmailProvider, SERVER_NOT_RUNNING_REASON } from './emailProvider'

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch
}

const email = { to: ['qa@example.com'], subject: 'Hi', html: '<p>x</p>', text: 'x', templateId: 't' }

describe('NoSendEmailProvider', () => {
  it('is never connected and never sends', async () => {
    const provider = new NoSendEmailProvider()
    expect((await provider.getStatus()).connected).toBe(false)
    expect((await provider.send()).status).toBe('not-sent')
  })
})

describe('HttpTestEmailProvider', () => {
  it('reports not connected when the server is unreachable', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    const provider = new HttpTestEmailProvider('/api/send-test', failing)
    expect(await provider.getStatus()).toEqual({
      connected: false,
      reason: SERVER_NOT_RUNNING_REASON,
      features: DEFAULT_STUDIO_FEATURES,
    })
    expect(await provider.send(email)).toMatchObject({ status: 'not-sent', code: 'server-unreachable' })
  })

  it('maps a disabled server to a reason', async () => {
    const provider = new HttpTestEmailProvider(
      '/api/send-test',
      fetchReturning(200, { enabled: false, reason: 'off' }),
    )
    expect(await provider.getStatus()).toEqual({
      connected: false,
      reason: 'off',
      features: DEFAULT_STUDIO_FEATURES,
    })
  })

  it('reads the feature flags, on both the enabled and the disabled branch', async () => {
    const off = new HttpTestEmailProvider(
      '/api/send-test',
      fetchReturning(200, { enabled: false, reason: 'off', features: { visualEditor: false } }),
    )
    expect((await off.getStatus()).features).toEqual({ visualEditor: false })

    const on = new HttpTestEmailProvider(
      '/api/send-test',
      fetchReturning(200, {
        enabled: true,
        provider: 'amazon-ses',
        mode: 'live',
        from: 'a@b.co',
        allowedRecipients: [],
        region: 'us-east-1',
        features: { visualEditor: false },
      }),
    )
    expect((await on.getStatus()).features).toEqual({ visualEditor: false })
  })

  it('parses a connected status, ignores unknown fields and fills in safe defaults', async () => {
    // A server that predates the recipient policy sends neither new field; the
    // defaults must be the closed reading, not the open one.
    const provider = new HttpTestEmailProvider(
      '/api/send-test',
      fetchReturning(200, {
        enabled: true,
        provider: 'amazon-ses',
        mode: 'live',
        from: 'a@b.co',
        allowedRecipients: ['q@b.co'],
        region: 'us-east-1',
        extra: 1,
      }),
    )
    expect(await provider.getStatus()).toEqual({
      connected: true,
      // A server that predates the flag sends no `features` at all, and the
      // safe reading is "everything on": the flag switches something OFF.
      features: DEFAULT_STUDIO_FEATURES,
      provider: 'amazon-ses',
      mode: 'live',
      from: 'a@b.co',
      recipientPolicy: 'allow-list',
      allowedRecipients: ['q@b.co'],
      maxRecipientsPerSend: 10,
      region: 'us-east-1',
    })
  })

  it('passes the "any" recipient policy and the cap through', async () => {
    const provider = new HttpTestEmailProvider(
      '/api/send-test',
      fetchReturning(200, {
        enabled: true,
        provider: 'amazon-ses',
        mode: 'live',
        from: 'a@b.co',
        recipientPolicy: 'any',
        allowedRecipients: [],
        maxRecipientsPerSend: 10,
        region: 'us-east-1',
      }),
    )
    expect(await provider.getStatus()).toMatchObject({
      recipientPolicy: 'any',
      allowedRecipients: [],
      maxRecipientsPerSend: 10,
    })
  })

  it('rejects malformed responses instead of trusting them', async () => {
    const provider = new HttpTestEmailProvider('/api/send-test', fetchReturning(200, { enabled: true }))
    expect((await provider.getStatus()).connected).toBe(false)
    const sendProvider = new HttpTestEmailProvider('/api/send-test', fetchReturning(200, { status: 'sent' }))
    expect(await sendProvider.send(email)).toMatchObject({ status: 'not-sent', code: 'unexpected-response' })
  })

  it('treats a non-JSON 5xx from the proxy as the server being down', async () => {
    const html = vi.fn(
      async () => new Response('<html>502</html>', { status: 502 }),
    ) as unknown as typeof fetch
    const provider = new HttpTestEmailProvider('/api/send-test', html)
    expect(await provider.send(email)).toMatchObject({ status: 'not-sent', code: 'server-unreachable' })
  })

  it('returns sent outcomes and server errors', async () => {
    const ok = new HttpTestEmailProvider(
      '/api/send-test',
      fetchReturning(200, {
        status: 'sent',
        mode: 'dry-run',
        messageId: 'dry-run-1',
        to: ['q@b.co', 'second@b.co'],
        from: 'a@b.co',
        subject: '[TEST] Hi',
        sentAt: 'now',
      }),
    )
    expect(await ok.send(email)).toMatchObject({
      status: 'sent',
      messageId: 'dry-run-1',
      to: ['q@b.co', 'second@b.co'],
    })
    const [, init] = (ok as unknown as { fetchImpl: ReturnType<typeof vi.fn> }).fetchImpl.mock.calls[0] as [
      string,
      RequestInit,
    ]
    expect(new Headers(init.headers).get('x-studio-send')).toBe('1')
    const refused = new HttpTestEmailProvider(
      '/api/send-test',
      fetchReturning(403, { status: 'error', code: 'recipient-not-allowed', message: 'no' }),
    )
    expect(await refused.send(email)).toEqual({
      status: 'not-sent',
      code: 'recipient-not-allowed',
      message: 'no',
    })
  })
})
