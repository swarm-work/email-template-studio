/**
 * How much to shrink a fixed-width frame so it fits the box it is drawn in.
 *
 * Presentation layer: a `ResizeObserver` and one number, no rules. The preview
 * thumbnail renders the email at its real width (680 px, what the desktop
 * preview uses) and scales the whole iframe down with a CSS transform, because
 * an iframe cannot be "responsive" — its content lays out against its own
 * width, so making it narrower would reflow the email instead of zooming out.
 */
import { useEffect, useState, type RefObject } from 'react'

/** Never smaller than a fifth, never larger than life. */
const MIN_SCALE = 0.2
const MAX_SCALE = 1

export function useScaledFrame(boxRef: RefObject<HTMLElement | null>, frameWidth: number): number {
  const [scale, setScale] = useState(MIN_SCALE)

  useEffect(() => {
    const box = boxRef.current
    if (box === null) return
    // jsdom and older browsers have no ResizeObserver; the thumbnail then keeps
    // its starting scale rather than crashing the studio around it.
    if (typeof ResizeObserver === 'undefined') return

    function measure(width: number) {
      // Three decimals: enough for a scale that looks smooth, few enough that a
      // sub-pixel wobble during a resize does not re-render on every frame.
      const next = Math.round(clamp(width / frameWidth) * 1000) / 1000
      setScale((current) => (current === next ? current : next))
    }

    measure(box.getBoundingClientRect().width)
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) measure(entry.contentRect.width)
    })
    observer.observe(box)
    return () => observer.disconnect()
  }, [boxRef, frameWidth])

  return scale
}

/** Keeps the ratio inside the readable range, and survives a zero-width box. */
function clamp(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return MIN_SCALE
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))
}
