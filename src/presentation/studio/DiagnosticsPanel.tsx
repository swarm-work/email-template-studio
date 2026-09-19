import { useId } from 'react'
import { ChevronDown } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { isRealCheck, type DiagnosticItem } from '@/domain'
import { StatusBadge, StatusDot } from '@/presentation/shared/StatusBadge'
import { labelForDiagnostic, toneForDiagnostic } from '@/presentation/shared/diagnosticPresentation'

export interface DiagnosticsPanelProps {
  items: readonly DiagnosticItem[]
}

export function DiagnosticsPanel({ items }: DiagnosticsPanelProps) {
  // The panel is on screen twice at once — the code rail and the preview both
  // carry one — so the heading's id has to be unique per instance, or both
  // regions would end up named by whichever heading comes first in the document.
  const headingId = useId()
  const checks = items.filter((item) => isRealCheck(item.state))
  const placeholders = items.filter((item) => !isRealCheck(item.state))
  const errors = checks.filter((item) => item.state === 'error').length
  const warnings = checks.filter((item) => item.state === 'warning').length

  return (
    <section aria-labelledby={headingId} className="bg-card overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <h2 id={headingId} className="text-xs font-medium">
          Diagnostics
        </h2>
        {errors > 0 ? (
          <StatusBadge tone="danger">
            {errors} {errors === 1 ? 'error' : 'errors'}
          </StatusBadge>
        ) : warnings > 0 ? (
          <StatusBadge tone="warning">
            {warnings} {warnings === 1 ? 'warning' : 'warnings'}
          </StatusBadge>
        ) : (
          <StatusBadge tone="success">All checks pass</StatusBadge>
        )}
      </div>
      <ul role="list" className="divide-y">
        {checks.map((item) => (
          <DiagnosticRow key={item.id} item={item} />
        ))}
      </ul>
      <Collapsible>
        <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-full items-center gap-2 border-t px-3 py-2 text-xs transition-colors [&[data-state=open]>svg]:rotate-180">
          <span className="meta-label">Deliverability · not connected</span>
          <ChevronDown
            className="ml-auto size-3.5 transition-transform motion-reduce:transition-none"
            aria-hidden="true"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="text-muted-foreground border-t px-3 py-2 text-[11px]">
            These checks are placeholders. The studio does not inspect DNS, spam scores or links yet, and
            never claims that it does.
          </p>
          <ul role="list" className="divide-y border-t">
            {placeholders.map((item) => (
              <DiagnosticRow key={item.id} item={item} />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}

function DiagnosticRow({ item }: { item: DiagnosticItem }) {
  const tone = toneForDiagnostic(item.state)
  return (
    <li className="flex items-start gap-3 px-3 py-2">
      <StatusDot tone={tone} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">{item.label}</span>
          <StatusBadge tone={tone} dot={false}>
            {labelForDiagnostic(item.state)}
          </StatusBadge>
        </div>
        <p className="text-muted-foreground mt-0.5 text-[11px] break-words">{item.detail}</p>
      </div>
    </li>
  )
}
