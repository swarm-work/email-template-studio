/**
 * The library's search box, as a pure function.
 *
 * Application layer: no React, no DOM, no Zod — just "which templates match
 * what was typed", so the rule can be unit tested and the component that calls
 * it stays a component.
 */
import type { TemplateRecord } from '@/domain'

/**
 * Lower-cases and strips accents, so "Rétention" and "retention" are the same
 * word. NFKD splits an accented letter into letter + combining mark, and the
 * replace then throws the marks away — U+0300–U+036F is the Unicode block that
 * holds them, written as escapes because the characters themselves are invisible.
 */
function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/** Everything about a template that search looks at, as one lower-case string. */
function haystack(record: TemplateRecord): string {
  const { name, slug, description, category, tags } = record.metadata
  return normalize([name, slug, description, category, ...tags].join(' '))
}

/**
 * Templates matching `query`. An empty query matches everything. A query with
 * several words matches only templates that contain **all** of them, in any
 * order and in any field: typing "billing invoice" narrows rather than widens.
 */
export function filterTemplates<T extends TemplateRecord>(
  templates: readonly T[],
  query: string,
): readonly T[] {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return templates
  return templates.filter((template) => {
    const text = haystack(template)
    return words.every((word) => text.includes(word))
  })
}
