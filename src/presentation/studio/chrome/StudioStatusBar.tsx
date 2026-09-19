/**
 * The one-line strip along the bottom of the studio.
 *
 * Presentation layer: measurements of what is currently on screen, nothing
 * else. Every number here is real — the byte counts come from the render that
 * is showing — because a status bar that guesses is worse than no status bar
 * (docs/DESIGN.md).
 */
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { EmailTemplate } from '@/domain'
import { StatusDot } from '@/presentation/shared/StatusBadge'
import { templateStatusLabel } from '@/presentation/shared/templateStatus'
import {
  byteLength,
  formatBytes,
  GMAIL_CLIPPING_LIMIT_BYTES,
  isOverGmailLimit,
} from '@/presentation/shared/formatBytes'
import { cn } from '@/lib/utils'

const GMAIL_TOOLTIP = "Gmail hides everything past about 102 KB behind a 'View entire message' link."

export interface StudioStatusBarProps {
  template: EmailTemplate
  /** HTML of the last successful render; null before the first one. */
  html: string | null
  /** Plain-text part of that same render; null before the first one. */
  text: string | null
}

export function StudioStatusBar({ template, html, text }: StudioStatusBarProps) {
  const { metadata } = template
  const htmlBytes = html === null ? 0 : byteLength(html)
  const approxBytes = htmlBytes + (text === null ? 0 : byteLength(text))
  const overLimit = isOverGmailLimit(approxBytes)

  return (
    <section
      aria-label="Studio status"
      className="bg-card text-muted-foreground flex h-8 shrink-0 [scrollbar-width:none] items-center gap-3 overflow-x-auto border-t px-4 text-[11px]"
    >
      <span className="flex shrink-0 items-center gap-1.5">
        <StatusDot tone={metadata.status === 'ready' ? 'success' : 'neutral'} />
        {templateStatusLabel(metadata.status)} · {metadata.version.label}
      </span>
      <Separator />
      <span className="shrink-0">{template.kind === 'code' ? 'Code' : 'Visual'}</span>
      <Separator />
      <span className="shrink-0 tabular-nums">
        HTML export {html === null ? '—' : formatBytes(htmlBytes)}
      </span>
      <Separator />
      {/* The worker renders the plain-text part beside the HTML, so this is a
          fact about the render on screen, not a promise. */}
      <span className="shrink-0">{text === null ? 'Plain text —' : 'Plain text ready'}</span>
      <Separator />
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'shrink-0 rounded px-1 tabular-nums',
              overLimit && 'bg-warning-muted text-warning-foreground',
            )}
          >
            {overLimit
              ? `Approx. size ${formatBytes(approxBytes)} — over the ${formatBytes(GMAIL_CLIPPING_LIMIT_BYTES)} Gmail clipping limit`
              : `${formatBytes(approxBytes)} of ${formatBytes(GMAIL_CLIPPING_LIMIT_BYTES)} Gmail limit`}
          </span>
        </TooltipTrigger>
        <TooltipContent>{GMAIL_TOOLTIP}</TooltipContent>
      </Tooltip>

      {/* The only live region on this bar: a whole sentence, so a screen reader
          is not interrupted by every byte count that ticks over. */}
      <span className="ml-auto shrink-0 pl-3 tabular-nums" aria-live="polite">
        Last saved {metadata.version.label} · {clockTime(metadata.updatedAt)}
      </span>
    </section>
  )
}

function Separator() {
  return (
    <span className="text-border shrink-0" aria-hidden="true">
      ·
    </span>
  )
}

/** "10:22" in the reader's own locale; an unparseable timestamp gives '—'. */
function clockTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
