/**
 * Undo / redo for the visual canvas.
 *
 * Presentation layer. A code template's undo belongs to CodeMirror, which
 * already owns ⌘Z, so this renders NOTHING for `kind: 'code'` — the studio
 * must never offer a button that fights the editor's own history.
 *
 * The buttons drive Tiptap's own history through the controls the editor
 * surface publishes, so pressing Undo here and pressing ⌘Z on the canvas are
 * the same action on the same stack.
 */
import { Redo2, Undo2 } from 'lucide-react'
import type { TemplateKind } from '@/domain'
import { ReasonedButton } from '@/presentation/shared/ReasonedButton'
import type { VisualEditorControls } from '../visual/editorControls'

const LOADING_REASON = 'The visual editor is still loading.'
const NOTHING_TO_UNDO_REASON = 'Nothing to undo yet.'
const NOTHING_TO_REDO_REASON = 'Nothing to redo.'

export interface UndoRedoGroupProps {
  kind: TemplateKind
  /**
   * False when there is no canvas to undo ON: the feature flag is off, or the
   * server has not said yet whether it is. Nothing is rendered then, because
   * "still loading" would be a permanent lie while the flag is off.
   */
  canvasEnabled: boolean
  /** null while the editor chunk is still on its way. */
  controls: VisualEditorControls | null
}

export function UndoRedoGroup({ kind, canvasEnabled, controls }: UndoRedoGroupProps) {
  if (kind !== 'visual' || !canvasEnabled) return null

  const undoReason =
    controls === null ? LOADING_REASON : controls.canUndo ? undefined : NOTHING_TO_UNDO_REASON
  const redoReason =
    controls === null ? LOADING_REASON : controls.canRedo ? undefined : NOTHING_TO_REDO_REASON

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <ReasonedButton
        variant="ghost"
        size="icon-sm"
        reason={undoReason}
        aria-label="Undo"
        onClick={() => controls?.undo()}
      >
        <Undo2 aria-hidden="true" />
      </ReasonedButton>
      <ReasonedButton
        variant="ghost"
        size="icon-sm"
        reason={redoReason}
        aria-label="Redo"
        onClick={() => controls?.redo()}
      >
        <Redo2 aria-hidden="true" />
      </ReasonedButton>
    </div>
  )
}
