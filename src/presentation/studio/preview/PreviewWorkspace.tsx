/**
 * Preview mode: the email as a mail client would show it, and nothing else.
 *
 * Presentation layer, read only. It never renders anything itself — the HTML
 * string it draws was built once in `StudioPage` and is shared with the code
 * rail's thumbnail (ADR-25), so switching modes costs no extra render.
 *
 * The isolation model is unchanged from phase 1: `sandbox=""` plus the CSP meta
 * tag `buildPreviewDocument` injects. Do not add `allow-*` tokens here.
 */
import { useState, type ReactNode, type Ref } from 'react'
import { AlertTriangle, Loader2, MailOpen, PauseCircle } from 'lucide-react'
import {
  PREVIEW_DEVICE_WIDTHS,
  type DiagnosticItem,
  type EmailTemplate,
  type PreviewDevice,
  type RenderResult,
  type RenderStatus,
  type TemplateEnvelope,
} from '@/domain'
import { cn } from '@/lib/utils'
import { DiagnosticsPanel } from '../DiagnosticsPanel'
import { EnvelopeSummary } from './EnvelopeSummary'
import { NOTHING_RENDERED_REASON } from './previewStatus'
import { PreviewToolbar } from './PreviewToolbar'

/** The two views of one render: the picture, and the words a text client sees. */
type PreviewTabId = 'rendered' | 'text'

/** In strip order, so the arrow keys know what "next" means. */
const PREVIEW_TABS: readonly { id: PreviewTabId; label: string }[] = [
  { id: 'rendered', label: 'Rendered' },
  { id: 'text', label: 'Plain text' },
]

/** The id the tab button carries, so the arrow keys can move focus to it. */
function previewTabId(id: PreviewTabId): string {
  return `preview-tab-${id}`
}

export interface PreviewWorkspaceProps {
  template: EmailTemplate
  /** The draft envelope, so the summary shows what is being edited right now. */
  envelope: TemplateEnvelope
  /** The send server's From identity, or null while it is unknown. */
  from: string | null
  device: PreviewDevice
  status: RenderStatus
  result: RenderResult | null
  /** The full document (HTML + CSP meta) for the iframe; null before the first render. */
  document: string | null
  /** Plain-text part of the last successful render; null before the first one. */
  text: string | null
  renderedAt: Date | null
  onRefresh: () => void
  /** Why Refresh cannot be used; `undefined` means it can. */
  refreshReason?: string
  onDownloadHtml: () => void
  onDownloadText: () => void
  /** Why the downloads cannot be used; `undefined` means they can. */
  downloadReason?: string
  diagnostics: readonly DiagnosticItem[]
  /** Escape leaves preview mode; the studio decides where back is. */
  onExit: () => void
  /** The studio focuses this region when ⌘P brings you here. */
  ref?: Ref<HTMLElement>
}

