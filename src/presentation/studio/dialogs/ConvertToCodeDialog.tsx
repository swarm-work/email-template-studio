/**
 * "Convert this visual template to a code template?" — the one-way door.
 *
 * Presentation layer: it decides nothing about the conversion itself. The
 * converter has already run by the time this opens, so the dialog either offers
 * the two ways to confirm, or explains which blocks stopped it (ADR-28).
 *
 * Two confirm paths on purpose: a hold-to-confirm gesture, and a checkbox plus
 * an ordinary button for anyone using a keyboard or a screen reader. A gesture
 * that only a mouse can perform would be a door only some people can open.
 */
import { useId, useState } from 'react'
import { AlertTriangle, FileCode2 } from 'lucide-react'
import type { UnsupportedNode } from '@/application/visual/documentToTsx'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import type { ConvertPreparation } from '@/presentation/hooks/useConvertToCode'
import { HoldToConfirmButton } from '@/presentation/shared/HoldToConfirmButton'
import { ReasonedButton } from '@/presentation/shared/ReasonedButton'

/** What the checkbox says, and what the button under it does. */
const UNDERSTOOD = 'I understand the visual layout is discarded.'
const CONFIRM_REASON = 'Tick the box to confirm, or hold the other button.'

export interface ConvertToCodeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The template's name, as the title quotes it. */
  templateName: string
  preparation: ConvertPreparation
  /** True from the moment either confirm control is used until it is over. */
  converting: boolean
  /** Why the generated source could not be rendered; the template is untouched. */
  renderError: string | null
  onConfirm: () => void
}

export function ConvertToCodeDialog({
  open,
  onOpenChange,
  templateName,
  preparation,
  converting,
  renderError,
  onConfirm,
}: ConvertToCodeDialogProps) {
  const [understood, setUnderstood] = useState(false)
  const checkboxId = useId()

  // Closing the dialog puts the acknowledgement back: the next time it opens is
  // a new decision, not a continuation of the last one. Adjusted during render
  // rather than in an effect — React's own advice for "something upstream
  // changed, derive from it" — so there is no extra paint with the box still
  // ticked.
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (!open) setUnderstood(false)
  }

  const blocked = preparation.status === 'blocked'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Convert &ldquo;{templateName}&rdquo; to a code template?</DialogTitle>
          <DialogDescription>
            Switching to source will replace the visual layout and can&rsquo;t be undone.
          </DialogDescription>
        </DialogHeader>

        <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 text-sm">
          <li>The exported TSX becomes the source of truth.</li>
          <li>Blocks become components, and hand-written TSX will not convert back.</li>
          <li>Existing drafts of this template in this browser are replaced.</li>
        </ul>

        {preparation.status === 'preparing' ? (
          <div className="space-y-2" aria-live="polite">
            <p className="text-muted-foreground text-sm">Reading the canvas&hellip;</p>
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : null}

        {preparation.status === 'failed' ? (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>This template could not be converted</AlertTitle>
            <AlertDescription>{preparation.message}</AlertDescription>
          </Alert>
        ) : null}

        {blocked ? <BlockedList reasons={preparation.reasons} /> : null}

        {preparation.status === 'ready' && preparation.warnings.length > 0 ? (
          <Alert className="border-warning/30 bg-warning-muted text-warning-foreground">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>Converted, with a few changes</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {preparation.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        {renderError === null ? null : (
          <Alert variant="destructive">
            <AlertTriangle aria-hidden="true" />
            <AlertTitle>The converted template did not render</AlertTitle>
            <AlertDescription>
              {renderError} Nothing was saved, and the visual template is exactly as it was.
            </AlertDescription>
          </Alert>
        )}

        {preparation.status === 'ready' ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id={checkboxId}
              checked={understood}
              onCheckedChange={(checked) => setUnderstood(checked === true)}
            />
            <label htmlFor={checkboxId} className="text-sm">
              {UNDERSTOOD}
            </label>
          </div>
        ) : null}

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={converting}>
            Keep editing visually
          </Button>
          {preparation.status === 'ready' ? (
            <>
              <HoldToConfirmButton label="Hold to confirm" onConfirm={onConfirm} busy={converting} />
              <ReasonedButton
                reason={understood ? undefined : CONFIRM_REASON}
                onClick={onConfirm}
                disabled={converting}
              >
                <FileCode2 aria-hidden="true" />
                {converting ? 'Converting…' : 'Convert template'}
              </ReasonedButton>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The refusal: what stopped the conversion, and where each one is. */
function BlockedList({ reasons }: { reasons: readonly UnsupportedNode[] }) {
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">These blocks have no React Email equivalent yet</h3>
      <ul className="text-muted-foreground space-y-1.5 text-sm">
        {reasons.map((reason) => (
          <li key={`${reason.node}-${reason.path}`}>
            <span className="font-mono text-[11px]">{reason.node}</span> &middot; {reason.message}
            <span className="text-muted-foreground/70 block font-mono text-[11px]">{reason.path}</span>
          </li>
        ))}
      </ul>
      <p className="text-sm">Remove these blocks, or ask for support for them.</p>
    </div>
  )
}
