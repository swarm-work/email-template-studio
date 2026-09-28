/**
 * The storage port for workspaces and their members: what the workspace
 * routes and the access middleware may know about persistence, and no more.
 *
 * Server layer, runtime-neutral, like templateStore.ts: no D1, no Hono, no
 * Node. Two implementations - `D1WorkspaceStore` and `InMemoryWorkspaceStore` -
 * and `server/workspaceStoreContract.ts` is the suite both pass.
 *
 * A workspace is the unit of isolation (ADR-32). Who may enter one is decided
 * by `server/workspaceAccess.ts` from three inputs: the workspace row, the
 * caller's member row if any, and the caller's identity (ADR-33).
 */
import type { WriteContext } from './templateStore.ts'

export type WorkspaceRole = 'admin' | 'editor'

/** One row of `workspaces`. Nullable columns are `null` here, never `undefined`. */
export interface StoredWorkspace {
  readonly id: string
  readonly slug: string
  readonly name: string
  /** Members of this Stytch organisation are admins; `null` means "members table only". */
  readonly stytchOrganizationSlug: string | null
  readonly defaultFrom: string
  readonly allowedFromDomain: string
  /** `null` means "use the server-wide SES_CONFIGURATION_SET". */
  readonly sesConfigurationSet: string | null
  readonly createdBy: string
  readonly createdAt: string
  readonly updatedBy: string
  readonly updatedAt: string
}

/** One row of `workspace_members`: a named person and their role in one workspace. */
export interface StoredMember {
  readonly workspaceId: string
  readonly email: string
  readonly role: WorkspaceRole
  readonly addedBy: string
  readonly addedAt: string
}

/** A brand-new workspace. The caller chooses the id (`ws_<slug>`). */
export interface NewWorkspaceInput {
  readonly id: string
  readonly slug: string
  readonly name: string
  readonly stytchOrganizationSlug: string | null
  readonly defaultFrom: string
  readonly allowedFromDomain: string
  readonly sesConfigurationSet: string | null
}

/**
 * The settings a PATCH may change. Absent means "leave alone"; for the two
 * nullable columns an explicit `null` means "clear it". The slug is not here:
 * it is the URL, and changing it would break every link anyone has kept.
 */
export interface WorkspacePatch {
  readonly name?: string
  readonly stytchOrganizationSlug?: string | null
  readonly defaultFrom?: string
  readonly allowedFromDomain?: string
  readonly sesConfigurationSet?: string | null
}

export type WorkspaceWriteOutcome =
  | { readonly status: 'saved'; readonly workspace: StoredWorkspace }
  | { readonly status: 'slug-taken' }
  | { readonly status: 'not-found' }

export interface WorkspaceStore {
  /** Every workspace, by name. Access filtering is the caller's job; there are few rows. */
  list(): Promise<readonly StoredWorkspace[]>
  get(id: string): Promise<StoredWorkspace | null>
  getBySlug(slug: string): Promise<StoredWorkspace | null>
  create(input: NewWorkspaceInput, ctx: WriteContext): Promise<WorkspaceWriteOutcome>
  update(id: string, patch: WorkspacePatch, ctx: WriteContext): Promise<WorkspaceWriteOutcome>
  /** The named members of one workspace, by email. Organisation members are not rows. */
  listMembers(workspaceId: string): Promise<readonly StoredMember[]>
  /** Every workspace this address is a named member of. */
  membershipsOf(email: string): Promise<readonly StoredMember[]>
  /** Adds the person or changes their role. `null` when the workspace does not exist. */
  putMember(
    workspaceId: string,
    email: string,
    role: WorkspaceRole,
    ctx: WriteContext,
  ): Promise<StoredMember | null>
  removeMember(workspaceId: string, email: string): Promise<'deleted' | 'not-found'>
}

/**
 * The workspace migration 0004 creates, mirrored here so the in-memory store
 * (tests and `server/node.ts`) starts from the same row D1 does. A test reads
 * the migration and fails if the two drift.
 */
export const DEFAULT_WORKSPACE: NewWorkspaceInput = {
  id: 'ws_swarm-camp',
  slug: 'swarm-camp',
  name: 'swarm.camp',
  stytchOrganizationSlug: 'swarm',
  defaultFrom: 'testing@swarm.camp',
  allowedFromDomain: 'swarm.camp',
  sesConfigurationSet: null,
}

/** The audit stamp migration 0004 writes on that row. */
export const DEFAULT_WORKSPACE_CTX: WriteContext = { by: 'migration', at: '2026-09-25T00:00:00.000Z' }

/** The id a slug gets: `ws_<slug>`. One rule, used by the route and the seed. */
export function workspaceIdFor(slug: string): string {
  return `ws_${slug}`
}
