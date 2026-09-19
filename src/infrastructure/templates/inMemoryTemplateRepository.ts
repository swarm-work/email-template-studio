/**
 * An in-memory adapter for the `TemplateRepository` port.
 *
 * Infrastructure layer: it implements what the application layer declared, and
 * it must not import React or touch the DOM. Everything lives in a Map, so the
 * data is gone when the page reloads — that is deliberate: it lets the whole
 * studio run with no server while the D1-backed HTTP adapter is built, and it
 * gives every later adapter a reference implementation to be compared against
 * (see `templateRepositoryContract.ts`).
 */
import type {
  ConvertToCodeInput,
  NewTemplateInput,
  RepositoryFailure,
  RepositoryResult,
  TemplateMetadataPatch,
  TemplateRepository,
  TemplateVersionSummary,
  VersionInput,
} from '@/application/repositories/templateRepository'
import {
  templateId,
  type TemplateEnvelope,
  type TemplateId,
  type TemplateMetadata,
  type TemplateRecord,
} from '@/domain'
import {
  MAX_DESCRIPTION_LENGTH,
  MAX_DOCUMENT_BYTES,
  MAX_HTML_BYTES,
  MAX_NAME_LENGTH,
  MAX_PREHEADER_LENGTH,
  MAX_PROPS_BYTES,
  MAX_SLUG_LENGTH,
  MAX_SOURCE_BYTES,
  MAX_SUBJECT_LENGTH,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  MAX_TEXT_BYTES,
  MAX_VERSION_BYTES,
  SLUG_PATTERN,
  slugify,
} from '@shared/templateContracts'
import { STARTER_TEMPLATES } from './registry'

/** One immutable entry in a template's history. Versions are appended, never edited. */
interface StoredVersion {
  readonly versionNumber: number
  readonly createdBy: string
  readonly createdAt: string
  readonly input: VersionInput
}

/** A template as this adapter keeps it: metadata plus its versions, oldest first. */
interface StoredTemplate {
  metadata: TemplateMetadata
  versions: StoredVersion[]
}

export interface InMemoryTemplateRepositoryOptions {
  /** Records to start from. Defaults to the starter templates that ship with the studio. */
  readonly seed?: readonly TemplateRecord[]
  /** Clock, injectable so tests can make timestamps predictable. */
  readonly now?: () => string
  /** Who writes are attributed to. There is no signed-in identity in memory mode. */
  readonly author?: string
  /** Id generator, injectable so tests can make ids predictable. */
  readonly newId?: () => string
}

/** Builds the adapter. Nothing is shared between two calls, so every test gets a clean store. */
export function createInMemoryTemplateRepository(
  options: InMemoryTemplateRepositoryOptions = {},
): TemplateRepository {
  return new InMemoryTemplateRepository(options)
}

class InMemoryTemplateRepository implements TemplateRepository {
  readonly #templates = new Map<string, StoredTemplate>()
  readonly #now: () => string
  readonly #author: string
  readonly #newId: () => string

  constructor(options: InMemoryTemplateRepositoryOptions) {
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#author = options.author ?? 'local'
    this.#newId = options.newId ?? (() => `tpl_${crypto.randomUUID()}`)
    for (const record of options.seed ?? STARTER_TEMPLATES) this.#seed(record)
  }

