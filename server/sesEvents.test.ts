/**
 * One test per SES `eventType`, plus malformed input. Pure and offline, no
 * network, same style as `server/sesSender.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { parseSesEvent } from './sesEvents.ts'
import {
  bounceFixture,
  clickFixture,
  complaintFixture,
  deliveryDelayFixture,
  deliveryFixture,
  openFixture,
  rejectFixture,
  renderingFailureFixture,
  sendFixture,
  subscriptionFixture,
  transientBounceFixture,
} from './sesEvents.fixtures.ts'

describe('parseSesEvent', () => {
  it('translates Send', () => {
    const result = parseSesEvent(sendFixture)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.event.type).toBe('email.sent')
    expect(result.event.providerMessageId).toBe('EXAMPLE-msg-id-000000')
    expect(result.event.detail).toEqual({ kind: 'send' })
    expect(result.event.occurredAt).toBe(sendFixture.mail.timestamp)
    expect(result.event.tags.studio_message).toEqual(['msg_01J000000000000000000000'])
  })

  it('translates Reject', () => {
    const result = parseSesEvent(rejectFixture)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.event.type).toBe('email.rejected')
    expect(result.event.detail).toEqual({ kind: 'reject', reason: 'Bad content' })
  })

  it('translates Delivery', () => {
    const result = parseSesEvent(deliveryFixture)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.event.type).toBe('email.delivered')
    expect(result.event.occurredAt).toBe('2026-09-20T12:00:04.133Z')
    expect(result.event.detail).toEqual({
      kind: 'delivery',
      recipients: ['recipient@example.com'],
      smtpResponse: '250 2.6.0 Message received',
    })
  })

  it('translates Bounce, exposing bounceType for suppression', () => {
    const result = parseSesEvent(bounceFixture)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.event.type).toBe('email.bounced')
    expect(result.event.detail).toEqual({
      kind: 'bounce',
      bounceType: 'Permanent',
      bounceSubType: 'General',
      recipients: ['recipient@example.com'],
    })
  })

  it('translates a Transient bounce distinctly from a Permanent one', () => {
    const result = parseSesEvent(transientBounceFixture)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.event.detail).toMatchObject({ bounceType: 'Transient', bounceSubType: 'MailboxFull' })
  })

  it('translates Complaint', () => {
    const result = parseSesEvent(complaintFixture)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.event.type).toBe('email.complained')
    expect(result.event.detail).toEqual({
      kind: 'complaint',
      complaintFeedbackType: 'abuse',
      recipients: ['recipient@example.com'],
    })
  })

  it('translates Open', () => {
    const result = parseSesEvent(openFixture)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.event.type).toBe('email.opened')
    expect(result.event.occurredAt).toBe('2026-09-20T12:05:19.652Z')
  })

  it('translates Click', () => {
    const result = parseSesEvent(clickFixture)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.event.type).toBe('email.clicked')
    expect(result.event.detail).toEqual({
      kind: 'click',
      ipAddress: '203.0.113.2',
      link: 'https://swarm.camp/invoice/123',
      userAgent: 'Mozilla/5.0',
    })
  })

  it('translates "Rendering Failure" (with the space) and reads its detail from "failure"', () => {
    const result = parseSesEvent(renderingFailureFixture)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.event.type).toBe('email.failed')
    expect(result.event.detail).toEqual({
      kind: 'failure',
      errorMessage: "Attribute 'firstName' is not present in the rendering data.",
      templateName: 'invoice-issued',
    })
  })

  it('translates DeliveryDelay, reading its detail from the camelCase "deliveryDelay" key', () => {
    const result = parseSesEvent(deliveryDelayFixture)
    expect(result.kind).toBe('parsed')
    if (result.kind !== 'parsed') return
    expect(result.event.type).toBe('email.delivery_delayed')
    expect(result.event.detail).toEqual({
      kind: 'deliveryDelay',
      delayType: 'TransientCommunicationFailure',
      recipients: ['recipient@example.com'],
    })
  })

  it('ignores Subscription instead of failing', () => {
    const result = parseSesEvent(subscriptionFixture)
    expect(result).toEqual({ kind: 'ignored', eventType: 'Subscription' })
  })

  it('reports malformed input without throwing', () => {
    expect(() => parseSesEvent({ not: 'an SES event' })).not.toThrow()
    const result = parseSesEvent({ not: 'an SES event' })
    expect(result.kind).toBe('invalid')

    expect(() => parseSesEvent(null)).not.toThrow()
    expect(parseSesEvent(null).kind).toBe('invalid')

    expect(() => parseSesEvent('just a string')).not.toThrow()
    expect(parseSesEvent('just a string').kind).toBe('invalid')

    // A known eventType with garbage detail still fails cleanly, not with a throw.
    const badBounce = parseSesEvent({ eventType: 'Bounce', mail: sendFixture.mail, bounce: { oops: true } })
    expect(badBounce.kind).toBe('invalid')
  })
})
