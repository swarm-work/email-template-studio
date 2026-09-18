/**
 * The keyboard shortcuts card in the right rail.
 *
 * Presentation layer. It renders `studio/shortcuts.ts` and nothing else, so the
 * card, the ? dialog and the keys that actually fire can never drift apart.
 */
import { ShortcutKeys } from '../ShortcutKeys'
import { SHORTCUTS, useIsMac } from '../shortcuts'

export function ShortcutsCard() {
  const isMac = useIsMac()
  return (
    <section aria-labelledby="shortcuts-card-heading" className="bg-card overflow-hidden rounded-lg border">
      <div className="border-b px-3 py-2">
        <h2 id="shortcuts-card-heading" className="text-xs font-medium">
          Keyboard shortcuts
        </h2>
      </div>
      <ul role="list" className="divide-y">
        {SHORTCUTS.map((shortcut) => (
          <li key={shortcut.id} className="flex items-center justify-between gap-3 px-3 py-1.5">
            <span className="text-muted-foreground min-w-0 truncate text-[11px]">{shortcut.label}</span>
            <ShortcutKeys shortcut={shortcut} isMac={isMac} />
          </li>
        ))}
      </ul>
    </section>
  )
}
