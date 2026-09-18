/**
 * "Templates / <name>" at the left of the studio sub-header.
 *
 * Presentation layer: no rules. It is both the page's heading and its way back
 * to the library, which is why the crumb is a real button rather than a link:
 * the app has no router yet, so navigation is a callback (see TemplatesRoute).
 */
import { Pencil } from 'lucide-react'
import { ReasonedButton } from '@/presentation/shared/ReasonedButton'

/** Renaming writes to the template record, which only exists once saving does. */
export const RENAME_REASON = 'Renaming arrives with saved templates.'

export interface TemplateBreadcrumbProps {
  name: string
  onBackToLibrary: () => void
}

export function TemplateBreadcrumb({ name, onBackToLibrary }: TemplateBreadcrumbProps) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={onBackToLibrary}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 shrink-0 rounded-md px-1 text-sm transition-colors focus-visible:ring-3 focus-visible:outline-none"
      >
        Templates
      </button>
      <span className="text-muted-foreground/60 shrink-0 text-sm" aria-hidden="true">
        /
      </span>
      <h1 className="max-w-[14ch] truncate text-sm font-semibold sm:max-w-[28ch] lg:max-w-none">{name}</h1>
      <ReasonedButton
        variant="ghost"
        size="icon-xs"
        reason={RENAME_REASON}
        aria-label="Rename template"
        className="text-muted-foreground shrink-0"
      >
        <Pencil aria-hidden="true" />
      </ReasonedButton>
    </div>
  )
}
