/**
 * How a template's kind is written in the UI.
 *
 * Presentation layer: labels only, no rules. A code template is still shown as
 * "TSX" because that is what the person is editing; the kind itself ('code')
 * is the word the API and the database use.
 */
import type { TemplateKind } from '@/domain'

const KIND_LABELS: Readonly<Record<TemplateKind, string>> = {
  code: 'TSX',
  visual: 'Visual',
}

/** Short chip label for a template kind. */
export function templateKindLabel(kind: TemplateKind): string {
  return KIND_LABELS[kind]
}
