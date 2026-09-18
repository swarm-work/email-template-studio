/**
 * The grid the library cards sit in.
 *
 * Presentation layer: layout only. It is its own component so the card and the
 * page can be read separately, and so the column rules live in one place.
 */
import type { EmailTemplate, TemplateId } from '@/domain'
import { TemplateCard } from './TemplateCard'

export interface TemplateGridProps {
  templates: readonly EmailTemplate[]
  dirtyIds: ReadonlySet<TemplateId>
  onOpenTemplate: (id: TemplateId) => void
}

export function TemplateGrid({ templates, dirtyIds, onOpenTemplate }: TemplateGridProps) {
  return (
    // Tailwind's grid-cols-N is repeat(N, minmax(0, 1fr)), not a bare 1fr: a
    // bare 1fr track refuses to shrink below its content, which is how one long
    // file name widens the whole page. The min-w-0 on each cell finishes the job.
    <ul role="list" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {templates.map((template) => (
        <li key={template.metadata.id} className="min-w-0">
          <TemplateCard
            template={template}
            dirty={dirtyIds.has(template.metadata.id)}
            onOpen={onOpenTemplate}
          />
        </li>
      ))}
    </ul>
  )
}
