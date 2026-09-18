/**
 * The editor screen for ONE template: chrome, envelope, workspace, status bar.
 *
 * Presentation layer, composition only. It owns no template data — the draft
 * lives in `useStudio` (held by the route) — just the few things that describe
 * the screen itself: which dialog is open, which editor tab is showing, and the
 * ring buffer of recent render times the report card draws.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { buildDiagnostics } from '@/application/buildDiagnostics'
import { parsePreviewPayload } from '@/application/parsePreviewPayload'
import { ALL_STUDIO_MODES } from '@/application/studioModes'
import type { StudioMode } from '@/domain'
import type { EmailProvider } from '@/infrastructure/providers/emailProvider'
import type { TemplateRenderer } from '@/infrastructure/render/renderClient'
import { useRenderPreview, type RenderPreviewState } from '@/presentation/hooks/useRenderPreview'
import type { UseStudioResult } from '@/presentation/hooks/useStudio'
import { useStudioShortcuts } from '@/presentation/hooks/useStudioShortcuts'
import { SAVE_TEMPLATE_REASON } from './chrome/SaveTemplateButton'
import { StudioStatusBar } from './chrome/StudioStatusBar'
import { StudioSubHeader } from './chrome/StudioSubHeader'
import { CodeWorkspace } from './code/CodeWorkspace'
import type { EditorTabId } from './code/editorTabs'
import { formatJson, formatTsx } from './code/formatSource'
import { ShortcutsDialog } from './dialogs/ShortcutsDialog'
import { EnvelopePanel } from './envelope/EnvelopePanel'
import { PreviewWorkspace } from './PreviewWorkspace'
import { SendTestEmailDialog } from './SendTestEmailDialog'

/** Visual mode lands in phase 5 and preview mode in phase 4; both are shown, neither is reachable. */
const MODE_NOT_READY_REASON = 'Coming in the next step.'

/**
 * The one mode this phase can render.
 *
 * It is named rather than derived from `state.mode`, because the stored mode
 * can be `preview` (a valid mode for a code template, so the session schema
 * keeps it) while this phase always renders the code workspace. Deriving the
 * toggle from the selection would then press "Preview" over a code editor and
 * put the reason on the only button that works. Phase 4 renders the real mode
 * here and this constant goes away.
 */
const REACHABLE_MODE: StudioMode = 'code'

/** How many render times the sparkline keeps. */
const RENDER_HISTORY_SIZE = 12

export interface StudioPageProps {
  studio: UseStudioResult
  renderer: TemplateRenderer
  provider: EmailProvider
  /** Goes back to the library; the sub-header's breadcrumb calls it. */
  onBackToLibrary: () => void
  /** Reports the last render time up to the header's latency pill. */
  onRenderTime: (ms: number | null) => void
}

