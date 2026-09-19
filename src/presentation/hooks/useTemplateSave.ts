/**
 * Everything that happens around one Save: the in-flight flag, the failure
 * toast with its Retry, and the server's copy when the save was refused.
 *
 * Presentation layer, React wiring only. It does not know what a version is —
 * the caller hands it a function that sends one — so the same hook serves a
 * code template and a visual one.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { RepositoryResult } from '@/application/repositories/templateRepository'
import type { EmailTemplate, TemplateRecord } from '@/domain'

/** The toast a failed save leaves on screen until it is dismissed or retried. */
export const SAVE_FAILED_MESSAGE = 'Save failed. The template was not changed.'

export interface UseTemplateSaveOptions {
  /**
   * Sends the version the studio holds right now, against `expectedRevision`.
   * A function rather than a value so a retry sends what is on screen at the
   * moment of the retry, not what was there when the first attempt failed.
   */
  readonly send: (expectedRevision: number) => Promise<RepositoryResult<EmailTemplate>>
  /** The revision the draft started from; the optimistic-concurrency token. */
  readonly baseRevision: number
  /** Called with what the server wrote, so the reducer can rebase the draft. */
  readonly onSaved: (template: EmailTemplate) => void
}

export interface UseTemplateSaveResult {
  readonly saving: boolean
  /**
   * The server's copy after a refused save; null when there is no conflict.
   * A plain record, not an `EmailTemplate`: the dialog only reads its name and
   * version number, and nothing here needs a props validator.
   */
  readonly conflict: TemplateRecord | null
  readonly dismissConflict: () => void
  /** Saves. Safe to call twice: a second call while one is in flight is ignored. */
  readonly save: () => void
}

export function useTemplateSave({
  send,
  baseRevision,
  onSaved,
}: UseTemplateSaveOptions): UseTemplateSaveResult {
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<TemplateRecord | null>(null)
  // A ref as well as state: ⌘S held down fires faster than React re-renders,
  // and two saves against the same revision would make the second one a
  // conflict with ourselves.
  const inFlight = useRef(false)
  // The latest arguments, so the Retry button (captured in a toast that
  // outlives this render) always sends the CURRENT draft. Updated in an effect
  // rather than during render: effects run after the commit and before any
  // event handler can fire, so the ref is never read stale.
  const latest = useRef({ send, baseRevision, onSaved })
  useEffect(() => {
    latest.current = { send, baseRevision, onSaved }
  })

  // A NAMED function expression, so Retry can call the same save again without
  // the callback having to reach for the `const` it is still being assigned to.
  const save = useCallback(function runSave() {
    if (inFlight.current) return
    inFlight.current = true
    setSaving(true)
    const run = async () => {
      const { send: sendNow, baseRevision: revision, onSaved: saved } = latest.current
      // `try`/`finally` rather than a plain await: the port promises never to
      // throw, but a bug that broke that promise would otherwise leave the
      // in-flight flag stuck and the Save button dead for the rest of the
      // session. Clearing it in `finally` costs nothing and cannot be forgotten.
      let result
      try {
        result = await sendNow(revision)
      } finally {
        inFlight.current = false
        setSaving(false)
      }
      if (result.ok) {
        saved(result.value)
        return
      }
      if (result.failure.code === 'version-conflict') {
        // The refusal carries the server's copy, which is what the dialog
        // offers to load; no second request is needed.
        setConflict(result.failure.current)
        return
      }
      failed(result.failure.message, runSave)
    }
    // The catch is the same belt as the `finally` above: the port answers with
    // a failure rather than throwing, so this only runs if that contract is
    // broken — and then the person is told, instead of nothing happening.
    void run().catch(() => failed('The save could not be sent.', runSave))
  }, [])

  const dismissConflict = useCallback(() => setConflict(null), [])

  return { saving, conflict, dismissConflict, save }
}

/**
 * The one toast a failed save leaves behind. Persistent on purpose: a save that
 * did not happen is not news you want to miss because you were looking at the
 * canvas, and Retry sends the CURRENT draft, not the one that failed.
 */
function failed(description: string, retry: () => void): void {
  toast.error(SAVE_FAILED_MESSAGE, {
    description,
    duration: Infinity,
    action: { label: 'Retry', onClick: retry },
  })
}
