/**
 * The port through which the studio reads and writes templates.
 *
 * Application layer: types only, no implementation, no React, DOM or Zod. The
 * adapters live in infrastructure (an in-memory one for tests and demos, an
 * HTTP one for the real API), so the studio never learns where templates live.
 *
 * Every call answers with a RepositoryResult instead of throwing: a failed save
 * is a normal outcome the UI has to explain, not an exception to catch.
 */
import type {
  EmailDocument,
  TemplateCategory,
  TemplateEnvelope,
  TemplateId,
  TemplateKind,
  TemplateRecord,
  TemplateStatus,
} from '@/domain'

/** What the create dialog collects. */
export interface NewTemplateInput {
  readonly name: string
  /** Derived from the name when absent. */
  readonly slug?: string
  readonly kind: TemplateKind
  readonly description: string
  readonly category: TemplateCategory
  readonly tags?: readonly string[]
}

/** Fields every new version carries, whatever the kind. */
interface VersionInputBase {
  readonly envelope: TemplateEnvelope
  readonly samplePayloadText: string
  readonly propsSchemaText: string
  /** Exported at save time, with {{key}} merge fields left unresolved. */
  readonly html: string
  readonly text: string
  /** Optional one-line "what changed". */
  readonly note?: string
}

/** One new version of a template. The kind decides what the content is. */
export type VersionInput =
  | (VersionInputBase & { readonly kind: 'code'; readonly source: string })
  | (VersionInputBase & { readonly kind: 'visual'; readonly document: EmailDocument; readonly theme: string })

/** The one-way conversion of a visual template into a code template. */
export interface ConvertToCodeInput {
  readonly expectedRevision: number
  readonly source: string
  readonly html: string
  readonly text: string
  readonly samplePayloadText: string
  readonly propsSchemaText: string
  readonly note?: string
}

/** Metadata-only edits (no new version). */
export interface TemplateMetadataPatch {
  readonly name?: string
  readonly slug?: string
  readonly description?: string
  readonly category?: TemplateCategory
  readonly status?: TemplateStatus
  readonly tags?: readonly string[]
}

/** One version as the history list shows it, without the content blobs. */
export interface TemplateVersionSummary {
  readonly versionNumber: number
  readonly kind: TemplateKind
  readonly note: string
  readonly createdBy: string
  readonly createdAt: string
}

/**
 * Why a call did not succeed. `version-conflict` carries the server's copy so
 * the UI can offer "keep mine / discard mine" without a second request.
 */
export type RepositoryFailure =
  | {
      readonly code:
        | 'unreachable'
        | 'unauthenticated'
        | 'forbidden'
        | 'not-found'
        | 'invalid'
        | 'slug-taken'
        | 'payload-too-large'
        | 'storage-unavailable'
        | 'not-visual'
        | 'unexpected'
      readonly message: string
    }
  | { readonly code: 'version-conflict'; readonly message: string; readonly current: TemplateRecord }

export type RepositoryResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: RepositoryFailure }

export interface TemplateRepository {
  list(): Promise<RepositoryResult<readonly TemplateRecord[]>>
  get(id: TemplateId): Promise<RepositoryResult<TemplateRecord>>
  create(
    input: NewTemplateInput & { readonly initialVersion: VersionInput },
  ): Promise<RepositoryResult<TemplateRecord>>
  /** Appends a version. `expectedRevision` is the optimistic-concurrency token. */
  saveVersion(
    id: TemplateId,
    expectedRevision: number,
    input: VersionInput,
  ): Promise<RepositoryResult<TemplateRecord>>
  updateMetadata(
    id: TemplateId,
    expectedRevision: number,
    patch: TemplateMetadataPatch,
  ): Promise<RepositoryResult<TemplateRecord>>
  remove(id: TemplateId): Promise<RepositoryResult<void>>
  listVersions(id: TemplateId): Promise<RepositoryResult<readonly TemplateVersionSummary[]>>
  /** Visual → code, one way: the document is discarded. */
  convertToCode(id: TemplateId, input: ConvertToCodeInput): Promise<RepositoryResult<TemplateRecord>>
}
