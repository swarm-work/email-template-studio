/**
 * The eight template routes, registered by `createApp` AFTER the auth and
 * workspace middlewares, so every one of them already has a named caller AND
 * a workspace that caller may edit (`server/workspaceRoutes.ts`).
 *
 * Server layer: Hono + Zod + the TemplateStore port. It must not import D1, R2,
 * Node APIs or anything under `src/`. The wire shapes all come from
 * `shared/templateContracts.ts`; this file only maps them to and from the store.
 *
 * Two rules, one sentence each. Concurrency: every write carries the
 * `revision` the caller last read, and the store refuses it if the row has
 * moved on (409). Isolation: every store call names the workspace from the
 * URL, so a template in another workspace is a 404 here, never a leak.
 */
import type { Context, Hono } from 'hono'
import { apiError, byteLength, checkMutationHeaders, issuesOf, readJsonBody } from './http.ts'
import type {
  MetadataPatch,
  NewVersionInput,
  StoredTemplate,
  StoredTemplateSummary,
  StoredVersionSummary,
  TemplateStore,
  WriteContext,
  WriteOutcome,
} from './templateStore.ts'
import type {
  TemplateDetailDto,
  TemplateSummaryDto,
  VersionBodyDto,
  VersionSummaryDto,
} from '../shared/templateContracts.ts'
import {
  convertToCodeRequest,
  createTemplateRequest,
  MAX_DOCUMENT_BYTES,
  MAX_HTML_BYTES,
  MAX_PROPS_BYTES,
  MAX_SOURCE_BYTES,
  MAX_TEXT_BYTES,
  MAX_VERSION_BYTES,
  saveVersionRequest,
  slugify,
  updateMetadataRequest,
} from '../shared/templateContracts.ts'
import type { StudioEnv } from './workspaceRoutes.ts'
import { WORKSPACE_ROUTE } from './workspaceRoutes.ts'

type TemplateApp = Hono<StudioEnv>
type RouteContext = Context<StudioEnv>

/** Where the routes live: `/api/workspaces/:workspace/templates`. */
const TEMPLATES = `${WORKSPACE_ROUTE}/templates`

export interface TemplateRouteDependencies {
  /** `null` (or absent) means "no database is bound", and every route answers 503. */
  readonly templateStore?: TemplateStore | null
  /** Injectable clock, so tests can assert exact audit timestamps. */
  readonly now?: () => number
  /** Injectable id factory, so tests get predictable ids. */
  readonly newTemplateId?: () => string
}

/** The byte caps, in the order a request is checked, each naming its own field. */
const STRING_FIELD_LIMITS = [
  ['html', MAX_HTML_BYTES],
  ['text', MAX_TEXT_BYTES],
  ['source', MAX_SOURCE_BYTES],
  ['propsSample', MAX_PROPS_BYTES],
  ['propsSchema', MAX_PROPS_BYTES],
] as const

