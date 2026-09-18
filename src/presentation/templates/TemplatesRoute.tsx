/**
 * The templates screen: library or editor, and everything the two share.
 *
 * Presentation layer. It owns `StudioView`, which is this app's stand-in for a
 * router: `{kind:'library'}` mirrors the future `/templates` and
 * `{kind:'editor'}` mirrors `/templates/:id`. Nothing else reads that value —
 * children are handed `onOpenTemplate` / `onBackToLibrary` callbacks — so
 * swapping in a real router later touches only this file.
 */
import { useCallback, useEffect, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { EmailTemplate, TemplateId } from '@/domain'
import type { RepositoryFailure, TemplateRepository } from '@/application/repositories/templateRepository'
import type { EmailProvider } from '@/infrastructure/providers/emailProvider'
import type { TemplateRenderer } from '@/infrastructure/render/renderClient'
import type { StudioSessionStore } from '@/infrastructure/session/sessionStore'
import { useStudio } from '@/presentation/hooks/useStudio'
import { useTemplateLibrary } from '@/presentation/hooks/useTemplateLibrary'
import { StudioPage } from '@/presentation/studio/StudioPage'
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
  const backToLibrary = useCallback(() => setView({ kind: 'library' }), [])

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
    return <TemplateLibraryPage templates={[]} dirtyIds={EMPTY_IDS} onOpenTemplate={openTemplate} />
  }

  return (
    <TemplatesWorkspace
      templates={library.state.templates}
      selectedId={view.kind === 'editor' ? view.templateId : null}
      onOpenTemplate={openTemplate}
      onBackToLibrary={backToLibrary}
      renderer={renderer}
      store={store}
      provider={provider}
      onRenderTime={onRenderTime}
    />
  )
}

const EMPTY_IDS: ReadonlySet<TemplateId> = new Set()

interface TemplatesWorkspaceProps {
  templates: readonly EmailTemplate[]
  /** null while the library is showing. */
  selectedId: TemplateId | null
  onOpenTemplate: (id: TemplateId) => void
  onBackToLibrary: () => void
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
  renderer,
  store,
  provider,
  onRenderTime,
}: TemplatesWorkspaceProps) {
  const studio = useStudio({ templates, store, selectedId })

  if (selectedId === null) {
    return (
      <TemplateLibraryPage
        templates={templates}
        dirtyIds={studio.dirtyTemplateIds}
        onOpenTemplate={onOpenTemplate}
      />
    )
  }

  return (
    <StudioPage
      studio={studio}
      renderer={renderer}
      provider={provider}
      onBackToLibrary={onBackToLibrary}
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

function LibraryError({ failure, onRetry }: { failure: RepositoryFailure; onRetry: () => void }) {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 py-6">
      <Alert variant="destructive">
        <AlertTitle>Templates could not be loaded</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>{failure.message}</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    </div>
  )
}
