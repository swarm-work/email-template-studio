/**
 * Send-server configuration, read from environment variables.
 *
 * Credentials ARE read here, unlike in the AWS-SDK version of this file.
 * A Cloudflare Worker has no `~/.aws` and no credential provider chain, so the
 * only way to reach Amazon SES from the Worker is an explicit key pair supplied
 * as a Worker secret. Both runtimes therefore take the same three variables and
 * hand them to `createSesSender`, which signs its own requests (see sesSender.ts).
 *
 * Nothing in this file ever logs or serialises a secret: the values are copied
 * into the returned config and read only by the signer.
 *
 * Local Node users who have an AWS profile can turn it into these variables:
 *   aws configure export-credentials --profile <name> --format env
 */
import { z } from 'zod'

/** Only the literal string "true" enables; anything else (including junk) disables. */
const flag = z.string().optional()

const envSchema = z.object({
  STUDIO_SEND_ENABLED: flag,
  /** true = go through the whole path but never call SES; returns a fake message id. */
  STUDIO_SEND_DRY_RUN: flag,
  STUDIO_SERVER_PORT: z.coerce.number().int().positive().default(8787),
  STUDIO_SEND_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(5),
  AWS_REGION: z.string().min(1).optional(),
  /** A verified SES identity (email or an address on a verified domain). */
  SES_FROM_ADDRESS: z.email().optional(),
  /**
   * Either a comma-separated allow-list ("a@x.io, b@y.io"), or the single
   * character "*" to accept any valid address the caller types. Unset or empty
   * is still a boot error, so forgetting the variable never opens sending up.
   * The IAM policy on the AWS key is the real backstop (docs/DEPLOYMENT.md).
   */
  SES_ALLOWED_RECIPIENTS: z.string().optional(),
  SES_CONFIGURATION_SET: z.string().min(1).optional(),
  /** Long-lived IAM user keys, or short-lived STS keys plus AWS_SESSION_TOKEN. */
  AWS_ACCESS_KEY_ID: z.string().min(1).optional(),
  AWS_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  AWS_SESSION_TOKEN: z.string().min(1).optional(),
})

/** What `createSesSender` needs to sign a request. Never logged. */
export interface AwsCredentials {
  readonly accessKeyId: string
  readonly secretAccessKey: string
  /** Present only for temporary (STS) credentials. */
  readonly sessionToken?: string
}

/**
 * How the server decides who may receive a test send.
 * - 'allow-list': only the addresses in `allowedRecipients`
 * - 'any': any valid address, chosen by the caller (SES_ALLOWED_RECIPIENTS="*")
 */
export type RecipientPolicy = 'any' | 'allow-list'

export type SendServerConfig =
  | { readonly enabled: false; readonly port: number; readonly reason: string }
  | {
      readonly enabled: true
      readonly port: number
      readonly dryRun: boolean
      readonly region: string
      readonly from: string
      readonly recipientPolicy: RecipientPolicy
      /**
       * `loadConfig` guarantees the invariant: non-empty when the policy is
       * 'allow-list', and always `[]` when the policy is 'any'.
       */
      readonly allowedRecipients: readonly string[]
      readonly configurationSet?: string
      readonly rateLimitPerMinute: number
      /** Absent in dry-run mode, which never calls AWS. Always present for a live sender. */
      readonly credentials?: AwsCredentials
    }

/**
 * Optional parts of the studio that can be switched off without a code change.
 *
 * This is the rollback switch of docs/DEPLOYMENT.md: a Worker `var`, so turning
 * the visual editor off is an edit to wrangler.jsonc plus a deploy, with no
 * rebuild of the app. The browser mirror of this type is `src/domain/features.ts`;
 * the wire shape is the `features` object in `GET /api/send-test/status`.
 */
export interface StudioFeatures {
  /** false = visual templates open read-only in Preview mode. */
  readonly visualEditor: boolean
}

/** Everything on. What a server with no feature variables set reports. */
export const DEFAULT_STUDIO_FEATURES: StudioFeatures = { visualEditor: true }

/**
 * Reads the feature variables.
 *
 * Deliberately NOT part of `loadConfig`: a broken SES configuration disables
 * sending, and a feature flag must not be able to take the whole API down with
 * it. Only the literal "false" switches a feature off, so a typo (or an unset
 * variable) leaves the studio working — the safe direction for a rollback lever
 * nobody touches on a normal day.
 */
