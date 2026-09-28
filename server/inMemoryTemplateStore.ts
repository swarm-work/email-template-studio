/**
 * A TemplateStore that keeps everything in two Maps.
 *
 * Server layer: it implements the port in templateStore.ts and imports nothing
 * else (no D1, no Hono, no Node APIs). It backs the route tests and the Node
 * runtime (`server/node.ts`), where restarting the process loses everything.
 *
 * Everything that goes in or comes out is deep-copied, so a caller holding a
 * returned object can never reach in and mutate the store behind its back.
 *
 * Isolation (ADR-32) is one private helper, `#rowIn`: a template is only
 * found when both its id AND its workspace match, which is what the D1 store's
 * `AND workspace_id = ?` does.
 */
import type {
  MetadataPatch,
  NewTemplateInput,
  NewVersionInput,
  StoredTemplate,
  StoredTemplateSummary,
  StoredVersion,
  StoredVersionSummary,
  TemplateStore,
  WriteContext,
  WriteOutcome,
} from './templateStore.ts'

/** The `templates` row. `kind` is not stored here: it comes from the current version. */
type TemplateRow = Omit<StoredTemplateSummary, 'kind'>

/** `structuredClone` is available in Node 18+, workerd and every browser we target. */
function copy<T>(value: T): T {
  return structuredClone(value) as T
}

export class InMemoryTemplateStore implements TemplateStore {
  readonly #templates = new Map<string, TemplateRow>()
  readonly #versions = new Map<string, StoredVersion[]>()

  /**
   * `seed` is applied with the timestamps each input already carries, so the
   * starters look the same here as they do after migration 0002.
   */
  constructor(seed: readonly { input: NewTemplateInput; ctx: WriteContext }[] = []) {
    for (const entry of seed) {
      // Loud on purpose: a seed the store refuses (two starters sharing a slug,
      // say) would otherwise leave the Node runtime quietly short of a template.
      const outcome = this.#insert(entry.input, entry.ctx)
      if (outcome.status !== 'saved') {
        throw new Error(`Seed template ${entry.input.id} was refused: ${outcome.status}`)
      }
    }
  }

  async list(workspaceId: string): Promise<readonly StoredTemplateSummary[]> {
    const summaries = [...this.#templates.values()]
      .filter((row) => row.workspaceId === workspaceId)
      .map((row) => this.#summary(row.id))
    // Newest-edited first, with the id as a tie-break so the order is stable
    // when two rows share a timestamp (the seed writes them in one batch).
    summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id))
    return summaries
  }

