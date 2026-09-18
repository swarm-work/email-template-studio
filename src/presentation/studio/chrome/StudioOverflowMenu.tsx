/**
 * The "⋯" menu at the right of the studio sub-header.
 *
 * Presentation layer: it holds the actions that are real but rare, and the
 * ones that are not built yet. Everything unavailable keeps the
 * disabled-with-reason pattern rather than disappearing, so the shape of the
 * finished studio is visible from the start.
 */
import { useId } from 'react'
import { Code2, Download, FileCode2, Keyboard, MoreHorizontal, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { TemplateKind, TemplateStatus } from '@/domain'
import { ReasonedMenuItem } from '@/presentation/shared/ReasonedButton'

const SAVED_TEMPLATES_REASON = 'Coming with saved templates.'
const CONVERT_REASON = 'Coming with the converter.'

export interface StudioOverflowMenuProps {
  kind: TemplateKind
  status: TemplateStatus
  /** Opens the send-test dialog; the menu carries it on narrow screens. */
  onSendTest: () => void
  onShowShortcuts: () => void
  /** Saves the last render as a file. */
  onDownloadHtml: () => void
  onDownloadText: () => void
  /** Why the downloads cannot be used; `undefined` means they can. */
  downloadReason?: string
  /** Opens the read-only export views. The only route to them for a visual template. */
  onViewExportedCode: () => void
}

export function StudioOverflowMenu({
  kind,
  status,
  onSendTest,
  onShowShortcuts,
  onDownloadHtml,
  onDownloadText,
  downloadReason,
  onViewExportedCode,
}: StudioOverflowMenuProps) {
  // The reason sentences live outside the menu: anything inside a menu item
  // becomes part of that item's accessible name.
  const savedReasonId = useId()
  const convertReasonId = useId()
  const downloadReasonId = useId()

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="More actions">
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {/* Below `md` the sub-header's action cluster is hidden, and Send test
              is the one action in it that actually works — so the menu carries
              it there rather than leaving a phone with nothing but unavailable
              items. It is `md:hidden` because the button itself is back. */}
          <ReasonedMenuItem className="md:hidden" onSelect={onSendTest}>
            <Send aria-hidden="true" />
            Send test
          </ReasonedMenuItem>
          <DropdownMenuSeparator className="md:hidden" />
          <ReasonedMenuItem reason={SAVED_TEMPLATES_REASON} reasonId={savedReasonId}>
            {status === 'ready' ? 'Mark as draft' : 'Mark as ready'}
          </ReasonedMenuItem>
          <DropdownMenuSeparator />
          <ReasonedMenuItem reason={downloadReason} reasonId={downloadReasonId} onSelect={onDownloadHtml}>
            <Download aria-hidden="true" />
            Download HTML
          </ReasonedMenuItem>
          <ReasonedMenuItem reason={downloadReason} reasonId={downloadReasonId} onSelect={onDownloadText}>
            <Download aria-hidden="true" />
            Download plain text
          </ReasonedMenuItem>
          {kind === 'visual' ? (
            <>
              <DropdownMenuSeparator />
              {/* A visual template has no code MODE - its views would all be
                  exports - so this is how they are reached (ADR-18). */}
              <ReasonedMenuItem onSelect={onViewExportedCode}>
                <Code2 aria-hidden="true" />
                View exported code
              </ReasonedMenuItem>
              <ReasonedMenuItem reason={CONVERT_REASON} reasonId={convertReasonId}>
                <FileCode2 aria-hidden="true" />
                Convert to code template…
              </ReasonedMenuItem>
            </>
          ) : null}
          <DropdownMenuSeparator />
          <ReasonedMenuItem onSelect={onShowShortcuts}>
            <Keyboard aria-hidden="true" />
            Keyboard shortcuts
          </ReasonedMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span id={savedReasonId} className="sr-only">
        {SAVED_TEMPLATES_REASON}
      </span>
      <span id={convertReasonId} className="sr-only">
        {CONVERT_REASON}
      </span>
      {downloadReason === undefined ? null : (
        <span id={downloadReasonId} className="sr-only">
          {downloadReason}
        </span>
      )}
    </>
  )
}
