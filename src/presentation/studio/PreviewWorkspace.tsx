import { useMemo } from 'react'
import { AlertTriangle, Loader2, MailOpen, PauseCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  PREVIEW_DEVICE_WIDTHS,
  PREVIEW_SAMPLE_RECIPIENT,
  type EmailTemplate,
  type PreviewDevice,
  type RenderResult,
  type RenderStatus,
} from '@/domain'
import { buildPreviewDocument } from '@/infrastructure/render/previewDocument'
import { AnimatedBadge, type AnimatedBadgeStatus } from '@/components/motion/animated-badge'
import { cn } from '@/lib/utils'

export interface PreviewWorkspaceProps {
  template: EmailTemplate
  device: PreviewDevice
  status: RenderStatus
  result: RenderResult | null
  /** Last successful HTML; may be older than `result` when the latest render failed. */
  html: string | null
  renderedAt: Date | null
  onRefresh: () => void
}

export function PreviewWorkspace({
  template,
  device,
  status,
  result,
  html,
  renderedAt,
  onRefresh,
}: PreviewWorkspaceProps) {
  const document = useMemo(() => (html === null ? null : buildPreviewDocument(html)), [html])
  const width = PREVIEW_DEVICE_WIDTHS[device]
  const failed = result !== null && !result.ok
  const { subject } = template.envelope

  return (
    <section
      aria-labelledby="preview-heading"
      className="bg-card flex flex-col overflow-hidden rounded-lg border"
    >
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <h2 id="preview-heading" className="text-xs font-medium">
          Preview
        </h2>
        <span className="text-muted-foreground font-mono text-[11px]">
          {device === 'desktop' ? `Desktop · up to ${width}px` : `Mobile · ${width}px`}
        </span>
        <PreviewStatusBadge status={status} stale={failed && html !== null} />
        <div className="ml-auto flex items-center gap-2">
          {renderedAt ? (
            <span className="text-muted-foreground text-[11px]">
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
        </div>
      </div>

      {/* Mail-client style envelope: subject, sender and recipient above the message body. */}
      <div className="grid gap-x-6 gap-y-1 border-b px-4 py-3 sm:grid-cols-[auto_1fr]">
        <span className="meta-label self-center">Subject</span>
        <span className="text-sm font-medium">{subject}</span>
        <span className="meta-label self-center">From</span>
        {/* The sender belongs to the send server, not to the template. */}
        <span className="text-muted-foreground text-xs">Set by the send server.</span>
        <span className="meta-label self-center">To</span>
        <span className="text-muted-foreground text-xs">
          {PREVIEW_SAMPLE_RECIPIENT.name}{' '}
          <span className="font-mono">&lt;{PREVIEW_SAMPLE_RECIPIENT.address}&gt;</span>
        </span>
      </div>

      {status === 'blocked' ? (
        <Banner tone="warning" icon={PauseCircle}>
          Preview paused. Fix the preview payload to continue rendering.
        </Banner>
      ) : failed && html !== null ? (
        <Banner tone="danger" icon={AlertTriangle}>
          The latest change failed to render. Showing the last successful preview.
        </Banner>
      ) : null}

      <div className="dot-grid relative flex min-h-[560px] justify-center overflow-auto p-4">
        {document !== null ? (
          <iframe
            key={template.metadata.id}
            title={`Email preview: ${template.metadata.name}`}
            // Empty sandbox = no scripts, no forms, no same-origin access. The HTML also carries a CSP meta tag.
            sandbox=""
            srcDoc={document}
            // Desktop is fluid up to the max width; mobile is a fixed phone width.
            style={device === 'mobile' ? { width } : { width: '100%', maxWidth: width }}
            className={cn(
              'h-[720px] max-w-full shrink-0 rounded-md border bg-white shadow-xs transition-[width,max-width] duration-300 ease-out motion-reduce:transition-none',
              status === 'rendering' && 'opacity-90',
            )}
          />
        ) : (
          <EmptyState status={status} result={result} />
        )}
        {status === 'rendering' && document !== null ? (
          <span className="bg-card text-muted-foreground absolute top-6 right-6 flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] shadow-xs">
            <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            Updating
          </span>
        ) : null}
      </div>
    </section>
  )
}

/** beUI animated badge: pulses while rendering, rolls to the next state when the render settles. */
function PreviewStatusBadge({ status, stale }: { status: RenderStatus; stale: boolean }) {
  const { badge, label } = previewStatusPresentation(status, stale)
  return (
    <AnimatedBadge size="sm" status={badge} contentKey={label} role="status">
      {label}
    </AnimatedBadge>
  )
}

function previewStatusPresentation(
  status: RenderStatus,
  stale: boolean,
): { badge: AnimatedBadgeStatus; label: string } {
  if (stale) return { badge: 'warning', label: 'Showing last good render' }
  switch (status) {
    case 'idle':
      return { badge: 'neutral', label: 'Idle' }
    case 'blocked':
      return { badge: 'warning', label: 'Paused' }
    case 'rendering':
      return { badge: 'loading', label: 'Rendering' }
    case 'success':
      return { badge: 'success', label: 'Up to date' }
    case 'error':
      return { badge: 'danger', label: 'Render failed' }
  }
}

function Banner({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'warning' | 'danger'
  icon: typeof AlertTriangle
  children: React.ReactNode
}) {
  return (
    <p
      role="status"
      className={cn(
        'flex items-center gap-2 border-b px-4 py-2 text-xs',
        tone === 'warning'
          ? 'bg-warning-muted text-warning-foreground'
          : 'bg-danger-muted text-danger-foreground',
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      {children}
    </p>
  )
}

function EmptyState({ status, result }: { status: RenderStatus; result: RenderResult | null }) {
  if (status === 'rendering') {
    return (
      <div
        className="text-muted-foreground flex flex-col items-center justify-center gap-2 text-sm"
        role="status"
      >
        <Loader2 className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Rendering preview…
      </div>
    )
  }
  if (status === 'error' && result && !result.ok) {
    return (
      <div className="text-danger-foreground flex max-w-md flex-col items-center justify-center gap-2 text-center text-sm">
        <AlertTriangle className="size-5" aria-hidden="true" />
        <p className="font-medium">Nothing to preview yet</p>
        <p className="text-muted-foreground text-xs">{result.error.message}</p>
      </div>
    )
  }
  return (
    <div className="text-muted-foreground flex flex-col items-center justify-center gap-2 text-center text-sm">
      <MailOpen className="size-5" aria-hidden="true" />
      <p>
        {status === 'blocked'
          ? 'Fix the payload to render a preview.'
          : 'Select a template to render a preview.'}
      </p>
    </div>
  )
}
