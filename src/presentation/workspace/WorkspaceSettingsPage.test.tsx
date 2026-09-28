// @vitest-environment jsdom
/**
 * WorkspaceSettingsPage: an admin sees both sections, with the named member
 * list loaded; an editor sees the read-only alert and the member list is
 * never even requested. The server enforces this for real (403 on the member
 * routes, see workspaceRoutes.test.ts) - this test only proves the client
 * honours the same rule instead of flashing content it will not be allowed
 * to use.
 */
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { WorkspaceRepository } from '@/application/repositories/workspaceRepository'
import type { Workspace, WorkspaceMember, WorkspaceRole } from '@/domain'
import { CurrentWorkspaceProvider, WorkspaceProvider } from './WorkspaceContext'
import { WorkspaceSettingsPage } from './WorkspaceSettingsPage'

const NAMED_ADMIN: WorkspaceMember = {
  email: 'admin@acme.test',
  role: 'admin',
  addedBy: 'migration',
  addedAt: '2026-09-25T00:00:00.000Z',
}

function workspaceWithRole(role: WorkspaceRole): Workspace {
  return {
    id: 'ws_acme',
    slug: 'acme',
    name: 'ACME',
    stytchOrganizationSlug: null,
    defaultFrom: 'hello@acme.test',
    allowedFromDomain: 'acme.test',
    sesConfigurationSet: null,
    createdBy: 'migration',
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedBy: 'migration',
    updatedAt: '2026-09-25T00:00:00.000Z',
    role,
  }
}

/** Every method stubbed; a test overrides only the ones it cares about. */
function fakeRepository(overrides: Partial<WorkspaceRepository> = {}): WorkspaceRepository {
  return {
    list: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    create: vi.fn(),
    update: vi.fn(),
    listMembers: vi.fn().mockResolvedValue({ ok: true, value: [NAMED_ADMIN] }),
    putMember: vi.fn(),
    removeMember: vi.fn(),
    ...overrides,
  }
}

function renderSettings(role: WorkspaceRole, repository: WorkspaceRepository = fakeRepository()) {
  return render(
    <WorkspaceProvider repository={repository}>
      <CurrentWorkspaceProvider workspace={workspaceWithRole(role)}>
        <WorkspaceSettingsPage />
      </CurrentWorkspaceProvider>
    </WorkspaceProvider>,
  )
}

describe('WorkspaceSettingsPage', () => {
  it('shows an admin both sections, with the named members list loaded', async () => {
    renderSettings('admin')

    expect(screen.getByText('General')).toBeInTheDocument()
    expect(screen.getByText('Members')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('ACME')
    expect(screen.getByLabelText('Name')).not.toBeDisabled()

    await waitFor(() => expect(screen.getByText('admin@acme.test')).toBeInTheDocument())
    expect(screen.getByRole('list', { name: 'Named members' })).toBeInTheDocument()
    expect(screen.queryByText('Read only')).not.toBeInTheDocument()
  })

  it('gives the General and Members sections distinct React keys', async () => {
    // Both sections used to share `key={workspace.slug}`, which trips React's
    // "two children with the same key" console warning. Reverting to that
    // would still pass every other assertion here, so this test pins the fix
    // by asserting the warning never fires.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      renderSettings('admin')
      await waitFor(() => expect(screen.getByText('admin@acme.test')).toBeInTheDocument())
      const sameKeyWarning = consoleError.mock.calls.some((args) =>
        args.some((arg) => typeof arg === 'string' && /same key/.test(arg)),
      )
      expect(sameKeyWarning).toBe(false)
    } finally {
      consoleError.mockRestore()
    }
  })

  it('gives an editor a read-only page and never loads or shows the member list', async () => {
    const listMembers = vi.fn()
    renderSettings('editor', fakeRepository({ listMembers }))

    expect(await screen.findByText('Read only')).toBeInTheDocument()
    expect(
      screen.getByText('Only a workspace admin can change these settings or its members.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Only an admin can see or change the member list.')).toBeInTheDocument()

    expect(screen.getByLabelText('Name')).toBeDisabled()
    expect(screen.queryByRole('list', { name: 'Named members' })).not.toBeInTheDocument()
    // An editor cannot see the member list, so the page must not even ask for it.
    expect(listMembers).not.toHaveBeenCalled()
  })
})
