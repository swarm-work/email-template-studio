/**
 * The keycaps of one shortcut, drawn for this platform.
 *
 * Presentation layer, one atom and no state. It sits beside `shortcuts.ts`
 * rather than inside `studio/code/`, because the right-rail card, the "?"
 * dialog and (phase 5) the inspector footer all draw the same list, and none of
 * them should have to import from another mode's folder to do it.
 */
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { shortcutKeys, type Shortcut } from './shortcuts'

export interface ShortcutKeysProps {
  shortcut: Shortcut
  /** True on macOS, where the modifier is ⌘; `useIsMac()` in `shortcuts.ts`. */
  isMac: boolean
}

export function ShortcutKeys({ shortcut, isMac }: ShortcutKeysProps) {
  return (
    <KbdGroup className="shrink-0">
      {shortcutKeys(shortcut, isMac).map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  )
}
