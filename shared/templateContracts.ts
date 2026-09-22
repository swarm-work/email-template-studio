/**
 * The wire contract for the template API: one Zod schema per request and
 * response, used by the server to validate what arrives and by the browser to
 * validate what comes back.
 *
 * This folder is shared by the app, the Node server and the Worker, so it may
 * import ONLY `zod` — no React, no browser APIs, no `@/` app modules.
 */
import { z } from 'zod'

/**
 * Size caps, enforced by the API and mirrored in the client so a refusal can be
 * explained before the request is made. D1 stores at most 2 MB per row.
 */
export const MAX_HTML_BYTES = 500_000
export const MAX_SOURCE_BYTES = 256_000
export const MAX_DOCUMENT_BYTES = 256_000
export const MAX_TEXT_BYTES = 256_000
export const MAX_PROPS_BYTES = 64_000
export const MAX_VERSION_BYTES = 1_000_000
export const MAX_TAGS = 10
export const MAX_TAG_LENGTH = 40
export const MAX_NAME_LENGTH = 120
export const MAX_SLUG_LENGTH = 80
export const MAX_DESCRIPTION_LENGTH = 500
export const MAX_SUBJECT_LENGTH = 200
export const MAX_PREHEADER_LENGTH = 200
export const MAX_NOTE_LENGTH = 200

/**
 * Mutating calls must carry this header. A cross-site form post cannot set a
 * custom header, so requiring it is a cheap CSRF guard (same trick as
 * `x-studio-send` on the send route).
 */
export const STUDIO_API_HEADER = 'x-studio-request'

/**
 * Image uploads for visual templates (`POST /api/uploads`).
 *
 * 2 MB is generous for an email image and small enough that a Worker can hold
 * the whole body in memory. The allow-list is four formats every mail client
 * renders; SVG is deliberately absent, because an SVG can carry script.
 */
export const MAX_UPLOAD_BYTES = 2_000_000

/** Declared content type -> the extension the stored key gets. */
export const UPLOAD_CONTENT_TYPES: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/** The form field `POST /api/uploads` reads the file from. */
export const UPLOAD_FIELD_NAME = 'file'

/** The shape of a stored asset key, also enforced by `GET /media/:key`. */
export const UPLOAD_KEY_PATTERN = /^img_[0-9a-f-]{36}\.(png|jpe?g|gif|webp)$/

/**
 * Where an uploaded image is served from. NOT `/assets/`: Vite builds the
 * studio's own JS, CSS and fonts into that prefix, and sharing it would mean
 * every static file had to travel through the Worker. Nothing else emits
 * `/media/`, so the Worker only ever sees a real image request.
 */
export const MEDIA_PATH_PREFIX = '/media/'

/** `{ url }` - absolute, because an email client has no page to resolve a relative src against. */
export const uploadResponseSchema = z.object({ url: z.url() })

export const templateKindSchema = z.enum(['code', 'visual'])
export const templateOriginSchema = z.enum(['user', 'starter'])
export const templateCategorySchema = z.enum([
  'onboarding',
  'security',
  'collaboration',
  'billing',
  'notification',
])
export const templateStatusSchema = z.enum(['draft', 'ready', 'deprecated'])

/** Lower-case words joined by single hyphens: `welcome-verification`. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const slugSchema = z
  .string()
  .min(1)
  .max(MAX_SLUG_LENGTH)
  .regex(SLUG_PATTERN, 'Use lower-case letters, numbers and single hyphens')

/**
 * Turns a human name into a slug: accents are dropped, anything that is not a
 * letter or a number becomes a hyphen, and runs of hyphens collapse. Returns ''
 * when nothing usable is left, so the caller decides what to do about it.
 */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '')
}

/** Counts bytes, not characters: an emoji costs four, and the caps are in bytes. */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/** Adds a byte cap to a string field, with a message that names the limit. */
function boundedText(maxBytes: number, label: string) {
  return z
    .string()
    .refine((value) => byteLength(value) <= maxBytes, `${label} is larger than ${maxBytes} bytes`)
}

/** True for text that parses as a JSON object (not an array, not a bare value). */
function isJsonObjectText(value: string): boolean {
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
  } catch {
    return false
  }
}

/**
 * A capped string that must also be a JSON object. Both props columns are
 * documented as JSON, and a corrupt props schema fails SILENTLY downstream (the
 * validator falls back to "any object" and nobody is told), so the check belongs
 * here at the edge where it can still be a 400 naming the field.
 */
function jsonObjectText(maxBytes: number, label: string) {
  return boundedText(maxBytes, label).refine(isJsonObjectText, `${label} must be a JSON object`)
}

export const envelopeSchema = z.object({
  subject: z.string().max(MAX_SUBJECT_LENGTH),
  preheader: z.string().max(MAX_PREHEADER_LENGTH),
  /** '' means "reply to the sender configured on the send server". */
  replyTo: z.union([z.literal(''), z.email()]),
})

/**
 * The document travels as a JSON object, not as text: the server stringifies it
 * into one TEXT column, and a malformed document is rejected at the edge.
 */
export const emailDocumentSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => value.type === 'doc', 'The document must be a Tiptap doc node')
  // The cap is on the document's JSON text, which is what the server stores.
  .refine(
    (value) => byteLength(JSON.stringify(value)) <= MAX_DOCUMENT_BYTES,
    `The document is larger than ${MAX_DOCUMENT_BYTES} bytes`,
  )

const versionBodyBase = {
  envelope: envelopeSchema,
  html: boundedText(MAX_HTML_BYTES, 'The exported HTML'),
  text: boundedText(MAX_TEXT_BYTES, 'The plain text'),
  propsSample: jsonObjectText(MAX_PROPS_BYTES, 'The sample props'),
  propsSchema: jsonObjectText(MAX_PROPS_BYTES, 'The props schema'),
  note: z.string().max(MAX_NOTE_LENGTH).default(''),
}