export function loadFeatures(env: Record<string, string | undefined>): StudioFeatures {
  return { visualEditor: (env.STUDIO_VISUAL_EDITOR ?? '').trim().toLowerCase() !== 'false' }
}

export class ConfigError extends Error {}

/** Parses process.env-like input. Throws ConfigError for an enabled but incomplete setup (fail fast). */
export function loadConfig(env: Record<string, string | undefined>): SendServerConfig {
  // `KEY=` in a .env file arrives as an empty string; treat it as unset.
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ''),
  )
  const parsed = envSchema.safeParse(cleaned)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new ConfigError(`Invalid send-server environment: ${detail}`)
  }
  const values = parsed.data
  const port = values.STUDIO_SERVER_PORT

  if (values.STUDIO_SEND_ENABLED !== 'true') {
    return { enabled: false, port, reason: 'STUDIO_SEND_ENABLED is not "true" on the send server.' }
  }

  const dryRun = values.STUDIO_SEND_DRY_RUN === 'true'

  const missing: string[] = []
  if (!values.AWS_REGION) missing.push('AWS_REGION')
  if (!values.SES_FROM_ADDRESS) missing.push('SES_FROM_ADDRESS')
  const recipients = parseRecipientPolicy(values.SES_ALLOWED_RECIPIENTS)
  if (recipients.policy === 'allow-list' && recipients.addresses.length === 0)
    missing.push('SES_ALLOWED_RECIPIENTS')
  // A dry run never reaches AWS, so it must not demand credentials: that is what
  // makes STUDIO_SEND_DRY_RUN=true a safe rehearsal mode for CI and a first deploy.
  if (!dryRun) {
    if (!values.AWS_ACCESS_KEY_ID) missing.push('AWS_ACCESS_KEY_ID')
    if (!values.AWS_SECRET_ACCESS_KEY) missing.push('AWS_SECRET_ACCESS_KEY')
  }
  if (missing.length > 0) {
    throw new ConfigError(
      `Sending is enabled but these variables are missing or empty: ${missing.join(', ')}. See .env.example.`,
    )
  }

  return {
    enabled: true,
    port,
    dryRun,
    region: values.AWS_REGION as string,
    from: values.SES_FROM_ADDRESS as string,
    recipientPolicy: recipients.policy,
    allowedRecipients: recipients.addresses,
    configurationSet: values.SES_CONFIGURATION_SET,
    rateLimitPerMinute: values.STUDIO_SEND_RATE_LIMIT_PER_MINUTE,
    credentials: dryRun
      ? undefined
      : {
          accessKeyId: values.AWS_ACCESS_KEY_ID as string,
          secretAccessKey: values.AWS_SECRET_ACCESS_KEY as string,
          sessionToken: values.AWS_SESSION_TOKEN,
        },
  }
}

/**
 * Reads SES_ALLOWED_RECIPIENTS as either the wildcard or a list.
 *
 * Exactly "*" (after trimming) means any address is acceptable; the returned
 * list is then empty, because there is nothing to compare against. A "*" mixed
 * into a list is a typo we refuse loudly rather than guess at.
 */
export function parseRecipientPolicy(raw: string | undefined): {
  policy: RecipientPolicy
  addresses: string[]
} {
  const trimmed = (raw ?? '').trim()
  if (trimmed === '*') return { policy: 'any', addresses: [] }
  if (trimmed.includes('*')) {
    throw new ConfigError('SES_ALLOWED_RECIPIENTS must be either "*" or a comma-separated list, not both.')
  }
  return { policy: 'allow-list', addresses: parseRecipients(raw) }
}

/** Splits the comma list, keeps original spelling, dedupes case-insensitively, rejects invalid entries loudly. */
export function parseRecipients(raw: string | undefined): string[] {
  if (!raw) return []
  const byLowerCase = new Map<string, string>()
  const invalid: string[] = []
  for (const part of raw.split(',')) {
    const address = part.trim()
    if (!address) continue
    if (!z.email().safeParse(address).success) {
      invalid.push(address)
      continue
    }
    const key = address.toLowerCase()
    if (!byLowerCase.has(key)) byLowerCase.set(key, address)
  }
  if (invalid.length > 0) {
    throw new ConfigError(`SES_ALLOWED_RECIPIENTS contains invalid addresses: ${invalid.join(', ')}`)
  }
  return [...byLowerCase.values()]
}
