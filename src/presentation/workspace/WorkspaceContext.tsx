/**
 * The workspace the studio is currently inside, and the list it could switch to.
 *
 * Presentation layer. Two contexts, because they change at different times:
 * `WorkspaceListContext` is filled once per session by `WorkspaceProvider`
 * (and again on `reload`), while `CurrentWorkspaceContext` follows the URL and
 * is provided by the `/w/:slug` route element in `App.tsx`.
 *
 * Screens only ever call `useWorkspace()`, which joins the two.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RepositoryFailure } from '@/application/repositories/templateRepository'
import type { WorkspaceRepository } from '@/application/repositories/workspaceRepository'
import type { Workspace } from '@/domain'

export type WorkspaceListState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly failure: RepositoryFailure }
  | { readonly kind: 'ready'; readonly workspaces: readonly Workspace[] }

export interface WorkspaceListValue {
  readonly state: WorkspaceListState
  readonly repository: WorkspaceRepository
  /** Fetches the list again, e.g. after creating a workspace or from a Retry button. */
  reload(): void
  /** Puts one workspace into the list at once, so a rename shows before the refetch. */
  replace(workspace: Workspace): void
}

const WorkspaceListContext = createContext<WorkspaceListValue | null>(null)
const CurrentWorkspaceContext = createContext<Workspace | null>(null)

interface WorkspaceProviderProps {
  readonly repository: WorkspaceRepository
  readonly children: ReactNode
}

export function WorkspaceProvider({ repository, children }: WorkspaceProviderProps) {
  const [state, setState] = useState<WorkspaceListState>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    void repository.list().then((result) => {
      if (cancelled) return
      setState(
        result.ok ? { kind: 'ready', workspaces: result.value } : { kind: 'error', failure: result.failure },
      )
    })
    return () => {
      cancelled = true
    }
  }, [repository, attempt])

  const reload = useCallback(() => setAttempt((count) => count + 1), [])
  const replace = useCallback((workspace: Workspace) => {
    setState((current) => {
      if (current.kind !== 'ready') return current
      const known = current.workspaces.some((existing) => existing.slug === workspace.slug)
      const workspaces = known
        ? current.workspaces.map((existing) => (existing.slug === workspace.slug ? workspace : existing))
        : [...current.workspaces, workspace]
      return { kind: 'ready', workspaces }
    })
  }, [])

  const value = useMemo<WorkspaceListValue>(
    () => ({ state, repository, reload, replace }),
    [state, repository, reload, replace],
  )
  return <WorkspaceListContext.Provider value={value}>{children}</WorkspaceListContext.Provider>
}

/** Provided by the `/w/:slug` route once the slug has been resolved to a workspace. */
export function CurrentWorkspaceProvider({
  workspace,
  children,
}: {
  workspace: Workspace
  children: ReactNode
}) {
  return <CurrentWorkspaceContext.Provider value={workspace}>{children}</CurrentWorkspaceContext.Provider>
}

/** The list and its repository. Throws outside the provider: that is a wiring bug, not a runtime case. */
export function useWorkspaceList(): WorkspaceListValue {
  const value = useContext(WorkspaceListContext)
  if (!value) throw new Error('useWorkspaceList must be used inside <WorkspaceProvider>')
  return value
}

export interface UseWorkspaceResult extends WorkspaceListValue {
  /** The workspace the URL names. */
  readonly workspace: Workspace
  /** Every workspace the signed-in person may enter; empty until the list has loaded. */
  readonly workspaces: readonly Workspace[]
}

/** The current workspace plus the list. Only valid under `/w/:slug`. */
export function useWorkspace(): UseWorkspaceResult {
  const list = useWorkspaceList()
  const workspace = useContext(CurrentWorkspaceContext)
  if (!workspace) throw new Error('useWorkspace must be used inside a workspace route')
  return { ...list, workspace, workspaces: list.state.kind === 'ready' ? list.state.workspaces : [] }
}

/**
 * The current workspace, or null when there is none - for components that are
 * also rendered outside a workspace (tests, the visual editor's stories) and
 * only need it for one optional action.
 */
export function useOptionalWorkspace(): Workspace | null {
  return useContext(CurrentWorkspaceContext)
}
