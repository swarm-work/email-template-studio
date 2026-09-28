/**
 * Turns the raw JSON Amazon SES publishes (inside an SNS `Notification`'s
 * `Message` string) into the small, stable shape the rest of the app uses
 * (docs/PLATFORM_PLAN.md section 5.4). Checking that the SNS envelope itself
 * is genuine (decision 36; see the spike verdict in this PR's description) is
 * a separate step, done before this file ever sees the JSON.
 *
 * Field names below are checked against AWS's own worked examples, not typed
 * from memory:
 * https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-examples.html
 * (fetched 2026-09-29). That page lists exactly ten `eventType` values - the
 * ten `sesEventTypeSchema` below - including `"Rendering Failure"` (with a
 * space; its detail sits under the JSON key `failure`, not `renderingFailure`)
 * and `Subscription`, which this app does not act on (see `parseSesEvent`).
 *
 * Like `server/sesSender.ts`, every `z.object()` below only lists the fields
 * this app reads; Zod quietly ignores whatever else AWS includes.
 *
 * This file is runtime neutral (no `node:*` imports) so it can be unit tested
 * anywhere and later imported by the Worker route that receives the webhook.
 */
import { z } from 'zod'

// ---------------------------------------------------------------------------
// The envelope every SES event shares
// ---------------------------------------------------------------------------

/** The exact ten strings AWS uses. Order matches the AWS docs page's table of contents. */
export const sesEventTypeSchema = z.enum([
  'Bounce',
  'Complaint',
  'Delivery',
  'Send',
  'Reject',
  'Open',
  'Click',
  'Rendering Failure',
  'DeliveryDelay',
  'Subscription',
])
export type SesEventType = z.infer<typeof sesEventTypeSchema>

/**
 * Every event type's `mail` object carries at least these two fields. Tag
 * values are always arrays (AWS lets the same tag key repeat), even though in
 * practice every tag here has exactly one value.
 */
const mailSchema = z.object({
  messageId: z.string().min(1),
  timestamp: z.string().min(1),
  tags: z.record(z.string(), z.array(z.string())).optional(),
})

/** One recipient inside a bounce, matching `bouncedRecipients[]` in the AWS example. */
const bouncedRecipientSchema = z.object({
  emailAddress: z.string(),
  diagnosticCode: z.string().optional(),
})

const bounceDetailSchema = z.object({
  bounceType: z.enum(['Permanent', 'Transient', 'Undetermined']),
  bounceSubType: z.string(),
  bouncedRecipients: z.array(bouncedRecipientSchema),
  timestamp: z.string(),
})

const complaintDetailSchema = z.object({
  complainedRecipients: z.array(z.object({ emailAddress: z.string() })),
  timestamp: z.string(),
  complaintFeedbackType: z.string().optional(),
})

const deliveryDetailSchema = z.object({
  timestamp: z.string(),
  recipients: z.array(z.string()),
  smtpResponse: z.string().optional(),
})

/** The AWS example shows `"send": {}` - nothing else to read. */
const sendDetailSchema = z.object({})

const rejectDetailSchema = z.object({
  reason: z.string(),
})

const openDetailSchema = z.object({
  timestamp: z.string(),
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
})

const clickDetailSchema = z.object({
  timestamp: z.string(),
  ipAddress: z.string().optional(),
  link: z.string(),
  userAgent: z.string().optional(),
})

/** Rendering Failure's detail key really is `failure`, confirmed against the live AWS docs. */
const failureDetailSchema = z.object({
  errorMessage: z.string(),
  templateName: z.string().optional(),
})

const delayedRecipientSchema = z.object({
  emailAddress: z.string(),
  diagnosticCode: z.string().optional(),
})

/** DeliveryDelay's detail key is `deliveryDelay`, camelCase like the event name. */
const deliveryDelayDetailSchema = z.object({
  timestamp: z.string(),
  delayType: z.string(),
  delayedRecipients: z.array(delayedRecipientSchema),
})

// ---------------------------------------------------------------------------
// The shape this app uses everywhere else (PLATFORM_PLAN.md section 5.4)
// ---------------------------------------------------------------------------

/** The nine names slice 4/5 dispatch on. `Subscription` has no entry: see `parseSesEvent`. */
export const ourEventTypeSchema = z.enum([
  'email.sent',
  'email.delivered',
  'email.delivery_delayed',
  'email.bounced',
  'email.complained',
  'email.rejected',
  'email.opened',
  'email.clicked',
  'email.failed',
])
export type OurEventType = z.infer<typeof ourEventTypeSchema>

