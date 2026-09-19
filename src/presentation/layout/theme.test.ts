import { describe, expect, it } from 'vitest'
import { parseThemePreference, resolveTheme, THEME_PREFERENCES } from './theme'

describe('parseThemePreference', () => {
  it('accepts the three known values', () => {
    for (const preference of THEME_PREFERENCES) {
      expect(parseThemePreference(preference)).toBe(preference)
    }
  })

  it('falls back to system for anything else', () => {
    // localStorage can hold whatever an older build (or a person) put there.
    expect(parseThemePreference(null)).toBe('system')
    expect(parseThemePreference('DARK')).toBe('system')
    expect(parseThemePreference(42)).toBe('system')
  })
})

describe('resolveTheme', () => {
  it('lets an explicit choice win over the operating system', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows the operating system when the preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})
