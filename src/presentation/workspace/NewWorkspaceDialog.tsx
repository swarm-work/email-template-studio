/**
 * "New workspace": a name and a default sender address. The slug is derived
 * from the name and shown before anything is sent, because it becomes the URL
 * and cannot be changed afterwards.
 *
 * Presentation layer: plain React state, the shared `slugify`, one request.
 */
import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import type { WorkspaceRepository } from '@/application/repositories/workspaceRepository'
import type { Workspace } from '@/domain'
import { slugify } from '@shared/templateContracts'

interface NewWorkspaceDialogProps {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly repository: WorkspaceRepository
  readonly onCreated: (workspace: Workspace) => void
}

export function NewWorkspaceDialog({ open, onOpenChange, repository, onCreated }: NewWorkspaceDialogProps) {
  const [name, setName] = useState('')
  const [defaultFrom, setDefaultFrom] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const slug = slugify(name)

  function reset() {
    setName('')
    setDefaultFrom('')
    setProblem(null)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting || slug === '' || defaultFrom.trim() === '') return
    setSubmitting(true)
    setProblem(null)
    try {
      const result = await repository.create({ name: name.trim(), defaultFrom: defaultFrom.trim() })
      if (!result.ok) {
        setProblem(result.failure.message)
        return
      }
      reset()
      onOpenChange(false)
      onCreated(result.value)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>
              A workspace keeps its own templates, keys and webhooks. Everyone in your organisation can enter
              it; named members can be added in its settings.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="new-workspace-name">Name</Label>
            <Input
              id="new-workspace-name"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              placeholder="swarm.work"
            />
            <p className="text-muted-foreground text-xs">
              URL: <span className="font-mono">/w/{slug || '…'}/</span> (cannot be changed later)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-workspace-from">Default sender</Label>
            <Input
              id="new-workspace-from"
              type="email"
              value={defaultFrom}
              onChange={(event) => setDefaultFrom(event.target.value)}
              placeholder="hello@swarm.work"
            />
            <p className="text-muted-foreground text-xs">
              Sends from this workspace may only come from its domain.
            </p>
          </div>

          {problem ? (
            <Alert variant="destructive">
              <AlertDescription>{problem}</AlertDescription>
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || slug === '' || defaultFrom.trim() === ''}>
              {submitting ? 'Creating…' : 'Create workspace'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
