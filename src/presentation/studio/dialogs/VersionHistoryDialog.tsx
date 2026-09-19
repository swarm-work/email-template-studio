/**
 * "Version history": every saved version of this template, newest first.
 *
 * Presentation layer, read-only on purpose. Each save writes an immutable row
 * (ADR-22) and `GET /api/templates/:id/versions` has always been able to list
 * them; this is the first screen that does. There is no Restore button because
 * restoring is milestone M4 work — a button that reopened an old version
 * without writing one would be a lie, and one that wrote one needs a decision
 * about what happens to the draft in front of you.
 */
import { useCallback, useEffect, useReducer, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import type {
  RepositoryFailure,
  RepositoryResult,
  TemplateVersionSummary,
} from '@/application/repositories/templateRepository'
import type { TemplateId } from '@/domain'
import { relativeTime } from '@/presentation/shared/relativeTime'
import { StatusBadge } from '@/presentation/shared/StatusBadge'
import { templateKindLabel } from '@/presentation/shared/templateKind'

/** Said out loud rather than shown as an empty box; a template always has v1. */
export const NO_VERSIONS_MESSAGE = 'No versions yet. Saving this template writes the first one.'

/** Why there is no Restore button, in the dialog itself. */
const READ_ONLY_NOTE = 'Read only. Restoring an old version is planned for a later milestone.'

export interface VersionHistoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  templateId: TemplateId
  /** The repository's `listVersions`, handed down by the route. */
  onListVersions: (id: TemplateId) => Promise<RepositoryResult<readonly TemplateVersionSummary[]>>
}

/** The three states the list can be in. */
type HistoryState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly failure: RepositoryFailure }
  | { readonly kind: 'ready'; readonly versions: readonly TemplateVersionSummary[] }

/**
 * A reducer rather than three `useState` calls, for the same reason
 * `useTemplateLibrary` uses one: the three states are mutually exclusive, and a
 * reducer makes that impossible to get wrong (no "loading AND error").
 */
type HistoryAction =
  | { readonly type: 'loading' }
  | { readonly type: 'loaded'; readonly versions: readonly TemplateVersionSummary[] }
  | { readonly type: 'failed'; readonly failure: RepositoryFailure }

function reducer(_state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'loading':
      return { kind: 'loading' }
    case 'loaded':
      return { kind: 'ready', versions: action.versions }
    case 'failed':
      return { kind: 'error', failure: action.failure }
  }
}

export function VersionHistoryDialog({
  open,
  onOpenChange,
  templateId,
  onListVersions,
}: VersionHistoryDialogProps) {
  const [state, dispatch] = useReducer(reducer, { kind: 'loading' })
  // Bumping this re-runs the effect; that is all "Retry" means.
  const [attempt, setAttempt] = useState(0)

  // The list is fetched when the dialog OPENS, not when the studio loads: it is
  // a rare view and the versions are immutable, so there is nothing to keep warm.
  useEffect(() => {
    if (!open) return
    // A plain "is this answer still wanted?" flag: the dialog can be closed
    // (or the template changed) while the request is in the air.
    let current = true
    dispatch({ type: 'loading' })
    void onListVersions(templateId).then((result) => {
      if (!current) return
      if (result.ok) dispatch({ type: 'loaded', versions: result.value })
      else dispatch({ type: 'failed', failure: result.failure })
    })
    return () => {
      current = false
    }
  }, [open, templateId, onListVersions, attempt])

  const retry = useCallback(() => setAttempt((count) => count + 1), [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Version history</DialogTitle>
          <DialogDescription>{READ_ONLY_NOTE}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] min-w-0 overflow-y-auto">
          {state.kind === 'loading' ? <HistorySkeleton /> : null}

          {state.kind === 'error' ? (
            <Alert variant="destructive">
              <AlertTitle>The history could not be loaded</AlertTitle>
              <AlertDescription className="flex flex-col items-start gap-3">
                <span>{state.failure.message}</span>
                <Button variant="outline" size="sm" onClick={retry}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {state.kind === 'ready' && state.versions.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">{NO_VERSIONS_MESSAGE}</p>
          ) : null}

          {state.kind === 'ready' && state.versions.length > 0 ? (
            <ul role="list" className="divide-y">
              {state.versions.map((version) => (
                <VersionRow key={version.versionNumber} version={version} />
              ))}
            </ul>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** One saved version: number, kind, who, when, and the note if there is one. */
function VersionRow({ version }: { version: TemplateVersionSummary }) {
  return (
    <li className="flex min-w-0 flex-col gap-1 py-2.5">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="shrink-0 font-mono text-xs tabular-nums">v{version.versionNumber}</span>
        <StatusBadge tone="neutral">{templateKindLabel(version.kind)}</StatusBadge>
        <span className="text-muted-foreground min-w-0 truncate text-xs">{version.createdBy}</span>
        {/* The exact timestamp stays available on hover: "3 days ago" is the
            right answer for scanning a list and the wrong one for a report. */}
        <time
          dateTime={version.createdAt}
          title={version.createdAt}
          className="text-muted-foreground ml-auto shrink-0 text-xs"
        >
          {relativeTime(version.createdAt)}
        </time>
      </div>
      {version.note === '' ? null : <p className="min-w-0 text-xs break-words">{version.note}</p>}
    </li>
  )
}

/** Three rows of the shape that is about to appear. */
function HistorySkeleton() {
  return (
    <div role="status" aria-label="Loading version history" className="space-y-3 py-2">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-8 w-full" />
      ))}
    </div>
  )
}
