/**
 * The studio's keyboard shortcuts, written down once.
 *
 * Presentation layer: data and one platform check, no behaviour. The list is
 * consumed by the shortcuts card, the shortcuts dialog and (phase 5) the
 * inspector footer, so a shortcut can never be documented in one place and
 * forgotten in another. What actually listens for the keys is
 * `hooks/useStudioShortcuts.ts`.
 */
import { useState } from 'react'

/**
 * Stable identifier, used as the React key and by the tests that assert the
 * card and the dialog draw the same list. It is NOT a dispatch key:
 * `useStudioShortcuts` takes named callbacks and matches the keys itself, so
 * adding an entry here documents a shortcut without binding one.
 */
export type ShortcutId = 'save' | 'preview' | 'format' | 'send-test' | 'shortcuts' | 'leave-editor'

export interface Shortcut {
  readonly id: ShortcutId
  readonly label: string
  /** Keys as they should be drawn on a Mac, e.g. ['⌘', 'S']. */
  readonly mac: readonly string[]
  /** The same shortcut everywhere else, e.g. ['Ctrl', 'S']. */
  readonly other: readonly string[]
}

export const SHORTCUTS: readonly Shortcut[] = [
  { id: 'save', label: 'Save template', mac: ['⌘', 'S'], other: ['Ctrl', 'S'] },
  { id: 'preview', label: 'Preview', mac: ['⌘', 'P'], other: ['Ctrl', 'P'] },
  {
    id: 'format',
    label: 'Format the open editor',
    mac: ['⌘', '⇧', 'F'],
    other: ['Ctrl', 'Shift', 'F'],
  },
  { id: 'send-test', label: 'Send test email', mac: ['⌘', '↵'], other: ['Ctrl', '↵'] },
  { id: 'shortcuts', label: 'Keyboard shortcuts', mac: ['?'], other: ['?'] },
  // CodeMirror takes Tab for indentation (ADR-5), so Tab alone cannot leave the
  // editor. Esc first, then Tab, does — and this list is the only place on
  // screen that can say so, or the editor is a keyboard trap.
  { id: 'leave-editor', label: 'Leave the editor', mac: ['Esc', 'Tab'], other: ['Esc', 'Tab'] },
]

/** The keys to draw for this platform. */
export function shortcutKeys(shortcut: Shortcut, isMac: boolean): readonly string[] {
  return isMac ? shortcut.mac : shortcut.other
}

/**
 * True on macOS, where the modifier is ⌘ rather than Ctrl.
 *
 * Read once into state rather than on every render: the platform cannot change
 * while the page is open, and `navigator` does not exist during tests that run
 * without a DOM.
 */
export function useIsMac(): boolean {
  const [isMac] = useState(
    () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent),
  )
  return isMac
}
