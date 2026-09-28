import { describe, expect, it } from 'vitest'
import { signWebhook, verifyWebhook } from './webhookSignature.ts'
import { svixVector } from './webhookSignature.fixtures.ts'

describe('signWebhook', () => {
  it('matches the published Svix vector exactly', async () => {
    const signature = await signWebhook(
      svixVector.secret,
      svixVector.id,
      svixVector.timestampSeconds,
      svixVector.body,
    )
    // An exact match to an independently-published answer is the strongest
    // proof this works: it is not just self-consistent, it agrees with
    // someone else's implementation of the same scheme.
    expect(signature).toBe(svixVector.expectedSignature)
  })
})

describe('verifyWebhook', () => {
  const headers = {
    'webhook-id': svixVector.id,
    'webhook-timestamp': String(svixVector.timestampSeconds),
    'webhook-signature': svixVector.expectedSignature,
  }

  it("accepts the published vector's own signature, at its own timestamp", async () => {
    const result = await verifyWebhook(
      svixVector.secret,
      headers,
      svixVector.body,
      svixVector.timestampSeconds, // "now" pinned to the vector's timestamp - it is a real 2024 value
    )
    expect(result).toEqual({ valid: true })
  })

  it('rejects a flipped character in the signature', async () => {
    const tampered = {
      ...headers,
      'webhook-signature': svixVector.expectedSignature.replace('r', 'q'),
    }
    const result = await verifyWebhook(
      svixVector.secret,
      tampered,
      svixVector.body,
      svixVector.timestampSeconds,
    )
    expect(result.valid).toBe(false)
  })

  it('rejects a tampered body', async () => {
    const result = await verifyWebhook(
      svixVector.secret,
      headers,
      '{"event_type":"ping","data":{"success":false}}',
      svixVector.timestampSeconds,
    )
    expect(result.valid).toBe(false)
  })

  it('rejects a timestamp older than the tolerance window', async () => {
    const nowSeconds = svixVector.timestampSeconds + 301 // one second past the default 300s tolerance
    const result = await verifyWebhook(svixVector.secret, headers, svixVector.body, nowSeconds)
    expect(result).toEqual({ valid: false, reason: 'Timestamp is too old.' })
  })

  it('rejects a timestamp from the future', async () => {
    const nowSeconds = svixVector.timestampSeconds - 301
    const result = await verifyWebhook(svixVector.secret, headers, svixVector.body, nowSeconds)
    expect(result).toEqual({ valid: false, reason: 'Timestamp is in the future.' })
  })

  it('accepts a timestamp right at the edge of the tolerance window', async () => {
    const nowSeconds = svixVector.timestampSeconds + 300
    const result = await verifyWebhook(svixVector.secret, headers, svixVector.body, nowSeconds)
    expect(result).toEqual({ valid: true })
  })

  it('accepts when the matching signature is one of several space-separated candidates', async () => {
    const rotated = {
      ...headers,
      'webhook-signature': `v1,not-the-right-one== ${svixVector.expectedSignature}`,
    }
    const result = await verifyWebhook(
      svixVector.secret,
      rotated,
      svixVector.body,
      svixVector.timestampSeconds,
    )
    expect(result).toEqual({ valid: true })
  })

  it('rejects when none of several candidates match', async () => {
    const rotated = { ...headers, 'webhook-signature': 'v1,aaaa== v1,bbbb==' }
    const result = await verifyWebhook(
      svixVector.secret,
      rotated,
      svixVector.body,
      svixVector.timestampSeconds,
    )
    expect(result.valid).toBe(false)
  })

  it('rejects a wrong secret', async () => {
    const result = await verifyWebhook(
      'whsec_wrongSecretWrongSecretWrongSecret=',
      headers,
      svixVector.body,
      svixVector.timestampSeconds,
    )
    expect(result.valid).toBe(false)
  })

  it('never throws on missing headers', async () => {
    const result = await verifyWebhook(
      svixVector.secret,
      { 'webhook-id': '', 'webhook-timestamp': '', 'webhook-signature': '' },
      svixVector.body,
      svixVector.timestampSeconds,
    )
    expect(result.valid).toBe(false)
  })
})
