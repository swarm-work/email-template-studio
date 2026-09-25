import { useCallback, useEffect, useMemo, useState } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useOutletContext } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import type { TemplateRepository } from '@/application/repositories/templateRepository'
import type { Workspace } from '@/domain'
import { ApiKeysPage } from '@/presentation/api/ApiKeysPage'
import { emailProvider, type EmailProvider } from '@/infrastructure/providers/emailProvider'
import { WorkerTemplateRenderer, type TemplateRenderer } from '@/infrastructure/render/renderClient'
import {
  createSessionStore,
  getBrowserSessionStorage,
  type StudioSessionStore,
} from '@/infrastructure/session/sessionStore'
import { createTemplateRepository } from '@/infrastructure/templates/createTemplateRepository'
import { createWorkspaceRepository } from '@/infrastructure/workspaces/createWorkspaceRepository'
import { PasswordGate } from '@/presentation/auth/PasswordGate'
import { AppShell } from '@/presentation/layout/AppShell'
import { GlobalHeader } from '@/presentation/layout/GlobalHeader'
import { TemplatesRoute } from '@/presentation/templates/TemplatesRoute'
import { rememberWorkspace } from '@/presentation/workspace/lastWorkspace'
import { HomeRedirect, ResolveWorkspace } from '@/presentation/workspace/WorkspaceGate'
import { WorkspaceProvider } from '@/presentation/workspace/WorkspaceContext'
import { WorkspaceSettingsPage } from '@/presentation/workspace/WorkspaceSettingsPage'
import { WorkspaceSwitcher } from '@/presentation/workspace/WorkspaceSwitcher'

// Only the API keys page reads this now: it goes into the prefix of the mock
// keys it generates (`st_local_…`). The header badge and the footer that used
// to show it were removed - "Local" was on screen in every environment,
// production included, so it told nobody anything true.
const ENVIRONMENT = 'Local'

/**
 * What the screens under a workspace get from the frame around them, through
 * the router's outlet context. One object, so a new screen only has to read it.
 */
interface StudioOutlet {
  readonly workspace: Workspace
  readonly repository: TemplateRepository
  readonly renderer: TemplateRenderer
  readonly store: StudioSessionStore
  readonly provider: EmailProvider
  readonly onRenderTime: (ms: number | null) => void
  readonly onEditorOpenChange: (open: boolean) => void
}

/**
 * Composition root: builds the infrastructure once and hands it to the screens.
 *
 * The URL is the state (docs/FEATURE_PLAN.md decision 18): `/w/:slug/...` names
 * the workspace, and everything under it lives in `WorkspaceFrame`.
 */
