/**
 * The TemplateStore backed by Cloudflare D1 (SQLite), written in plain SQL.
 *
 * Server layer: it talks to the structural `SqlDatabase` from templateStore.ts,
 * never to `D1Database` directly, so this file needs no Cloudflare types and no
 * Hono. Every write goes through ONE `db.batch(...)`, which D1 runs as a single
 * transaction: either the whole write lands or none of it does.
 */
import { z } from 'zod'
import type {
  MetadataPatch,
  NewTemplateInput,
  NewVersionInput,
  SqlDatabase,
  SqlStatement,
  StoredTemplate,
  StoredTemplateSummary,
  StoredVersion,
  StoredVersionSummary,
  TemplateStore,
  WriteContext,
  WriteOutcome,
} from './templateStore.ts'

/**
 * The `templates` row as SQLite hands it back: snake_case columns, tags as JSON
 * text. Parsing with Zod turns "the database returned something unexpected"
 * into a loud error here instead of a strange bug three layers up.
 */
const templateRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(['onboarding', 'security', 'collaboration', 'billing', 'notification']),
  status: z.enum(['draft', 'ready', 'deprecated']),
  tags: z.string(),
  origin: z.enum(['user', 'starter']),
  current_version: z.number().int(),
  revision: z.number().int(),
  created_by: z.string(),
  created_at: z.string(),
  updated_by: z.string(),
  updated_at: z.string(),
  /** Joined from the current version, because the kind lives on the version. */
  kind: z.enum(['code', 'visual']),
})

/** The `template_versions` row. `source` and `document` are nullable by design. */
const versionRowSchema = z.object({
  version_number: z.number().int(),
  kind: z.enum(['code', 'visual']),
  subject: z.string(),
  preheader: z.string(),
  reply_to: z.string(),
  source: z.string().nullable(),
  document: z.string().nullable(),
  theme: z.string(),
  html: z.string(),
  plain_text: z.string(),
  props_sample: z.string(),
  props_schema: z.string(),
  note: z.string(),
  created_by: z.string(),
  created_at: z.string(),
})

const versionSummaryRowSchema = versionRowSchema.pick({
  version_number: true,
  kind: true,
  note: true,
  created_by: true,
  created_at: true,
})

/** The columns a summary needs, joined to the current version for its kind. */
const SUMMARY_SELECT = `SELECT t.id, t.slug, t.name, t.description, t.category, t.status, t.tags, t.origin,
         t.current_version, t.revision, t.created_by, t.created_at, t.updated_by, t.updated_at, v.kind
  FROM templates t
  JOIN template_versions v ON v.template_id = t.id AND v.version_number = t.current_version`

/** Kept in one place because both the INSERT and the INSERT ... SELECT list them. */
const VERSION_COLUMNS = `id, template_id, version_number, kind, subject, preheader, reply_to,
   source, document, theme, html, plain_text, props_sample, props_schema, note, created_by, created_at`

export class D1TemplateStore implements TemplateStore {
  readonly #db: SqlDatabase

  constructor(db: SqlDatabase) {
    this.#db = db
  }

  async list(): Promise<readonly StoredTemplateSummary[]> {
    // Newest-edited first; the id is the tie-break so two rows written in the
    // same batch (the starter seed) always come back in the same order.
    const rows = await this.#db.prepare(`${SUMMARY_SELECT} ORDER BY t.updated_at DESC, t.id DESC`).all()
    return rows.results.map((row) => toSummary(templateRowSchema.parse(row)))
  }

  async get(id: string): Promise<StoredTemplate | null> {
    const row = await this.#db.prepare(`${SUMMARY_SELECT} WHERE t.id = ?`).bind(id).first()
    if (row === null) return null
    const summary = toSummary(templateRowSchema.parse(row))
    const version = await this.#currentVersion(id, summary.versionNumber)
    return { ...summary, version }
  }