export function registerTemplateRoutes(app: TemplateApp, deps: TemplateRouteDependencies): void {
  const {
    templateStore = null,
    now = () => Date.now(),
    newTemplateId = () => `tpl_${crypto.randomUUID()}`,
  } = deps

  /** The audit stamp for one write: who asked, and when the server handled it. */
  const contextFor = (email: string): WriteContext => ({ by: email, at: new Date(now()).toISOString() })

  app.get(TEMPLATES, async (c) => {
    if (!templateStore) return storageUnavailable(c)
    const templates = await templateStore.list(c.get('workspace').id)
    return c.json({ templates: templates.map(toSummaryDto) })
  })

  app.get(`${TEMPLATES}/:id`, async (c) => {
    if (!templateStore) return storageUnavailable(c)
    const template = await templateStore.get(c.get('workspace').id, c.req.param('id'))
    if (!template) return notFound(c)
    // Weak, because the body is re-serialised on every request; the revision is
    // still an exact answer to "is this the copy I already have?".
    c.header('etag', `W/"${template.revision}"`)
    return c.json({ template: toDetailDto(template) })
  })

  app.get(`${TEMPLATES}/:id/versions`, async (c) => {
    if (!templateStore) return storageUnavailable(c)
    const versions = await templateStore.listVersions(c.get('workspace').id, c.req.param('id'))
    if (!versions) return notFound(c)
    return c.json({ versions: versions.map(toVersionSummaryDto) })
  })

  app.post(TEMPLATES, async (c) => {
    if (!templateStore) return storageUnavailable(c)
    const guard = checkMutationHeaders(c)
    if (guard) return guard
    const read = await readJsonBody(c)
    if ('response' in read) return read.response

    const oversized = oversizedField(read.body, 'initialVersion')
    if (oversized) return tooLarge(c, oversized)

    const parsed = createTemplateRequest.safeParse(read.body)
    if (!parsed.success) return badRequest(c, 'Invalid template.', parsed.error)

    const request = parsed.data
    // A name is always given; a slug only sometimes. Deriving it here means the
    // browser never has to know the slug rules.
    const slug = request.slug ?? slugify(request.name)
    if (slug === '') {
      return badRequest(c, 'That name does not produce a usable slug; send one explicitly.')
    }

    const email = c.get('identity').email
    const outcome = await templateStore.create(
      {
        id: newTemplateId(),
        workspaceId: c.get('workspace').id,
        slug,
        name: request.name,
        description: request.description,
        category: request.category,
        status: 'draft',
        tags: request.tags,
        origin: 'user',
        version: versionInputFrom(request.initialVersion),
      },
      contextFor(email),
    )
    return respondToWrite(c, outcome, 201, 'created', email)
  })

  app.post(`${TEMPLATES}/:id/versions`, async (c) => {
    if (!templateStore) return storageUnavailable(c)
    const guard = checkMutationHeaders(c)
    if (guard) return guard
    const read = await readJsonBody(c)
    if ('response' in read) return read.response

    const oversized = oversizedField(read.body, 'version')
    if (oversized) return tooLarge(c, oversized)

    const parsed = saveVersionRequest.safeParse(read.body)
    if (!parsed.success) return badRequest(c, 'Invalid version.', parsed.error)

    // One extra read per save, and worth it: `POST /convert` is one way, so a
    // save must not be the back door that turns a code template visual again.
    // The library card, the 422 below and the convert dialog all read the kind
    // off the CURRENT version, so they would all quietly disagree with the data.
    const existing = await templateStore.get(c.get('workspace').id, c.req.param('id'))
    if (!existing) return notFound(c)
    if (existing.version.kind !== parsed.data.version.kind) {
      return apiError(
        c,
        422,
        'not-visual',
        'Use POST .../templates/:id/convert to change how a template is authored.',
      )
    }

    const email = c.get('identity').email
    const outcome = await templateStore.addVersion(
      c.get('workspace').id,
      c.req.param('id'),
      parsed.data.expectedRevision,
      versionInputFrom(parsed.data.version),
      contextFor(email),
    )
    return respondToWrite(c, outcome, 201, 'saved', email)
  })

  app.patch(`${TEMPLATES}/:id`, async (c) => {
    if (!templateStore) return storageUnavailable(c)
    const guard = checkMutationHeaders(c)
    if (guard) return guard
    const read = await readJsonBody(c)
    if ('response' in read) return read.response

    const parsed = updateMetadataRequest.safeParse(read.body)
    if (!parsed.success) return badRequest(c, 'Invalid metadata change.', parsed.error)

    const { expectedRevision, ...patch } = parsed.data
    const email = c.get('identity').email
    const outcome = await templateStore.updateMetadata(
      c.get('workspace').id,
      c.req.param('id'),
      expectedRevision,
      patch satisfies MetadataPatch,
      contextFor(email),
    )
    return respondToWrite(c, outcome, 200, 'updated', email)
  })

  app.delete(`${TEMPLATES}/:id`, async (c) => {
    if (!templateStore) return storageUnavailable(c)
    const guard = checkMutationHeaders(c, null)
    if (guard) return guard
    const id = c.req.param('id')
    const result = await templateStore.remove(c.get('workspace').id, id)
    if (result === 'not-found') return notFound(c)
    // No version number here: the template and all its versions are gone, so
    // there is no "v<n>" left to name.
    console.log(`[templates] deleted ${id} by ${c.get('identity').email}`)
    return c.json({ status: 'deleted' as const, id })
  })

  app.post(`${TEMPLATES}/:id/convert`, async (c) => {
    if (!templateStore) return storageUnavailable(c)
    const guard = checkMutationHeaders(c)
    if (guard) return guard
    const read = await readJsonBody(c)
    if ('response' in read) return read.response

    const oversized = oversizedField(read.body)
    if (oversized) return tooLarge(c, oversized)

    const parsed = convertToCodeRequest.safeParse(read.body)
    if (!parsed.success) return badRequest(c, 'Invalid conversion.', parsed.error)

    const id = c.req.param('id')
    const workspaceId = c.get('workspace').id
    const existing = await templateStore.get(workspaceId, id)
    if (!existing) return notFound(c)
    // One way, and only from visual: converting an already-code template would
    // silently throw away nothing, but it would also hide a client-side bug.
    if (existing.version.kind !== 'visual') {
      return apiError(c, 422, 'not-visual', 'Only a visual template can be converted to code.')
    }

    const request = parsed.data
    const email = c.get('identity').email
    const outcome = await templateStore.addVersion(
      workspaceId,
      id,
      request.expectedRevision,
      {
        kind: 'code',
        // The envelope and theme are carried over: conversion changes how the
        // template is authored, not what the email says about itself.
        envelope: existing.version.envelope,
        source: request.source,
        document: null,
        theme: existing.version.theme,
        html: request.html,
        text: request.text,
        propsSample: request.propsSample,
        propsSchema: request.propsSchema,
        note: request.note,
      },
      contextFor(email),
    )
    return respondToWrite(c, outcome, 201, 'converted', email)
  })
}

