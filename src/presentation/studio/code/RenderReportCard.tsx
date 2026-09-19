/**
 * What the last render produced: sizes, timings and how many props were used.
 *
 * Presentation layer. This is the honest replacement for the mock's "Compiler
 * AST" panel — nothing here is inferred, every row is measured from the render
 * that is on screen (docs/DESIGN.md §"what we do not copy").
 */
import { useId } from 'react'
import type { ReactNode } from 'react'
import { StatusBadge } from '@/presentation/shared/StatusBadge'
import { byteLength, formatBytes } from '@/presentation/shared/formatBytes'
import { Sparkline } from './Sparkline'

export interface RenderReportCardProps {
  /** HTML of the last successful render; null before the first one. */
  html: string | null
  /** Plain-text part of the last successful render; '' before the first one. */
  text: string
  /** How many props the payload validated, or null when it is invalid. */
  propsCount: number | null
  /** Duration of the last successful render, in milliseconds. */
  durationMs: number | null
  /** Durations of up to the last twelve successful renders, oldest first. */
  history: readonly number[]
}

export function RenderReportCard({ html, text, propsCount, durationMs, history }: RenderReportCardProps) {
  const headingId = useId()
  const htmlBytes = html === null ? null : byteLength(html)
  const textBytes = text === '' ? null : byteLength(text)
  const approx = (htmlBytes ?? 0) + (textBytes ?? 0)

  return (
    <section aria-labelledby={headingId} className="bg-card overflow-hidden rounded-lg border">
      <div className="border-b px-3 py-2">
        <h2 id={headingId} className="text-xs font-medium">
          Render report
        </h2>
      </div>
      <dl className="divide-y">
        <Row label="Rendered HTML" value={htmlBytes === null ? '—' : formatBytes(htmlBytes)} />
        <Row label="Plain text" value={textBytes === null ? '—' : formatBytes(textBytes)} />
        <Row label="Approx. email size" value={htmlBytes === null ? '—' : formatBytes(approx)} />
        <Row label="Props validated" value={propsCount === null ? '—' : String(propsCount)} />
        <Row label="Render time" value={durationMs === null ? '—' : `${Math.round(durationMs)} ms`} />
        <div className="flex flex-col gap-1 px-3 py-2">
          <dt className="text-muted-foreground text-[11px]">Last 12 renders</dt>
          <dd>
            <Sparkline values={history} unit="milliseconds" />
          </dd>
        </div>
        <Row label="Type checking" value={<StatusBadge tone="planned">Planned</StatusBadge>} />
      </dl>
    </section>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1.5">
      <dt className="text-muted-foreground min-w-0 truncate text-[11px]">{label}</dt>
      <dd className="shrink-0 font-mono text-[11px] tabular-nums">{value}</dd>
    </div>
  )
}
