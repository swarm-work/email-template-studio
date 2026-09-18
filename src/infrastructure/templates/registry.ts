/**
 * The starter templates that ship with the studio.
 *
 * In the MVP templates live in this folder as real TSX files. Vite's `?raw`
 * import gives us the exact file text for the editor, while the same files
 * are also type-checked and unit-tested as normal React components.
 *
 * Infrastructure layer: it may use Zod and Vite features. These records are
 * the seed for the persistent store and the fixtures the tests use; behaviour
 * (the props validator) is attached in templateMapper.ts.
 */
import { z } from 'zod'
import { templateId, type PropsValidator, type TemplateId, type TemplateRecord } from '@/domain'
import { zodPropsValidator } from '@/infrastructure/validation/zodPropsValidator'
import { STARTER_PROPS_SCHEMA_TEXT } from './starterPropsSchemas'
import welcomeVerificationSource from './welcome-verification.email.tsx?raw'
import passwordResetSource from './password-reset.email.tsx?raw'
import teamInvitationSource from './team-invitation.email.tsx?raw'

const url = z.url({ protocol: /^https?$/, message: 'Must be an http(s) URL' })

/** The fictional product used across sample data. */
export const SAMPLE_PRODUCT_NAME = 'Meridian'

/** Who the starters are attributed to: they are created by the seed, not a person. */
const SEED_AUTHOR = 'seed'

const welcomeVerificationSchema = z.strictObject({
  recipientName: z.string().min(1, 'Required'),
  verificationUrl: url,
  expiresInHours: z.number().int().positive(),
  productName: z.string().min(1, 'Required'),
  supportEmail: z.email(),
})

const passwordResetSchema = z.strictObject({
  recipientName: z.string().min(1, 'Required'),
  resetUrl: url,
  expiresInMinutes: z.number().int().positive(),
  productName: z.string().min(1, 'Required'),
  requestIp: z.string().optional(),
  requestLocation: z.string().optional(),
})

const teamInvitationSchema = z.strictObject({
  inviteeName: z.string().min(1, 'Required'),
  inviterName: z.string().min(1, 'Required'),
  teamName: z.string().min(1, 'Required'),
  role: z.enum(['admin', 'member', 'viewer']),
  acceptUrl: url,
  expiresInDays: z.number().int().positive(),
  productName: z.string().min(1, 'Required'),
})

