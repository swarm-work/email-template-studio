// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { WorkspaceRepository } from '@/application/repositories/workspaceRepository'
import {
  createInMemoryWorkspaceRepository,
  MEMORY_WORKSPACE,
} from '@/infrastructure/workspaces/inMemoryWorkspaceRepository'
import { rememberWorkspace } from './lastWorkspace'
import { WorkspaceProvider, useWorkspace } from './WorkspaceContext'
import { HomeRedirect, ResolveWorkspace } from './WorkspaceGate'

const OTHER = { ...MEMORY_WORKSPACE, id: 'ws_swarm-work', slug: 'swarm-work', name: 'swarm.work' }

/** Prints the URL, so a test can see where a redirect went. */
function WhereAmI() {
  const location = useLocation()
  return <p>at {location.pathname}</p>
}

function Inside() {
  const { workspace, workspaces } = useWorkspace()
  return (
    <p>
      inside {workspace.name} of {workspaces.length}
    </p>
  )
}

function renderAt(
  path: string,
  repository: WorkspaceRepository = createInMemoryWorkspaceRepository([MEMORY_WORKSPACE, OTHER]),
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <WorkspaceProvider repository={repository}>
        <Routes>
          <Route path="/" element={<HomeRedirect />} />
          <Route path="/w/:slug/*" element={<ResolveWorkspace>{() => <Inside />}</ResolveWorkspace>} />
        </Routes>
        <WhereAmI />
      </WorkspaceProvider>
    </MemoryRouter>,
  )
}

describe('HomeRedirect', () => {
  it('sends / to the first workspace when none is remembered', async () => {
    window.localStorage.clear()
    renderAt('/')
    await waitFor(() => expect(screen.getByText('at /w/swarm-camp/templates')).toBeInTheDocument())
  })

  it('prefers the workspace last visited in this browser', async () => {
    rememberWorkspace('swarm-work')
    renderAt('/')
    await waitFor(() => expect(screen.getByText('at /w/swarm-work/templates')).toBeInTheDocument())
  })

  it('falls back to the first workspace when the remembered one is no longer available', async () => {
    rememberWorkspace('gone')
    renderAt('/')
    await waitFor(() => expect(screen.getByText('at /w/swarm-camp/templates')).toBeInTheDocument())
  })

  it('explains when the person is in no workspace at all', async () => {
    window.localStorage.clear()
    renderAt('/', createInMemoryWorkspaceRepository([]))
    await waitFor(() => expect(screen.getByText('You are not in any workspace')).toBeInTheDocument())
  })
})

describe('ResolveWorkspace', () => {
  it('provides the workspace the URL names', async () => {
    renderAt('/w/swarm-work/templates')
    await waitFor(() => expect(screen.getByText('inside swarm.work of 2')).toBeInTheDocument())
  })

  it('names an unknown slug and offers the workspaces that exist', async () => {
    renderAt('/w/nope/templates')
    await waitFor(() => expect(screen.getByText('No workspace called “nope”')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: 'swarm.camp' })).toHaveAttribute(
      'href',
      '/w/swarm-camp/templates',
    )
  })

  it('shows the failure and a retry when the list cannot be loaded', async () => {
    const list = vi
      .fn<WorkspaceRepository['list']>()
      .mockResolvedValueOnce({
        ok: false,
        failure: { code: 'unreachable', message: 'Could not reach the API.' },
      })
      .mockResolvedValueOnce({ ok: true, value: [MEMORY_WORKSPACE] })
    const repository = { ...createInMemoryWorkspaceRepository(), list }
    renderAt('/w/swarm-camp/templates', repository)
    await waitFor(() => expect(screen.getByText('Could not reach the API.')).toBeInTheDocument())
    screen.getByRole('button', { name: 'Retry' }).click()
    await waitFor(() => expect(screen.getByText('inside swarm.camp of 1')).toBeInTheDocument())
  })
})
