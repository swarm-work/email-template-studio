/**
 * The starter templates that ship with the studio.
 *
 * These records are now TWO things: the **seed input** that
 * `scripts/generate-seed-migration.mjs` turns into `migrations/0002_seed_starter_templates.sql`,
 * and the **fixtures** most unit tests build on. The metadata comes from
 * `starterCatalog.json`; the source is the real TSX file next to it, pulled in
 * with Vite's `?raw` so the same file is both editable text and a type-checked
 * React component.
 *
 * Infrastructure layer: it may use Zod and Vite features. Behaviour (the props
 * validator) is attached in templateMapper.ts.
 */
import { z } from 'zod'
import { templateId, type PropsValidator, type TemplateId, type TemplateRecord } from '@/domain'
import { zodPropsValidator } from '@/infrastructure/validation/zodPropsValidator'
import { prettyJson, STARTER_CATALOG } from './starterCatalog'
import welcomeVerificationSource from './welcome-verification.email.tsx?raw'
import passwordResetSource from './password-reset.email.tsx?raw'
import teamInvitationSource from './team-invitation.email.tsx?raw'

const url = z.url({ protocol: /^https?$/, message: 'Must be an http(s) URL' })

/** The fictional product used across sample data. */
export const SAMPLE_PRODUCT_NAME = 'Meridian'

/** Who the starters are attributed to: they are created by the seed, not a person. */
const SEED_AUTHOR = 'seed'

/** The TSX text of each starter, keyed by the `sourceFile` its catalog entry names. */
const STARTER_SOURCES: Readonly<Record<string, string>> = {
  'welcome-verification.email.tsx': welcomeVerificationSource,
  'password-reset.email.tsx': passwordResetSource,
  'team-invitation.email.tsx': teamInvitationSource,
}

/**
 * The TSX text for one catalog entry. A typo in `sourceFile` is a mistake, not
 * a template with no source: the server-side seed throws on it (readFileSync),
 * and an empty starter here would only show up as a blank editor in the studio.
 */
function sourceFor(sourceFile: string, slug: string): string {
  const source = STARTER_SOURCES[sourceFile]
  if (!source) throw new Error(`Starter "${slug}" names an unknown sourceFile: ${sourceFile}`)
  return source
}

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

export const STARTER_TEMPLATES: readonly TemplateRecord[] = STARTER_CATALOG.map((entry) => ({
  kind: 'code',
  source: sourceFor(entry.sourceFile, entry.slug),
  metadata: {
    id: templateId(entry.slug),
    name: entry.name,
    slug: entry.slug,
    description: entry.description,
    category: entry.category,
    status: entry.status,
    version: entry.version,
    revision: 1,
    tags: entry.tags,
    origin: 'starter',
    createdBy: SEED_AUTHOR,
    createdAt: entry.createdAt,
    updatedBy: SEED_AUTHOR,
    updatedAt: entry.createdAt,
  },
  envelope: entry.envelope,
  samplePayloadText: prettyJson(entry.samplePayload),
  propsSchemaText: prettyJson(entry.propsSchema),
}))

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
