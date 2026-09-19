/**
 * The "?" dialog listing every studio shortcut.
 *
 * Presentation layer. Same source as the right-rail card
 * (`studio/shortcuts.ts`), so there is one list to keep correct.
 */
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ShortcutKeys } from '../ShortcutKeys'
import { SHORTCUTS, useIsMac } from '../shortcuts'

export interface ShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ShortcutsDialog({ open, onOpenChange }: ShortcutsDialogProps) {
  const isMac = useIsMac()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Undo, redo and the block menu belong to the editor you are typing in and are not listed here.
          </DialogDescription>
        </DialogHeader>
        <ul role="list" className="divide-y">
          {SHORTCUTS.map((shortcut) => (
            <li key={shortcut.id} className="flex items-center justify-between gap-3 py-2">
              <span className="min-w-0 text-sm">{shortcut.label}</span>
              <ShortcutKeys shortcut={shortcut} isMac={isMac} />
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