  async listVersions(id: string): Promise<readonly StoredVersionSummary[] | null> {
    const rows = await this.#db
      .prepare(
        `SELECT version_number, kind, note, created_by, created_at FROM template_versions
         WHERE template_id = ? ORDER BY version_number DESC`,
      )
      .bind(id)
      .all()
    // A template always has at least version 1, so an empty history can only
    // mean the template itself is gone.
    if (rows.results.length === 0) return null
    return rows.results.map((row) => {
      const parsed = versionSummaryRowSchema.parse(row)
      return {
        versionNumber: parsed.version_number,
        kind: parsed.kind,
        note: parsed.note,
        createdBy: parsed.created_by,
        createdAt: parsed.created_at,
      }
    })
  }

  async create(input: NewTemplateInput, ctx: WriteContext): Promise<WriteOutcome> {
    const statements = [
      this.#db
        .prepare(
          `INSERT INTO templates (id, slug, name, description, category, status, tags, origin,
             current_version, revision, created_by, created_at, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?, ?)`,
        )
        .bind(
          input.id,
          input.slug,
          input.name,
          input.description,
          input.category,
          input.status,
          JSON.stringify([...input.tags]),
          input.origin,
          ctx.by,
          ctx.at,
          ctx.by,
          ctx.at,
        ),
      this.#insertVersion(`${input.id}_v1`, input.id, 1, input.version, ctx),
    ]

    try {
      await this.#db.batch(statements)
    } catch (error) {
      if (isSlugConflict(error)) return { status: 'slug-taken' }
      throw error
    }
    return this.#saved(input.id)
  }

