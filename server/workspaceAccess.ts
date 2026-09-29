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

/**
 * Who may create a NEW workspace (ADR-33, update 2026-09-29).
 *
 * The Stytch project behind this app lets a stranger create their own
 * organisation during sign-in, so "signed in" alone is not "belongs to a
 * team" - a stranger with a self-made organisation would otherwise become
 * the admin of a brand-new workspace just by calling this endpoint. So
 * creation is narrower than entering an existing workspace:
 *   1. A 'server' identity may always create one (same trust as ADR-33's
 *      entry rule).
 *   2. A directory identity may create one when its Stytch organisation
 *      already owns at least one workspace, or when it is already a named
 *      admin of at least one workspace - either way, it is already part of
 *      a team the studio recognises, not a fresh, self-made organisation.
 */
export function mayCreateWorkspace(
  identity: Identity,
  existingWorkspaces: readonly StoredWorkspace[],
  ownMemberships: readonly StoredMember[],
): boolean {
  if (identity.origin === 'server') return true
  const organizationSlug = identity.organization?.slug
  if (
    organizationSlug !== undefined &&
    existingWorkspaces.some((workspace) => workspace.stytchOrganizationSlug === organizationSlug)
  ) {
    return true
  }
  return ownMemberships.some((membership) => membership.role === 'admin')
}

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
