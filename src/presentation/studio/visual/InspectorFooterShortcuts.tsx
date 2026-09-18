/**
 * The quiet "⌘S Save · ⌘P Preview · / Blocks" strip at the foot of the
 * inspector rail.
 *
 * Presentation layer. It is a REMINDER of shortcuts that are documented and
 * announced elsewhere (the shortcuts card and dialog), so the whole strip is
 * `aria-hidden`: a screen-reader user would otherwise hear the same three
 * shortcuts a third time, in a place that is not a control.
 *
 * The three entries come from the one SHORTCUTS array, so a shortcut can never
 * be renamed here and left alone in the dialog.
 */
import { SHORTCUTS, shortcutKeys, useIsMac, type ShortcutId } from '../shortcuts'

/** The three worth repeating next to the canvas, in the order the mock shows. */
const FOOTER_SHORTCUTS: readonly ShortcutId[] = ['save', 'preview']

/**
 * "/" opens the editor's own slash menu. It is deliberately NOT in the
 * SHORTCUTS array: that list is what `useStudioShortcuts` documents, and the
 * studio must never register a key Tiptap already owns (plan §4.5).
 */
const SLASH_HINT = { keys: ['/'], label: 'Blocks' }

export function InspectorFooterShortcuts() {
  const isMac = useIsMac()
  const entries = FOOTER_SHORTCUTS.map((id) => {
    const shortcut = SHORTCUTS.find((candidate) => candidate.id === id)
    return shortcut ? { keys: shortcutKeys(shortcut, isMac), label: shortcut.label } : null
  }).filter((entry) => entry !== null)

  return (
    <div
      aria-hidden="true"
      className="text-muted-foreground flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-[11px]"
    >
      {[...entries, SLASH_HINT].map((entry) => (
        <span key={entry.label} className="flex items-center gap-1">
          <span className="font-mono">{entry.keys.join('')}</span>
          {entry.label}
        </span>
      ))}
    </div>
  )
}
