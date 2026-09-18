/**
 * The small "600 px canvas · 100%" label in the corner of the canvas.
 *
 * Presentation layer: it states a fact about the canvas, it is not a control.
 * It sits on the NON-scrolling wrapper so it stays in the corner while the
 * email scrolls underneath it.
 */
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { CANVAS_WIDTH_PX } from './canvas'

/**
 * Why "100%" is worth saying: every other visual email builder scales the
 * canvas to fit, so what you judge on screen is not what arrives. This one
 * does not, and the chip is where that promise is made.
 */
const ZOOM_TOOLTIP = 'Shown at actual size. The studio never scales the email.'

export function CanvasChip() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="bg-card/90 text-muted-foreground absolute top-4 left-4 z-10 rounded-full border px-2.5 py-1 font-mono text-[11px] tabular-nums backdrop-blur-sm">
          {CANVAS_WIDTH_PX} px canvas · 100%
        </span>
      </TooltipTrigger>
      <TooltipContent>{ZOOM_TOOLTIP}</TooltipContent>
    </Tooltip>
  )
}
