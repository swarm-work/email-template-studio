import { useEffect, useMemo, useState } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { ApiKeysPage } from '@/presentation/api/ApiKeysPage'
import { emailProvider } from '@/infrastructure/providers/emailProvider'
import { WorkerTemplateRenderer } from '@/infrastructure/render/renderClient'
import { createSessionStore, getBrowserSessionStorage } from '@/infrastructure/session/sessionStore'
import { STARTER_TEMPLATES } from '@/infrastructure/templates/registry'
import { toEmailTemplate } from '@/infrastructure/templates/templateMapper'
import { PasswordGate } from '@/presentation/auth/PasswordGate'
import { StudioPage } from '@/presentation/studio/StudioPage'
import type { ProductPage } from '@/presentation/layout/GlobalHeader'

/** Composition root: builds the infrastructure once and hands it to the page. */
export default function App() {
  const renderer = useMemo(() => new WorkerTemplateRenderer(), [])
  // Records are plain data; the mapper gives each one its props validator.
  const templates = useMemo(() => STARTER_TEMPLATES.map(toEmailTemplate), [])
  const store = useMemo(() => createSessionStore(getBrowserSessionStorage()), [])
  const [activePage, setActivePage] = useState<ProductPage>('templates')

  useEffect(() => () => renderer.dispose(), [renderer])

  return (
    <TooltipProvider delayDuration={300}>
      {/* Wraps both pages: whichever one is showing, the API behind it still
          needs a caller it can name, so the gate belongs outside the switch. */}
      <PasswordGate>
        {activePage === 'api' ? (
          <ApiKeysPage
            workspace="meridian-platform"
            environment="Local"
            version={__APP_VERSION__}
            providerLabel={emailProvider.label}
            activePage={activePage}
            onNavigate={setActivePage}
          />
        ) : (
          <StudioPage
            templates={templates}
            renderer={renderer}
            store={store}
            provider={emailProvider}
            workspace="meridian-platform"
            environment="Local"
            version={__APP_VERSION__}
            activePage={activePage}
            onNavigate={setActivePage}
          />
        )}
      </PasswordGate>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  )
}