function pretty(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

export const STARTER_TEMPLATES: readonly TemplateRecord[] = [
  {
    kind: 'code',
    metadata: {
      id: templateId('welcome-verification'),
      name: 'Welcome & verification',
      slug: 'welcome-verification',
      description:
        'Sent after sign-up. Asks the user to confirm their email address before the account is activated.',
      category: 'onboarding',
      status: 'ready',
      version: { number: 3, label: 'v3', createdAt: '2026-08-21T09:30:00Z' },
      revision: 1,
      tags: ['sign-up', 'verification'],
      origin: 'starter',
      createdBy: SEED_AUTHOR,
      createdAt: '2026-08-21T09:30:00Z',
      updatedBy: SEED_AUTHOR,
      updatedAt: '2026-08-21T09:30:00Z',
    },
    envelope: { subject: 'Verify your email address', preheader: '', replyTo: '' },
    source: welcomeVerificationSource,
    samplePayloadText: pretty({
      recipientName: 'Ada',
      verificationUrl: 'https://app.meridian.example/verify?token=sample-token',
      expiresInHours: 24,
      productName: SAMPLE_PRODUCT_NAME,
      supportEmail: 'support@meridian.example',
    }),
    propsSchemaText: STARTER_PROPS_SCHEMA_TEXT['welcome-verification'],
  },
  {
    kind: 'code',
    metadata: {
      id: templateId('password-reset'),
      name: 'Password reset',
      slug: 'password-reset',
      description:
        'Time-limited link to choose a new password, with optional request details for security context.',
      category: 'security',
      status: 'ready',
      version: { number: 5, label: 'v5', createdAt: '2026-09-02T14:05:00Z' },
      revision: 1,
      tags: ['security', 'account'],
      origin: 'starter',
      createdBy: SEED_AUTHOR,
      createdAt: '2026-09-02T14:05:00Z',
      updatedBy: SEED_AUTHOR,
      updatedAt: '2026-09-02T14:05:00Z',
    },
    envelope: { subject: 'Reset your password', preheader: '', replyTo: '' },
    source: passwordResetSource,
    samplePayloadText: pretty({
      recipientName: 'Grace',
      resetUrl: 'https://app.meridian.example/reset?token=sample-token',
      expiresInMinutes: 30,
      productName: SAMPLE_PRODUCT_NAME,
      requestIp: '203.0.113.42',
      requestLocation: 'Manila, PH',
    }),
    propsSchemaText: STARTER_PROPS_SCHEMA_TEXT['password-reset'],
  },
  {
    kind: 'code',
    metadata: {
      id: templateId('team-invitation'),
      name: 'Team invitation',
      slug: 'team-invitation',
      description: 'Invites a person to join a team with a specific role. Uses Row/Column layout.',
      category: 'collaboration',
      status: 'draft',
      version: { number: 1, label: 'v1', createdAt: '2026-09-05T11:00:00Z' },
      revision: 1,
      tags: ['teams', 'invitation'],
      origin: 'starter',
      createdBy: SEED_AUTHOR,
      createdAt: '2026-09-05T11:00:00Z',
      updatedBy: SEED_AUTHOR,
      updatedAt: '2026-09-05T11:00:00Z',
    },
    envelope: { subject: 'You have been invited to join a team', preheader: '', replyTo: '' },
    source: teamInvitationSource,
    samplePayloadText: pretty({
      inviteeName: 'Linus',
      inviterName: 'Margaret Hamilton',
      teamName: 'Platform Core',
      role: 'member',
      acceptUrl: 'https://app.meridian.example/invitations/sample-token',
      expiresInDays: 7,
      productName: SAMPLE_PRODUCT_NAME,
    }),
    propsSchemaText: STARTER_PROPS_SCHEMA_TEXT['team-invitation'],
  },
]

/**
 * The Zod schemas behind the starters, keyed by **slug**. Exported for
 * `registry.test.ts`, which regenerates the stored JSON Schema text from them
 * and fails when the two drift apart.
 */
export const STARTER_PROPS_SCHEMAS: Readonly<Partial<Record<string, z.ZodType>>> = {
  'welcome-verification': welcomeVerificationSchema,
  'password-reset': passwordResetSchema,
  'team-invitation': teamInvitationSchema,
}

/**
 * The same schemas as validators, ready for templateMapper.ts: `strictObject`
 * rejects unknown keys, which catches typos in payloads, and each field carries
 * its own message. Keyed by **slug**, not by id: the ids change when the
 * starters are seeded into the database (`tpl_<slug>`), the slug does not.
 * `Partial` is deliberate — an unknown slug must read as `undefined` so the
 * mapper's fallback stays load-bearing for the compiler.
 */
export const STARTER_PROPS_VALIDATORS: Readonly<Partial<Record<string, PropsValidator>>> = {
  'welcome-verification': zodPropsValidator(welcomeVerificationSchema),
  'password-reset': zodPropsValidator(passwordResetSchema),
  'team-invitation': zodPropsValidator(teamInvitationSchema),
}

export function findTemplate(id: TemplateId): TemplateRecord | undefined {
  return STARTER_TEMPLATES.find((template) => template.metadata.id === id)
}

/** Throws if the id is unknown. Use when an unknown id is a programming error. */
export function getTemplate(id: TemplateId): TemplateRecord {
  const template = findTemplate(id)
  if (!template) throw new Error(`Unknown template id: ${id}`)
  return template
}

export const DEFAULT_TEMPLATE_ID: TemplateId = STARTER_TEMPLATES[0].metadata.id
