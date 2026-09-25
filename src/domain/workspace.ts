/**
 * A workspace: the unit of isolation the studio runs inside (ADR-32).
 *
 * Domain layer: plain types, no React, no Zod. It owns templates today and
 * API keys, webhook endpoints and messages in later slices. The slug is the
 * URL segment (`/w/<slug>/...`) and never changes once created.
 */

/** What a person may do in a workspace. Admins can do everything editors can (ADR-33). */
export type WorkspaceRole = 'admin' | 'editor'

export interface Workspace {
  readonly id: string
  readonly slug: string
  readonly name: string
  /** Members of this Stytch organisation are admins; null means "named members only". */
  readonly stytchOrganizationSlug: string | null
  readonly defaultFrom: string
  readonly allowedFromDomain: string
  /** null means "the server-wide SES configuration set". */
  readonly sesConfigurationSet: string | null
  readonly createdBy: string
  readonly createdAt: string
  readonly updatedBy: string
  readonly updatedAt: string
  /** The signed-in person's own role here. */
  readonly role: WorkspaceRole
}

/** A named member: someone let in by email rather than by organisation. */
export interface WorkspaceMember {
  readonly email: string
  readonly role: WorkspaceRole
  readonly addedBy: string
  readonly addedAt: string
}
