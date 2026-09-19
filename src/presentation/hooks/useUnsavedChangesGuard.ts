/**
 * Asks the browser to confirm before a tab with unsaved edits goes away.
 *
 * Presentation layer, one effect. Moving around INSIDE the studio never
 * prompts: drafts survive in session storage and the library says "Draft
 * kept." Leaving the PAGE is different — a reload, a closed tab or a typed URL
 * throws session storage away with it — so that is the one case worth a
 * browser-level confirmation (plan §4.1).
 */
import { useEffect } from 'react'

/** Registers the guard while `dirty` is true, and removes it the moment it is not. */
export function useUnsavedChangesGuard(dirty: boolean): void {
  useEffect(() => {
    if (!dirty) return
    const handler = (event: BeforeUnloadEvent) => {
      // Modern browsers show their own wording and ignore any custom message;
      // `preventDefault()` is the whole supported API. `returnValue` is set too
      // because Safari still wants it.
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
}
