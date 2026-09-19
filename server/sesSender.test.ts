/**
 * Tests for the Amazon SES client. No network and no AWS account: `fetch` is
 * injected, so every assertion is about the request we would have sent and the
 * way we read the response back.
 */
import { describe, expect, it } from 'vitest'
import { SesApiError, createSesSender } from './sesSender.ts'

const credentials = { accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret-example' }

interface Call {
  readonly method: string
  readonly url: string
  readonly authorization: string
  readonly body: string
}

/** Records every request and answers from `routes`, matched on a URL substring. */
function fakeFetch(
  routes: { match: string; status?: number; headers?: Record<string, string>; body: unknown }[],
) {
  const calls: Call[] = []
  const impl = async (request: Request): Promise<Response> => {
    calls.push({
      method: request.method,
      url: request.url,
      authorization: request.headers.get('authorization') ?? '',
      body: await request.text(),
    })
    const route = routes.find((candidate) => request.url.includes(candidate.match))
    if (!route) return new Response('{}', { status: 404 })
    const body = typeof route.body === 'string' ? route.body : JSON.stringify(route.body)
    return new Response(body, { status: route.status ?? 200, headers: route.headers })
  }
  return { calls, impl }
}

const email = {
  from: 'studio@example.com',
  to: ['qa@example.com', 'second@example.com'],
  subject: '[TEST] Hi',
  html: '<p>Hi</p>',
}

describe('createSesSender.send', () => {
  it('posts a signed SendEmail request to the regional endpoint and returns the message id', async () => {
    const { calls, impl } = fakeFetch([
      { match: '/v2/email/outbound-emails', body: { MessageId: 'abc-123' } },
    ])
    const sender = createSesSender({ region: 'eu-west-1', credentials, fetch: impl })

    const receipt = await sender.send(email)

    expect(receipt.messageId).toBe('abc-123')
    expect(calls).toHaveLength(1)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toBe('https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails')
    // Signed for the "ses" service in the configured region, not for "email".
    expect(calls[0].authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/eu-west-1\/ses\/aws4_request/,
    )
    expect(JSON.parse(calls[0].body)).toEqual({
      FromEmailAddress: 'studio@example.com',
      // Every recipient travels in the To header of a single SendEmail call.
      Destination: { ToAddresses: ['qa@example.com', 'second@example.com'] },
      Content: {
        Simple: {
          Subject: { Data: '[TEST] Hi', Charset: 'UTF-8' },
          Body: { Html: { Data: '<p>Hi</p>', Charset: 'UTF-8' } },
        },
      },
    })
  })

  it('sends ReplyToAddresses at the top level when reply-to is set', async () => {
    const { calls, impl } = fakeFetch([{ match: '/outbound-emails', body: { MessageId: 'x' } }])
    const sender = createSesSender({ region: 'us-east-1', credentials, fetch: impl })

    await sender.send({ ...email, replyTo: ['support@example.com'] })

    const body = JSON.parse(calls[0].body)
    // Beside Destination, NOT inside Content - SES ignores it anywhere else.
    expect(body.ReplyToAddresses).toEqual(['support@example.com'])
  })

  it('omits ReplyToAddresses entirely when there is no reply-to', async () => {
    const { calls, impl } = fakeFetch([{ match: '/outbound-emails', body: { MessageId: 'x' } }])
    const sender = createSesSender({ region: 'us-east-1', credentials, fetch: impl })

    await sender.send({ ...email, replyTo: [] })

    // Absent, not null: SES refuses an explicit null.
    expect('ReplyToAddresses' in JSON.parse(calls[0].body)).toBe(false)
  })

  it('adds the Text part when the plain-text alternative is not empty', async () => {
    const { calls, impl } = fakeFetch([{ match: '/outbound-emails', body: { MessageId: 'x' } }])
    const sender = createSesSender({ region: 'us-east-1', credentials, fetch: impl })

    await sender.send({ ...email, text: 'Hi' })

    expect(JSON.parse(calls[0].body).Content.Simple.Body).toEqual({
      Html: { Data: '<p>Hi</p>', Charset: 'UTF-8' },
      Text: { Data: 'Hi', Charset: 'UTF-8' },
    })
  })

  it('sends no Text part for an empty or absent plain text', async () => {
    const { calls, impl } = fakeFetch([{ match: '/outbound-emails', body: { MessageId: 'x' } }])
    const sender = createSesSender({ region: 'us-east-1', credentials, fetch: impl })

    await sender.send({ ...email, text: '' })

    // An empty Text part is worse than none: a text-first client would show a
    // blank message instead of falling back to the HTML.
    expect(JSON.parse(calls[0].body).Content.Simple.Body).toEqual({
      Html: { Data: '<p>Hi</p>', Charset: 'UTF-8' },
    })
  })

  it('includes the configuration set only when one is configured', async () => {
    const { calls, impl } = fakeFetch([{ match: '/outbound-emails', body: { MessageId: 'x' } }])
    const sender = createSesSender({
      region: 'us-east-1',
      credentials,
      configurationSet: 'studio-events',
      fetch: impl,
    })

    await sender.send(email)

    expect(JSON.parse(calls[0].body).ConfigurationSetName).toBe('studio-events')
  })

  it('reports the SES error type and sentence instead of a bare HTTP status', async () => {
    const { impl } = fakeFetch([
      {
        match: '/outbound-emails',
        status: 400,
        headers: { 'x-amzn-errortype': 'MessageRejected:http://internal.amazon.com/coral/' },
        body: { message: 'Email address is not verified.' },
      },
    ])
    const sender = createSesSender({ region: 'us-east-1', credentials, fetch: impl })

    await expect(sender.send(email)).rejects.toThrow(SesApiError)
    await expect(sender.send(email)).rejects.toMatchObject({
      name: 'MessageRejected',
      message: 'Email address is not verified.',
      status: 400,
    })
  })
})

describe('createSesSender.preflight', () => {
  const verifiedAddress = {
    match: '/v2/email/identities/studio%40example.com',
    body: { VerifiedForSendingStatus: true },
  }

  it('reports a verified sender and production access', async () => {
    const { impl } = fakeFetch([
      {
        match: '/v2/email/account',
        body: { ProductionAccessEnabled: true, SendQuota: { Max24HourSend: 50000, SentLast24Hours: 12 } },
      },
      verifiedAddress,
    ])
    const sender = createSesSender({ region: 'us-east-1', credentials, fetch: impl })

    const result = await sender.preflight('studio@example.com')

    expect(result).toMatchObject({
      ok: true,
      sandbox: false,
      identityVerified: true,
      dailyQuota: 50000,
      sentLast24Hours: 12,
    })
    expect(result.message).toContain('production access')
  })

  it('falls back to the domain identity when the address itself is not an identity', async () => {
    const { calls, impl } = fakeFetch([
      { match: '/v2/email/account', body: { ProductionAccessEnabled: false } },
      {
        match: '/v2/email/identities/studio%40example.com',
        status: 404,
        headers: { 'x-amzn-errortype': 'NotFoundException' },
        body: { message: 'Email identity not found.' },
      },
      { match: '/v2/email/identities/example.com', body: { VerifiedForSendingStatus: true } },
    ])
    const sender = createSesSender({ region: 'us-east-1', credentials, fetch: impl })

    const result = await sender.preflight('studio@example.com')

    expect(result.ok).toBe(true)
    expect(result.sandbox).toBe(true)
    expect(result.message).toContain('sandbox')
    expect(calls.map((call) => call.url)).toContain(
      'https://email.us-east-1.amazonaws.com/v2/email/identities/example.com',
    )
  })

  it('turns an unreachable or unauthorised SES into a readable status instead of throwing', async () => {
    const { impl } = fakeFetch([
      {
        match: '/v2/email/account',
        status: 403,
        headers: { 'x-amzn-errortype': 'AccessDeniedException' },
        body: { message: 'User is not authorized to perform ses:GetAccount.' },
      },
    ])
    const sender = createSesSender({ region: 'us-east-1', credentials, fetch: impl })

    const result = await sender.preflight('studio@example.com')

    expect(result.ok).toBe(false)
    expect(result.message).toContain('ses:GetAccount')
  })
})