  async addVersion(
    id: string,
    expectedRevision: number,
    input: NewVersionInput,
    ctx: WriteContext,
  ): Promise<WriteOutcome> {
    // Statement 1 is the guard: it only matches while the row is still at the
    // revision the caller read. Statement 2 copies the freshly incremented
    // `current_version` out of that same row, and its NOT EXISTS clause makes
    // sure it can never insert a version number that already exists - so when
    // statement 1 matches nothing, statement 2 writes nothing either.
    const result = await this.#db.batch([
      this.#db
        .prepare(
          `UPDATE templates
             SET current_version = current_version + 1, revision = revision + 1,
                 updated_by = ?, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .bind(ctx.by, ctx.at, id, expectedRevision),
      this.#db
        .prepare(
          `INSERT INTO template_versions (${VERSION_COLUMNS})
           SELECT t.id || '_v' || t.current_version, t.id, t.current_version,
                  ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             FROM templates t
            WHERE t.id = ? AND t.revision = ? + 1
              AND NOT EXISTS (
                SELECT 1 FROM template_versions v
                 WHERE v.template_id = t.id AND v.version_number = t.current_version
              )`,
        )
        .bind(...versionValues(input, ctx), id, expectedRevision),
    ])

    if (result[0].meta.changes === 0) return this.#refused(id)
    return this.#saved(id)
  }

  async updateMetadata(
    id: string,
    expectedRevision: number,
    patch: MetadataPatch,
    ctx: WriteContext,
  ): Promise<WriteOutcome> {
    // COALESCE(?, column) is SQL for "use the new value when one was sent,
    // otherwise leave the column alone", which keeps this one statement.
    const statement = this.#db
      .prepare(
        `UPDATE templates
            SET name = COALESCE(?, name), slug = COALESCE(?, slug),
                description = COALESCE(?, description), category = COALESCE(?, category),
                status = COALESCE(?, status), tags = COALESCE(?, tags),
                revision = revision + 1, updated_by = ?, updated_at = ?
          WHERE id = ? AND revision = ?`,
      )
      .bind(
        patch.name ?? null,
        patch.slug ?? null,
        patch.description ?? null,
        patch.category ?? null,
        patch.status ?? null,
        patch.tags === undefined ? null : JSON.stringify([...patch.tags]),
        ctx.by,
        ctx.at,
        id,
        expectedRevision,
      )

    let result
    try {
      result = await this.#db.batch([statement])
    } catch (error) {
      if (isSlugConflict(error)) return { status: 'slug-taken' }
      throw error
    }
    if (result[0].meta.changes === 0) return this.#refused(id)
    return this.#saved(id)
  }

  async remove(id: string): Promise<'deleted' | 'not-found'> {
    // The versions go with it: `ON DELETE CASCADE` in migration 0001.
    const result = await this.#db.batch([this.#db.prepare('DELETE FROM templates WHERE id = ?').bind(id)])
    return result[0].meta.changes === 0 ? 'not-found' : 'deleted'
  }

  /** Reads the row back after a successful write, so the caller gets the server's truth. */
  async #saved(id: string): Promise<WriteOutcome> {
    const template = await this.get(id)
    if (template === null) throw new Error(`Template ${id} disappeared immediately after a write`)
    return { status: 'saved', template }
  }

  /**
   * A guarded write matched no row. That is either "someone else got there
   * first" or "there is nothing here", and only a re-read can tell them apart.
   */
  async #refused(id: string): Promise<WriteOutcome> {
    const template = await this.get(id)
    return template === null ? { status: 'not-found' } : { status: 'conflict', template }
  }

  async #currentVersion(id: string, versionNumber: number): Promise<StoredVersion> {
    const row = await this.#db
      .prepare(
        `SELECT version_number, kind, subject, preheader, reply_to, source, document, theme,
                html, plain_text, props_sample, props_schema, note, created_by, created_at
           FROM template_versions WHERE template_id = ? AND version_number = ?`,
      )
      .bind(id, versionNumber)
      .first()
    if (row === null) throw new Error(`Template ${id} has no version ${versionNumber}`)
    const parsed = versionRowSchema.parse(row)
    return {
      versionNumber: parsed.version_number,
      kind: parsed.kind,
      envelope: { subject: parsed.subject, preheader: parsed.preheader, replyTo: parsed.reply_to },
      source: parsed.source,
      document: parsed.document,
      theme: parsed.theme,
      html: parsed.html,
      text: parsed.plain_text,
      propsSample: parsed.props_sample,
      propsSchema: parsed.props_schema,
      note: parsed.note,
      createdBy: parsed.created_by,
      createdAt: parsed.created_at,
    }
  }

  #insertVersion(
    rowId: string,
    templateId: string,
    versionNumber: number,
    input: NewVersionInput,
    ctx: WriteContext,
  ): SqlStatement {
    return this.#db
      .prepare(
        `INSERT INTO template_versions (${VERSION_COLUMNS})
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(rowId, templateId, versionNumber, ...versionValues(input, ctx))
  }
}

/**
 * The version's own columns in the order both INSERTs list them, so the two
 * statements can never drift apart.
 */
function versionValues(input: NewVersionInput, ctx: WriteContext): unknown[] {
  return [
    input.kind,
    input.envelope.subject,
    input.envelope.preheader,
    input.envelope.replyTo,
    input.source,
    input.document,
    input.theme,
    input.html,
    input.text,
    input.propsSample,
    input.propsSchema,
    input.note,
    ctx.by,
    ctx.at,
  ]
}

function toSummary(row: z.infer<typeof templateRowSchema>): StoredTemplateSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    status: row.status,
    tags: parseTags(row.tags),
    origin: row.origin,
    kind: row.kind,
    versionNumber: row.current_version,
    revision: row.revision,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}

/** Tags are stored as JSON text; anything unreadable degrades to no tags rather than a 500. */
function parseTags(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : []
  } catch {
    return []
  }
}

/**
 * SQLite reports a broken unique index by message; the only one this store can
 * hit from user input is `templates.slug`. Everything else is rethrown so the
 * route turns it into a 500 rather than a misleading "that name is taken".
 */
export function isSlugConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /UNIQUE constraint failed/i.test(message) && /templates\.slug/i.test(message)
}
