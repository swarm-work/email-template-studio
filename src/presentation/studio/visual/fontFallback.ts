/**
 * What a font stack falls back to in a mail client, as data.
 *
 * Presentation layer: two small pure functions behind the inspector's
 * "Client-safe typography" note. No React, no DOM.
 *
 * Why it reads the STACK rather than a table of stacks: the note has to be
 * TRUE. A hard-coded reassurance would keep saying "falls back safely" after
 * somebody changed the theme (docs/DESIGN.md: honesty rules) — and so would a
 * table keyed only on the first family, because the fallbacks are the part
 * that actually has to exist on the reader's machine.
 */

export type FontFallback =
  | {
      /** Every fallback in the stack is a face the studio has checked. */
      readonly kind: 'known'
      readonly family: string
      /** The fallbacks, exactly as the stack names them. */
      readonly fallbacks: readonly string[]
    }
  | {
      /** The stack ends somewhere the studio cannot vouch for. */
      readonly kind: 'unknown'
      readonly family: string
      /** The fallbacks that are not on the checked list; may be empty. */
      readonly unchecked: readonly string[]
    }

/** Every family in a CSS font stack, in order, unquoted and trimmed. */
export function familiesIn(stack: string): string[] {
  return stack
    .split(',')
    .map((family) => family.trim().replace(/^['"]|['"]$/g, ''))
    .filter((family) => family !== '')
}

/**
 * The first family in a CSS font stack, unquoted. `getComputedStyle` and the
 * editor's theme both hand back whole stacks, and the name people recognise is
 * the first one.
 */
export function primaryFamily(stack: string): string {
  return familiesIn(stack)[0] ?? ''
}

/**
 * CSS keywords rather than faces. They are a perfectly good last entry, but
 * they name no particular typeface, so the note does not list them.
 */
const GENERIC_FAMILIES = new Set([
  'sans-serif',
  'serif',
  'monospace',
  'cursive',
  'fantasy',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
])

/**
 * The faces the studio has checked: each one ships with Windows or macOS, so a
 * mail client that has never heard of the primary family still has something
 * of the right shape to fall back to. Anything outside this list downgrades
 * the note to its warning variant.
 */
const CHECKED_FALLBACKS = new Set([
  '-apple-system',
  'blinkmacsystemfont',
  'segoe ui',
  'helvetica',
  'helvetica neue',
  'arial',
  'verdana',
  'tahoma',
  'trebuchet ms',
  'georgia',
  'times new roman',
  'courier new',
  'consolas',
  'sf mono',
  'menlo',
])

/** What the note should say about this stack. */
export function fontFallbackFor(stack: string): FontFallback {
  const [family = '', ...rest] = familiesIn(stack)
  const fallbacks = rest.filter((name) => !GENERIC_FAMILIES.has(name.toLowerCase()))
  const unchecked = fallbacks.filter((name) => !CHECKED_FALLBACKS.has(name.toLowerCase()))
  // No named fallback at all is its own kind of risk: the client is left to
  // pick whatever its generic keyword means, which is often Times.
  if (fallbacks.length === 0 || unchecked.length > 0) return { kind: 'unknown', family, unchecked }
  return { kind: 'known', family, fallbacks }
}

/** The note's sentence, built from the same data the variant is chosen from. */
export function fontFallbackSentence(fallback: FontFallback): string {
  if (fallback.kind === 'unknown') {
    if (fallback.unchecked.length === 0) {
      return `${fallback.family} has no named fallback after it. Mail clients that do not have it choose their own replacement.`
    }
    return `${fallback.family} falls back to ${prose(fallback.unchecked)}, which the studio has not checked. Mail clients that do not have them choose their own replacement.`
  }
  return `${fallback.family} will fall back to ${prose(fallback.fallbacks)} on Outlook desktop without layout jitter.`
}

/** "a, b and c" — the list as a person would read it out. */
function prose(names: readonly string[]): string {
  const [last, ...rest] = [...names].reverse()
  return rest.length === 0 ? (last ?? '') : `${rest.reverse().join(', ')} and ${last}`
}
