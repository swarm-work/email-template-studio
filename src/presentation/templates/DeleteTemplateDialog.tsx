/**
 * "Delete <name>": a permanent delete, so it asks you to type the slug.
 *
 * Presentation layer. Deleting a template takes every version with it (the
 * database cascades), which is why this dialog names the number and why the
 * confirmation is typing rather than clicking — a misplaced Enter should not be
 * able to do this.
 */
import { useId, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { EmailTemplate } from '@/domain'

/** What the toast says once the server has confirmed it. */
export const TEMPLATE_DELETED_MESSAGE = 'Template deleted.'

export interface DeleteTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The template to delete; null while the dialog has never been opened. */
  template: EmailTemplate | null
  /** Deletes it. Resolves once the server has answered. */
  onDelete: () => Promise<void>
}

/**
 * The dialog shell. The confirmation form is a CHILD, so closing the dialog
 * unmounts it and the typed slug is gone — a reset with no effect to forget.
 */
export function DeleteTemplateDialog({ open, onOpenChange, template, onDelete }: DeleteTemplateDialogProps) {
  if (!template) return null
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DeleteTemplateForm template={template} onDelete={onDelete} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function DeleteTemplateForm({
  template,
  onDelete,
  onCancel,
}: {
  template: EmailTemplate
  onDelete: () => Promise<void>
  onCancel: () => void
}) {
  const fieldId = useId()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)

  const { metadata } = template
  // Versions are numbered from 1 with no gaps, so the current number IS the count.
  const versionCount = metadata.version.number
  const confirmed = typed.trim() === metadata.slug

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!confirmed || busy) return
    setBusy(true)
    await onDelete()
    setBusy(false)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete “{metadata.name}”?</DialogTitle>
        <DialogDescription>
          This deletes the template and all {versionCount} {versionCount === 1 ? 'version' : 'versions'} of
          it. It cannot be undone from the studio.
        </DialogDescription>
      </DialogHeader>

      {/* Starters are ordinary rows, not protected files, so they can be
            deleted like anything else — and, unlike a template somebody wrote,
            they can be brought back. Saying so is what makes the delete safe
            to offer rather than something to warn about. */}
      {metadata.origin === 'starter' ? (
        <p className="text-muted-foreground text-sm">
          This is a starter. Re-running the seed migration (<code>npm run db:migrate</code>) puts it back at
          version 1.
        </p>
      ) : null}

      <form onSubmit={submit} className="flex flex-col gap-1.5">
        <Label htmlFor={`${fieldId}-slug`}>
          Type <span className="font-mono">{metadata.slug}</span> to confirm
        </Label>
        <Input
          id={`${fieldId}-slug`}
          value={typed}
          autoFocus
          autoComplete="off"
          onChange={(event) => setTyped(event.target.value)}
          className="font-mono"
        />
        <DialogFooter className="mt-3">
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={!confirmed || busy}>
            {busy ? 'Deleting…' : 'Delete template'}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
