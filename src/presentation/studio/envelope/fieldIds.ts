/**
 * The ids that tie an envelope field's control to its hint and its error.
 *
 * Presentation layer: string building, no React and no validation. It lives
 * beside `EnvelopeField.tsx` rather than inside it so that the component file
 * exports only a component (fast-refresh keeps working, and oxlint stays quiet).
 */

/** The ids a control should be described by: its helper, and its error when there is one. */
export function describedBy(id: string, options: { helper?: boolean; error?: boolean }): string | undefined {
  const ids = [options.error ? `${id}-error` : null, options.helper ? `${id}-helper` : null].filter(
    (value): value is string => value !== null,
  )
  return ids.length === 0 ? undefined : ids.join(' ')
}