  async list(): Promise<RepositoryResult<readonly TemplateRecord[]>> {
    const records = [...this.#templates.values()]
      .map(toRecord)
      // Newest first: the order the API promises and the library shows.
      .sort((a, b) => b.metadata.updatedAt.localeCompare(a.metadata.updatedAt))
    return ok(copy(records))
  }

  async get(id: TemplateId): Promise<RepositoryResult<TemplateRecord>> {
    const stored = this.#templates.get(id)
    if (!stored) return notFound(id)
    return ok(copy(toRecord(stored)))
  }

  async create(
    input: NewTemplateInput & { readonly initialVersion: VersionInput },
  ): Promise<RepositoryResult<TemplateRecord>> {
    if (input.kind !== input.initialVersion.kind) {
      return fail('invalid', 'The template kind and its first version disagree.')
    }
    const slug = input.slug ?? slugify(input.name)
    const slugProblem = validateSlug(slug)
    if (slugProblem) return fail('invalid', slugProblem)
    if (this.#slugTaken(slug, null)) return slugTaken()
    const invalid = validateMetadata(input) ?? validateEnvelope(input.initialVersion.envelope)
    if (invalid) return fail('invalid', invalid)
    const tooLarge = oversizedField(input.initialVersion)
    if (tooLarge) return payloadTooLarge(tooLarge)

    const at = this.#now()
    const id = templateId(this.#newId())
    const stored: StoredTemplate = {
      metadata: {
        id,
        name: input.name,
        slug,
        description: input.description,
        category: input.category,
        status: 'draft',
        version: { number: 1, label: 'v1', createdAt: at },
        revision: 1,
        tags: copy(input.tags ?? []),
        origin: 'user',
        createdBy: this.#author,
        createdAt: at,
        updatedBy: this.#author,
        updatedAt: at,
      },
      versions: [
        { versionNumber: 1, createdBy: this.#author, createdAt: at, input: copy(input.initialVersion) },
      ],
    }
    this.#templates.set(id, stored)
    return ok(copy(toRecord(stored)))
  }

  async saveVersion(
    id: TemplateId,
    expectedRevision: number,
    input: VersionInput,
  ): Promise<RepositoryResult<TemplateRecord>> {
    const stored = this.#templates.get(id)
    if (!stored) return notFound(id)
    const stale = conflictIfStale(stored, expectedRevision)
    if (stale) return stale
    // A template's kind is the kind of its newest version, so accepting a
    // visual version here would silently un-convert a converted template.
    // `convertToCode` is the only way a kind ever changes, and only one way.
    if (input.kind !== toRecord(stored).kind) {
      return fail('invalid', 'The template kind and the new version disagree.')
    }
    const invalidEnvelope = validateEnvelope(input.envelope)
    if (invalidEnvelope) return fail('invalid', invalidEnvelope)
    const tooLarge = oversizedField(input)
    if (tooLarge) return payloadTooLarge(tooLarge)
    this.#appendVersion(stored, input)
    return ok(copy(toRecord(stored)))
  }

  async updateMetadata(
    id: TemplateId,
    expectedRevision: number,
    patch: TemplateMetadataPatch,
  ): Promise<RepositoryResult<TemplateRecord>> {
    const stored = this.#templates.get(id)
    if (!stored) return notFound(id)
    const stale = conflictIfStale(stored, expectedRevision)
    if (stale) return stale
    if (patch.slug !== undefined) {
      const slugProblem = validateSlug(patch.slug)
      if (slugProblem) return fail('invalid', slugProblem)
      if (this.#slugTaken(patch.slug, id)) return slugTaken()
    }
    const invalid = validateMetadata(patch)
    if (invalid) return fail('invalid', invalid)
    // A metadata edit bumps the concurrency token but writes no version: the
    // content did not change, so the history would gain a meaningless entry.
    stored.metadata = {
      ...stored.metadata,
      ...copy(definedOnly(patch)),
      revision: stored.metadata.revision + 1,
      updatedBy: this.#author,
      updatedAt: this.#now(),
    }
    return ok(copy(toRecord(stored)))
  }

  async remove(id: TemplateId): Promise<RepositoryResult<void>> {
    if (!this.#templates.has(id)) return notFound(id)
    // The versions live inside the entry, so deleting it cascades by construction.
    this.#templates.delete(id)
    return { ok: true, value: undefined }
  }

  async listVersions(id: TemplateId): Promise<RepositoryResult<readonly TemplateVersionSummary[]>> {
    const stored = this.#templates.get(id)
    if (!stored) return notFound(id)
    const summaries = [...stored.versions].reverse().map((version): TemplateVersionSummary => ({
      versionNumber: version.versionNumber,
      kind: version.input.kind,
      note: version.input.note ?? '',
      createdBy: version.createdBy,
      createdAt: version.createdAt,
    }))
    return ok(copy(summaries))
  }

  async convertToCode(id: TemplateId, input: ConvertToCodeInput): Promise<RepositoryResult<TemplateRecord>> {
    const stored = this.#templates.get(id)
    if (!stored) return notFound(id)
    const current = toRecord(stored)
    if (current.kind !== 'visual') {
      return fail('not-visual', 'Only a visual template can be converted into a code template.')
    }
    const stale = conflictIfStale(stored, input.expectedRevision)
    if (stale) return stale
    // The envelope is carried over: conversion changes how the email is edited,
    // not who it is addressed to.
    const version: VersionInput = {
      kind: 'code',
      envelope: current.envelope,
      samplePayloadText: input.samplePayloadText,
      propsSchemaText: input.propsSchemaText,
      html: input.html,
      text: input.text,
      source: input.source,
      note: input.note,
    }
    const tooLarge = oversizedField(version)
    if (tooLarge) return payloadTooLarge(tooLarge)
    this.#appendVersion(stored, version)
    return ok(copy(toRecord(stored)))
  }

  /** Copies a seed record in as the first entry of its own history. */
  #seed(record: TemplateRecord): void {
    const version: VersionInput =
      record.kind === 'code'
        ? {
            kind: 'code',
            envelope: record.envelope,
            samplePayloadText: record.samplePayloadText,
            propsSchemaText: record.propsSchemaText,
            html: '',
            text: '',
            source: record.source,
          }
        : {
            kind: 'visual',
            envelope: record.envelope,
            samplePayloadText: record.samplePayloadText,
            propsSchemaText: record.propsSchemaText,
            html: record.html,
            text: record.text,
            document: record.document,
            theme: record.theme,
          }
    this.#templates.set(record.metadata.id, {
      // Ids, slugs and version labels are kept exactly as the starter declares
      // them; only the revision is normalised, because it is this store's token.
      metadata: copy({ ...record.metadata, revision: 1 }),
      versions: [
        {
          versionNumber: record.metadata.version.number,
          createdBy: record.metadata.createdBy,
          createdAt: record.metadata.version.createdAt,
          input: copy(version),
        },
      ],
    })
  }

  #appendVersion(stored: StoredTemplate, input: VersionInput): void {
    const at = this.#now()
    const number = stored.versions[stored.versions.length - 1].versionNumber + 1
    stored.versions.push({
      versionNumber: number,
      createdBy: this.#author,
      createdAt: at,
      input: copy(input),
    })
    stored.metadata = {
      ...stored.metadata,
      version: { number, label: `v${number}`, createdAt: at },
      revision: stored.metadata.revision + 1,
      updatedBy: this.#author,
      updatedAt: at,
    }
  }

  #slugTaken(slug: string, exceptId: TemplateId | null): boolean {
    for (const stored of this.#templates.values()) {
      if (stored.metadata.slug === slug && stored.metadata.id !== exceptId) return true
    }
    return false
  }
}

/** Builds the record callers see: the metadata plus the content of the newest version. */
function toRecord(stored: StoredTemplate): TemplateRecord {
  const latest = stored.versions[stored.versions.length - 1].input
  const base = {
    metadata: stored.metadata,
    envelope: latest.envelope,
    samplePayloadText: latest.samplePayloadText,
    propsSchemaText: latest.propsSchemaText,
  }
  return latest.kind === 'code'
    ? { ...base, kind: 'code', source: latest.source }
    : {
        ...base,
        kind: 'visual',
        document: latest.document,
        theme: latest.theme,
        html: latest.html,
        text: latest.text,
      }
}

/**
 * Every value that crosses this boundary is copied, in both directions. An HTTP
 * adapter serialises anyway, so a caller must never be able to reach into the
 * store by holding on to something it was handed.
 */
function copy<T>(value: T): T {
  return structuredClone(value)
}

/** Counts bytes, not characters: the caps in `shared/templateContracts.ts` are in bytes. */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

/** Names the first field over its size cap, or null when everything fits. */
function oversizedField(input: VersionInput): string | null {
  if (byteLength(input.html) > MAX_HTML_BYTES) return 'The exported HTML'
  if (byteLength(input.text) > MAX_TEXT_BYTES) return 'The plain text'
  if (byteLength(input.samplePayloadText) > MAX_PROPS_BYTES) return 'The sample props'
  if (byteLength(input.propsSchemaText) > MAX_PROPS_BYTES) return 'The props schema'
  if (input.kind === 'code' && byteLength(input.source) > MAX_SOURCE_BYTES) return 'The source'
  if (input.kind === 'visual' && byteLength(JSON.stringify(input.document)) > MAX_DOCUMENT_BYTES) {
    return 'The document'
  }
  if (byteLength(JSON.stringify(input)) > MAX_VERSION_BYTES) return 'The version'
  return null
}

/** Explains why a slug cannot be used, or null when it is fine. */
function validateSlug(slug: string): string | null {
  if (slug === '') return 'A template needs a name with at least one letter or number in it.'
  if (slug.length > MAX_SLUG_LENGTH) return `A slug may be at most ${MAX_SLUG_LENGTH} characters.`
  if (!SLUG_PATTERN.test(slug)) return 'Use lower-case letters, numbers and single hyphens.'
  return null
}

/**
 * Explains why a name, description or tag list cannot be stored, or null when
 * everything fits. The same caps live in `shared/templateContracts.ts`, where
 * the API enforces them: checking them here too is what stops memory mode from
 * accepting a template the server would refuse.
 */
function validateMetadata(input: {
  readonly name?: string
  readonly description?: string
  readonly tags?: readonly string[]
}): string | null {
  if (input.name !== undefined && input.name.length > MAX_NAME_LENGTH) {
    return `A name may be at most ${MAX_NAME_LENGTH} characters.`
  }
  if (input.description !== undefined && input.description.length > MAX_DESCRIPTION_LENGTH) {
    return `A description may be at most ${MAX_DESCRIPTION_LENGTH} characters.`
  }
  if (input.tags !== undefined) {
    if (input.tags.length > MAX_TAGS) return `A template may have at most ${MAX_TAGS} tags.`
    for (const tag of input.tags) {
      if (tag === '') return 'A tag cannot be empty.'
      if (tag.length > MAX_TAG_LENGTH) return `A tag may be at most ${MAX_TAG_LENGTH} characters.`
    }
  }
  return null
}

/** Explains why an envelope cannot be stored, or null when it fits. */
function validateEnvelope(envelope: TemplateEnvelope): string | null {
  if (envelope.subject.length > MAX_SUBJECT_LENGTH) {
    return `A subject line may be at most ${MAX_SUBJECT_LENGTH} characters.`
  }
  if (envelope.preheader.length > MAX_PREHEADER_LENGTH) {
    return `Preheader text may be at most ${MAX_PREHEADER_LENGTH} characters.`
  }
  return null
}

/** Drops the keys a patch left out, so `undefined` never overwrites a stored value. */
function definedOnly(patch: TemplateMetadataPatch): Partial<TemplateMetadata> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) if (value !== undefined) result[key] = value
  return result as Partial<TemplateMetadata>
}

