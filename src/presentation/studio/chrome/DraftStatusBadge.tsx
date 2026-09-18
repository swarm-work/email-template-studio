/**
 * "Ready · Unsaved changes" / "Draft · Saved" in the studio sub-header.
 *
 * Presentation layer: it renders one status and one boolean. Whether a template
 * is dirty is decided by the reducer (`application/studioState.ts`), and the
 * status word comes from the same helper the status bar uses, never from a
 * literal — two starters ship as "ready", and a hardcoded "Draft" here made the
 * sub-header contradict the bar at the bottom of the same screen.
 */
import type { TemplateStatus } from '@/domain'
import { StatusBadge } from '@/presentation/shared/StatusBadge'
import { templateStatusLabel } from '@/presentation/shared/templateStatus'

export interface DraftStatusBadgeProps {
  /** The saved status of the template, as stored on its metadata. */
  status: TemplateStatus
  /** True when the draft differs from the saved template in any way. */
  dirty: boolean
}

export function DraftStatusBadge({ status, dirty }: DraftStatusBadgeProps) {
  return (
    <StatusBadge tone={dirty ? 'warning' : 'neutral'}>
      {templateStatusLabel(status)} · {dirty ? 'Unsaved changes' : 'Saved'}
    </StatusBadge>
  )
}