export interface BounceDetail {
  readonly kind: 'bounce'
  /** Only `Permanent` should ever add a row to `suppressions` (PLATFORM_PLAN.md 5.4). */
  readonly bounceType: 'Permanent' | 'Transient' | 'Undetermined'
  readonly bounceSubType: string
  readonly recipients: readonly string[]
}

export interface ComplaintDetail {
  readonly kind: 'complaint'
  readonly complaintFeedbackType?: string
  readonly recipients: readonly string[]
}

export interface DeliveryDetail {
  readonly kind: 'delivery'
  readonly recipients: readonly string[]
  readonly smtpResponse?: string
}

export interface SendDetail {
  readonly kind: 'send'
}

export interface RejectDetail {
  readonly kind: 'reject'
  readonly reason: string
}

export interface OpenDetail {
  readonly kind: 'open'
  readonly ipAddress?: string
  readonly userAgent?: string
}

export interface ClickDetail {
  readonly kind: 'click'
  readonly ipAddress?: string
  readonly link: string
  readonly userAgent?: string
}

export interface FailureDetail {
  readonly kind: 'failure'
  readonly errorMessage: string
  readonly templateName?: string
}

export interface DeliveryDelayDetail {
  readonly kind: 'deliveryDelay'
  readonly delayType: string
  readonly recipients: readonly string[]
}

export type SesEventDetail =
  | BounceDetail
  | ComplaintDetail
  | DeliveryDetail
  | SendDetail
  | RejectDetail
  | OpenDetail
  | ClickDetail
  | FailureDetail
  | DeliveryDelayDetail

/** The translated event: what every caller after this file actually works with. */
export interface SesEvent {
  readonly type: OurEventType
  /** SES's own `mail.messageId`, used to look up the `email_messages` row this event is about. */
  readonly providerMessageId: string
  /** `mail.tags`, verbatim - every value is an array, even a single-entry one. */
  readonly tags: Readonly<Record<string, readonly string[]>>
  /** ISO-8601. The detail object's own timestamp when it has one, else `mail.timestamp`. */
  readonly occurredAt: string
  readonly detail: SesEventDetail
}

/**
 * The result of parsing one SES event. Three outcomes, none of them a thrown
 * error, the same shape of idea as `AuthResult` in `server/auth.ts`:
 *  - `parsed`: a translated `SesEvent`, ready to act on.
 *  - `ignored`: a real, recognised SES event type (`Subscription`) that this
 *    app does not react to. Not an error - the caller should just acknowledge it.
 *  - `invalid`: the JSON did not match any known SES event shape.
 */
export type ParseSesEventResult =
  | { readonly kind: 'parsed'; readonly event: SesEvent }
  | { readonly kind: 'ignored'; readonly eventType: string }
  | { readonly kind: 'invalid'; readonly reason: string }

function tagsOf(mail: z.infer<typeof mailSchema>): Readonly<Record<string, readonly string[]>> {
  return mail.tags ?? {}
}

/**
 * Parses one SES event (the JSON already extracted from an SNS `Notification`'s
 * `Message` string). Never throws: a malformed payload comes back as
 * `{ kind: 'invalid', reason }`.
 */