/** One new version: a code template carries source, a visual one a document. */
export const versionBodySchema = z
  .discriminatedUnion('kind', [
    z.object({
      ...versionBodyBase,
      kind: z.literal('code'),
      source: boundedText(MAX_SOURCE_BYTES, 'The source'),
    }),
    z.object({
      ...versionBodyBase,
      kind: z.literal('visual'),
      document: emailDocumentSchema,
      theme: z.string().min(1).max(64),
    }),
  ])
  .refine(
    (body) => byteLength(JSON.stringify(body)) <= MAX_VERSION_BYTES,
    `The version is larger than ${MAX_VERSION_BYTES} bytes`,
  )

export const tagsSchema = z.array(z.string().min(1).max(MAX_TAG_LENGTH)).max(MAX_TAGS)

/**
 * The four request bodies are `strictObject`: an unknown key is a 400 naming the
 * key, not something Zod quietly drops. A PATCH of `{ tittle: 'x' }` would
 * otherwise "succeed", change nothing and still bump the revision, invalidating
 * every other tab's `expectedRevision`. (`versionBodySchema` stays permissive:
 * `templateVersionSchema` intersects it with response-only fields below.)
 */
export const createTemplateRequest = z.strictObject({
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  slug: slugSchema.optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).default(''),
  category: templateCategorySchema,
  tags: tagsSchema.default([]),
  initialVersion: versionBodySchema,
})

export const saveVersionRequest = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  version: versionBodySchema,
})

export const updateMetadataRequest = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  name: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
  slug: slugSchema.optional(),
  description: z.string().max(MAX_DESCRIPTION_LENGTH).optional(),
  category: templateCategorySchema.optional(),
  status: templateStatusSchema.optional(),
  tags: tagsSchema.optional(),
})

export const convertToCodeRequest = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  source: boundedText(MAX_SOURCE_BYTES, 'The source'),
  html: boundedText(MAX_HTML_BYTES, 'The exported HTML'),
  text: boundedText(MAX_TEXT_BYTES, 'The plain text'),
  propsSample: jsonObjectText(MAX_PROPS_BYTES, 'The sample props'),
  propsSchema: jsonObjectText(MAX_PROPS_BYTES, 'The props schema'),
  note: z.string().max(MAX_NOTE_LENGTH).default(''),
})

/** A library card: everything but the content blobs, so listing stays cheap. */
export const templateSummarySchema = z.object({
  id: z.string().min(1),
  slug: slugSchema,
  name: z.string(),
  description: z.string(),
  category: templateCategorySchema,
  status: templateStatusSchema,
  tags: tagsSchema,
  origin: templateOriginSchema,
  kind: templateKindSchema,
  versionNumber: z.number().int().positive(),
  revision: z.number().int().nonnegative(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
})

/** The content of one version as the API returns it. */
export const templateVersionSchema = versionBodySchema.and(
  z.object({
    versionNumber: z.number().int().positive(),
    createdBy: z.string(),
    createdAt: z.string(),
  }),
)

export const templateDetailSchema = z.object({
  ...templateSummarySchema.shape,
  version: templateVersionSchema,
})

export const versionSummarySchema = z.object({
  versionNumber: z.number().int().positive(),
  kind: templateKindSchema,
  note: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
})

export const templateListResponse = z.object({ templates: z.array(templateSummarySchema) })
export const templateResponse = z.object({ template: templateDetailSchema })
export const versionListResponse = z.object({ versions: z.array(versionSummarySchema) })
export const deletedResponse = z.object({ status: z.literal('deleted'), id: z.string().min(1) })

/**
 * Mirrored by RepositoryFailure in the application layer. `forbidden-origin` is
 * the 403 the Host/Origin middleware emits (`server/app.ts`); it is listed here
 * so that body parses too, and the repository maps it onto plain `forbidden`.
 */
export const apiErrorCode = z.enum([
  'bad-request',
  'unauthenticated',
  'forbidden',
  'forbidden-origin',
  'not-found',
  'conflict',
  'slug-taken',
  'payload-too-large',
  'unsupported-media-type',
  'storage-unavailable',
  'not-visual',
  // The caller is asking too often. Distinct from 'forbidden' on purpose: the
  // request was legitimate and waiting will fix it, which is what a client
  // needs to know to decide between retrying and giving up.
  'rate-limited',
  'unexpected',
])

export const apiErrorSchema = z.object({
  status: z.literal('error'),
  code: apiErrorCode,
  message: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  /** On 409 the server's current copy travels with the error. */
  template: templateDetailSchema.optional(),
})

export type TemplateKindDto = z.infer<typeof templateKindSchema>
export type EnvelopeDto = z.infer<typeof envelopeSchema>
export type VersionBodyDto = z.infer<typeof versionBodySchema>
export type CreateTemplateRequest = z.infer<typeof createTemplateRequest>
export type SaveVersionRequest = z.infer<typeof saveVersionRequest>
export type UpdateMetadataRequest = z.infer<typeof updateMetadataRequest>
export type ConvertToCodeRequest = z.infer<typeof convertToCodeRequest>
export type TemplateSummaryDto = z.infer<typeof templateSummarySchema>
export type TemplateDetailDto = z.infer<typeof templateDetailSchema>
export type VersionSummaryDto = z.infer<typeof versionSummarySchema>
export type ApiErrorCode = z.infer<typeof apiErrorCode>
export type ApiError = z.infer<typeof apiErrorSchema>
export type UploadResponse = z.infer<typeof uploadResponseSchema>
