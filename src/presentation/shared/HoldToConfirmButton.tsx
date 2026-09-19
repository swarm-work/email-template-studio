/**
 * A button you have to hold down, for an action that cannot be undone.
 *
 * Presentation layer: no rules of its own, it only decides when the hold is
 * long enough and calls `onConfirm` exactly once. It must not import the
 * application or infrastructure layers.
 *
 * Why a hold rather than a second dialog: the gesture itself is the
 * confirmation, and it cannot be completed by muscle memory. The keyboard has
 * no equivalent gesture, so every screen using this must ALSO offer a plain
 * control (the convert dialog pairs it with a checkbox) — a hold is never the
 * only way through.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from 'cn'

/** How long the studio asks people to hold, in milliseconds. */
export const HOLD_DURATION_MS = 1200

/** How often the fill (or the countdown) is redrawn while holding. */
const TICK_MS = 50

export interface HoldToConfirmButtonProps {
  /** The label, and the button's accessible name. */
  label: string
  /** Fired once, when the hold has lasted the whole duration. */
  onConfirm: () => void
  /** Milliseconds the hold must last. */
  holdMs?: number
  /** True while the confirmed action is running; the button cannot be held. */
  busy?: boolean
  className?: string
}

export function HoldToConfirmButton({
  label,
  onConfirm,
  holdMs = HOLD_DURATION_MS,
  busy = false,
  className,
}: HoldToConfirmButtonProps) {
  const [holding, setHolding] = useState(false)
  const [progress, setProgress] = useState(0)
  const reducedMotion = usePrefersReducedMotion()
  // The moment the hold started. A ref because the interval below reads it on
  // every tick and nothing is rendered from it directly.
  const startedAt = useRef(0)

  const stop = useCallback(() => {
    setHolding(false)
    setProgress(0)
  }, [])

  const start = useCallback(() => {
    if (busy || holding) return
    startedAt.current = Date.now()
    setProgress(0)
    setHolding(true)
  }, [busy, holding])

  useEffect(() => {
    if (!holding) return
    const timer = setInterval(() => {
      const elapsed = Date.now() - startedAt.current
      if (elapsed >= holdMs) {
        // Cleared here as well as in the cleanup: `onConfirm` may open a dialog
        // or start a request, and a tick arriving after that would fire it twice.
        clearInterval(timer)
        setHolding(false)
        setProgress(0)
        onConfirm()
        return
      }
      setProgress(elapsed / holdMs)
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [holding, holdMs, onConfirm])

  // Enter and Space repeat while held down, so `start` guards against restarting.
  const isHoldKey = (key: string) => key === ' ' || key === 'Enter'
  const remainingSeconds = ((holdMs * (1 - progress)) / 1000).toFixed(1)

  return (
    <Button
      type="button"
      className={cn('relative overflow-hidden', className)}
      disabled={busy}
      onMouseDown={start}
      onMouseUp={stop}
      onMouseLeave={stop}
      onTouchStart={start}
      onTouchEnd={stop}
      onKeyDown={(event) => {
        if (isHoldKey(event.key)) {
          // Space would otherwise "click" the button on release, which is the
          // one thing a hold-to-confirm control must never do.
          event.preventDefault()
          start()
        }
      }}
      onKeyUp={(event) => {
        if (isHoldKey(event.key)) stop()
      }}
      onBlur={stop}
    >
      {/* The fill is a width, not an animation: a transition would keep moving
          after the finger came up, and would be flattened to nothing by the
          app's reduced-motion rule (src/index.css). */}
      <span
        aria-hidden="true"
        className="bg-primary-foreground/25 absolute inset-y-0 left-0"
        style={{ width: `${Math.round(progress * 100)}%` }}
      />
      <span className="relative">{label}</span>
      {/* Reduced motion gets the same information as a number instead of a
          moving bar. It is hidden from screen readers so the button's name
          stays still while somebody is holding it. */}
      {reducedMotion && holding ? (
        <span aria-hidden="true" className="relative tabular-nums">
          {remainingSeconds}s
        </span>
      ) : null}
    </Button>
  )
}

/**
 * Whether the reader asked their system for less motion.
 *
 * Read through `matchMedia` rather than CSS because the choice here is not a
 * style: it is a moving bar versus a number on the screen.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => matchReducedMotion()?.matches ?? false)

  useEffect(() => {
    const query = matchReducedMotion()
    if (!query) return
    // Only the CHANGE is subscribed to here; the current value was read when
    // the state was initialised, so there is nothing to set on mount.
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches)
    query.addEventListener('change', listener)
    return () => query.removeEventListener('change', listener)
  }, [])

  return reduced
}

/** `null` where there is no `matchMedia` at all — jsdom without a stub, mainly. */
function matchReducedMotion(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null
  return window.matchMedia('(prefers-reduced-motion: reduce)')
}
