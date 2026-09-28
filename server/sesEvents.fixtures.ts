/**
 * One raw SES event payload per `eventType`, shaped like AWS's own worked
 * examples so `sesEvents.test.ts` reads as "given this real AWS shape, we get
 * this translated event" rather than a wall of inline JSON per test.
 *
 * Field names and nesting copied from:
 * https://docs.aws.amazon.com/ses/latest/dg/event-publishing-retrieving-sns-examples.html
 * (fetched 2026-09-29). Only the values are made up (fake addresses, ids).
 */

const mail = {
  timestamp: '2026-09-20T12:00:00.000Z',
  source: 'sender@swarm.camp',
  sourceArn: 'arn:aws:ses:us-east-1:123456789012:identity/sender@swarm.camp',
  sendingAccountId: '123456789012',
  messageId: 'EXAMPLE-msg-id-000000',
  destination: ['recipient@example.com'],
  headersTruncated: false,
  tags: {
    'ses:configuration-set': ['studio-swarm-camp'],
    studio_message: ['msg_01J000000000000000000000'],
    studio_workspace: ['ws_swarm-camp'],
  },
}

export const sendFixture = {
  eventType: 'Send',
  mail,
  send: {},
}

export const rejectFixture = {
  eventType: 'Reject',
  mail,
  reject: { reason: 'Bad content' },
}

export const deliveryFixture = {
  eventType: 'Delivery',
  mail,
  delivery: {
    timestamp: '2026-09-20T12:00:04.133Z',
    processingTimeMillis: 4133,
    recipients: ['recipient@example.com'],
    smtpResponse: '250 2.6.0 Message received',
    remoteMtaIp: '203.0.113.1',
    reportingMTA: 'mta.example.com',
  },
}

export const bounceFixture = {
  eventType: 'Bounce',
  mail,
  bounce: {
    bounceType: 'Permanent',
    bounceSubType: 'General',
    bouncedRecipients: [
      {
        emailAddress: 'recipient@example.com',
        action: 'failed',
        status: '5.1.1',
        diagnosticCode: 'smtp; 550 5.1.1 user unknown',
      },
    ],
    timestamp: '2026-09-20T12:00:02.669Z',
    feedbackId: '01000-example-feedback-id',
    reportingMTA: 'dsn; mta.example.com',
  },
}

export const transientBounceFixture = {
  eventType: 'Bounce',
  mail,
  bounce: {
    ...bounceFixture.bounce,
    bounceType: 'Transient',
    bounceSubType: 'MailboxFull',
  },
}

export const complaintFixture = {
  eventType: 'Complaint',
  mail,
  complaint: {
    complainedRecipients: [{ emailAddress: 'recipient@example.com' }],
    timestamp: '2026-09-20T12:00:02.669Z',
    feedbackId: '01000-example-feedback-id',
    userAgent: 'Some Mailbox Provider',
    complaintFeedbackType: 'abuse',
    arrivalDate: '2026-09-20T12:00:02.669Z',
  },
}

export const openFixture = {
  eventType: 'Open',
  mail,
  open: {
    ipAddress: '203.0.113.2',
    timestamp: '2026-09-20T12:05:19.652Z',
    userAgent: 'Mozilla/5.0',
    isBotEvent: 'Unlikely',
  },
}

export const clickFixture = {
  eventType: 'Click',
  mail,
  click: {
    ipAddress: '203.0.113.2',
    link: 'https://swarm.camp/invoice/123',
    linkTags: { position: ['1'] },
    timestamp: '2026-09-20T12:06:25.570Z',
    userAgent: 'Mozilla/5.0',
    isBotEvent: 'Likely',
  },
}

/** `eventType` really does contain a space; see the AWS docs comment above. */
export const renderingFailureFixture = {
  eventType: 'Rendering Failure',
  mail,
  failure: {
    errorMessage: "Attribute 'firstName' is not present in the rendering data.",
    templateName: 'invoice-issued',
  },
}

export const deliveryDelayFixture = {
  eventType: 'DeliveryDelay',
  mail,
  deliveryDelay: {
    timestamp: '2026-09-20T12:10:40.095Z',
    delayType: 'TransientCommunicationFailure',
    expirationTime: '2026-09-21T12:10:40.914Z',
    delayedRecipients: [
      {
        emailAddress: 'recipient@example.com',
        status: '4.4.1',
        diagnosticCode: 'smtp; 421 4.4.1 Unable to connect to remote host',
      },
    ],
  },
}

export const subscriptionFixture = {
  eventType: 'Subscription',
  mail,
  subscription: {
    contactList: 'Newsletter',
    timestamp: '2026-09-20T12:00:17.910Z',
    source: 'UnsubscribeHeader',
  },
}
