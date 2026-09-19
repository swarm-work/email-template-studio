/**
 * A row of chips that insert React Email elements at the cursor.
 *
 * Presentation layer. The snippets are data (`primitives.ts`); inserting is the
 * editor's job (`CodeEditor.insertAtCursor`). Inserting into a tab nobody is
 * looking at would be confusing, so the chips are disabled-with-reason unless
 * template.tsx is the open tab.
 */
import { EMAIL_PRIMITIVES } from './primitives'
import { ReasonedButton } from '@/presentation/shared/ReasonedButton'

const NOT_ON_TSX_REASON = 'Put the cursor in template.tsx to insert a primitive.'

export interface PrimitivesRowProps {
  /** False while a read-only or JSON tab is showing. */
  enabled: boolean
  onInsert: (snippet: string) => void
}

export function PrimitivesRow({ enabled, onInsert }: PrimitivesRowProps) {
  const reason = enabled ? undefined : NOT_ON_TSX_REASON
  return (
    <div className="flex min-w-0 [scrollbar-width:none] items-center gap-2 overflow-x-auto px-3 py-1.5">
      <span className="meta-label shrink-0">Primitives</span>
      {EMAIL_PRIMITIVES.map((primitive) => (
        <ReasonedButton
          key={primitive.id}
          variant="outline"
          size="xs"
          reason={reason}
          className="shrink-0 font-mono"
          aria-label={`Insert ${primitive.label}`}
          onClick={() => onInsert(primitive.snippet)}
        >
          {primitive.label}
        </ReasonedButton>
      ))}
    </div>
  )
}