export function StudioPage({ studio, renderer, provider, onBackToLibrary, onRenderTime }: StudioPageProps) {
  const { template, draft, sourceDirty, payloadDirty, envelopeDirty, state, actions } = studio
  const templateId = template.metadata.id

  // Validation is memoised on the text so its identity only changes when the text does.
  const validation = useMemo(
    () => parsePreviewPayload(draft.payloadText, template.validateProps),
    [draft.payloadText, template],
  )
  const props = validation.ok ? validation.value : null

  const preview = useRenderPreview(renderer, templateId, draft.source, props)

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
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<EditorTabId>('tsx')
  const renderHistory = useRenderHistory(templateId, preview)

  const lastRenderMs = preview.result?.ok ? preview.result.durationMs : null
  useEffect(() => {
    onRenderTime(lastRenderMs)
    // Back on the library there is no render on screen, so the header's pill
    // must fall back to "—" rather than keep quoting a number from a closed
    // editor (docs/DESIGN.md: it is a measurement of what you are looking at).
    return () => onRenderTime(null)
  }, [lastRenderMs, onRenderTime])

  /** Pretty-prints one editable tab; the generated tabs have nothing to format. */
  const formatTab = useCallback(
    (tab: EditorTabId) => {
      if (tab === 'props') {
        try {
          actions.updatePayload(formatJson(draft.payloadText))
        } catch {
          toast.error('The payload is not valid JSON, so it was left as it is.')
        }
        return
      }
      if (tab !== 'tsx') return
      void formatTsx(draft.source)
        .then((formatted) => actions.updateSource(formatted))
        .catch(() => toast.error('The source could not be parsed, so it was left as it is.'))
    },
    [actions, draft.payloadText, draft.source],
  )

  useStudioShortcuts({
    enabled: true,
    // Saving is phase 7b: ⌘S answers with exactly what the button says.
    onSave: () => toast(SAVE_TEMPLATE_REASON),
    // Registered and deliberately empty: it stops the browser's print dialog
    // opening on ⌘P before preview mode exists (phase 4).
    onPreview: () => {},
    onFormat: () => formatTab(activeTab === 'props' ? 'props' : 'tsx'),
    onSendTest: () => setSendOpen(true),
    onShowShortcuts: () => setShortcutsOpen(true),
  })

  return (
    <div className="flex min-w-0 flex-col">
      <StudioSubHeader
        template={template}
        dirty={studio.dirtyTemplateIds.has(templateId)}
        lastSavedAt={studio.lastSavedAt}
        mode={REACHABLE_MODE}
        modes={ALL_STUDIO_MODES}
        onModeChange={actions.setMode}
        modeReason={(mode: StudioMode) => (mode === REACHABLE_MODE ? undefined : MODE_NOT_READY_REASON)}
        device={state.device}
        onDeviceChange={actions.setDevice}
        onSendTest={() => setSendOpen(true)}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onBackToLibrary={onBackToLibrary}
      />

      <EnvelopePanel
        envelope={draft.envelope}
        metadata={template.metadata}
        dirty={envelopeDirty}
        onChange={actions.updateEnvelope}
        onReset={() => {
          actions.resetEnvelope()
          toast.success('Envelope restored to the saved values.')
        }}
        provider={provider}
      />

      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-4">
        <CodeWorkspace
          template={template}
          source={draft.source}
          onSourceChange={actions.updateSource}
          sourceDirty={sourceDirty}
          onResetSource={() => {
            actions.resetSource()
            toast.success('Source restored to the original file.')
          }}
          payloadText={draft.payloadText}
          onPayloadChange={actions.updatePayload}
          validation={validation}
          payloadDirty={payloadDirty}
          onResetPayload={() => {
            actions.resetPayload()
            toast.success('Preview payload restored to the sample data.')
          }}
          html={preview.html}
          renderStatus={preview.status}
          renderResult={preview.result}
          renderHistory={renderHistory}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          onFormat={formatTab}
          diagnostics={diagnostics}
        />

        {/* Temporary: the preview gets its own mode in phase 4. Until then it
            stays on the page, under the editor, so nothing is lost. */}
        <PreviewWorkspace
          template={template}
          device={state.device}
          status={preview.status}
          result={preview.result}
          html={preview.html}
          renderedAt={preview.renderedAt}
          onRefresh={preview.refresh}
        />
      </div>

      <StudioStatusBar template={template} html={preview.html} result={preview.result} />

      <SendTestEmailDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        template={template}
        provider={provider}
        html={preview.html}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  )
}

/**
 * The durations of the last twelve successful renders, oldest first.
 *
 * `renderedAt` is a fresh Date on every success, so it is the signal that a new
 * measurement exists; switching template starts the buffer again, because the
 * numbers describe one template's source.
 */
function useRenderHistory(templateId: string, preview: RenderPreviewState): readonly number[] {
  const [history, setHistory] = useState<History>({ key: templateId, seen: null, values: [] })
  const durationMs = preview.result?.ok === true ? preview.result.durationMs : null
  const renderedAt = preview.renderedAt

  // Adjusting state while rendering (rather than in an effect) is React's own
  // recommendation for "something upstream changed, derive from it": it avoids
  // the extra paint an effect would cause.
  if (renderedAt !== history.seen || templateId !== history.key) {
    setHistory(nextHistory(history, templateId, renderedAt, durationMs))
  }

  return history.key === templateId ? history.values : []
}

interface History {
  readonly key: string
  /** The `renderedAt` already counted, so one success is never counted twice. */
  readonly seen: Date | null
  readonly values: readonly number[]
}

function nextHistory(
  history: History,
  templateId: string,
  renderedAt: Date | null,
  durationMs: number | null,
): History {
  // A different template is a different measurement; the buffer starts again.
  const values = templateId === history.key ? history.values : []
  const measured = renderedAt !== null && durationMs !== null
  return {
    key: templateId,
    seen: renderedAt,
    values: measured ? [...values, durationMs].slice(-RENDER_HISTORY_SIZE) : values,
  }
}