function storageUnavailable(c: RouteContext) {
  return apiError(c, 503, 'storage-unavailable', 'No template database is configured for this server.')
}

function notFound(c: RouteContext) {
  return apiError(c, 404, 'not-found', 'No template with that id.')
}

function badRequest(c: RouteContext, message: string, error?: Parameters<typeof issuesOf>[0]) {
  return apiError(c, 400, 'bad-request', message, error ? { issues: issuesOf(error) } : {})
}

function tooLarge(c: RouteContext, oversized: { field: string; limit: number }) {
  return apiError(c, 413, 'payload-too-large', `${oversized.field} is larger than ${oversized.limit} bytes.`)
}

/**
 * Turns a store outcome into a response, and logs the one audit line every
 * write produces: `[templates] <verb> <id> v<n> by <email>`.
 */
function respondToWrite(
  c: RouteContext,
  outcome: WriteOutcome,
  successStatus: 200 | 201,
  verb: string,
  email: string,
) {
  switch (outcome.status) {
    case 'saved': {
      const template = outcome.template
      console.log(`[templates] ${verb} ${template.id} v${template.versionNumber} by ${email}`)
      return c.json({ template: toDetailDto(template) }, successStatus)
    }
    case 'conflict':
      return apiError(
        c,
        409,
        'conflict',
        `This template has moved on to revision ${outcome.template.revision}. Reload before saving again.`,
        { template: toDetailDto(outcome.template) },
      )
    case 'slug-taken':
      return apiError(c, 409, 'slug-taken', 'Another template already uses that slug.')
    case 'not-found':
      return notFound(c)
  }
}

