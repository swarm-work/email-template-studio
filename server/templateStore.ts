/**
 * The storage port for templates: what the HTTP routes are allowed to know
 * about persistence, and nothing more.
 *
 * Server layer, runtime-neutral: it must not import D1, R2, Hono, Node or any
 * `@/` app module. The SQL types below are STRUCTURAL, so Cloudflare's
 * `D1Database` satisfies them without this file ever naming Cloudflare.
 */

/** What a statement's `run()`/`all()` hands back. Only the fields we actually use. */
export interface SqlResult<T = Record<string, unknown>> {
  readonly results: T[]
  /** `changes` is how many rows the statement wrote; 0 means a guarded UPDATE matched nothing. */
  readonly meta: { readonly changes: number }
}

/** A prepared statement. `bind` returns a new statement, it does not mutate. */
export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  run<T = Record<string, unknown>>(): Promise<SqlResult<T>>
  all<T = Record<string, unknown>>(): Promise<SqlResult<T>>
}

/**
 * A SQLite-shaped database. `batch` runs its statements as ONE transaction,
 * which is how every write in this store stays all-or-nothing.
 */
export interface SqlDatabase {
  prepare(query: string): SqlStatement
  batch<T = Record<string, unknown>>(statements: SqlStatement[]): Promise<SqlResult<T>[]>
}

export type TemplateKind = 'code' | 'visual'
export type TemplateOrigin = 'user' | 'starter'
export type TemplateCategory = 'onboarding' | 'security' | 'collaboration' | 'billing' | 'notification'
export type TemplateStatus = 'draft' | 'ready' | 'deprecated'

/** The envelope as stored: three plain strings, '' meaning "not set". */
export interface StoredEnvelope {
  readonly subject: string
  readonly preheader: string
  readonly replyTo: string
}

/**
 * One row of `template_versions`. `source` and `document` mirror the columns:
 * exactly one of them is non-null, decided by `kind`. `document` stays JSON
 * TEXT here — parsing it is the HTTP layer's job, not the store's.
 */
export interface StoredVersion {
  readonly versionNumber: number
  readonly kind: TemplateKind
  readonly envelope: StoredEnvelope
  readonly source: string | null
  readonly document: string | null
  readonly theme: string
  readonly html: string
  readonly text: string
  readonly propsSample: string
  readonly propsSchema: string
  readonly note: string
  readonly createdBy: string
  readonly createdAt: string
}

/** A library card: the `templates` row, without any of the content blobs. */
export interface StoredTemplateSummary {
  readonly id: string
  /** The workspace this template belongs to (ADR-32). Every read and write is scoped by it. */
  readonly workspaceId: string
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly category: TemplateCategory
  readonly status: TemplateStatus
  readonly tags: readonly string[]
  readonly origin: TemplateOrigin
  /** The kind of the CURRENT version; a converted template reports 'code'. */
  readonly kind: TemplateKind
  readonly versionNumber: number
  readonly revision: number
  readonly createdBy: string
  readonly createdAt: string
  readonly updatedBy: string
  readonly updatedAt: string
}

/** A card plus the contents of its current version. */
export interface StoredTemplate extends StoredTemplateSummary {
  readonly version: StoredVersion
}

/** Enough of a version to draw a history list without loading any blobs. */
export interface StoredVersionSummary {
  readonly versionNumber: number
  readonly kind: TemplateKind
  readonly note: string
  readonly createdBy: string
  readonly createdAt: string
}

/** The contents of a version about to be written. */
export interface NewVersionInput {
  readonly kind: TemplateKind
  readonly envelope: StoredEnvelope
  readonly source: string | null
  readonly document: string | null
  readonly theme: string
  readonly html: string
  readonly text: string
  readonly propsSample: string
  readonly propsSchema: string
  readonly note: string
}

/** A brand-new template and its version 1. The caller chooses the id. */
export interface NewTemplateInput {
  readonly id: string
  readonly workspaceId: string
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly category: TemplateCategory
  readonly status: TemplateStatus
  readonly tags: readonly string[]
  readonly origin: TemplateOrigin
  readonly version: NewVersionInput
}

/** Only the metadata fields a PATCH may change; absent means "leave alone". */
export interface MetadataPatch {
  readonly name?: string
  readonly slug?: string
  readonly description?: string
  readonly category?: TemplateCategory
  readonly status?: TemplateStatus
  readonly tags?: readonly string[]
}

/** Who is writing and when, for the audit columns. Injected so tests can fix the clock. */
export interface WriteContext {
  readonly by: string
  readonly at: string
}

/**
 * The four ways a write can end. `conflict` carries the server's current copy
 * so the browser can show "someone else saved v4" without a second round trip.
 */
export type WriteOutcome =
  | { readonly status: 'saved'; readonly template: StoredTemplate }
  | { readonly status: 'conflict'; readonly template: StoredTemplate }
  | { readonly status: 'not-found' }
  | { readonly status: 'slug-taken' }

/**
 * Everything the template routes may do to storage. Two implementations:
 * `D1TemplateStore` (production) and `InMemoryTemplateStore` (tests and the
 * Node runtime). `server/templateStoreContract.ts` holds the suite both pass.
 *
 * Every method takes the workspace FIRST. A template in another workspace is
 * indistinguishable from one that does not exist: reads answer `null`, writes
 * answer `not-found`. That is the whole of the isolation rule (ADR-32), and
 * keeping it inside the store means no route can forget it.
 */
export interface TemplateStore {
  /** Newest-updated first. Summaries only: the library never needs the blobs. */
  list(workspaceId: string): Promise<readonly StoredTemplateSummary[]>
  get(workspaceId: string, id: string): Promise<StoredTemplate | null>
  /** Newest version first; `null` when the template itself does not exist. */
  listVersions(workspaceId: string, id: string): Promise<readonly StoredVersionSummary[] | null>
  /** The workspace is on the input; the slug only has to be unique inside it. */
  create(input: NewTemplateInput, ctx: WriteContext): Promise<WriteOutcome>
  /** Appends the next version. Refuses with `conflict` unless `expectedRevision` is current. */
  addVersion(
    workspaceId: string,
    id: string,
    expectedRevision: number,
    input: NewVersionInput,
    ctx: WriteContext,
  ): Promise<WriteOutcome>
  /** Bumps `revision` without creating a version. Same optimistic-concurrency rule. */
  updateMetadata(
    workspaceId: string,
    id: string,
    expectedRevision: number,
    patch: MetadataPatch,
    ctx: WriteContext,
  ): Promise<WriteOutcome>
  /** Hard delete; the versions cascade with it. */
  remove(workspaceId: string, id: string): Promise<'deleted' | 'not-found'>
}
