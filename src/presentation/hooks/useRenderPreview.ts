/**
 * Drives the preview pipeline from React.
 *
 * - Debounces source/props changes so typing does not trigger a render per keystroke.
 * - Ignores stale results (a newer render was requested while an older one was in flight).
 * - Keeps the last successful HTML so the preview does not flash empty on every edit.
 *
 * Status is DERIVED from "what was requested" vs "what has completed" instead
 * of being set inside effects, which keeps React's rendering predictable.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PreviewPayload, RenderResult, RenderStatus } from '@/domain'
import type { TemplateRenderer } from '@/infrastructure/render/renderClient'

export const DEFAULT_RENDER_DEBOUNCE_MS = 300

export interface RenderPreviewState {
  readonly status: RenderStatus
  /** Outcome of the most recent finished render for this template, success or failure. */
  readonly result: RenderResult | null
  /** HTML of the most recent SUCCESSFUL render, kept while newer renders fail. */
  readonly html: string | null
  /** Plain-text part of that same successful render; null before the first one. */
  readonly text: string | null
  readonly renderedAt: Date | null
  /** Forces a re-render even if nothing changed (used by the Refresh button). */
  readonly refresh: () => void
}

interface Completed {
  readonly requestKey: string
  readonly resetKey: string
  readonly result: RenderResult
}

interface LastGood {
  readonly resetKey: string
  readonly html: string
  /** Kept beside the HTML so the two parts on screen always come from one render. */
  readonly text: string
  readonly renderedAt: Date
}

export function useRenderPreview(
  renderer: TemplateRenderer,
  /** Changing this key (e.g. the template id) hides output from the previous key. */
  resetKey: string,
  source: string,
  /** `null` when the payload is invalid; rendering is then blocked. */
  props: PreviewPayload | null,
  debounceMs: number = DEFAULT_RENDER_DEBOUNCE_MS,
): RenderPreviewState {
  const [completed, setCompleted] = useState<Completed | null>(null)
  const [lastGood, setLastGood] = useState<LastGood | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)
  const latestRequest = useRef<string | null>(null)

  const propsKey = useMemo(() => (props === null ? null : JSON.stringify(props)), [props])
  // Everything that should trigger a new render is folded into one key.
  const requestKey = propsKey === null ? null : `${resetKey} ${refreshCount} ${propsKey} ${source}`

  useEffect(() => {
    latestRequest.current = requestKey
    if (requestKey === null || props === null) return
    const timer = setTimeout(() => {
      void renderer.render(source, props).then((result) => {
        if (latestRequest.current !== requestKey) return // superseded by a newer request
        setCompleted({ requestKey, resetKey, result })
        if (result.ok) {
          setLastGood({ resetKey, html: result.html, text: result.text, renderedAt: new Date() })
        }
      })
    }, debounceMs)
    return () => clearTimeout(timer)
  }, [renderer, requestKey, resetKey, source, props, debounceMs])

  const refresh = useCallback(() => setRefreshCount((count) => count + 1), [])

  const currentCompleted = completed && completed.resetKey === resetKey ? completed : null
  const currentGood = lastGood && lastGood.resetKey === resetKey ? lastGood : null

  let status: RenderStatus
  if (requestKey === null) status = 'blocked'
  else if (currentCompleted?.requestKey !== requestKey) status = 'rendering'
  else status = currentCompleted.result.ok ? 'success' : 'error'

  return {
    status,
    result: currentCompleted?.result ?? null,
    html: currentGood?.html ?? null,
    text: currentGood?.text ?? null,
    renderedAt: currentGood?.renderedAt ?? null,
    refresh,
  }
}
