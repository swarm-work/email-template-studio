/**
 * A tiny line chart of the last few render times.
 *
 * Presentation layer, hand-written SVG: a charting library would be far more
 * bytes than the twelve numbers it draws. It is an image with a text
 * alternative, so a screen reader hears the range instead of a list of points.
 */
import { cn } from '@/lib/utils'

const WIDTH = 220
const HEIGHT = 36
/** Keeps the stroke from being clipped at the top and bottom edges. */
const PADDING = 3

export interface SparklineProps {
  /** Oldest first. Fewer than two points draws nothing. */
  values: readonly number[]
  /** What the values are, for the accessible name: "milliseconds". */
  unit: string
  className?: string
}

export function Sparkline({ values, unit, className }: SparklineProps) {
  if (values.length < 2) {
    return <p className={cn('text-muted-foreground text-[11px]', className)}>Not enough renders yet.</p>
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  // A flat line would divide by zero; a span of at least 1 keeps it centred.
  const span = Math.max(max - min, 1)
  const step = WIDTH / (values.length - 1)
  const points = values
    .map((value, index) => {
      const x = index * step
      const y = HEIGHT - PADDING - ((value - min) / span) * (HEIGHT - PADDING * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')

  return (
    <svg
      role="img"
      aria-label={`Last ${values.length} renders, ${Math.round(min)} to ${Math.round(max)} ${unit}`}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={cn('h-9 w-full', className)}
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--success)"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