  async get(workspaceId: string, id: string): Promise<StoredTemplate | null> {
    if (!this.#rowIn(workspaceId, id)) return null
    return this.#detail(id)
  }

  async listVersions(workspaceId: string, id: string): Promise<readonly StoredVersionSummary[] | null> {
    if (!this.#rowIn(workspaceId, id)) return null
    const versions = this.#versions.get(id) ?? []
    return versions
      .map(({ versionNumber, kind, note, createdBy, createdAt }) => ({
        versionNumber,
        kind,
        note,
        createdBy,
        createdAt,
      }))
      .sort((a, b) => b.versionNumber - a.versionNumber)
  }

  async create(input: NewTemplateInput, ctx: WriteContext): Promise<WriteOutcome> {
    return this.#insert(input, ctx)
  }

  /**
   * The body of `create`, kept synchronous so the constructor can check its
   * outcome. A duplicate id THROWS rather than returning an outcome, because
   * that is what SQLite does with a duplicate primary key: the two stores have
   * to disagree about nothing, which is the point of the shared contract suite.
   */
  #insert(input: NewTemplateInput, ctx: WriteContext): WriteOutcome {
    if (this.#templates.has(input.id)) throw new Error(`Template ${input.id} already exists`)
    if (this.#slugOwner(input.workspaceId, input.slug) !== undefined) return { status: 'slug-taken' }
    this.#templates.set(input.id, {
      id: input.id,
      workspaceId: input.workspaceId,
      slug: input.slug,
      name: input.name,
      description: input.description,
      category: input.category,
      status: input.status,
      tags: copy([...input.tags]),
      origin: input.origin,
      versionNumber: 1,
      revision: 1,
      createdBy: ctx.by,
      createdAt: ctx.at,
      updatedBy: ctx.by,
      updatedAt: ctx.at,
    })
    this.#versions.set(input.id, [versionFrom(input.version, 1, ctx)])
    return { status: 'saved', template: this.#detail(input.id) }
  }

  async addVersion(
    workspaceId: string,
    id: string,
    expectedRevision: number,
    input: NewVersionInput,
    ctx: WriteContext,
  ): Promise<WriteOutcome> {
    const row = this.#rowIn(workspaceId, id)
    if (!row) return { status: 'not-found' }
    if (row.revision !== expectedRevision) return { status: 'conflict', template: this.#detail(id) }

    const next = row.versionNumber + 1
    this.#versions.get(id)?.push(versionFrom(input, next, ctx))
    this.#templates.set(id, {
      ...row,
      versionNumber: next,
      revision: row.revision + 1,
      updatedBy: ctx.by,
      updatedAt: ctx.at,
    })
    return { status: 'saved', template: this.#detail(id) }
  }

  async updateMetadata(
    workspaceId: string,
    id: string,
    expectedRevision: number,
    patch: MetadataPatch,
    ctx: WriteContext,
  ): Promise<WriteOutcome> {
    const row = this.#rowIn(workspaceId, id)
    if (!row) return { status: 'not-found' }
    if (row.revision !== expectedRevision) return { status: 'conflict', template: this.#detail(id) }
    const owner = patch.slug === undefined ? undefined : this.#slugOwner(workspaceId, patch.slug)
    if (owner !== undefined && owner !== id) return { status: 'slug-taken' }

    this.#templates.set(id, {
      ...row,
      name: patch.name ?? row.name,
      slug: patch.slug ?? row.slug,
      description: patch.description ?? row.description,
      category: patch.category ?? row.category,
      status: patch.status ?? row.status,
      tags: patch.tags === undefined ? row.tags : copy([...patch.tags]),
      revision: row.revision + 1,
      updatedBy: ctx.by,
      updatedAt: ctx.at,
    })
    return { status: 'saved', template: this.#detail(id) }
  }

  async remove(workspaceId: string, id: string): Promise<'deleted' | 'not-found'> {
    if (!this.#rowIn(workspaceId, id)) return 'not-found'
    this.#templates.delete(id)
    // The SQL schema does this with ON DELETE CASCADE; here it is one more line.
    this.#versions.delete(id)
    return 'deleted'
  }

  /** The row, but only if it lives in this workspace. Otherwise it "does not exist". */
  #rowIn(workspaceId: string, id: string): TemplateRow | undefined {
    const row = this.#templates.get(id)
    return row && row.workspaceId === workspaceId ? row : undefined
  }

  /** The id that already holds this slug IN THIS WORKSPACE, or undefined when it is free. */
  #slugOwner(workspaceId: string, slug: string): string | undefined {
    for (const row of this.#templates.values()) {
      if (row.workspaceId === workspaceId && row.slug === slug) return row.id
    }
    return undefined
  }

  #currentVersion(id: string): StoredVersion {
    const versions = this.#versions.get(id) ?? []
    const current = versions[versions.length - 1]
    if (!current) throw new Error(`Template ${id} has no versions`)
    return current
  }

  #summary(id: string): StoredTemplateSummary {
    const row = this.#templates.get(id)
    if (!row) throw new Error(`Unknown template id: ${id}`)
    return copy({ ...row, kind: this.#currentVersion(id).kind })
  }

  #detail(id: string): StoredTemplate {
    return { ...this.#summary(id), version: copy(this.#currentVersion(id)) }
  }
}

/** Turns the contents of a save into the stored row, stamping author and time. */
function versionFrom(input: NewVersionInput, versionNumber: number, ctx: WriteContext): StoredVersion {
  return copy({
    versionNumber,
    kind: input.kind,
    envelope: input.envelope,
    source: input.source,
    document: input.document,
    theme: input.theme,
    html: input.html,
    text: input.text,
    propsSample: input.propsSample,
    propsSchema: input.propsSchema,
    note: input.note,
    createdBy: ctx.by,
    createdAt: ctx.at,
  })
}
