/**
 * The templates screen: library or editor, and everything the two share.
 *
 * Presentation layer. It owns `StudioView`, which is this app's stand-in for a
 * router: `{kind:'library'}` mirrors the future `/templates` and
 * `{kind:'editor'}` mirrors `/templates/:id`. Nothing else reads that value —
 * children are handed `onOpenTemplate` / `onBackToLibrary` callbacks — so
 * swapping in a real router later touches only this file.
 *
 * It is also where the repository's writes are turned into screen behaviour:
 * the dialogs collect the input, this file sends it and says what happened.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { EmailTemplate, TemplateId } from '@/domain'
import type {
  NewTemplateInput,
  RepositoryFailure,
  RepositoryResult,
  TemplateRepository,
  TemplateVersionSummary,
  VersionInput,
} from '@/application/repositories/templateRepository'
import type { EmailProvider } from '@/infrastructure/providers/emailProvider'
import type { TemplateRenderer } from '@/infrastructure/render/renderClient'
import type { StudioSessionStore } from '@/infrastructure/session/sessionStore'
import { useStudio } from '@/presentation/hooks/useStudio'
import { useTemplateLibrary, type TemplateWrites } from '@/presentation/hooks/useTemplateLibrary'
import { StudioPage } from '@/presentation/studio/StudioPage'
import { TEMPLATE_DELETED_MESSAGE } from './DeleteTemplateDialog'
import { TemplateLibraryPage } from './TemplateLibraryPage'

/** Which of the two templates screens is showing. Deliberately not persisted. */
type StudioView = { readonly kind: 'library' } | { readonly kind: 'editor'; readonly templateId: TemplateId }

export interface TemplatesRouteProps {
  repository: TemplateRepository
  renderer: TemplateRenderer
  store: StudioSessionStore
  provider: EmailProvider
  /** Reports how long the last preview render took, for the header's pill. */
  onRenderTime: (ms: number | null) => void
  /** Tells the shell whether the full-height editor is open. */
  onEditorOpenChange: (open: boolean) => void
}

export function TemplatesRoute({
  repository,
  renderer,
  store,
  provider,
  onRenderTime,
  onEditorOpenChange,
}: TemplatesRouteProps) {
  const library = useTemplateLibrary(repository)
  // The app always lands on the library; the view is state, not a saved setting.
  const [view, setView] = useState<StudioView>({ kind: 'library' })

  const openTemplate = useCallback((id: TemplateId) => setView({ kind: 'editor', templateId: id }), [])
  /**
   * The one repository READ the studio needs beyond the library list: the
   * version-history dialog asks for it when it opens. It is passed as a
   * callback rather than handing the whole repository down, so the studio still
   * cannot reach anything else (ADR-20).
   */
  const listVersions = useCallback((id: TemplateId) => repository.listVersions(id), [repository])
  const backToLibrary = useCallback(() => setView({ kind: 'library' }), [])

  const { create, remove } = library
  /**
   * Creates a template and opens it. Returns the whole failure so the dialog
   * can turn `slug-taken` into a field error and show the server's own sentence
   * for anything else.
   *
   * The new template is in the list before this resolves (`useTemplateLibrary`
   * patches it in from the create's own answer), so opening the editor here
   * cannot flash whichever template happens to be first in the library.
   */
  const createTemplate = useCallback(
    async (input: NewTemplateInput & { readonly initialVersion: VersionInput }) => {
      const result = await create(input)
      if (!result.ok) return result.failure
      setView({ kind: 'editor', templateId: result.value.metadata.id })
      return null
    },
    [create],
  )

  const deleteTemplate = useCallback(
    async (id: TemplateId) => {
      const result = await remove(id)
      if (!result.ok) {
        toast.error('The template could not be deleted.', { description: result.failure.message })
        return
      }
      toast.success(TEMPLATE_DELETED_MESSAGE)
      // The card is gone, so anything looking at it has to come back here.
      setView({ kind: 'library' })
    },
    [remove],
  )

  // The shell owns the page shape (`density`), so the view has to report it.
  // The cleanup matters: navigating to another screen closes the editor too.
  const editorOpen = view.kind === 'editor'
  useEffect(() => {
    onEditorOpenChange(editorOpen)
    return () => onEditorOpenChange(false)
  }, [editorOpen, onEditorOpenChange])

  if (library.state.kind === 'loading') return <LibrarySkeleton />
  if (library.state.kind === 'error') {
    return <LibraryError failure={library.state.failure} onRetry={library.reload} />
  }
  if (library.state.kind === 'empty') {
    // Nothing to edit, so the studio (which needs a template) is not mounted.
    return (
      <TemplateLibraryPage
        templates={[]}
        dirtyIds={EMPTY_IDS}
        onOpenTemplate={openTemplate}
        onCreateTemplate={createTemplate}
        onDeleteTemplate={deleteTemplate}
      />
    )
  }

  return (
    <TemplatesWorkspace
      templates={library.state.templates}
      selectedId={view.kind === 'editor' ? view.templateId : null}
      onOpenTemplate={openTemplate}
      onBackToLibrary={backToLibrary}
      onCreateTemplate={createTemplate}
      onDeleteTemplate={deleteTemplate}
      writes={library.writes}
      onListVersions={listVersions}
      reloadLibrary={library.reload}
      renderer={renderer}
      store={store}
      provider={provider}
      onRenderTime={onRenderTime}
    />
  )
}

