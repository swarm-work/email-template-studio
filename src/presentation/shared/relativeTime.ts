/**
 * "3 days ago" from an ISO timestamp.
 *
 * Presentation layer: formatting only, no rules. `Intl.RelativeTimeFormat` is
 * built into the browser, so there is no date library here; all this function
 * does is pick the biggest unit that fits and let Intl write the sentence.
 */

/** Largest first: the first unit the difference fills is the one we use. */
const UNITS: readonly { readonly unit: Intl.RelativeTimeFormatUnit; readonly seconds: number }[] = [
  { unit: 'year', seconds: 60 * 60 * 24 * 365 },
  { unit: 'month', seconds: 60 * 60 * 24 * 30 },
  { unit: 'day', seconds: 60 * 60 * 24 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
]

const FORMAT = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

/** Formats `iso` relative to `now`. An unparseable timestamp gives '—'. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const seconds = (then - now.getTime()) / 1000
  for (const { unit, seconds: size } of UNITS) {
    if (Math.abs(seconds) >= size) return FORMAT.format(Math.round(seconds / size), unit)
  }
  return 'just now'
}
