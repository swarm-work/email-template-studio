import { describe, expect, it } from 'vitest'
import { relativeTime } from './relativeTime'

const NOW = new Date('2026-09-18T12:00:00Z')

describe('relativeTime', () => {
  it('picks the biggest unit that fits', () => {
    expect(relativeTime('2026-09-18T11:59:30Z', NOW)).toBe('just now')
    expect(relativeTime('2026-09-18T11:30:00Z', NOW)).toBe('30 minutes ago')
    expect(relativeTime('2026-09-18T09:00:00Z', NOW)).toBe('3 hours ago')
    expect(relativeTime('2026-09-15T12:00:00Z', NOW)).toBe('3 days ago')
    // numeric: 'auto' is why this is not "1 year ago".
    expect(relativeTime('2025-09-18T12:00:00Z', NOW)).toBe('last year')
  })

  it('handles a timestamp in the future', () => {
    expect(relativeTime('2026-09-20T12:00:00Z', NOW)).toBe('in 2 days')
  })

  it('does not throw on a timestamp it cannot read', () => {
    expect(relativeTime('not a date', NOW)).toBe('—')
  })
})
