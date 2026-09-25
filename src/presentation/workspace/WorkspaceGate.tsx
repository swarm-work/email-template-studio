/**
 * The screens around the workspace list: where `/` goes, what an unknown slug
 * gets, and what "you have no workspace" looks like.
 *
 * Presentation layer. Nothing here fetches; it reads `useWorkspaceList()`.
 */
import { Navigate, useParams } from 'react-router'
import type { ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import type { Workspace } from '@/domain'
import { pickHomeWorkspace } from './lastWorkspace'
import { CurrentWorkspaceProvider, useWorkspaceList } from './WorkspaceContext'
import { workspaceHome } from './WorkspaceSwitcher'

/** `/`: into the last-visited workspace, else the first one. */
export function HomeRedirect() {
  const { state, reload } = useWorkspaceList()
  if (state.kind === 'loading') return <Centered>Loading workspaces…</Centered>
  if (state.kind === 'error') return <ListError failure={state.failure.message} onRetry={reload} />
  const home = pickHomeWorkspace(state.workspaces)
  if (!home) return <NoWorkspace />
  return <Navigate to={workspaceHome(home)} replace />
}

/**
 * Resolves `:slug` and provides the current workspace to everything below.
 * `children` is the shell; it only renders once the slug is known to be one of
 * ours, so the header never has to cope with "no workspace".
 */
export function ResolveWorkspace({ children }: { children: (workspace: Workspace) => ReactNode }) {
  const { slug } = useParams()
  const { state, reload } = useWorkspaceList()
  if (state.kind === 'loading') return <Centered>Loading workspaces…</Centered>
  if (state.kind === 'error') return <ListError failure={state.failure.message} onRetry={reload} />
  const workspace = state.workspaces.find((candidate) => candidate.slug === slug)
  if (!workspace) return <UnknownWorkspace slug={slug ?? ''} workspaces={state.workspaces} />
  return <CurrentWorkspaceProvider workspace={workspace}>{children(workspace)}</CurrentWorkspaceProvider>
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <p className="text-muted-foreground text-sm">{children}</p>
    </div>
  )
}

function ListError({ failure, onRetry }: { failure: string; onRetry: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-12">
      <Alert variant="destructive">
        <AlertTitle>Workspaces could not be loaded</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>{failure}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}

function NoWorkspace() {
  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-12">
      <Alert>
        <AlertTitle>You are not in any workspace</AlertTitle>
        <AlertDescription>
          Ask a workspace admin to add your address, or sign in with an account that belongs to the
          organisation.
        </AlertDescription>
      </Alert>
    </div>
  )
}

function UnknownWorkspace({ slug, workspaces }: { slug: string; workspaces: readonly Workspace[] }) {
  return (
    <div className="mx-auto w-full max-w-[720px] px-6 py-12">
      <Alert>
        <AlertTitle>No workspace called “{slug}”</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>Either it does not exist or you are not a member of it.</span>
          {workspaces.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {workspaces.map((workspace) => (
                <li key={workspace.slug}>
                  <Button asChild variant="outline" size="sm">
                    <a href={workspaceHome(workspace)}>{workspace.name}</a>
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </AlertDescription>
      </Alert>
    </div>
  )
}
