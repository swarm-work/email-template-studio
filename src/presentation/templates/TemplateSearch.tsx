/**
 * The library's search field.
 *
 * Presentation layer: a controlled input and nothing else. Which templates the
 * text matches is decided by `application/filterTemplates.ts`.
 */
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

export interface TemplateSearchProps {
  value: string
  onChange: (value: string) => void
}

export function TemplateSearch({ value, onChange }: TemplateSearchProps) {
  return (
    <div className="relative min-w-0 sm:w-64">
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
        aria-hidden="true"
      />
      <Input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Search templates"
        placeholder="Search templates…"
        className="h-8 pl-8 text-sm"
      />
    </div>
  )
}