export function parseSesEvent(json: unknown): ParseSesEventResult {
  const envelope = z.object({ eventType: sesEventTypeSchema, mail: mailSchema }).safeParse(json)
  if (!envelope.success) {
    // json might not even have a recognisable eventType at all (garbage input).
    const eventType = z.object({ eventType: z.string() }).safeParse(json)
    return {
      kind: 'invalid',
      reason: eventType.success
        ? `Unrecognised SES eventType "${eventType.data.eventType}": ${envelope.error.message}`
        : `Not an SES event: ${envelope.error.message}`,
    }
  }
  const { eventType, mail } = envelope.data
  const tags = tagsOf(mail)
  const providerMessageId = mail.messageId

  switch (eventType) {
    case 'Subscription':
      return { kind: 'ignored', eventType }

    case 'Bounce': {
      const detail = bounceDetailSchema.safeParse((json as { bounce?: unknown }).bounce)
      if (!detail.success) return { kind: 'invalid', reason: `Bad bounce detail: ${detail.error.message}` }
      return {
        kind: 'parsed',
        event: {
          type: 'email.bounced',
          providerMessageId,
          tags,
          occurredAt: detail.data.timestamp,
          detail: {
            kind: 'bounce',
            bounceType: detail.data.bounceType,
            bounceSubType: detail.data.bounceSubType,
            recipients: detail.data.bouncedRecipients.map((r) => r.emailAddress),
          },
        },
      }
    }

    case 'Complaint': {
      const detail = complaintDetailSchema.safeParse((json as { complaint?: unknown }).complaint)
      if (!detail.success) return { kind: 'invalid', reason: `Bad complaint detail: ${detail.error.message}` }
      return {
        kind: 'parsed',
        event: {
          type: 'email.complained',
          providerMessageId,
          tags,
          occurredAt: detail.data.timestamp,
          detail: {
            kind: 'complaint',
            complaintFeedbackType: detail.data.complaintFeedbackType,
            recipients: detail.data.complainedRecipients.map((r) => r.emailAddress),
          },
        },
      }
    }

    case 'Delivery': {
      const detail = deliveryDetailSchema.safeParse((json as { delivery?: unknown }).delivery)
      if (!detail.success) return { kind: 'invalid', reason: `Bad delivery detail: ${detail.error.message}` }
      return {
        kind: 'parsed',
        event: {
          type: 'email.delivered',
          providerMessageId,
          tags,
          occurredAt: detail.data.timestamp,
          detail: {
            kind: 'delivery',
            recipients: detail.data.recipients,
            smtpResponse: detail.data.smtpResponse,
          },
        },
      }
    }

    case 'Send': {
      const detail = sendDetailSchema.safeParse((json as { send?: unknown }).send)
      if (!detail.success) return { kind: 'invalid', reason: `Bad send detail: ${detail.error.message}` }
      return {
        kind: 'parsed',
        event: {
          type: 'email.sent',
          providerMessageId,
          tags,
          occurredAt: mail.timestamp,
          detail: { kind: 'send' },
        },
      }
    }

    case 'Reject': {
      const detail = rejectDetailSchema.safeParse((json as { reject?: unknown }).reject)
      if (!detail.success) return { kind: 'invalid', reason: `Bad reject detail: ${detail.error.message}` }
      return {
        kind: 'parsed',
        event: {
          type: 'email.rejected',
          providerMessageId,
          tags,
          occurredAt: mail.timestamp,
          detail: { kind: 'reject', reason: detail.data.reason },
        },
      }
    }

    case 'Open': {
      const detail = openDetailSchema.safeParse((json as { open?: unknown }).open)
      if (!detail.success) return { kind: 'invalid', reason: `Bad open detail: ${detail.error.message}` }
      return {
        kind: 'parsed',
        event: {
          type: 'email.opened',
          providerMessageId,
          tags,
          occurredAt: detail.data.timestamp,
          detail: { kind: 'open', ipAddress: detail.data.ipAddress, userAgent: detail.data.userAgent },
        },
      }
    }

    case 'Click': {
      const detail = clickDetailSchema.safeParse((json as { click?: unknown }).click)
      if (!detail.success) return { kind: 'invalid', reason: `Bad click detail: ${detail.error.message}` }
      return {
        kind: 'parsed',
        event: {
          type: 'email.clicked',
          providerMessageId,
          tags,
          occurredAt: detail.data.timestamp,
          detail: {
            kind: 'click',
            ipAddress: detail.data.ipAddress,
            link: detail.data.link,
            userAgent: detail.data.userAgent,
          },
        },
      }
    }

    case 'Rendering Failure': {
      const detail = failureDetailSchema.safeParse((json as { failure?: unknown }).failure)
      if (!detail.success) return { kind: 'invalid', reason: `Bad failure detail: ${detail.error.message}` }
      return {
        kind: 'parsed',
        event: {
          type: 'email.failed',
          providerMessageId,
          tags,
          occurredAt: mail.timestamp,
          detail: {
            kind: 'failure',
            errorMessage: detail.data.errorMessage,
            templateName: detail.data.templateName,
          },
        },
      }
    }

    case 'DeliveryDelay': {
      const detail = deliveryDelayDetailSchema.safeParse((json as { deliveryDelay?: unknown }).deliveryDelay)
      if (!detail.success)
        return { kind: 'invalid', reason: `Bad deliveryDelay detail: ${detail.error.message}` }
      return {
        kind: 'parsed',
        event: {
          type: 'email.delivery_delayed',
          providerMessageId,
          tags,
          occurredAt: detail.data.timestamp,
          detail: {
            kind: 'deliveryDelay',
            delayType: detail.data.delayType,
            recipients: detail.data.delayedRecipients.map((r) => r.emailAddress),
          },
        },
      }
    }
  }
}
