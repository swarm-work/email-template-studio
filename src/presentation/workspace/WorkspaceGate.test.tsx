// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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

// The real sign-out loads the Stytch SDK and reloads the page; here it only
// has to be called.
const { signOutOfStytch } = vi.hoisted(() => ({ signOutOfStytch: vi.fn(async () => null) }))
vi.mock('@/presentation/auth/stytchSignOut', () => ({ signOutOfStytch }))

/** What `/api/send-test/status` answers: who is signed in, and how. */
function stubStatus(body: { user?: string; authMode?: string } | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      body === null ? new Response('', { status: 401 }) : Response.json(body, { status: 200 }),
    ),
  )
}

beforeEach(() => {
  signOutOfStytch.mockClear()
  // Nobody named unless a test says so, so the older tests see what they always did.
  stubStatus(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

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

/**
 * These three screens render outside the header, so its account menu is not
 * there. Each one says which account is signed in and, under Stytch, offers the
 * only way out of it - a person who signed in with the wrong account was stuck.
 */
describe('the screens outside the header', () => {
  function failingList() {
    const list = vi.fn<WorkspaceRepository['list']>().mockResolvedValue({
      ok: false,
      failure: { code: 'unreachable', message: 'Could not reach the API.' },
    })
    return { ...createInMemoryWorkspaceRepository(), list }
  }

  const SCREENS = [
    { name: 'no workspace', path: '/', repository: () => createInMemoryWorkspaceRepository([]) },
    { name: 'unknown workspace', path: '/w/nope/templates', repository: () => undefined },
    { name: 'list error', path: '/w/swarm-camp/templates', repository: failingList },
  ] as const

  for (const { name, path, repository } of SCREENS) {
    it(`${name}: names the account and signs out of Stytch`, async () => {
      window.localStorage.clear()
      stubStatus({ user: 'wrong.account@example.com', authMode: 'stytch' })
      renderAt(path, repository())

      await waitFor(() => expect(screen.getByText('wrong.account@example.com')).toBeInTheDocument())
      expect(screen.getByText(/Signed in as/)).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
      await waitFor(() => expect(signOutOfStytch).toHaveBeenCalledTimes(1))
    })

    it(`${name}: names the account but offers no sign out outside Stytch`, async () => {
      window.localStorage.clear()
      stubStatus({ user: 'developer@example.com', authMode: 'developer' })
      renderAt(path, repository())

      await waitFor(() => expect(screen.getByText('developer@example.com')).toBeInTheDocument())
      expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    })
  }

  it('shows no account line when the API names nobody', async () => {
    window.localStorage.clear()
    renderAt('/', createInMemoryWorkspaceRepository([]))
    await waitFor(() => expect(screen.getByText('You are not in any workspace')).toBeInTheDocument())
    expect(screen.queryByText(/Signed in as/)).not.toBeInTheDocument()
  })
})
