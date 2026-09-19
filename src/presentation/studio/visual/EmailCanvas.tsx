/**
 * The dotted stage the email sheet sits on.
 *
 * Presentation layer, geometry only: a non-scrolling wrapper (so the chip can
 * stay in its corner), one scroller inside it, and a 600 px column in the
 * middle of that. Its child is the editor itself.
 *
 * The scroller is NOT the editor's own container: the bubble menu is appended
 * inside that container, so making the container the scroller would let
 * `overflow: auto` clip the menu. Here the menu lives in the sheet and the
 * padding around the sheet gives it room (e2e/visual.spec.ts proves it at the
 * top and bottom edges).
 */
import type { ReactNode } from 'react'
import { CANVAS_WIDTH_PX } from './canvas'
import { CanvasChip } from './CanvasChip'

export interface EmailCanvasProps {
  /** The editor. Everything the package renders goes inside the sheet column. */
  children: ReactNode
}

export function EmailCanvas({ children }: EmailCanvasProps) {
  return (
    <div role="region" aria-label="Email canvas" className="relative min-h-0 min-w-0 flex-1">
      <CanvasChip />
      {/* `absolute inset-0` rather than `h-full`: it makes the scroller exactly
          as tall as the workspace whatever the sheet inside it measures, which
          is what keeps the scrollbar on this element and off the page.
          `overscroll-contain` stops a flick at the end of the email from
          scrolling the page behind it. */}
      <div className="dot-grid absolute inset-0 overflow-auto overscroll-contain">
        {/* The column is the sheet plus everything around it: 600 px of email,
            the sheet's hairline border on each side, and 24 px of dotted ground
            beyond that. Adding the border is what makes the email itself
            exactly 600 px wide, which is what the chip promises. The gutter is
            also where the bubble menu goes when the selection is on the very
            first line. */}
        <div
          className="mx-auto w-full px-6 py-10"
          style={{ maxWidth: `${CANVAS_WIDTH_PX + 2 + 48}px` }}
          data-testid="email-canvas-column"
        >
          {children}
        </div>
      </div>
    </div>
  )
}
