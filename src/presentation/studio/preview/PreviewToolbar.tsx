/**
 * The strip along the top of preview mode.
 *
 * Presentation layer: it echoes the device the sub-header's toggle chose (this
 * is not a second control), says when the picture on screen was made, and
 * carries the two downloads plus Refresh. No rules live here; every label is a
 * prop.
 */
import { Download, RefreshCw } from 'lucide-react'
import { AnimatedBadge } from '@/components/motion/animated-badge'
import { Button } from '@/components/ui/button'
import { PREVIEW_DEVICE_WIDTHS, type PreviewDevice, type RenderStatus } from '@/domain'
import { ReasonedButton } from '@/presentation/shared/ReasonedButton'
import { cn } from '@/lib/utils'
import { previewStatusPresentation } from './previewStatus'

export interface PreviewToolbarProps {
  headingId: string
  device: PreviewDevice
  status: RenderStatus
  /** True when the newest render failed but an older, good one is on screen. */
  stale: boolean
  renderedAt: Date | null
  onRefresh: () => void
  onDownloadHtml: () => void
  onDownloadText: () => void
  /** Why the downloads cannot be used; `undefined` means they can. */
  downloadReason?: string
}

export function PreviewToolbar({
  headingId,
  device,
  status,
  stale,
  renderedAt,
  onRefresh,
  onDownloadHtml,
  onDownloadText,
  downloadReason,
}: PreviewToolbarProps) {
  const width = PREVIEW_DEVICE_WIDTHS[device]
  const { badge, label } = previewStatusPresentation(status, stale)

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 border-b px-3 py-2">
      <h2 id={headingId} className="shrink-0 text-xs font-medium">
        Preview
      </h2>
      <span className="text-muted-foreground shrink-0 font-mono text-[11px]">
        {device === 'desktop' ? `Desktop · up to ${width}px` : `Mobile · ${width}px`}
      </span>
      <AnimatedBadge size="sm" status={badge} contentKey={label} role="status">
        {label}
      </AnimatedBadge>

      <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1">
        {renderedAt ? (
          <span className="text-muted-foreground shrink-0 text-[11px]">
            Rendered{' '}
            <time dateTime={renderedAt.toISOString()} className="font-mono tabular-nums">
              {renderedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </time>
          </span>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onRefresh} disabled={status === 'blocked'}>
          <RefreshCw
            className={cn(status === 'rendering' && 'animate-spin motion-reduce:animate-none')}
            aria-hidden="true"
          />
          Refresh
        </Button>
        <ReasonedButton variant="ghost" size="sm" reason={downloadReason} onClick={onDownloadHtml}>
          <Download aria-hidden="true" />
          Download HTML
        </ReasonedButton>
        <ReasonedButton variant="ghost" size="sm" reason={downloadReason} onClick={onDownloadText}>
          <Download aria-hidden="true" />
          Download plain text
        </ReasonedButton>
      </div>
    </div>
  )
}
