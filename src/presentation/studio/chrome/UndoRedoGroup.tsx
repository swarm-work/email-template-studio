/**
 * Undo / redo for the visual canvas.
 *
 * Presentation layer. A code template's undo belongs to CodeMirror, which
 * already owns ⌘Z, so this renders NOTHING for `kind: 'code'` — the studio
 * must never offer a button that fights the editor's own history.
 *
 * The visual editor arrives in phase 5, so for now the visual branch is the
 * disabled-with-reason pattern rather than a fake control.
 */
import { Redo2, Undo2 } from 'lucide-react'
import type { TemplateKind } from '@/domain'
import { ReasonedButton } from '@/presentation/shared/ReasonedButton'

const UNDO_REASON = 'Undo arrives with the visual editor.'

export interface UndoRedoGroupProps {
  kind: TemplateKind
}

export function UndoRedoGroup({ kind }: UndoRedoGroupProps) {
  if (kind !== 'visual') return null
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <ReasonedButton variant="ghost" size="icon-sm" reason={UNDO_REASON} aria-label="Undo">
        <Undo2 aria-hidden="true" />
      </ReasonedButton>
      <ReasonedButton variant="ghost" size="icon-sm" reason={UNDO_REASON} aria-label="Redo">
        <Redo2 aria-hidden="true" />
      </ReasonedButton>
    </div>
  )
}
