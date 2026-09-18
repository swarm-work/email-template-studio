/**
 * The one page of the MVP. Composes the studio panels and wires them to the
 * application layer. Keeping all state here (rather than in a global store)
 * is a deliberate MVP choice: one page, one owner of state.
 */
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { EmailTemplate } from '@/domain'
import { buildDiagnostics } from '@/application/buildDiagnostics'
import { parsePreviewPayload } from '@/application/parsePreviewPayload'
import type { EmailProvider } from '@/infrastructure/providers/emailProvider'
import type { TemplateRenderer } from '@/infrastructure/render/renderClient'
import type { StudioSessionStore } from '@/infrastructure/session/sessionStore'
import { AppFooter } from '@/presentation/layout/AppFooter'
import { GlobalHeader, type ProductPage, type WorkerHealth } from '@/presentation/layout/GlobalHeader'
import { useRenderPreview } from '@/presentation/hooks/useRenderPreview'
import { useStudio } from '@/presentation/hooks/useStudio'
import { DiagnosticsPanel } from './DiagnosticsPanel'
import { PageHeader } from './PageHeader'
import { PayloadPanel } from './PayloadPanel'
import { PreviewWorkspace } from './PreviewWorkspace'
import { SendTestEmailDialog } from './SendTestEmailDialog'
import { SourceWorkspace } from './SourceWorkspace'
import { TemplateLibrary } from './TemplateLibrary'

export interface StudioPageProps {
  templates: readonly EmailTemplate[]
  renderer: TemplateRenderer
  store: StudioSessionStore
  provider: EmailProvider
  workspace: string
  environment: string
  version: string
  activePage: ProductPage
  onNavigate: (page: ProductPage) => void
}

export function StudioPage({
  templates,
  renderer,
  store,
  provider,
  workspace,
  environment,
  version,
  activePage,
  onNavigate,
}: StudioPageProps) {
  const studio = useStudio({ templates, store })
  const { template, draft, sourceDirty, payloadDirty, state, actions } = studio

  // Validation is memoised on the text so its identity only changes when the text does.
  const validation = useMemo(
    () => parsePreviewPayload(draft.payloadText, template.validateProps),
    [draft.payloadText, template],
  )
  const props = validation.ok ? validation.value : null

  const preview = useRenderPreview(renderer, template.metadata.id, draft.source, props)

  const diagnostics = useMemo(
    () =>
      buildDiagnostics({
        validation,
        renderStatus: preview.status,
        renderResult: preview.result,
        sourceDirty,
        payloadDirty,
      }),
    [validation, preview.status, preview.result, sourceDirty, payloadDirty],
  )

  const [sendOpen, setSendOpen] = useState(false)

  const workerHealth: WorkerHealth =
    preview.status === 'rendering'
      ? 'busy'
      : preview.result &&
          !preview.result.ok &&
          (preview.result.error.kind === 'timeout' || preview.result.error.kind === 'worker')
        ? 'error'
        : 'ready'
  const lastRenderMs = preview.result?.ok ? preview.result.durationMs : null

  return (
    <div className="flex min-h-screen flex-col">
      <GlobalHeader
        workspace={workspace}
        environment={environment}
        workerHealth={workerHealth}
        lastRenderMs={lastRenderMs}
        activePage={activePage}
        onNavigate={onNavigate}
      />

      <main className="mx-auto w-full max-w-[1440px] flex-1 space-y-6 px-6 py-6">
        <PageHeader
          template={template}
          device={state.device}
          onDeviceChange={actions.setDevice}
          onSendTest={() => setSendOpen(true)}
          sourceDirty={sourceDirty}
        />

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-4">
            <SourceWorkspace
              template={template}
              source={draft.source}
              onSourceChange={actions.updateSource}
              sourceDirty={sourceDirty}
              onReset={() => {
                actions.resetSource()
                toast.success('Source restored to the original file.')
              }}
              renderStatus={preview.status}
              renderResult={preview.result}
              html={preview.html}
            />
            <PayloadPanel
              payloadText={draft.payloadText}
              onChange={actions.updatePayload}
              validation={validation}
              payloadDirty={payloadDirty}
              onReset={() => {
                actions.resetPayload()
                toast.success('Preview payload restored to the sample data.')
              }}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <PreviewWorkspace
              template={template}
              device={state.device}
              status={preview.status}
              result={preview.result}
              html={preview.html}
              renderedAt={preview.renderedAt}
              onRefresh={preview.refresh}
            />
            <DiagnosticsPanel items={diagnostics} />
          </div>
        </div>

        <TemplateLibrary
          templates={templates}
          selectedId={template.metadata.id}
          dirtyIds={studio.dirtyTemplateIds}
          onSelect={actions.selectTemplate}
        />
      </main>

      <AppFooter environment={environment} version={version} providerLabel={provider.label} />

      <SendTestEmailDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        template={template}
        provider={provider}
        html={preview.html}
      />
    </div>
  )
}
