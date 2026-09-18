/**
 * The template library: the screen the studio lands on.
 *
 * Presentation layer: it composes the header, the search field and the grid,
 * and owns exactly one piece of state — what has been typed into search. The
 * matching itself is `application/filterTemplates.ts`.
 */
import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { filterTemplates } from '@/application/filterTemplates'
import type { EmailTemplate, TemplateId } from '@/domain'
import { ReasonedButton } from '@/presentation/shared/ReasonedButton'
import { EmptyLibrary } from './EmptyLibrary'
import { TemplateGrid } from './TemplateGrid'
import { TemplateSearch } from './TemplateSearch'

export interface TemplateLibraryPageProps {
  templates: readonly EmailTemplate[]
  /** Templates with unsaved edits in this browser session; they get a "Modified" badge. */
  dirtyIds: ReadonlySet<TemplateId>
  onOpenTemplate: (id: TemplateId) => void
}

/** Creating a template needs somewhere to save it, which is phase 7b's job. */
const NEW_TEMPLATE_REASON = 'Coming with saved templates.'

export function TemplateLibraryPage({ templates, dirtyIds, onOpenTemplate }: TemplateLibraryPageProps) {
  const [query, setQuery] = useState('')
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
          <ReasonedButton size="sm" reason={NEW_TEMPLATE_REASON}>
            <Plus aria-hidden="true" />
            New template
          </ReasonedButton>
        </div>
      </div>

      {templates.length === 0 ? (
        <EmptyLibrary />
      ) : visible.length === 0 ? (
        <NoResults query={query} onClear={() => setQuery('')} />
      ) : (
        <TemplateGrid templates={visible} dirtyIds={dirtyIds} onOpenTemplate={onOpenTemplate} />
      )}
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
