/**
 * Who may enter a workspace, and as what. Pure functions, no I/O: the
 * middleware fetches the rows and asks here (ADR-33).
 *
 * The rule, in order:
 *   1. A named member row wins. It is how someone outside the organisation
 *      gets in, and how someone inside it is held to `editor`.
 *   2. A 'server' identity (developer mode, the shared password) is an admin
 *      everywhere. Those modes already mean "whoever reached this server is
 *      trusted", so this is the access they had before workspaces existed.
 *   3. A member of the workspace's Stytch organisation is an admin.
 *   4. Otherwise: no access. The route answers 404, not 403, so a slug cannot
 *      be confirmed to exist by someone who may not enter it.
 */
import type { Identity } from './auth.ts'
import type { StoredMember, StoredWorkspace, WorkspaceRole } from './workspaceStore.ts'

export function roleFor(
  workspace: StoredWorkspace,
  membership: StoredMember | null,
  identity: Identity,
): WorkspaceRole | null {
  if (membership) return membership.role
  if (identity.origin === 'server') return 'admin'
  if (
    workspace.stytchOrganizationSlug !== null &&
    identity.organization?.slug === workspace.stytchOrganizationSlug
  ) {
    return 'admin'
  }
  return null
}

/** Admins can do everything editors can; editors cannot administer. */
export function roleAllows(role: WorkspaceRole, required: WorkspaceRole): boolean {
  return role === 'admin' || required === 'editor'
}
