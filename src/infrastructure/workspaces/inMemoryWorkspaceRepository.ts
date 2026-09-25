/**
 * A `WorkspaceRepository` that lives in the browser tab: one workspace to
 * start (the same one migration 0004 creates), and whatever is made after.
 * Backs `VITE_DATA_MODE=memory` and the component tests. Nothing survives a
 * reload, which is the point of that mode.
 */
import type { RepositoryResult } from '@/application/repositories/templateRepository'
import type {
  NewWorkspaceInput,
  WorkspacePatch,
  WorkspaceRepository,
} from '@/application/repositories/workspaceRepository'
import type { Workspace, WorkspaceMember, WorkspaceRole } from '@/domain'
import { slugify } from '@shared/templateContracts'

/** Who the in-memory mode says is signed in. Named so tests can assert on it. */
export const MEMORY_IDENTITY = 'you@localhost'

const NOW = '2026-09-25T00:00:00.000Z'

/** The default workspace, as `migrations/0004_create_workspaces.sql` makes it. */
export const MEMORY_WORKSPACE: Workspace = {
  id: 'ws_swarm-camp',
  slug: 'swarm-camp',
  name: 'swarm.camp',
  stytchOrganizationSlug: 'swarm',
  defaultFrom: 'testing@swarm.camp',
  allowedFromDomain: 'swarm.camp',
  sesConfigurationSet: null,
  createdBy: 'migration',
  createdAt: NOW,
  updatedBy: 'migration',
  updatedAt: NOW,
  role: 'admin',
}

export function createInMemoryWorkspaceRepository(
  seed: readonly Workspace[] = [MEMORY_WORKSPACE],
): WorkspaceRepository {
  return new InMemoryWorkspaceRepository(seed)
}

class InMemoryWorkspaceRepository implements WorkspaceRepository {
  readonly #workspaces = new Map<string, Workspace>()
  readonly #members = new Map<string, WorkspaceMember[]>()

  constructor(seed: readonly Workspace[]) {
    for (const workspace of seed) {
      this.#workspaces.set(workspace.slug, workspace)
      this.#members.set(workspace.slug, [])
    }
  }

  async list(): Promise<RepositoryResult<readonly Workspace[]>> {
    const all = [...this.#workspaces.values()].sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
    )
    return { ok: true, value: all }
  }

  async create(input: NewWorkspaceInput): Promise<RepositoryResult<Workspace>> {
    const slug = input.slug ?? slugify(input.name)
    if (slug === '')
      return { ok: false, failure: { code: 'invalid', message: 'That name makes no usable slug.' } }
    if (this.#workspaces.has(slug)) {
      return {
        ok: false,
        failure: { code: 'slug-taken', message: 'Another workspace already uses that slug.' },
      }
    }
    const workspace: Workspace = {
      id: `ws_${slug}`,
      slug,
      name: input.name,
      stytchOrganizationSlug: MEMORY_WORKSPACE.stytchOrganizationSlug,
      defaultFrom: input.defaultFrom,
      allowedFromDomain: input.defaultFrom.slice(input.defaultFrom.lastIndexOf('@') + 1).toLowerCase(),
      sesConfigurationSet: null,
      createdBy: MEMORY_IDENTITY,
      createdAt: NOW,
      updatedBy: MEMORY_IDENTITY,
      updatedAt: NOW,
      role: 'admin',
    }
    this.#workspaces.set(slug, workspace)
    this.#members.set(slug, [
      { email: MEMORY_IDENTITY, role: 'admin', addedBy: MEMORY_IDENTITY, addedAt: NOW },
    ])
    return { ok: true, value: workspace }
  }

  async update(slug: string, patch: WorkspacePatch): Promise<RepositoryResult<Workspace>> {
    const current = this.#workspaces.get(slug)
    if (!current) return notFound()
    const next: Workspace = {
      ...current,
      name: patch.name ?? current.name,
      defaultFrom: patch.defaultFrom ?? current.defaultFrom,
      allowedFromDomain: patch.allowedFromDomain ?? current.allowedFromDomain,
      stytchOrganizationSlug:
        patch.stytchOrganizationSlug === undefined
          ? current.stytchOrganizationSlug
          : patch.stytchOrganizationSlug,
      sesConfigurationSet:
        patch.sesConfigurationSet === undefined ? current.sesConfigurationSet : patch.sesConfigurationSet,
      updatedBy: MEMORY_IDENTITY,
    }
    this.#workspaces.set(slug, next)
    return { ok: true, value: next }
  }

  async listMembers(slug: string): Promise<RepositoryResult<readonly WorkspaceMember[]>> {
    const members = this.#members.get(slug)
    return members ? { ok: true, value: [...members] } : notFound()
  }

  async putMember(
    slug: string,
    email: string,
    role: WorkspaceRole,
  ): Promise<RepositoryResult<WorkspaceMember>> {
    const members = this.#members.get(slug)
    if (!members) return notFound()
    const member: WorkspaceMember = { email, role, addedBy: MEMORY_IDENTITY, addedAt: NOW }
    const index = members.findIndex((existing) => existing.email === email)
    if (index === -1) members.push(member)
    else members[index] = member
    members.sort((a, b) => a.email.localeCompare(b.email))
    return { ok: true, value: member }
  }

  async removeMember(slug: string, email: string): Promise<RepositoryResult<void>> {
    const members = this.#members.get(slug)
    if (!members) return notFound()
    const index = members.findIndex((existing) => existing.email === email)
    if (index === -1) return notFound('No named member with that address.')
    members.splice(index, 1)
    return { ok: true, value: undefined }
  }
}

function notFound(message = 'No workspace with that slug.'): {
  readonly ok: false
  readonly failure: { code: 'not-found'; message: string }
} {
  return { ok: false, failure: { code: 'not-found', message } }
}
