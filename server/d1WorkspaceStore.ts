/**
 * The WorkspaceStore backed by Cloudflare D1, in plain SQL.
 *
 * Server layer, like d1TemplateStore.ts: it talks to the structural
 * `SqlDatabase`, never to `D1Database`, and every write is one `db.batch(...)`.
 * Rows are parsed with Zod on the way out so an unexpected column shape fails
 * here, loudly, rather than three layers up.
 */
import { z } from 'zod'
import type { SqlDatabase, WriteContext } from './templateStore.ts'
import type {
  NewWorkspaceInput,
  StoredMember,
  StoredWorkspace,
  WorkspacePatch,
  WorkspaceRole,
  WorkspaceStore,
  WorkspaceWriteOutcome,
} from './workspaceStore.ts'

const workspaceRowSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  stytch_organization_slug: z.string().nullable(),
  default_from: z.string(),
  allowed_from_domain: z.string(),
  ses_configuration_set: z.string().nullable(),
  created_by: z.string(),
  created_at: z.string(),
  updated_by: z.string(),
  updated_at: z.string(),
})

const memberRowSchema = z.object({
  workspace_id: z.string(),
  email: z.string(),
  role: z.enum(['admin', 'editor']),
  added_by: z.string(),
  added_at: z.string(),
})

const WORKSPACE_COLUMNS = `id, slug, name, stytch_organization_slug, default_from, allowed_from_domain,
  ses_configuration_set, created_by, created_at, updated_by, updated_at`

const MEMBER_COLUMNS = 'workspace_id, email, role, added_by, added_at'

export class D1WorkspaceStore implements WorkspaceStore {
  readonly #db: SqlDatabase

  constructor(db: SqlDatabase) {
    this.#db = db
  }

