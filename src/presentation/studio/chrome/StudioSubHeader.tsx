/**
 * The bar that sits under the global header while a template is open.
 *
 * Presentation layer, composition only: breadcrumb and draft state on the left,
 * the actions that apply to the whole template on the right. It is sticky so
 * that Save and the mode switch stay reachable while the page scrolls.
 */
import { useEffect, useState, type Ref } from 'react'
import { Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { EmailTemplate, PreviewDevice, StudioMode } from '@/domain'
import { relativeTime } from '@/presentation/shared/relativeTime'
import type { VisualEditorControls } from '../visual/editorControls'
import { DeviceToggle } from './DeviceToggle'
import { DraftStatusBadge } from './DraftStatusBadge'
import { InspectorToggle } from './InspectorToggle'
import { ModeToggle } from './ModeToggle'
import { SaveTemplateButton } from './SaveTemplateButton'
import { StudioOverflowMenu } from './StudioOverflowMenu'
import { TemplateBreadcrumb } from './TemplateBreadcrumb'
import { UndoRedoGroup } from './UndoRedoGroup'

export interface StudioSubHeaderProps {
  template: EmailTemplate
  /** True when the draft differs from the saved template. */
  dirty: boolean
  /** When the draft was last written to session storage; null before the first save. */
  lastSavedAt: Date | null
  mode: StudioMode
  /** Every mode this template's kind offers, reachable or not. */
  modes: readonly StudioMode[]
  onModeChange: (mode: StudioMode) => void
  /** Why a mode cannot be entered yet; `undefined` means it can. */
  modeReason: (mode: StudioMode) => string | undefined
  device: PreviewDevice
  onDeviceChange: (device: PreviewDevice) => void
  onSendTest: () => void
  onShowShortcuts: () => void
  onBackToLibrary: () => void
  /** Saves the rendered HTML / plain text as a file; carried by the overflow menu. */
  onDownloadHtml: () => void
  onDownloadText: () => void
  /** Why the two downloads cannot be used; `undefined` means they can. */
  downloadReason?: string
  /** Opens the read-only list of saved versions. */
  onShowVersionHistory: () => void
  /** Opens the read-only Exported HTML / Plain text / document.json views. */
  onViewExportedCode: () => void
  /** Opens the convert-to-code dialog; only a visual template has one. */
  onConvertToCode?: () => void
  /** Saves a new version. */
  onSave: () => void
  /** True while a save is in flight. */
  saving: boolean
  /** Why Save cannot be pressed; `undefined` means it can (see `saveTemplateReason`). */
  saveReason?: string
  /** Renames the template (a metadata PATCH, not a new version). */
  onRename: (name: string) => void
  /** Flips the template between 'draft' and 'ready'. */
  onToggleStatus: () => void
  /** Opens the delete dialog. */
  onDelete: () => void
  /**
   * True only while the canvas is really mounted: a visual template, the
   * server has answered, and the flag is on. The controls that act on the
   * canvas are not drawn at all otherwise.
   */
  canvasEnabled?: boolean
  /** Undo/redo state from the visual canvas; null for a code template. */
  visualControls: VisualEditorControls | null
  /** The off-canvas inspector rail, below xl. Absent for a code template. */
  inspectorOpen?: boolean
  onToggleInspector?: () => void
  inspectorToggleRef?: Ref<HTMLButtonElement>
}

export function StudioSubHeader({
  template,
  dirty,
  lastSavedAt,
  mode,
  modes,
  onModeChange,
  modeReason,
  device,
  onDeviceChange,
  onSendTest,
  onShowShortcuts,
  onBackToLibrary,
  onDownloadHtml,
  onDownloadText,
  downloadReason,
  onShowVersionHistory,
  onViewExportedCode,
  onConvertToCode,
  onSave,
  saving,
  saveReason,
  onRename,
  onToggleStatus,
  onDelete,
  canvasEnabled = false,
  visualControls,
  inspectorOpen = false,
  onToggleInspector,
  inspectorToggleRef,
}: StudioSubHeaderProps) {
  return (
    <header className="bg-card/85 sticky top-0 z-30 flex min-h-[52px] min-w-0 shrink-0 flex-wrap items-center gap-2 border-b px-4 py-1.5 backdrop-blur-sm">
      <TemplateBreadcrumb
        name={template.metadata.name}
        onBackToLibrary={onBackToLibrary}
        onRename={onRename}
      />
      <DraftStatusBadge status={template.metadata.status} dirty={dirty} />
      <AutosaveNote lastSavedAt={lastSavedAt} />

      {/* The cluster WRAPS rather than refusing to shrink: a visual template
          carries two more controls than a code one (undo/redo, the inspector
          toggle), and at `md` those were exactly enough to push the row past
          the viewport. Wrapping costs a second line on a narrow screen and
          keeps every control reachable, which a horizontal scrollbar would
          not (docs/DESIGN.md, overflow checklist). */}
      <div
        role="toolbar"
        aria-label="Template actions"
        className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2"
      >
        <div className="hidden flex-wrap items-center justify-end gap-2 md:flex">
          <ModeToggle modes={modes} value={mode} onChange={onModeChange} reasonFor={modeReason} />
          <UndoRedoGroup kind={template.kind} canvasEnabled={canvasEnabled} controls={visualControls} />
          <DeviceToggle value={device} onChange={onDeviceChange} />
          <Button variant="outline" size="sm" onClick={onSendTest}>
            <Send aria-hidden="true" />
            Send test
          </Button>
        </div>
        {onToggleInspector ? (
          <InspectorToggle ref={inspectorToggleRef} open={inspectorOpen} onToggle={onToggleInspector} />
        ) : null}
        <SaveTemplateButton saving={saving} reason={saveReason} onSave={onSave} />
        <StudioOverflowMenu
          kind={template.kind}
          status={template.metadata.status}
          onSendTest={onSendTest}
          onShowShortcuts={onShowShortcuts}
          onDownloadHtml={onDownloadHtml}
          onDownloadText={onDownloadText}
          downloadReason={downloadReason}
          onShowVersionHistory={onShowVersionHistory}
          onViewExportedCode={onViewExportedCode}
          onConvertToCode={onConvertToCode}
          onToggleStatus={onToggleStatus}
          onDelete={onDelete}
        />
      </div>
    </header>
  )
}

/** How often the "4 minutes ago" text is recomputed. */
const TICK_MS = 30_000

/**
 * "Autosaved just now". Drafts are written to session storage half a second
 * after the last keystroke (see `useStudio`), and this is the only place that
 * says so — a quiet, polite live region rather than a toast per save.
 */
function AutosaveNote({ lastSavedAt }: { lastSavedAt: Date | null }) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), TICK_MS)
    return () => clearInterval(timer)
  }, [])

  return (
    // `max-lg:sr-only` rather than `hidden` below lg: `display: none` takes the
    // node out of the accessibility tree, and a live region that is not in the
    // tree never announces anything. Narrow screens hide the text, not the news.
    <span className="text-muted-foreground min-w-0 truncate text-xs max-lg:sr-only" aria-live="polite">
      {lastSavedAt === null ? '' : `Autosaved ${relativeTime(lastSavedAt.toISOString(), now)}`}
    </span>
  )
}