export function PreviewWorkspace({
  template,
  envelope,
  from,
  device,
  status,
  result,
  document,
  text,
  renderedAt,
  onRefresh,
  refreshReason,
  onDownloadHtml,
  onDownloadText,
  downloadReason,
  diagnostics,
  onExit,
  ref,
}: PreviewWorkspaceProps) {
  const [tab, setTab] = useState<PreviewTabId>('rendered')
  const width = PREVIEW_DEVICE_WIDTHS[device]
  const failed = result !== null && !result.ok
  const skipTargetId = 'preview-skip-target'

  return (
    <section
      ref={ref}
      aria-labelledby="preview-heading"
      // Focusable only by script: ⌘P moves focus here so the next Tab starts
      // inside the preview instead of back at the top of the page.
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onExit()
      }}
      className="bg-card flex min-w-0 flex-col overflow-hidden rounded-lg border focus-visible:outline-none"
    >
      <PreviewToolbar
        headingId="preview-heading"
        device={device}
        status={status}
        stale={failed && document !== null}
        renderedAt={renderedAt}
        onRefresh={onRefresh}
        refreshReason={refreshReason}
        onDownloadHtml={onDownloadHtml}
        onDownloadText={onDownloadText}
        downloadReason={downloadReason}
      />

      <EnvelopeSummary envelope={envelope} fallbackSubject={template.envelope.subject} from={from} />

      {/* Only the selected tab is in the tab order (the ARIA tabs pattern), so
          the arrow keys are the ONLY way to reach the other one from the
          keyboard — the same handler the code editor's tab strip has. */}
      <div
        role="tablist"
        aria-label="Preview format"
        onKeyDown={(event) => {
          const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
          if (step === 0) return
          event.preventDefault()
          const index = PREVIEW_TABS.findIndex((candidate) => candidate.id === tab)
          const next = PREVIEW_TABS[(index + step + PREVIEW_TABS.length) % PREVIEW_TABS.length]
          setTab(next.id)
          globalThis.document.getElementById(previewTabId(next.id))?.focus()
        }}
        className="flex items-center gap-1 border-b px-2 py-1"
      >
        {PREVIEW_TABS.map((candidate) => (
          <PreviewTab
            key={candidate.id}
            id={candidate.id}
            label={candidate.label}
            active={tab}
            onSelect={setTab}
          />
        ))}
      </div>

      {status === 'blocked' ? (
        <Banner tone="warning" icon={PauseCircle}>
          Preview paused. Fix the preview payload to continue rendering.
        </Banner>
      ) : failed && document !== null ? (
        <Banner tone="danger" icon={AlertTriangle}>
          The latest change failed to render. Showing the last successful preview.
        </Banner>
      ) : null}

      {/* Both panels stay mounted (ADR-24): unmounting the iframe would reload
          the email every time someone glanced at the plain-text part. */}
      <TabPanel id="rendered" active={tab}>
        <div className="dot-grid relative flex min-h-[560px] flex-1 justify-center overflow-auto p-4">
          {document !== null ? (
            <>
              {/* A keyboard user who does not want to walk into the email can
                  step over it; the iframe itself is focusable and titled. */}
              <a
                href={`#${skipTargetId}`}
                className="bg-card focus-visible:ring-ring/50 sr-only rounded-md border px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-10 focus-visible:ring-3"
              >
                Skip preview
              </a>
              <iframe
                key={template.metadata.id}
                title={`Email preview: ${template.metadata.name}`}
                // Empty sandbox = no scripts, no forms, no same-origin access. The HTML also carries a CSP meta tag.
                sandbox=""
                srcDoc={document}
                tabIndex={0}
                // Desktop is fluid up to the max width; mobile is a fixed phone width.
                style={device === 'mobile' ? { width } : { width: '100%', maxWidth: width }}
                className={cn(
                  'h-[720px] max-w-full shrink-0 rounded-md border bg-white shadow-xs transition-[width,max-width] duration-300 ease-out motion-reduce:transition-none',
                  status === 'rendering' && 'opacity-90',
                )}
              />
              <span id={skipTargetId} tabIndex={-1} />
            </>
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
      </TabPanel>

      <TabPanel id="text" active={tab}>
        <div className="min-h-[560px] p-4">
          {/* The alternative part exactly as the worker produced it: no markup,
              so a plain `<pre>` is the honest way to show it. */}
          {/* `role="group"` rather than a bare <pre>: ARIA forbids a name on
              the generic role a <pre> maps to, so without it this focusable,
              scrollable box would be announced as nothing at all. */}
          <pre
            role="group"
            aria-label="Plain text part (read only)"
            tabIndex={0}
            className="bg-muted/40 h-[560px] overflow-auto rounded-md border p-3 font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap"
          >
            {text === null || text === '' ? NOTHING_RENDERED_REASON : text}
          </pre>
        </div>
      </TabPanel>

      <div className="border-t p-3">
        <DiagnosticsPanel items={diagnostics} />
      </div>
    </section>
  )
}

function PreviewTab({
  id,
  label,
  active,
  onSelect,
}: {
  id: PreviewTabId
  label: string
  active: PreviewTabId
  onSelect: (tab: PreviewTabId) => void
}) {
  const selected = id === active
  return (
    <button
      type="button"
      role="tab"
      id={previewTabId(id)}
      aria-selected={selected}
      aria-controls={`preview-panel-${id}`}
      tabIndex={selected ? 0 : -1}
      onClick={() => onSelect(id)}
      className={cn(
        'h-7 shrink-0 rounded-md px-2 text-xs transition-colors',
        selected ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
}

function TabPanel({ id, active, children }: { id: PreviewTabId; active: PreviewTabId; children: ReactNode }) {
  const selected = id === active
  return (
    <div
      id={`preview-panel-${id}`}
      role="tabpanel"
      aria-labelledby={`preview-tab-${id}`}
      hidden={!selected}
      // `inert` also takes the hidden iframe out of the tab order; `hidden`
      // alone would leave it focusable (ADR-24).
      inert={!selected}
      className="flex min-h-0 flex-1 flex-col"
    >
      {children}
    </div>
  )
}

function Banner({
  tone,
  icon: Icon,
  children,
}: {
  tone: 'warning' | 'danger'
  icon: typeof AlertTriangle
  children: ReactNode
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