/** The refusal a stale `expectedRevision` earns, or null when the caller is up to date. */
function conflictIfStale(
  stored: StoredTemplate,
  expectedRevision: number,
): { readonly ok: false; readonly failure: RepositoryFailure } | null {
  if (expectedRevision === stored.metadata.revision) return null
  return {
    ok: false,
    failure: {
      code: 'version-conflict',
      message: `This template was saved elsewhere as ${stored.metadata.version.label}.`,
      // The stored copy travels with the refusal so the UI can offer
      // "keep mine / discard mine" without a second request.
      current: copy(toRecord(stored)),
    },
  }
}

function ok<T>(value: T): RepositoryResult<T> {
  return { ok: true, value }
}

function fail<T>(
  code: Exclude<RepositoryFailure['code'], 'version-conflict'>,
  message: string,
): RepositoryResult<T> {
  return { ok: false, failure: { code, message } }
}

function notFound<T>(id: TemplateId): RepositoryResult<T> {
  return fail('not-found', `No template with the id ${id}.`)
}

function slugTaken<T>(): RepositoryResult<T> {
  return fail('slug-taken', 'A template with that name already exists. Try another name.')
}

function payloadTooLarge<T>(field: string): RepositoryResult<T> {
  return fail('payload-too-large', `${field} is too large to save.`)
}
