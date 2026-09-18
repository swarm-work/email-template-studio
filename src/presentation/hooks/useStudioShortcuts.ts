/**
 * The studio's one keyboard listener.
 *
 * Presentation layer: React wiring around a `keydown` handler, no rules. The
 * shortcuts themselves are written down in `studio/shortcuts.ts`.
 *
 * Two things make this delicate, so they are spelled out here:
 * 1. Most shortcuts must keep working while someone is typing in CodeMirror
 *    (⌘S in the middle of a line is the whole point), so there is an explicit
 *    allow-list of combos instead of a blanket "ignore while typing" check.
 * 2. Undo/redo (⌘Z, ⌘⇧Z) and "/" belong to the editors. They are never handled
 *    here — re-registering them would break CodeMirror's own history.
 */
import { useEffect, useRef } from 'react'

export interface StudioShortcutHandlers {
  /** False while no template is open; the listener is then not registered at all. */
  readonly enabled: boolean
  readonly onSave: () => void
  readonly onPreview: () => void
  readonly onFormat: () => void
  readonly onSendTest: () => void
  readonly onShowShortcuts: () => void
}

export function useStudioShortcuts(handlers: StudioShortcutHandlers): void {
  // The handlers change on nearly every render (they close over draft state),
  // but the listener must not be torn down and re-added that often, so the
  // latest set is kept in a ref and the effect only depends on `enabled`.
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })
  const { enabled } = handlers

  useEffect(() => {
    if (!enabled) return

    function onKeyDown(event: KeyboardEvent) {
      const current = latest.current
      // One modifier name for both platforms: ⌘ on a Mac, Ctrl everywhere else.
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (mod && !event.altKey) {
        if (key === 's' && !event.shiftKey) {
          // Without this the browser opens its "Save page as…" dialog.
          event.preventDefault()
          current.onSave()
          return
        }
        if (key === 'p' && !event.shiftKey) {
          // Without this the browser opens the print dialog.
          event.preventDefault()
          current.onPreview()
          return
        }
        if (key === 'f' && event.shiftKey) {
          event.preventDefault()
          current.onFormat()
          return
        }
        if (key === 'enter') {
          current.onSendTest()
          return
        }
        return
      }

      // A bare "?" is a character someone may well be typing.
      if (event.key === '?' && !mod && !event.altKey && !isTyping(event.target)) {
        current.onShowShortcuts()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}

/** True when the event came from a text field, a code editor or any editable area. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const tag = target.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  return target.closest('[contenteditable="true"], .cm-content') !== null
}
