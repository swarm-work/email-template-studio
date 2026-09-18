/**
 * One template in the library grid.
 *
 * Presentation layer: a button that opens a template, plus the chips that say
 * what it is. No rules live here — "is this template modified" is decided by
 * the studio reducer and arrives as a boolean.
 */
import { FileCode2, MousePointerClick } from 'lucide-react'
import { fileNameFor, type EmailTemplate, type TemplateId, type TemplateStatus } from '@/domain'
import { StatusBadge, type StatusTone } from '@/presentation/shared/StatusBadge'
import { templateKindLabel } from '@/presentation/shared/templateKind'
import { relativeTime } from '@/presentation/shared/relativeTime'

export interface TemplateCardProps {
  template: EmailTemplate
  /** The template has unsaved edits kept in this browser session. */
  dirty: boolean
  onOpen: (id: TemplateId) => void
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

export function TemplateCard({ template, dirty, onOpen }: TemplateCardProps) {
  const { metadata } = template
  return (
    <button
      type="button"
      // The card opens a template; it is not a selection that stays switched
      // on, so it carries no aria-pressed. The name says what it does.
      aria-label={`Open ${metadata.name}`}
      onClick={() => onOpen(metadata.id)}
      className="bg-card hover:border-foreground/30 focus-visible:ring-ring/50 flex h-full w-full flex-col gap-3 rounded-lg border p-4 text-left transition-[border-color,box-shadow] duration-150 outline-none focus-visible:ring-3 motion-reduce:transition-none"
    >
      <div className="flex min-w-0 items-start gap-2">
        <span
          className="text-muted-foreground bg-muted flex size-7 shrink-0 items-center justify-center rounded-md border"
          aria-hidden="true"
        >
          {template.kind === 'visual' ? (
            <MousePointerClick className="size-4" />
          ) : (
            <FileCode2 className="size-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{metadata.name}</p>
          <p className="text-muted-foreground truncate font-mono text-[11px]">
            {fileNameFor(template.kind, metadata.slug)}
          </p>
        </div>
        <StatusBadge tone={statusTone[metadata.status]}>{statusLabel[metadata.status]}</StatusBadge>
      </div>

      <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">{metadata.description}</p>

      <div className="mt-auto flex min-w-0 flex-wrap items-center gap-1.5">
        <StatusBadge tone="neutral" dot={false}>
          {templateKindLabel(template.kind)}
        </StatusBadge>
        <StatusBadge tone="neutral" dot={false} className="capitalize">
          {metadata.category}
        </StatusBadge>
        <StatusBadge tone="neutral" dot={false} className="font-mono tabular-nums">
          {metadata.version.label}
        </StatusBadge>
        {dirty ? <StatusBadge tone="warning">Modified</StatusBadge> : null}
        <span className="text-muted-foreground ml-auto truncate text-[11px]">
          Updated {relativeTime(metadata.updatedAt)}
        </span>
      </div>
    </button>
  )
}
