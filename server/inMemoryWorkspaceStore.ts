/**
 * A WorkspaceStore in two Maps. Backs the route tests and the Node runtime.
 *
 * Server layer: implements the port in workspaceStore.ts and imports nothing
 * else. Everything in or out is deep-copied, like the template store, so a
 * caller can never mutate the store through a returned object.
 */
import type { WriteContext } from './templateStore.ts'
import type {
  NewWorkspaceInput,
  StoredMember,
  StoredWorkspace,
  WorkspacePatch,
  WorkspaceRole,
  WorkspaceStore,
  WorkspaceWriteOutcome,
} from './workspaceStore.ts'

function copy<T>(value: T): T {
  return structuredClone(value) as T
}

/** Members keyed by `<workspaceId>\n<email>`; a newline cannot appear in either. */
function memberKey(workspaceId: string, email: string): string {
  return `${workspaceId}\n${email}`
}

export class InMemoryWorkspaceStore implements WorkspaceStore {
  readonly #workspaces = new Map<string, StoredWorkspace>()
  readonly #members = new Map<string, StoredMember>()

  /** `seed` rows are applied as-is; a refused one throws, like the template store's seed. */
  constructor(seed: readonly { input: NewWorkspaceInput; ctx: WriteContext }[] = []) {
    for (const { input, ctx } of seed) {
      const outcome = this.#insert(input, ctx)
      if (outcome.status !== 'saved')
        throw new Error(`Seed workspace ${input.id} was refused: ${outcome.status}`)
    }
  }

  async list(): Promise<readonly StoredWorkspace[]> {
    return (
      [...this.#workspaces.values()]
        // Case-insensitive, matching the D1 store's COLLATE NOCASE.
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id))
        .map(copy)
    )
  }

  async get(id: string): Promise<StoredWorkspace | null> {
    const row = this.#workspaces.get(id)
    return row ? copy(row) : null
  }

  async getBySlug(slug: string): Promise<StoredWorkspace | null> {
    for (const row of this.#workspaces.values()) if (row.slug === slug) return copy(row)
    return null
  }

  async create(input: NewWorkspaceInput, ctx: WriteContext): Promise<WorkspaceWriteOutcome> {
    return this.#insert(input, ctx)
  }

  #insert(input: NewWorkspaceInput, ctx: WriteContext): WorkspaceWriteOutcome {
    // A duplicate slug is the one clash user input can cause, so it is checked
    // first and answered politely. A duplicate id with a free slug throws,
    // because that is what SQLite does with a duplicate primary key.
    for (const row of this.#workspaces.values()) if (row.slug === input.slug) return { status: 'slug-taken' }
    if (this.#workspaces.has(input.id)) throw new Error(`Workspace ${input.id} already exists`)
    const row: StoredWorkspace = copy({
      ...input,
      createdBy: ctx.by,
      createdAt: ctx.at,
      updatedBy: ctx.by,
      updatedAt: ctx.at,
    })
    this.#workspaces.set(input.id, row)
    return { status: 'saved', workspace: copy(row) }
  }

  async update(id: string, patch: WorkspacePatch, ctx: WriteContext): Promise<WorkspaceWriteOutcome> {
    const row = this.#workspaces.get(id)
    if (!row) return { status: 'not-found' }
    const next: StoredWorkspace = {
      ...row,
      name: patch.name ?? row.name,
      // `undefined` leaves the column alone; an explicit `null` clears it.
      stytchOrganizationSlug:
        patch.stytchOrganizationSlug === undefined
          ? row.stytchOrganizationSlug
          : patch.stytchOrganizationSlug,
      defaultFrom: patch.defaultFrom ?? row.defaultFrom,
      allowedFromDomain: patch.allowedFromDomain ?? row.allowedFromDomain,
      sesConfigurationSet:
        patch.sesConfigurationSet === undefined ? row.sesConfigurationSet : patch.sesConfigurationSet,
      updatedBy: ctx.by,
      updatedAt: ctx.at,
    }
    this.#workspaces.set(id, copy(next))
    return { status: 'saved', workspace: copy(next) }
  }

  async listMembers(workspaceId: string): Promise<readonly StoredMember[]> {
    return [...this.#members.values()]
      .filter((member) => member.workspaceId === workspaceId)
      .sort((a, b) => a.email.localeCompare(b.email))
      .map(copy)
  }

  async membershipsOf(email: string): Promise<readonly StoredMember[]> {
    return [...this.#members.values()]
      .filter((member) => member.email === email)
      .sort((a, b) => a.workspaceId.localeCompare(b.workspaceId))
      .map(copy)
  }

  async putMember(
    workspaceId: string,
    email: string,
    role: WorkspaceRole,
    ctx: WriteContext,
  ): Promise<StoredMember | null> {
    // The foreign key in SQL refuses a member of a workspace that is not there.
    if (!this.#workspaces.has(workspaceId)) return null
    const member: StoredMember = { workspaceId, email, role, addedBy: ctx.by, addedAt: ctx.at }
    this.#members.set(memberKey(workspaceId, email), member)
    return copy(member)
  }

  async removeMember(workspaceId: string, email: string): Promise<'deleted' | 'not-found'> {
    return this.#members.delete(memberKey(workspaceId, email)) ? 'deleted' : 'not-found'
  }
}