/** The library card on the wire. */
function toSummaryDto(template: StoredTemplateSummary): TemplateSummaryDto {
  return {
    id: template.id,
    slug: template.slug,
    name: template.name,
    description: template.description,
    category: template.category,
    status: template.status,
    tags: [...template.tags],
    origin: template.origin,
    kind: template.kind,
    versionNumber: template.versionNumber,
    revision: template.revision,
    createdBy: template.createdBy,
    createdAt: template.createdAt,
    updatedBy: template.updatedBy,
    updatedAt: template.updatedAt,
  }
}

/**
 * One row of the read-only history. Written out field by field, like the two
 * DTO builders around it, so the compiler fails if the stored shape ever grows
 * a column that has no business on the wire.
 */
function toVersionSummaryDto(version: StoredVersionSummary): VersionSummaryDto {
  return {
    versionNumber: version.versionNumber,
    kind: version.kind,
    note: version.note,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
  }
}

/**
 * The card plus its current version. The stored row keeps `source` and
 * `document` side by side with one of them null; the wire shape is a
 * discriminated union, so exactly one branch is built here.
 */
function toDetailDto(template: StoredTemplate): TemplateDetailDto {
  const version = template.version
  const common = {
    versionNumber: version.versionNumber,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
    envelope: version.envelope,
    html: version.html,
    text: version.text,
    propsSample: version.propsSample,
    propsSchema: version.propsSchema,
    note: version.note,
  }
  return {
    ...toSummaryDto(template),
    version:
      version.kind === 'code'
        ? { ...common, kind: 'code', source: version.source ?? '' }
        : {
            ...common,
            kind: 'visual',
            document: parseDocument(version.document),
            theme: version.theme,
          },
  }
}

/** The document is stored as JSON text; an unreadable one becomes an empty doc. */
function parseDocument(text: string | null): Record<string, unknown> {
  if (text === null) return { type: 'doc', content: [] }
  try {
    const parsed: unknown = JSON.parse(text)
    return isRecord(parsed) ? parsed : { type: 'doc', content: [] }
  } catch {
    return { type: 'doc', content: [] }
  }
}

/** Flattens the wire's discriminated union back onto the two nullable columns. */
function versionInputFrom(version: VersionBodyDto): NewVersionInput {
  const common = {
    envelope: version.envelope,
    html: version.html,
    text: version.text,
    propsSample: version.propsSample,
    propsSchema: version.propsSchema,
    note: version.note,
  }
  if (version.kind === 'code') {
    return { ...common, kind: 'code', source: version.source, document: null, theme: 'studio-v1' }
  }
  return {
    ...common,
    kind: 'visual',
    source: null,
    document: JSON.stringify(version.document),
    theme: version.theme,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Size caps are checked in BYTES, on the raw body, BEFORE any parsing or SQL:
 * a 4 MB paste should cost one TextEncoder pass, not a round trip to D1. The
 * answer names the field so the UI can point at it.
 *
 * `versionKey` says where the version body sits in this request ('initialVersion'
 * on create, 'version' on save); the convert route sends its fields at the top
 * level, so it passes nothing.
 */
function oversizedField(body: unknown, versionKey?: string): { field: string; limit: number } | null {
  if (!isRecord(body)) return null
  const version = versionKey === undefined ? body : body[versionKey]
  if (!isRecord(version)) return null

  for (const [field, limit] of STRING_FIELD_LIMITS) {
    const value = version[field]
    if (typeof value === 'string' && byteLength(value) > limit) return { field, limit }
  }
  if (version.document !== undefined && byteLength(JSON.stringify(version.document)) > MAX_DOCUMENT_BYTES) {
    return { field: 'document', limit: MAX_DOCUMENT_BYTES }
  }
  if (byteLength(JSON.stringify(version)) > MAX_VERSION_BYTES) {
    return { field: 'version', limit: MAX_VERSION_BYTES }
  }
  return null
}
