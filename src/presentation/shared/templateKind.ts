/**
 * How a template's kind is written in the UI.
 *
 * Presentation layer: labels only, no rules. These are the words on the library
 * card's chip; the kind itself ('code' | 'visual') is what the API and the
 * database use.
 */
import type { TemplateKind } from '@/domain'

const KIND_LABELS: Readonly<Record<TemplateKind, string>> = {
  code: 'Code',
  visual: 'Visual',
}

/** Short chip label for a template kind. */
export function templateKindLabel(kind: TemplateKind): string {
  return KIND_LABELS[kind]
}
