import { describe, expect, it } from 'vitest'
import { byteLength, formatBytes, GMAIL_CLIPPING_LIMIT_BYTES, isOverGmailLimit } from './formatBytes'

describe('byteLength', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(byteLength('')).toBe(0)
    expect(byteLength('abc')).toBe(3)
    // One character, three bytes: this is why the status bar cannot use .length.
    expect(byteLength('€')).toBe(3)
  })
})

describe('formatBytes', () => {
  it('uses bytes below a kilobyte and one decimal place above it', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(812)).toBe('812 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(14_540)).toBe('14.2 KB')
    expect(formatBytes(2 * 1024 * 1024)).toBe('2 MB')
  })
})

describe('isOverGmailLimit', () => {
  it('is the 102 KB clipping threshold, exclusive', () => {
    expect(GMAIL_CLIPPING_LIMIT_BYTES).toBe(104_448)
    expect(isOverGmailLimit(GMAIL_CLIPPING_LIMIT_BYTES)).toBe(false)
    expect(isOverGmailLimit(GMAIL_CLIPPING_LIMIT_BYTES + 1)).toBe(true)
  })
})
