/**
 * The port through which the studio reads and changes workspaces.
 *
 * Application layer: types only, like templateRepository.ts. Two adapters live
 * in infrastructure (HTTP for the real API, in-memory for `VITE_DATA_MODE=memory`
 * and tests). Every call answers with a RepositoryResult rather than throwing.
 */
import type { Workspace, WorkspaceMember, WorkspaceRole } from '@/domain'
import type { RepositoryResult } from './templateRepository'

/** What the "new workspace" dialog collects. */
export interface NewWorkspaceInput {
  readonly name: string
  /** Derived from the name when absent. */
  readonly slug?: string
  readonly defaultFrom: string
}

/**
 * The settings page's edits. Absent leaves a field alone; for the two nullable
 * ones an explicit `null` clears the setting.
 */
export interface WorkspacePatch {
  readonly name?: string
  readonly defaultFrom?: string
  readonly allowedFromDomain?: string
  readonly stytchOrganizationSlug?: string | null
  readonly sesConfigurationSet?: string | null
}

export interface WorkspaceRepository {
  /** Every workspace the signed-in person may enter, with their role in each. */
  list(): Promise<RepositoryResult<readonly Workspace[]>>
  create(input: NewWorkspaceInput): Promise<RepositoryResult<Workspace>>
  update(slug: string, patch: WorkspacePatch): Promise<RepositoryResult<Workspace>>
  listMembers(slug: string): Promise<RepositoryResult<readonly WorkspaceMember[]>>
  /** Adds the person, or changes their role if they are already named. */
  putMember(slug: string, email: string, role: WorkspaceRole): Promise<RepositoryResult<WorkspaceMember>>
  removeMember(slug: string, email: string): Promise<RepositoryResult<void>>
}
