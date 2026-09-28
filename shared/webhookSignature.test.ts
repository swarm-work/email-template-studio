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
    expect(result).toEqual({ ok: true })
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
    expect(result.ok).toBe(false)
  })

  it('rejects a tampered body', async () => {
    const result = await verifyWebhook(
      svixVector.secret,
      headers,
      '{"event_type":"ping","data":{"success":false}}',
      svixVector.timestampSeconds,
    )
    expect(result.ok).toBe(false)
  })

  it('rejects a timestamp older than the tolerance window', async () => {
    const nowSeconds = svixVector.timestampSeconds + 301 // one second past the default 300s tolerance
    const result = await verifyWebhook(svixVector.secret, headers, svixVector.body, nowSeconds)
    expect(result).toEqual({ ok: false, reason: 'Timestamp is too old.' })
  })

  it('rejects a timestamp from the future', async () => {
    const nowSeconds = svixVector.timestampSeconds - 301
    const result = await verifyWebhook(svixVector.secret, headers, svixVector.body, nowSeconds)
    expect(result).toEqual({ ok: false, reason: 'Timestamp is in the future.' })
  })

  it('accepts a timestamp right at the edge of the tolerance window', async () => {
    const nowSeconds = svixVector.timestampSeconds + 300
    const result = await verifyWebhook(svixVector.secret, headers, svixVector.body, nowSeconds)
    expect(result).toEqual({ ok: true })
  })

  it('rejects a NaN "now" (or a NaN tolerance) instead of failing open', async () => {
    // With a NaN clock, `age` would be NaN, and both the too-old and
    // too-future comparisons are false for NaN - the staleness check would
    // silently pass for any timestamp at all if this guard were missing.
    const byBadClock = await verifyWebhook(svixVector.secret, headers, svixVector.body, NaN)
    expect(byBadClock).toEqual({ ok: false, reason: 'Invalid clock or tolerance.' })

    const byBadTolerance = await verifyWebhook(
      svixVector.secret,
      headers,
      svixVector.body,
      svixVector.timestampSeconds,
      NaN,
    )
    expect(byBadTolerance).toEqual({ ok: false, reason: 'Invalid clock or tolerance.' })
  })

  it('accepts when the matching signature is one of several space-separated candidates', async () => {
    // The decoy is a real signature made with a different secret (the
    // key-rotation case), not just invalid base64 that would be dropped
    // before ever reaching the byte comparison.
    const otherSecretSignature = await signWebhook(
      'whsec_ZGlmZmVyZW50U2VjcmV0Rm9yUm90YXRpb24=',
      svixVector.id,
      svixVector.timestampSeconds,
      svixVector.body,
    )
    const rotated = {
      ...headers,
      // A "v1a" candidate (a version this scheme doesn't know) must be
      // skipped rather than mistaken for a "v1" one.
      'webhook-signature': `${otherSecretSignature} v1a,${otherSecretSignature.slice(3)} ${svixVector.expectedSignature}`,
    }
    const result = await verifyWebhook(
      svixVector.secret,
      rotated,
      svixVector.body,
      svixVector.timestampSeconds,
    )
    expect(result).toEqual({ ok: true })
  })

  it('rejects when none of several valid-but-wrong candidates match', async () => {
    const otherSecretSignatureA = await signWebhook(
      'whsec_Zmlyc3RXcm9uZ1NlY3JldEZvclRlc3Q=',
      svixVector.id,
      svixVector.timestampSeconds,
      svixVector.body,
    )
    const otherSecretSignatureB = await signWebhook(
      'whsec_c2Vjb25kV3JvbmdTZWNyZXRGb3JUZXN0',
      svixVector.id,
      svixVector.timestampSeconds,
      svixVector.body,
    )
    const rotated = {
      ...headers,
      'webhook-signature': `${otherSecretSignatureA} ${otherSecretSignatureB}`,
    }
    const result = await verifyWebhook(
      svixVector.secret,
      rotated,
      svixVector.body,
      svixVector.timestampSeconds,
    )
    expect(result).toEqual({ ok: false, reason: 'No signature in webhook-signature matched.' })
  })

  it('rejects a wrong secret with a mismatch, not a base64-decoding failure', async () => {
    // This secret is well-formed `whsec_<base64>` (confirmed to decode
    // cleanly), so this proves the wrong-key comparison path itself rejects
    // the key, rather than merely tripping over malformed base64 before ever
    // reaching that comparison.
    const result = await verifyWebhook(
      'whsec_d3JvbmdTZWNyZXRXcm9uZ1NlY3JldA==',
      headers,
      svixVector.body,
      svixVector.timestampSeconds,
    )
    expect(result).toEqual({ ok: false, reason: 'No signature in webhook-signature matched.' })
  })

  it('never throws on missing headers', async () => {
    const result = await verifyWebhook(
      svixVector.secret,
      { 'webhook-id': '', 'webhook-timestamp': '', 'webhook-signature': '' },
      svixVector.body,
      svixVector.timestampSeconds,
    )
    expect(result.ok).toBe(false)
  })

  it('rejects a webhook-timestamp that is not a plain integer', async () => {
    for (const badTimestamp of ['0x673770E1', '1.731705121e9', ' 1731705121 ', '1731705121.0']) {
      const result = await verifyWebhook(
        svixVector.secret,
        { ...headers, 'webhook-timestamp': badTimestamp },
        svixVector.body,
        svixVector.timestampSeconds,
      )
      expect(result).toEqual({ ok: false, reason: 'webhook-timestamp must be a plain non-negative integer.' })
    }
  })
})
