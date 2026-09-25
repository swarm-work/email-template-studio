/**
 * Minimises a panel while the person scrolls down through the editor, and
 * brings it back when they return to the top.
 *
 * Presentation layer, one listener. The studio's envelope panel is 200+ px of
 * form above the editor; once you are scrolled into the email you are not
 * editing the subject, so the panel gives that height back to the editor and
 * shrinks to a one-line summary (see `EnvelopePanel`'s `compact` prop).
 *
 * The decision is a pure function (`nextCollapsed`) so its rules can be tested
 * without a browser that really scrolls:
 *
 * - Collapse only while scrolling DOWN past a small threshold. Direction
 *   matters: when the panel expands, the scroller gets shorter and the browser
 *   may clamp `scrollTop` downwards. That is a scroll event too, and treating
 *   it as "still scrolled down" would collapse the panel right after the person
 *   opened it.
 * - Expand only at the very top. The gap between "past the threshold" and "at
 *   zero" is deliberate slack, so a panel near the threshold does not flicker.
 * - Change nothing for a moment after the panel changed shape. Collapsing
 *   makes the scroller taller and expanding makes it shorter, and either way
 *   the browser moves `scrollTop` by itself (clamping it, or scroll anchoring
 *   keeping the visible content still) and fires a scroll event nobody asked
 *   for. Obeying those would undo the change the person just caused - seen in
 *   the browser as "click the summary, the panel opens and snaps shut again".
 * - Never collapse while `hold()` says so - the studio holds while focus is
 *   inside the panel, so a field you are typing in is never whisked away.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

/** How far down (px) the editor must scroll before the panel minimises. */
export const COLLAPSE_THRESHOLD_PX = 48

export interface ScrollSample {
  /** `scrollTop` now. */
  readonly scrollTop: number
  /** `scrollTop` at the previous event, to tell down from up. */
  readonly previousScrollTop: number
  /** True just after the panel changed shape, while the layout settles (see above). */
  readonly settling: boolean
  /** True while something (usually focus inside the panel) must keep it open. */
  readonly held: boolean
}

/** How long (ms) after a change scroll events are treated as layout, not a person. */
export const SETTLE_MS = 250

/** The whole rule, as a function of one scroll event. */
export function nextCollapsed(collapsed: boolean, sample: ScrollSample): boolean {
  if (sample.settling) return collapsed
  if (sample.scrollTop <= 0) return false
  if (collapsed || sample.held) return collapsed
  const scrollingDown = sample.scrollTop > sample.previousScrollTop
  return scrollingDown && sample.scrollTop > COLLAPSE_THRESHOLD_PX
}

export interface UseCollapseOnScrollOptions {
  /** The element that scrolls. */
  scroller: RefObject<HTMLElement | null>
  /** Keeps the panel open while true, e.g. while focus is inside it. */
  hold?: () => boolean
}

export interface CollapseOnScroll {
  collapsed: boolean
  /** Opens the panel again, e.g. from a click on its summary row. */
  expand: () => void
}

export function useCollapseOnScroll({ scroller, hold }: UseCollapseOnScrollOptions): CollapseOnScroll {
  const [collapsed, setCollapsed] = useState(false)
  // A mirror of `collapsed` the listener can read synchronously, so the
  // decision and its side effects happen once, outside React's state updater.
  const collapsedRef = useRef(false)
  // Kept in a ref, not state: it changes on every scroll event and nothing
  // renders from it, so state would cost a render per pixel for nothing.
  const previousScrollTop = useRef(0)
  // When the panel last changed shape, for the settle window. `performance.now()`
  // rather than Date: it is monotonic, so a clock change cannot confuse it.
  const changedAt = useRef(Number.NEGATIVE_INFINITY)
  // The latest `hold`, read inside the listener without re-subscribing it
  // every time the parent renders a new arrow function.
  const holdRef = useRef(hold)
  useEffect(() => {
    holdRef.current = hold
  }, [hold])

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const onScroll = () => {
      const scrollTop = element.scrollTop
      const sample: ScrollSample = {
        scrollTop,
        previousScrollTop: previousScrollTop.current,
        settling: performance.now() - changedAt.current < SETTLE_MS,
        held: holdRef.current?.() ?? false,
      }
      previousScrollTop.current = scrollTop
      const current = collapsedRef.current
      const next = nextCollapsed(current, sample)
      // Only a CHANGE re-renders; most scroll events change nothing.
      if (next === current) return
      collapsedRef.current = next
      changedAt.current = performance.now()
      setCollapsed(next)
    }
    // Passive: the listener never calls preventDefault, and saying so up front
    // lets the browser scroll without waiting for this function to return.
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [scroller])

  const expand = useCallback(() => {
    if (!collapsedRef.current) return
    collapsedRef.current = false
    changedAt.current = performance.now()
    setCollapsed(false)
  }, [])
  return { collapsed, expand }
}
