/**
 * The editor screen for ONE template: chrome, envelope, workspaces, status bar.
 *
 * Presentation layer, composition only. It owns no template data — the draft
 * lives in `useStudio` (held by the route) — just the few things that describe
 * the screen itself: which dialog is open, which editor tab is showing, which
 * mode ⌘P should return to, and the ring buffer of recent render times.
 *
 * It also builds the one preview document string (ADR-25): the preview mode and
 * the code rail's thumbnail both read it, so neither costs a second render.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { buildDiagnostics } from '@/application/buildDiagnostics'
import { parsePreviewPayload } from '@/application/parsePreviewPayload'
import {
  ALL_STUDIO_MODES,
  availableModes,
  defaultMode,
  nextModeForPreviewToggle,
} from '@/application/studioModes'
import {
  VISUAL_EDITOR_OFF_MESSAGE,
  type EmailDocument,
  type StudioFeatures,
  type StudioMode,
  type TemplateKind,
} from '@/domain'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { buildPreviewDocument } from '@/infrastructure/render/previewDocument'
import { DEFAULT_STUDIO_THEME } from '@/infrastructure/render/studioTheme'
import type { EmailProvider } from '@/infrastructure/providers/emailProvider'
import type { TemplateRenderer } from '@/infrastructure/render/renderClient'
import { useSendServerStatus } from '@/presentation/hooks/useSendServerStatus'
import { useRenderPreview, type RenderPreviewState } from '@/presentation/hooks/useRenderPreview'
import { SAVED_EXPORT_REASON, useSavedExport } from '@/presentation/hooks/useSavedExport'
import { useVisualPreview } from '@/presentation/hooks/useVisualPreview'
import type { UseStudioResult } from '@/presentation/hooks/useStudio'
import { useStudioShortcuts } from '@/presentation/hooks/useStudioShortcuts'
import { downloadTextFile } from '@/presentation/shared/downloadFile'
import { unavailableModeReason } from './chrome/modeReasons'
import { SAVE_TEMPLATE_REASON } from './chrome/SaveTemplateButton'
import { StudioStatusBar } from './chrome/StudioStatusBar'
import { StudioSubHeader } from './chrome/StudioSubHeader'
import { CodeWorkspace } from './code/CodeWorkspace'
import type { EditorTabId } from './code/editorTabs'
import { formatJson, formatTsx } from './code/formatSource'
import { PreviewThumbnail } from './code/PreviewThumbnail'
import { PropsPayloadCard } from './code/PropsPayloadCard'
import { ExportedCodeDialog } from './dialogs/ExportedCodeDialog'
import { ShortcutsDialog } from './dialogs/ShortcutsDialog'
import { EMPTY_EMAIL_DOCUMENT } from './visual/canvas'
import { VisualEditorSkeleton } from './visual/VisualEditorSkeleton'
import type { VisualEditorControls } from './visual/editorControls'
import { VisualWorkspace } from './visual/VisualWorkspace'
import { EnvelopePanel } from './envelope/EnvelopePanel'
import { NOTHING_RENDERED_REASON } from './preview/previewStatus'
import { PreviewWorkspace } from './preview/PreviewWorkspace'
import { SendTestEmailDialog } from './SendTestEmailDialog'

/** How many render times the sparkline keeps. */
const RENDER_HISTORY_SIZE = 12

