/**
 * "This template was saved elsewhere as v8." — the three ways out.
 *
 * Presentation layer, and deliberately dumb: every sentence it shows is handed
 * to it, already worded, by `application/versionConflict.ts`. It decides
 * nothing; it only asks which of the three things the person wants.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { VersionConflictCopy } from '@/application/versionConflict'

export interface VersionConflictDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The worded sentences; see `describeVersionConflict`. */
  copy: VersionConflictCopy
  /** Creates a NEW template holding the current draft, and opens it. */
  onSaveAsCopy: () => void
  /** Throws the draft away and shows the version the server has. */
  onDiscardMine: () => void
  /** True while one of the two actions is in flight. */
  busy?: boolean
}

export function VersionConflictDialog({
  open,
  onOpenChange,
  copy,
  onSaveAsCopy,
  onDiscardMine,
  busy = false,
}: VersionConflictDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            Your edits are still here and nothing was written. Keep them under a new name, throw them away and
            start from the saved version, or carry on and decide later.
          </DialogDescription>
        </DialogHeader>
        {/* Stacked on a phone, in a row from `sm`: three labels this long do
            not fit side by side on a narrow screen. */}
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Keep editing
          </Button>
          <Button variant="outline" onClick={onDiscardMine} disabled={busy}>
            {copy.discardLabel}
          </Button>
          <Button onClick={onSaveAsCopy} disabled={busy}>
            Save as a copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