export default function App() {
  const renderer = useMemo(() => new WorkerTemplateRenderer(), [])
  const store = useMemo(() => createSessionStore(getBrowserSessionStorage()), [])
  const workspaceRepository = useMemo(() => createWorkspaceRepository(), [])

  // Boot the render worker now rather than when a template is first opened: it
  // is a large bundle and its load counts against the render timeout.
  useEffect(() => {
    renderer.warmUp()
    return () => renderer.dispose()
  }, [renderer])

  return (
    <TooltipProvider delayDuration={300}>
      {/* Wraps every screen: whichever one is showing, the API behind it still
          needs a caller it can name, so the gate belongs outside the router -
          it also owns the /authenticate callback path before any route runs. */}
      <PasswordGate>
        <BrowserRouter>
          <WorkspaceProvider repository={workspaceRepository}>
            <Routes>
              <Route path="/" element={<HomeRedirect />} />
              <Route path="/w/:slug" element={<WorkspaceFrame renderer={renderer} store={store} />}>
                <Route index element={<Navigate to="templates" replace />} />
                <Route path="templates" element={<TemplatesScreen />} />
                <Route path="templates/:templateId" element={<TemplatesScreen />} />
                <Route path="api" element={<ApiKeysPage environment={ENVIRONMENT} />} />
                <Route path="settings" element={<WorkspaceSettingsPage />} />
                <Route path="*" element={<Navigate to="templates" replace />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </WorkspaceProvider>
        </BrowserRouter>
      </PasswordGate>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}

interface WorkspaceFrameProps {
  readonly renderer: TemplateRenderer
  readonly store: StudioSessionStore
}

/** Resolves `:slug`, then renders the shell around whichever screen is open. */
function WorkspaceFrame({ renderer, store }: WorkspaceFrameProps) {
  return (
    <ResolveWorkspace>
      {(workspace) => <WorkspaceShell workspace={workspace} renderer={renderer} store={store} />}
    </ResolveWorkspace>
  )
}

/**
 * The shell for one workspace: the header and the outlet the screens render
 * into. Rendered once per workspace, so the header keeps its state (and its
 * DOM node) while the screen inside changes.
 */
function WorkspaceShell({
  workspace,
  renderer,
  store,
}: WorkspaceFrameProps & { readonly workspace: Workspace }) {
  // Templates belong to a workspace, so the repository is built for this one
  // and rebuilt when the slug changes (which is what a switch is).
  const repository = useMemo(() => createTemplateRepository(workspace.slug), [workspace.slug])

  useEffect(() => rememberWorkspace(workspace.slug), [workspace.slug])

  // The studio with a template open is a full-height app screen (one viewport,
  // internal scrollers); every other screen is an ordinary page that scrolls.
  // The shell is rendered here, above the routes, so the route has to say which.
  const [editorOpen, setEditorOpen] = useState(false)

  // The header is rendered once, outside the page switch, so it never remounts.
  // That means the numbers it shows have to live here rather than in a page.
  const [lastRenderMs, setLastRenderMs] = useState<number | null>(null)
  const [live, setLive] = useState(false)
  const onRenderTime = useCallback((ms: number | null) => setLastRenderMs(ms), [])

  // Who is signed in, and whether there is anything to sign out OF.
  //
  // The status route already echoes the caller's email back, so this needs no
  // new endpoint. `authMode` decides whether the sign-out control exists at all:
  // under Cloudflare Access signing out is the identity provider's business, and
  // under the shared password there is no person to sign out - which is exactly
  // the gap ADR-31 closes.
  const [signedInAs, setSignedInAs] = useState<string | undefined>(undefined)
  const [authMode, setAuthMode] = useState<string | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/send-test/status', { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) return null
        return (await response.json()) as { user?: string; authMode?: string }
      })
      .then((body) => {
        if (cancelled || !body) return
        setSignedInAs(body.user)
        setAuthMode(body.authMode)
      })
      // A failure here costs the avatar its name and nothing else. The gate
      // above this component has already decided whether the studio opens.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  const onSignOut = useCallback(() => {
    // Imported here, not at the top of the file: the header is on every screen,
    // and a static import would pull the Stytch chunk into the first download of
    // every build (see src/presentation/auth/stytchSignOut.ts).
    void import('@/presentation/auth/stytchSignOut').then(({ signOutOfStytch }) => signOutOfStytch())
  }, [])

  // "LIVE" is only honest when the send server says it is connected.
  useEffect(() => {
    let cancelled = false
    void emailProvider.getStatus().then((status) => {
      if (!cancelled) setLive(status.connected)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const outlet = useMemo<StudioOutlet>(
    () => ({
      workspace,
      repository,
      renderer,
      store,
      provider: emailProvider,
      onRenderTime,
      onEditorOpenChange: setEditorOpen,
    }),
    [workspace, repository, renderer, store, onRenderTime],
  )

  return (
    <AppShell
      density={editorOpen ? 'app' : 'page'}
      header={
        <GlobalHeader
          workspace={workspace}
          workspaceSwitcher={<WorkspaceSwitcher />}
          lastRenderMs={lastRenderMs}
          live={live}
          signedInAs={signedInAs}
          onSignOut={authMode === 'stytch' ? onSignOut : undefined}
        />
      }
    >
      {/* Keyed by the slug: switching workspace remounts the screen, so an
          editor open on one workspace's template never survives into another. */}
      <Outlet key={workspace.slug} context={outlet} />
    </AppShell>
  )
}

/** The templates screen, fed from the frame's outlet context. */
function TemplatesScreen() {
  const { workspace, repository, renderer, store, provider, onRenderTime, onEditorOpenChange } =
    useOutletContext<StudioOutlet>()
  return (
    <TemplatesRoute
      workspaceSlug={workspace.slug}
      repository={repository}
      renderer={renderer}
      store={store}
      provider={provider}
      onRenderTime={onRenderTime}
      onEditorOpenChange={onEditorOpenChange}
    />
  )
}
