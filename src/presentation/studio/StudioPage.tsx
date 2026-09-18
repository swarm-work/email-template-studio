/**
 * The editor screen: source, payload, preview and diagnostics for ONE template.
 *
 * Presentation layer, composition only. It no longer owns the shell (that is
 * `AppShell`), the navigation (that is `TemplatesRoute`) or the studio state
 * (that is `useStudio`, held by the route so drafts outlive this component).
 */
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { buildDiagnostics } from '@/application/buildDiagnostics'
import { parsePreviewPayload } from '@/application/parsePreviewPayload'
import type { EmailProvider } from '@/infrastructure/providers/emailProvider'
import type { TemplateRenderer } from '@/infrastructure/render/renderClient'
import { useRenderPreview } from '@/presentation/hooks/useRenderPreview'
import type { UseStudioResult } from '@/presentation/hooks/useStudio'
import { DiagnosticsPanel } from './DiagnosticsPanel'
import { PageHeader } from './PageHeader'
import { PayloadPanel } from './PayloadPanel'
import { PreviewWorkspace } from './PreviewWorkspace'
import { SendTestEmailDialog } from './SendTestEmailDialog'
import { SourceWorkspace } from './SourceWorkspace'

export interface StudioPageProps {
  studio: UseStudioResult
  renderer: TemplateRenderer
  provider: EmailProvider
  /** Goes back to the library. Phase 3 replaces the header this button lives in. */
  onBackToLibrary: () => void
  /** Reports the last render time up to the header's latency pill. */
  onRenderTime: (ms: number | null) => void
}

export function StudioPage({ studio, renderer, provider, onBackToLibrary, onRenderTime }: StudioPageProps) {
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

  const lastRenderMs = preview.result?.ok ? preview.result.durationMs : null
  useEffect(() => {
    onRenderTime(lastRenderMs)
    // Back on the library there is no render on screen, so the header's pill
    // must fall back to "—" rather than keep quoting a number from a closed
    // editor (docs/DESIGN.md: it is a measurement of what you are looking at).
    return () => onRenderTime(null)
  }, [lastRenderMs, onRenderTime])

  return (
    <div className="mx-auto w-full max-w-[1440px] space-y-6 px-6 py-6">
      <PageHeader
        template={template}
        device={state.device}
        onDeviceChange={actions.setDevice}
        onSendTest={() => setSendOpen(true)}
        onBackToLibrary={onBackToLibrary}
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
