/**
 * How a template's status is written on screen.
 *
 * Presentation layer: one function, no rules. It lives on its own so the
 * sub-header badge and the status bar cannot disagree about the same field —
 * they used to hold two copies of this switch, and one of them said "Draft"
 * for every template.
 */
import type { TemplateStatus } from '@/domain'

/** 'draft' → "Draft". The label the studio shows for a stored status. */
export function templateStatusLabel(status: TemplateStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft'
    case 'ready':
      return 'Ready'
    case 'deprecated':
      return 'Deprecated'
  }
}
