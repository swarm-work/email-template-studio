import { Check, FileCode2 } from 'lucide-react'
import { fileNameFor, type EmailTemplate, type TemplateId, type TemplateStatus } from '@/domain'
import { StatusBadge, type StatusTone } from '@/presentation/shared/StatusBadge'
import { templateKindLabel } from '@/presentation/shared/templateKind'
import { cn } from '@/lib/utils'

export interface TemplateLibraryProps {
  templates: readonly EmailTemplate[]
  selectedId: TemplateId
  dirtyIds: ReadonlySet<TemplateId>
  onSelect: (id: TemplateId) => void
}

const statusTone: Record<TemplateStatus, StatusTone> = {
  ready: 'success',
  draft: 'neutral',
  deprecated: 'warning',
}
const statusLabel: Record<TemplateStatus, string> = {
  ready: 'Ready',
  draft: 'Draft',
  deprecated: 'Deprecated',
}

export function TemplateLibrary({ templates, selectedId, dirtyIds, onSelect }: TemplateLibraryProps) {
  return (
    <section aria-labelledby="library-heading" className="space-y-3">
      <div className="flex items-baseline gap-3">
        <h2 id="library-heading" className="text-sm font-semibold tracking-tight">
          Template library
        </h2>
        <span className="text-muted-foreground text-xs">
          {templates.length} local templates · edits are kept per template for this browser session
        </span>
      </div>
      <ul role="list" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {templates.map((template) => {
          const { metadata } = template
          const selected = metadata.id === selectedId
          const dirty = dirtyIds.has(metadata.id)
          return (
            <li key={metadata.id}>
              <button
                type="button"
                onClick={() => onSelect(metadata.id)}
                aria-pressed={selected}
                className={cn(
                  'bg-card group flex h-full w-full flex-col gap-3 rounded-lg border p-4 text-left transition-[border-color,box-shadow] duration-150 outline-none motion-reduce:transition-none',
                  'hover:border-foreground/30 focus-visible:ring-ring/50 focus-visible:ring-3',
                  selected && 'border-primary ring-primary ring-1',
                )}
              >
                <div className="flex items-start gap-2">
                  <span
                    className={cn(
                      'flex size-7 shrink-0 items-center justify-center rounded-md border',
                      selected
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'text-muted-foreground bg-muted',
                    )}
                    aria-hidden="true"
                  >
                    {selected ? <Check className="size-4" /> : <FileCode2 className="size-4" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{metadata.name}</p>
                    <p className="text-muted-foreground truncate font-mono text-[11px]">
                      {fileNameFor(template.kind, metadata.slug)}
                    </p>
                  </div>
                  <StatusBadge tone={statusTone[metadata.status]}>{statusLabel[metadata.status]}</StatusBadge>
                </div>
                <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
                  {metadata.description}
                </p>
                <div className="mt-auto flex flex-wrap items-center gap-1.5">
                  <StatusBadge tone="neutral" dot={false} className="capitalize">
                    {metadata.category}
                  </StatusBadge>
                  <StatusBadge tone="neutral" dot={false} className="font-mono">
                    {metadata.version.label}
                  </StatusBadge>
                  <StatusBadge tone="neutral" dot={false} className="font-mono">
                    {templateKindLabel(template.kind)}
                  </StatusBadge>
                  {dirty ? <StatusBadge tone="warning">Modified</StatusBadge> : null}
                  <span className="text-muted-foreground ml-auto text-[11px]">
                    {selected ? 'Selected' : 'Select'}
                  </span>
                </div>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
