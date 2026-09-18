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
import { AppFooter } from '@/presentation/layout/AppFooter'
import { GlobalHeader, type ScreenPage } from '@/presentation/layout/GlobalHeader'
import { TemplatesRoute } from '@/presentation/templates/TemplatesRoute'

const WORKSPACE = 'meridian-platform'
const ENVIRONMENT = 'Local'

/** Composition root: builds the infrastructure once and hands it to the screens. */
export default function App() {
  const renderer = useMemo(() => new WorkerTemplateRenderer(), [])
  const repository = useMemo(() => createTemplateRepository(), [])
  const store = useMemo(() => createSessionStore(getBrowserSessionStorage()), [])
  const [activePage, setActivePage] = useState<ScreenPage>('templates')

  // The header is rendered once, outside the page switch, so it never remounts.
  // That means the numbers it shows have to live here rather than in a page.
  const [lastRenderMs, setLastRenderMs] = useState<number | null>(null)
  const [live, setLive] = useState(false)
  const onRenderTime = useCallback((ms: number | null) => setLastRenderMs(ms), [])

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
          density="page"
          header={
            <GlobalHeader
              workspace={WORKSPACE}
              environment={ENVIRONMENT}
              lastRenderMs={lastRenderMs}
              live={live}
              activePage={activePage}
              onNavigate={setActivePage}
            />
          }
          footer={
            <AppFooter
              environment={ENVIRONMENT}
              version={__APP_VERSION__}
              providerLabel={emailProvider.label}
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
