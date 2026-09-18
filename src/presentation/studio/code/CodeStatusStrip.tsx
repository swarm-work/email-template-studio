/**
 * The strip under the editors: facts about the file on the left, facts about
 * the last render on the right.
 *
 * Presentation layer, formatting only. The mock's "UTF-8 CRLF" is wrong for
 * this app — the studio only ever writes LF — so it says "UTF-8 · LF".
 */
import type { RenderStatus } from '@/domain'
import { byteLength, formatBytes } from '@/presentation/shared/formatBytes'

export interface CodeStatusStripProps {
  /** The text currently in the open editor. */
  content: string
  status: RenderStatus
  /** How long the last successful render took, in milliseconds. */
  durationMs: number | null
}

export function CodeStatusStrip({ content, status, durationMs }: CodeStatusStripProps) {
  const lines = content === '' ? 0 : content.split('\n').length
  return (
    <div className="bg-editor-chrome text-editor-muted border-editor-border flex min-w-0 [scrollbar-width:none] items-center gap-3 overflow-x-auto border-t px-3 py-1.5 font-mono text-[11px]">
      <span className="shrink-0 tabular-nums">{lines} lines</span>
      <Dot />
      <span className="shrink-0 tabular-nums">{formatBytes(byteLength(content))}</span>
      <Dot />
      <span className="shrink-0">UTF-8 · LF</span>
      <span className="ml-auto flex shrink-0 items-center gap-3 pl-3">
        <span className="tabular-nums">
          Worker render {durationMs === null ? '—' : `${Math.round(durationMs)} ms`}
        </span>
        <Dot />
        <span>{renderLabel(status)}</span>
      </span>
    </div>
  )
}

function Dot() {
  return (
    <span aria-hidden="true" className="shrink-0 opacity-60">
      ·
    </span>
  )
}

/** The mock's "Render Ready" claimed more than it knew; this reports the real status. */
function renderLabel(status: RenderStatus): string {
  switch (status) {
    case 'rendering':
      return 'Rendering…'
    case 'error':
      return 'Render failed'
    case 'success':
      return 'Last render OK'
    case 'blocked':
      return 'Render paused'
    case 'idle':
      return 'Not rendered yet'
  }
}
