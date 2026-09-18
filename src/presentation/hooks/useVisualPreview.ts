/**
 * Drives the VISUAL pipeline from React, with the same contract as
 * `useRenderPreview`: debounced, stale-guarded, last-good-kept, reset per
 * template. The studio therefore never has to ask which kind it is showing —
 * both hooks answer with the same `RenderPreviewState`.
 *
 * Presentation layer: React wiring only. Composing an email is
 * `infrastructure/render/visualEmailRenderer.ts`.
 */
import { useCallback, useEffect, useState } from 'react'
import type { RenderResult, RenderStatus } from '@/domain'
import {
  composeVisualEmail,
  type VisualComposer,
  type VisualEditorHandle,
} from '@/infrastructure/render/visualEmailRenderer'
import { DEFAULT_RENDER_DEBOUNCE_MS, IDLE_PREVIEW_STATE, type RenderPreviewState } from './useRenderPreview'

export interface UseVisualPreviewOptions {
  /** false while a code template is open: no handle is kept and no timer runs. */
  readonly enabled: boolean
  /** Changing this (the template id) drops output from the previous template. */
  readonly resetKey: string
  /** Part of the export, so changing it has to trigger a new compose. */
  readonly preheader: string
  /**
   * Bumped by the surface's `onUpdate`. The document itself is not a useful
   * trigger — it is a fresh object on every keystroke — so the caller counts
   * the transactions instead and the hook keys its work off the number.
   */
  readonly revision: number
  /** Injectable composer, so the hook can be tested without a real editor. */
  readonly compose?: VisualComposer
  readonly debounceMs?: number
}

export interface VisualPreviewState extends RenderPreviewState {
  /** Handed to the editor surface: the editor is live and can be composed from. */
  readonly onReady: (handle: VisualEditorHandle) => void
  /** Handed to the editor surface: the editor is going away (template switch, unmount). */
  readonly onDestroy: () => void
}

interface Completed {
  readonly requestKey: string
  readonly resetKey: string
  readonly result: RenderResult
}

interface LastGood {
  readonly resetKey: string
  readonly html: string
  readonly text: string
  readonly renderedAt: Date
}

export function useVisualPreview({
  enabled,
  resetKey,
  preheader,
  revision,
  compose = composeVisualEmail,
  debounceMs = DEFAULT_RENDER_DEBOUNCE_MS,
}: UseVisualPreviewOptions): VisualPreviewState {
  // State rather than a ref: the arrival of the editor is what should start the
  // first compose, and a ref would not re-run the effect below.
  const [handle, setHandle] = useState<VisualEditorHandle | null>(null)
  const [completed, setCompleted] = useState<Completed | null>(null)
  const [lastGood, setLastGood] = useState<LastGood | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)

  const onReady = useCallback((next: VisualEditorHandle) => setHandle(next), [])
  const onDestroy = useCallback(() => setHandle(null), [])

  // Everything that should trigger a new compose, folded into one key - the
  // same trick `useRenderPreview` uses, so the two hooks stay recognisably one
  // design rather than two.
  const requestKey =
    !enabled || handle === null ? null : `${resetKey} ${refreshCount} ${revision} ${preheader}`

  useEffect(() => {
    if (requestKey === null || handle === null) return
    // `cancelled` rather than comparing against a ref: an effect cleanup runs
    // for exactly the request it was created for, which is all the staleness
    // guard needs here.
    let cancelled = false
    const timer = setTimeout(() => {
      void compose(handle, { preheader }).then((result) => {
        if (cancelled) return
        setCompleted({ requestKey, resetKey, result })
        if (result.ok) {
          setLastGood({ resetKey, html: result.html, text: result.text, renderedAt: new Date() })
        }
      })
    }, debounceMs)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [compose, debounceMs, handle, preheader, requestKey, resetKey])

  const refresh = useCallback(() => setRefreshCount((count) => count + 1), [])

  const currentCompleted = completed && completed.resetKey === resetKey ? completed : null
  const currentGood = lastGood && lastGood.resetKey === resetKey ? lastGood : null

  if (!enabled) return { status: 'idle', ...IDLE_PREVIEW_STATE, refresh, onReady, onDestroy }

  let status: RenderStatus
  // No handle yet means the editor chunk is still on its way. That is the same
  // "a result is coming" the code pipeline calls `rendering`, and reusing the
  // word keeps the status bar honest without inventing a fifth state.
  if (requestKey === null) status = 'rendering'
  else if (currentCompleted?.requestKey !== requestKey) status = 'rendering'
  else status = currentCompleted.result.ok ? 'success' : 'error'

  return {
    status,
    result: currentCompleted?.result ?? null,
    html: currentGood?.html ?? null,
    text: currentGood?.text ?? null,
    renderedAt: currentGood?.renderedAt ?? null,
    refresh,
    onReady,
    onDestroy,
  }
}
