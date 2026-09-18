/**
 * The JSON Schema each starter template stores next to its props sample.
 *
 * Infrastructure layer, but deliberately plain data: these are written out by
 * hand rather than generated with `z.toJSONSchema()` at start-up, because that
 * converter would then be part of the first chunk the browser downloads (plan
 * §3.10 budget). `registry.test.ts` regenerates them from the Zod schemas and
 * fails if the two ever drift apart. Imports nothing.
 */

/** The text a record stores: pretty-printed JSON with a trailing newline. */
function schemaText(schema: Record<string, unknown>): string {
  return `${JSON.stringify(schema, null, 2)}\n`
}

/** `z.email()`'s own pattern; kept verbatim so the regenerate-and-diff test passes. */
const EMAIL_PATTERN =
  "^(?!\\.)(?!.*\\.\\.)([A-Za-z0-9_'+\\-\\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\\-]*\\.)+[A-Za-z]{2,}$"

/** A positive integer as `z.number().int().positive()` describes it. */
const POSITIVE_INTEGER = {
  type: 'integer',
  exclusiveMinimum: 0,
  maximum: 9007199254740991,
} as const

const NON_EMPTY_STRING = { type: 'string', minLength: 1 } as const
const URL_STRING = { type: 'string', format: 'uri' } as const
const JSON_SCHEMA_DIALECT = 'https://json-schema.org/draft/2020-12/schema'

/** Keyed by slug, like the starter validators in registry.ts. */
export const STARTER_PROPS_SCHEMA_TEXT: Readonly<Record<string, string>> = {
  'welcome-verification': schemaText({
    $schema: JSON_SCHEMA_DIALECT,
    type: 'object',
    properties: {
      recipientName: NON_EMPTY_STRING,
      verificationUrl: URL_STRING,
      expiresInHours: POSITIVE_INTEGER,
      productName: NON_EMPTY_STRING,
      supportEmail: { type: 'string', format: 'email', pattern: EMAIL_PATTERN },
    },
    required: ['recipientName', 'verificationUrl', 'expiresInHours', 'productName', 'supportEmail'],
    additionalProperties: false,
  }),
  'password-reset': schemaText({
    $schema: JSON_SCHEMA_DIALECT,
    type: 'object',
    properties: {
      recipientName: NON_EMPTY_STRING,
      resetUrl: URL_STRING,
      expiresInMinutes: POSITIVE_INTEGER,
      productName: NON_EMPTY_STRING,
      requestIp: { type: 'string' },
      requestLocation: { type: 'string' },
    },
    required: ['recipientName', 'resetUrl', 'expiresInMinutes', 'productName'],
    additionalProperties: false,
  }),
  'team-invitation': schemaText({
    $schema: JSON_SCHEMA_DIALECT,
    type: 'object',
    properties: {
      inviteeName: NON_EMPTY_STRING,
      inviterName: NON_EMPTY_STRING,
      teamName: NON_EMPTY_STRING,
      role: { type: 'string', enum: ['admin', 'member', 'viewer'] },
      acceptUrl: URL_STRING,
      expiresInDays: POSITIVE_INTEGER,
      productName: NON_EMPTY_STRING,
    },
    required: ['inviteeName', 'inviterName', 'teamName', 'role', 'acceptUrl', 'expiresInDays', 'productName'],
    additionalProperties: false,
  }),
}
