import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { ApiKeysPage } from '@/presentation/api/ApiKeysPage'
import { emailProvider } from '@/infrastructure/providers/emailProvider'
import { WorkerTemplateRenderer } from '@/infrastructure/render/renderClient'
import { createSessionStore, getBrowserSessionStorage } from '@/infrastructure/session/sessionStore'
import { createTemplateRepository } from '@/infrastructure/templates/createTemplateRepository'
import { PasswordGate } from '@/presentation/auth/PasswordGate'
import { AppShell } from '@/presentation/layout/AppShell'
import { GlobalHeader, type ScreenPage } from '@/presentation/layout/GlobalHeader'
import { TemplatesRoute } from '@/presentation/templates/TemplatesRoute'

const WORKSPACE = 'meridian-platform'
// Only the API keys page reads this now: it goes into the prefix of the mock
// keys it generates (`st_local_…`). The header badge and the footer that used
// to show it were removed - "Local" was on screen in every environment,
// production included, so it told nobody anything true.
const ENVIRONMENT = 'Local'

/** Composition root: builds the infrastructure once and hands it to the screens. */
export default function App() {
  const renderer = useMemo(() => new WorkerTemplateRenderer(), [])
  const repository = useMemo(() => createTemplateRepository(), [])
  const store = useMemo(() => createSessionStore(getBrowserSessionStorage()), [])
  const [activePage, setActivePage] = useState<ScreenPage>('templates')
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

  // Boot the render worker now rather than when a template is first opened: it
  // is a large bundle and its load counts against the render timeout.
  useEffect(() => {
    renderer.warmUp()
    return () => renderer.dispose()
  }, [renderer])

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

  /**
   * One screen per navigable page. The switch is exhaustive on purpose: adding
   * a page to `ScreenPage` without a screen here is a compile error rather than
   * a header that highlights something nobody rendered.
   */
  function screenFor(page: ScreenPage): ReactElement {
    switch (page) {
      case 'api':
        return <ApiKeysPage environment={ENVIRONMENT} />
      case 'templates':
        return (
          <TemplatesRoute
            repository={repository}
            renderer={renderer}
            store={store}
            provider={emailProvider}
            onRenderTime={onRenderTime}
            onEditorOpenChange={setEditorOpen}
          />
        )
    }
  }

  return (
    <TooltipProvider delayDuration={300}>
      {/* Wraps every screen: whichever one is showing, the API behind it still
          needs a caller it can name, so the gate belongs outside the shell. */}
      <PasswordGate>
        <AppShell
          density={activePage === 'templates' && editorOpen ? 'app' : 'page'}
          header={
            <GlobalHeader
              workspace={WORKSPACE}
              lastRenderMs={lastRenderMs}
              live={live}
              activePage={activePage}
              onNavigate={setActivePage}
              signedInAs={signedInAs}
              onSignOut={authMode === 'stytch' ? onSignOut : undefined}
            />
          }
        >
          {screenFor(activePage)}
        </AppShell>
      </PasswordGate>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}
