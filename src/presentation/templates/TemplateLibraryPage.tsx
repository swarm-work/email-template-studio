/**
 * The template library: the screen the studio lands on.
 *
 * Presentation layer: it composes the header, the search field and the grid,
 * and owns what is on screen — the search text and which dialog is open. The
 * matching itself is `application/filterTemplates.ts`, and the writes belong to
 * the route above (it is the one holding the repository).
 */
import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { filterTemplates } from '@/application/filterTemplates'
import type {
  NewTemplateInput,
  RepositoryFailure,
  VersionInput,
} from '@/application/repositories/templateRepository'
import type { EmailTemplate, TemplateId } from '@/domain'
import { CreateTemplateDialog } from './CreateTemplateDialog'
import { DeleteTemplateDialog } from './DeleteTemplateDialog'
import { EmptyLibrary } from './EmptyLibrary'
import { TemplateGrid } from './TemplateGrid'
import { TemplateSearch } from './TemplateSearch'

export interface TemplateLibraryPageProps {
  templates: readonly EmailTemplate[]
  /** Templates with unsaved edits in this browser session; they get a "Modified" badge. */
  dirtyIds: ReadonlySet<TemplateId>
  onOpenTemplate: (id: TemplateId) => void
  /** Creates a template. Resolves with the failure, or null when it worked. */
  onCreateTemplate: (
    input: NewTemplateInput & { readonly initialVersion: VersionInput },
  ) => Promise<RepositoryFailure | null>
  /** Deletes a template and refreshes the list. */
  onDeleteTemplate: (id: TemplateId) => Promise<void>
}

export function TemplateLibraryPage({
  templates,
  dirtyIds,
  onOpenTemplate,
  onCreateTemplate,
  onDeleteTemplate,
}: TemplateLibraryPageProps) {
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  // Which template the delete dialog is asking about; null before it is opened.
  const [deleting, setDeleting] = useState<EmailTemplate | null>(null)
  const visible = useMemo(() => filterTemplates(templates, query), [templates, query])

  return (
    <section
      aria-label="Template library"
      className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-6 py-6"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Templates</h1>
        <span className="text-muted-foreground text-sm tabular-nums">
          {templates.length === 1 ? '1 template' : `${templates.length} templates`}
        </span>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          <TemplateSearch value={query} onChange={setQuery} />
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" />
            New template
          </Button>
        </div>
      </div>

      {templates.length === 0 ? (
        <EmptyLibrary />
      ) : visible.length === 0 ? (
        <NoResults query={query} onClear={() => setQuery('')} />
      ) : (
        <TemplateGrid
          templates={visible}
          dirtyIds={dirtyIds}
          onOpenTemplate={onOpenTemplate}
          onDeleteTemplate={setDeleting}
        />
      )}

      <CreateTemplateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        templates={templates}
        onCreate={async (input) => {
          const failure = await onCreateTemplate(input)
          // Only close on success: a slug clash is shown as a field error and
          // the person keeps the name they typed.
          if (failure === null) setCreateOpen(false)
          return failure
        }}
      />
      <DeleteTemplateDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        template={deleting}
        onDelete={async () => {
          if (!deleting) return
          await onDeleteTemplate(deleting.metadata.id)
          setDeleting(null)
        }}
      />
    </section>
  )
}

/** Shown when the library has templates but the search matches none of them. */
function NoResults({ query, onClear }: { query: string; onClear: () => void }) {
  return (
    <div className="bg-card flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-16 text-center">
      <p className="text-sm font-medium">{`No templates match "${query}".`}</p>
      <Button variant="outline" size="sm" onClick={onClear}>
        Clear search
      </Button>
    </div>
  )
}