const EMPTY_IDS: ReadonlySet<TemplateId> = new Set()

/** What the studio says when you leave the editor with unsaved edits. */
export const DRAFT_KEPT_MESSAGE = 'Draft kept.'

interface TemplatesWorkspaceProps {
  templates: readonly EmailTemplate[]
  /** null while the library is showing. */
  selectedId: TemplateId | null
  onOpenTemplate: (id: TemplateId) => void
  onBackToLibrary: () => void
  onCreateTemplate: (
    input: NewTemplateInput & { readonly initialVersion: VersionInput },
  ) => Promise<RepositoryFailure | null>
  onDeleteTemplate: (id: TemplateId) => Promise<void>
  writes: TemplateWrites
  onListVersions: (id: TemplateId) => Promise<RepositoryResult<readonly TemplateVersionSummary[]>>
  reloadLibrary: () => void
  renderer: TemplateRenderer
  store: StudioSessionStore
  provider: EmailProvider
  onRenderTime: (ms: number | null) => void
}

/**
 * The part that needs at least one template. `useStudio` lives here rather than
 * in `StudioPage` so the drafts it tracks outlive the editor: the library has to
 * know which cards to badge "Modified" while the editor is not mounted.
 */
function TemplatesWorkspace({
  templates,
  selectedId,
  onOpenTemplate,
  onBackToLibrary,
  onCreateTemplate,
  onDeleteTemplate,
  writes,
  onListVersions,
  reloadLibrary,
  renderer,
  store,
  provider,
  onRenderTime,
}: TemplatesWorkspaceProps) {
  const studio = useStudio({ templates, store, selectedId })

  /**
   * Leaving the editor with unsaved edits. There is no "are you sure?" — the
   * draft is kept in session storage and the card keeps its "Modified" badge —
   * but silence would read as "my edits are gone", so the toast says what
   * happened (plan §4.1). Only the browser leaving the PAGE is worth a blocking
   * prompt; that is `useUnsavedChangesGuard`.
   */
  const leaveEditor = useCallback(() => {
    if (selectedId !== null && studio.dirtyTemplateIds.has(selectedId)) toast(DRAFT_KEPT_MESSAGE)
    onBackToLibrary()
  }, [selectedId, studio.dirtyTemplateIds, onBackToLibrary])

  if (selectedId === null) {
    return (
      <TemplateLibraryPage
        templates={templates}
        dirtyIds={studio.dirtyTemplateIds}
        onOpenTemplate={onOpenTemplate}
        onCreateTemplate={onCreateTemplate}
        onDeleteTemplate={onDeleteTemplate}
      />
    )
  }

  return (
    <StudioPage
      studio={studio}
      renderer={renderer}
      provider={provider}
      writes={writes}
      onOpenTemplate={onOpenTemplate}
      onDeleteTemplate={onDeleteTemplate}
      onReloadLibrary={reloadLibrary}
      onBackToLibrary={leaveEditor}
      onListVersions={onListVersions}
      onRenderTime={onRenderTime}
    />
  )
}

/** Three card outlines: the same shape the real grid will have, so nothing jumps. */
function LibrarySkeleton() {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 py-6" role="status" aria-label="Loading templates">
      <Skeleton className="mb-4 h-7 w-40" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-40 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}

/**
 * Why the list is not there, in the words that fit the reason.
 *
 * Three of the failures deserve their own screen: an expired session is not an
 * error to retry but a sign-in to redo, a database that is not bound is a
 * deployment problem rather than a network hiccup, and everything else is the
 * general "it did not work, try again".
 */
function LibraryError({ failure, onRetry }: { failure: RepositoryFailure; onRetry: () => void }) {
  if (failure.code === 'unauthenticated') {
    return (
      <LibraryErrorShell title="Your session has ended">
        <span>Sign in again to carry on. Your drafts are still in this browser.</span>
        {/* A reload is what re-runs PasswordGate's probe, which is the one
            component that knows how this studio is gated. */}
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Sign in again
        </Button>
      </LibraryErrorShell>
    )
  }

  if (failure.code === 'storage-unavailable') {
    return (
      <LibraryErrorShell title="Template storage is unavailable">
        <span>
          No template database is bound to this server, so nothing can be listed or saved. Any draft you
          already have is kept in this browser.
        </span>
        <Button variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </LibraryErrorShell>
    )
  }

  return (
    <LibraryErrorShell title="Templates could not be loaded">
      <span>{failure.message}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Retry
      </Button>
    </LibraryErrorShell>
  )
}

function LibraryErrorShell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 py-6">
      <Alert variant="destructive">
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">{children}</AlertDescription>
      </Alert>
    </div>
  )
}