/** What the one hidden live region says when the workspace changes. */
const MODE_ANNOUNCEMENTS: Readonly<Record<StudioMode, string>> = {
  preview: 'Preview mode. Read only.',
  code: 'Code editor.',
  visual: 'Visual editor.',
}

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
  const { template, draft, sourceDirty, documentDirty, payloadDirty, envelopeDirty, state, actions } = studio
  const templateId = template.metadata.id

  // What the send server says about itself: the From address the envelope panel
  // and the preview summary show, and which features are switched on. Asked for
  // ONCE here, because two callers would be two requests that can answer
  // differently.
  const { from: fromIdentity, features, ready: featuresReady } = useSendServerStatus(provider)
  const isVisual = template.kind === 'visual'

  // The reducer clamps the mode by KIND; the feature flag can take a mode away
  // after that, so what is actually shown is clamped again here. Nothing is
  // written back, so switching the flag on again returns you where you were.
  const kindModes = availableModes(template.kind, features)
  const mode = kindModes.includes(state.mode) ? state.mode : kindModes[0]

  // Validation is memoised on the text so its identity only changes when the text does.
  const validation = useMemo(
    () => parsePreviewPayload(draft.payloadText, template.validateProps),
    [draft.payloadText, template],
  )
  const props = validation.ok ? validation.value : null

  // Counts the canvas transactions a person has made. The document itself is a
  // fresh object on every keystroke, so it is useless as a trigger; a number is
  // exactly as expressive and compares in one step.
  const [documentRevision, setDocumentRevision] = useState(0)

  // BOTH pipelines are wired up on every render - hooks cannot live inside an
  // `if` - and each one is switched off unless it is the one this template
  // uses. Everything downstream reads `preview`, so the preview, the status
  // bar, the diagnostics, the downloads and the send dialog go on working for
  // either kind without knowing which one they are looking at.
  // The canvas waits for the server's answer before it is mounted at all. That
  // is what makes STUDIO_VISUAL_EDITOR a real rollback switch: with it off, the
  // editor chunk is never even requested.
  const canvasEnabled = isVisual && featuresReady && features.visualEditor
  const codePreview = useRenderPreview(renderer, templateId, draft.source, props, { enabled: !isVisual })
  const visualPreview = useVisualPreview({
    enabled: canvasEnabled,
    resetKey: templateId,
    preheader: draft.envelope.preheader,
    revision: documentRevision,
  })
  // With the canvas switched off there is no editor to compose from - and the
  // whole point of the flag is that the editor is never even downloaded - so
  // the preview falls back to the export saved with this version.
  const savedExport = useSavedExport(template)
  const preview = isVisual ? (canvasEnabled ? visualPreview : savedExport) : codePreview

  /**
   * The one preview document, built once per successful render (ADR-25).
   * Preview mode and the thumbnail are two views of this exact string; that is
   * what makes switching between them free.
   */
  const previewDocument = useMemo(
    () => (preview.html === null ? null : buildPreviewDocument(preview.html)),
    [preview.html],
  )

  const diagnostics = useMemo(
    () =>
      buildDiagnostics({
        validation,
        renderStatus: preview.status,
        renderResult: preview.result,
        kind: template.kind,
        // Whichever half of the template this kind is authored in. A visual
        // template's source is always empty, so `sourceDirty` could only ever
        // say "Matches the original file" - about a document being typed into.
        contentDirty: isVisual ? documentDirty : sourceDirty,
        payloadDirty,
      }),
    [
      validation,
      preview.status,
      preview.result,
      template.kind,
      isVisual,
      documentDirty,
      sourceDirty,
      payloadDirty,
    ],
  )

  const [sendOpen, setSendOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [exportedCodeOpen, setExportedCodeOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<EditorTabId>('tsx')
  // Undo/redo and selection state, published by the canvas for the sub-header.
  // null until the editor chunk has arrived.
  const [visualControls, setVisualControls] = useState<VisualEditorControls | null>(null)
  // The inspector rail below xl. At xl and up the rail is always on screen and
  // this value is simply ignored, which is why it is not stored in the session.
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const renderHistory = useRenderHistory(templateId, preview)
  const { returnMode, rememberMode } = useReturnMode(templateId, template.kind, features)

  const previewRef = useRef<HTMLElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const inspectorToggleRef = useRef<HTMLButtonElement>(null)
  // Focus follows the workspace only when the keyboard asked for the switch; a
  // click on the mode toggle leaves focus on the button that was just pressed.
  // A ref rather than state: it is a one-shot instruction for the next commit,
  // not something the screen is rendered from.
  const moveFocusOnModeChange = useRef(false)

  useEffect(() => {
    if (!moveFocusOnModeChange.current) return
    moveFocusOnModeChange.current = false
    // The workspace that was hidden a moment ago is on screen by now, so it can
    // take focus. `preventScroll` keeps the page from jumping under the reader.
    const target = mode === 'preview' ? previewRef.current : editorRef.current
    target?.focus({ preventScroll: true })
  }, [mode])

  const lastRenderMs = preview.result?.ok ? preview.result.durationMs : null
  useEffect(() => {
    onRenderTime(lastRenderMs)
    // Back on the library there is no render on screen, so the header's pill
    // must fall back to "—" rather than keep quoting a number from a closed
    // editor (docs/DESIGN.md: it is a measurement of what you are looking at).
    return () => onRenderTime(null)
  }, [lastRenderMs, onRenderTime])

  /**
   * One canvas edit: the draft takes the new document, and the revision counter
   * tells the preview hook to compose again.
   */
  const handleDocumentChange = useCallback(
    (document: EmailDocument) => {
      actions.updateDocument(document)
      setDocumentRevision((revision) => revision + 1)
    },
    [actions],
  )

  /** Closes the off-canvas rail and puts focus back on the button that opened it. */
  const closeInspector = useCallback(() => {
    setInspectorOpen(false)
    inspectorToggleRef.current?.focus({ preventScroll: true })
  }, [])

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

  /** Every route into a mode goes through here, so the return mode is never missed. */
  const changeMode = useCallback(
    (next: StudioMode) => {
      if (next === mode) return
      if (next === 'preview') rememberMode(mode)
      actions.setMode(next)
    },
    [actions, mode, rememberMode],
  )

  /**
   * The thumbnail's "Open full preview" button, which unmounts itself by
   * switching modes. Focus has to follow, or the browser drops it on <body>
   * and the reader's next Tab starts again at the top of the page.
   */
  const openPreviewFromThumbnail = useCallback(() => {
    moveFocusOnModeChange.current = true
    changeMode('preview')
  }, [changeMode])

  /** ⌘P (and Escape out of the preview): a round trip, with focus following. */
  const togglePreview = useCallback(() => {
    const next = nextModeForPreviewToggle(mode, returnMode)
    if (mode !== 'preview') rememberMode(mode)
    moveFocusOnModeChange.current = true
    actions.setMode(next)
  }, [actions, mode, rememberMode, returnMode])

  const downloadReason = preview.html === null ? NOTHING_RENDERED_REASON : undefined
  // Refresh re-runs a pipeline, and the saved export is not one. Saying so is
  // better than a button that looks live and does nothing.
  const refreshReason = preview === savedExport ? SAVED_EXPORT_REASON : undefined
  const downloadHtml = useCallback(() => {
    if (preview.html === null) return
    downloadTextFile(`${template.metadata.slug}.html`, preview.html, 'text/html')
  }, [preview.html, template.metadata.slug])
  const downloadText = useCallback(() => {
    if (preview.text === null) return
    downloadTextFile(`${template.metadata.slug}.txt`, preview.text, 'text/plain')
  }, [preview.text, template.metadata.slug])

  useStudioShortcuts({
    enabled: true,
    // Saving is phase 7b: ⌘S answers with exactly what the button says.
    onSave: () => toast(SAVE_TEMPLATE_REASON),
    onPreview: togglePreview,
    onFormat: () => formatTab(activeTab === 'props' ? 'props' : 'tsx'),
    onSendTest: () => setSendOpen(true),
    onShowShortcuts: () => setShortcutsOpen(true),
  })

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <StudioSubHeader
        template={template}
        dirty={studio.dirtyTemplateIds.has(templateId)}
        lastSavedAt={studio.lastSavedAt}
        mode={mode}
        modes={ALL_STUDIO_MODES}
        onModeChange={changeMode}
        modeReason={(candidate: StudioMode) => unavailableModeReason(template.kind, candidate, features)}
        device={state.device}
        onDeviceChange={actions.setDevice}
        onSendTest={() => setSendOpen(true)}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onBackToLibrary={onBackToLibrary}
        onDownloadHtml={downloadHtml}
        onDownloadText={downloadText}
        downloadReason={downloadReason}
        onViewExportedCode={() => setExportedCodeOpen(true)}
        visualControls={visualControls}
        canvasEnabled={canvasEnabled}
        inspectorOpen={canvasEnabled ? inspectorOpen : undefined}
        onToggleInspector={canvasEnabled ? () => setInspectorOpen((open) => !open) : undefined}
        inspectorToggleRef={inspectorToggleRef}
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
        from={fromIdentity}
      />

      {/* The one scroller in the editor: from `lg` up the shell is exactly one
          viewport tall, so this is what moves. Below `lg` it has no height to
          fill and the page scrolls instead. */}
      <div className="min-h-0 flex-1 overflow-y-auto max-lg:min-h-[640px]">
        <div className="mx-auto flex w-full max-w-[1440px] min-w-0 flex-col gap-4 px-4 py-4">
          {/* The rollback flag, said out loud. Without this the Visual button
              would simply be missing and nobody could tell why. */}
          {isVisual && !features.visualEditor ? (
            <Alert className="border-warning/30 bg-warning-muted text-warning-foreground">
              <AlertTitle>Visual editing is switched off</AlertTitle>
              <AlertDescription>{VISUAL_EDITOR_OFF_MESSAGE}</AlertDescription>
            </Alert>
          ) : null}

          {/* This template's own editor stays mounted while you are in preview
              mode - `hidden` and `inert` (ADR-24) - so the canvas keeps its
              undo history and CodeMirror keeps its measurements. The OTHER
              kind's workspace is not rendered at all: for a code template that
              is what keeps the editor chunk off the wire (plan §3.10; its
              measured size lives in docs/TECH_DEBT.md #33). */}
          {canvasEnabled ? (
            <div
              ref={editorRef}
              tabIndex={-1}
              hidden={mode !== 'visual'}
              inert={mode !== 'visual'}
              className="flex min-h-0 min-w-0 flex-1 flex-col focus-visible:outline-none"
            >
              <VisualWorkspace
                templateId={templateId}
                document={draft.document ?? EMPTY_EMAIL_DOCUMENT}
                theme={template.kind === 'visual' ? template.theme : DEFAULT_STUDIO_THEME}
                onDocumentChange={handleDocumentChange}
                onEditorReady={visualPreview.onReady}
                onEditorDestroy={visualPreview.onDestroy}
                onControlsChange={setVisualControls}
                inspectorOpen={inspectorOpen}
                onCloseInspector={closeInspector}
                dataPanel={
                  <PropsPayloadCard
                    validation={validation}
                    payloadDirty={payloadDirty}
                    onFormat={() => formatTab('props')}
                    onReset={() => {
                      actions.resetPayload()
                      toast.success('Preview payload restored to the sample data.')
                    }}
                  />
                }
              />
            </div>
          ) : null}

          {/* Waiting for the server to say whether the canvas is switched on.
              It is one small same-origin request, and the skeleton is the shape
              of the screen that is about to appear. */}
          {isVisual && !featuresReady ? <VisualEditorSkeleton /> : null}

          {isVisual ? null : (
            <div
              ref={editorRef}
              tabIndex={-1}
              hidden={mode !== 'code'}
              inert={mode !== 'code'}
              className="flex min-w-0 flex-col focus-visible:outline-none"
            >
              <CodeWorkspace
                active={mode === 'code'}
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
                text={preview.text}
                renderStatus={preview.status}
                renderResult={preview.result}
                renderHistory={renderHistory}
                activeTab={activeTab}
                onActiveTabChange={setActiveTab}
                onFormat={formatTab}
                diagnostics={diagnostics}
                previewThumbnail={
                  // Not mounted in preview mode: the same document is already on
                  // screen full size, and a second iframe would cost memory for a
                  // picture nobody can see.
                  mode === 'preview' ? null : (
                    <PreviewThumbnail
                      document={previewDocument}
                      status={preview.status}
                      stale={preview.result !== null && !preview.result.ok && previewDocument !== null}
                      onOpenPreview={openPreviewFromThumbnail}
                    />
                  )
                }
              />
            </div>
          )}

          <div hidden={mode !== 'preview'} inert={mode !== 'preview'} className="flex min-w-0 flex-col">
            <PreviewWorkspace
              ref={previewRef}
              template={template}
              envelope={draft.envelope}
              from={fromIdentity}
              device={state.device}
              status={preview.status}
              result={preview.result}
              document={previewDocument}
              text={preview.text}
              renderedAt={preview.renderedAt}
              onRefresh={preview.refresh}
              refreshReason={refreshReason}
              onDownloadHtml={downloadHtml}
              onDownloadText={downloadText}
              downloadReason={downloadReason}
              diagnostics={diagnostics}
              onExit={togglePreview}
            />
          </div>
        </div>
      </div>

      <StudioStatusBar template={template} html={preview.html} text={preview.text} />

      {/* The studio's one mode live region: a whole sentence, announced when
          the workspace changes and at no other time (docs/DESIGN.md §4.6). */}
      <span role="status" className="sr-only">
        {MODE_ANNOUNCEMENTS[mode]}
      </span>

      <SendTestEmailDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        template={template}
        provider={provider}
        html={preview.html}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ExportedCodeDialog
        open={exportedCodeOpen}
        onOpenChange={setExportedCodeOpen}
        html={preview.html}
        text={preview.text}
        document={draft.document}
      />
    </div>
  )
}

/**
 * Which mode ⌘P returns to, per template.
 *
 * It is state rather than a constant because a visual template returns to the
 * canvas and a code template to the editor; it is keyed by template id so that
 * opening another template does not send you back to the previous one's mode.
 */
function useReturnMode(templateId: string, kind: TemplateKind, features: StudioFeatures) {
  const [remembered, setRemembered] = useState<{ key: string; mode: StudioMode }>(() => ({
    key: templateId,
    mode: defaultMode(kind, features),
  }))

  const rememberMode = useCallback(
    (mode: StudioMode) => setRemembered({ key: templateId, mode }),
    [templateId],
  )

  const returnMode = remembered.key === templateId ? remembered.mode : defaultMode(kind, features)
  return { returnMode, rememberMode }
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