  async list(): Promise<readonly StoredWorkspace[]> {
    // NOCASE, or 'swarm.camp' would sort after 'Zeta': SQLite compares bytes by
    // default and every capital letter comes before every lower-case one.
    const rows = await this.#db
      .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces ORDER BY name COLLATE NOCASE, id`)
      .all()
    return rows.results.map((row) => toWorkspace(workspaceRowSchema.parse(row)))
  }

  async get(id: string): Promise<StoredWorkspace | null> {
    const row = await this.#db
      .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE id = ?`)
      .bind(id)
      .first()
    return row === null ? null : toWorkspace(workspaceRowSchema.parse(row))
  }

  async getBySlug(slug: string): Promise<StoredWorkspace | null> {
    const row = await this.#db
      .prepare(`SELECT ${WORKSPACE_COLUMNS} FROM workspaces WHERE slug = ?`)
      .bind(slug)
      .first()
    return row === null ? null : toWorkspace(workspaceRowSchema.parse(row))
  }

  async create(input: NewWorkspaceInput, ctx: WriteContext): Promise<WorkspaceWriteOutcome> {
    const statement = this.#db
      .prepare(`INSERT INTO workspaces (${WORKSPACE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        input.id,
        input.slug,
        input.name,
        input.stytchOrganizationSlug,
        input.defaultFrom,
        input.allowedFromDomain,
        input.sesConfigurationSet,
        ctx.by,
        ctx.at,
        ctx.by,
        ctx.at,
      )
    try {
      await this.#db.batch([statement])
    } catch (error) {
      if (isWorkspaceSlugConflict(error)) return { status: 'slug-taken' }
      throw error
    }
    return this.#saved(input.id)
  }

  async update(id: string, patch: WorkspacePatch, ctx: WriteContext): Promise<WorkspaceWriteOutcome> {
    // The SET clause is built from the keys that were actually sent, because
    // COALESCE cannot tell "clear this column" (an explicit null) from "leave
    // it alone" (absent), and two of these columns are nullable on purpose.
    const assignments: string[] = []
    const values: unknown[] = []
    const set = (column: string, value: unknown) => {
      assignments.push(`${column} = ?`)
      values.push(value)
    }
    if (patch.name !== undefined) set('name', patch.name)
    if (patch.stytchOrganizationSlug !== undefined)
      set('stytch_organization_slug', patch.stytchOrganizationSlug)
    if (patch.defaultFrom !== undefined) set('default_from', patch.defaultFrom)
    if (patch.allowedFromDomain !== undefined) set('allowed_from_domain', patch.allowedFromDomain)
    if (patch.sesConfigurationSet !== undefined) set('ses_configuration_set', patch.sesConfigurationSet)
    set('updated_by', ctx.by)
    set('updated_at', ctx.at)

    const result = await this.#db.batch([
      this.#db.prepare(`UPDATE workspaces SET ${assignments.join(', ')} WHERE id = ?`).bind(...values, id),
    ])
    if (result[0].meta.changes === 0) return { status: 'not-found' }
    return this.#saved(id)
  }

  async listMembers(workspaceId: string): Promise<readonly StoredMember[]> {
    const rows = await this.#db
      .prepare(`SELECT ${MEMBER_COLUMNS} FROM workspace_members WHERE workspace_id = ? ORDER BY email`)
      .bind(workspaceId)
      .all()
    return rows.results.map((row) => toMember(memberRowSchema.parse(row)))
  }

  async membershipsOf(email: string): Promise<readonly StoredMember[]> {
    const rows = await this.#db
      .prepare(`SELECT ${MEMBER_COLUMNS} FROM workspace_members WHERE email = ? ORDER BY workspace_id`)
      .bind(email)
      .all()
    return rows.results.map((row) => toMember(memberRowSchema.parse(row)))
  }

  async putMember(
    workspaceId: string,
    email: string,
    role: WorkspaceRole,
    ctx: WriteContext,
  ): Promise<StoredMember | null> {
    // An upsert on the (workspace_id, email) primary key: a second PUT for the
    // same person changes their role and re-stamps who did it.
    try {
      await this.#db.batch([
        this.#db
          .prepare(
            `INSERT INTO workspace_members (${MEMBER_COLUMNS}) VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (workspace_id, email) DO UPDATE SET role = excluded.role,
               added_by = excluded.added_by, added_at = excluded.added_at`,
          )
          .bind(workspaceId, email, role, ctx.by, ctx.at),
      ])
    } catch (error) {
      // The foreign key: the workspace is not there. Same answer as the
      // in-memory store, so the route can turn it into a 404.
      if (isForeignKeyFailure(error)) return null
      throw error
    }
    const row = await this.#db
      .prepare(`SELECT ${MEMBER_COLUMNS} FROM workspace_members WHERE workspace_id = ? AND email = ?`)
      .bind(workspaceId, email)
      .first()
    if (row === null)
      throw new Error(`Member ${email} of ${workspaceId} disappeared immediately after a write`)
    return toMember(memberRowSchema.parse(row))
  }

  async removeMember(workspaceId: string, email: string): Promise<'deleted' | 'not-found'> {
    const result = await this.#db.batch([
      this.#db
        .prepare('DELETE FROM workspace_members WHERE workspace_id = ? AND email = ?')
        .bind(workspaceId, email),
    ])
    return result[0].meta.changes === 0 ? 'not-found' : 'deleted'
  }

  async #saved(id: string): Promise<WorkspaceWriteOutcome> {
    const workspace = await this.get(id)
    if (workspace === null) throw new Error(`Workspace ${id} disappeared immediately after a write`)
    return { status: 'saved', workspace }
  }
}

function toWorkspace(row: z.infer<typeof workspaceRowSchema>): StoredWorkspace {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    stytchOrganizationSlug: row.stytch_organization_slug,
    defaultFrom: row.default_from,
    allowedFromDomain: row.allowed_from_domain,
    sesConfigurationSet: row.ses_configuration_set,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  }
}

function toMember(row: z.infer<typeof memberRowSchema>): StoredMember {
  return {
    workspaceId: row.workspace_id,
    email: row.email,
    role: row.role,
    addedBy: row.added_by,
    addedAt: row.added_at,
  }
}

/** The one unique index user input can hit here: `workspaces.slug`. */
export function isWorkspaceSlugConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /UNIQUE constraint failed/i.test(message) && /workspaces\.slug/i.test(message)
}

function isForeignKeyFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /FOREIGN KEY constraint failed/i.test(message)
}
