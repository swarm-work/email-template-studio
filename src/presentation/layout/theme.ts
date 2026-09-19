/**
 * Which colour theme the studio draws itself in.
 *
 * Presentation layer, and pure: the three values the toggle offers, how a
 * stored value is read back, and how a preference plus the operating system's
 * setting become the one theme that is applied. No React, no DOM — `useTheme`
 * does all of that.
 */

/** What the person chose. 'system' means "follow the operating system". */
export type ThemePreference = 'system' | 'light' | 'dark'

/** What is actually drawn once 'system' has been resolved. */
export type ResolvedTheme = 'light' | 'dark'

/** In the order the toggle draws them; 'system' first because it is the default. */
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark']

/**
 * Where the choice is kept. `localStorage`, not `sessionStorage`: a theme is a
 * setting about this browser, not a draft of this tab's work (which is what
 * `email-template-studio:v1` in session storage holds).
 */
export const THEME_STORAGE_KEY = 'email-template-studio:theme'

/** Anything that is not one of the three values reads back as 'system'. */
export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

/** The theme to draw: an explicit choice wins, 'system' asks the operating system. */
export function resolveTheme(preference: ThemePreference, prefersDark: boolean): ResolvedTheme {
  if (preference === 'light') return 'light'
  if (preference === 'dark') return 'dark'
  return prefersDark ? 'dark' : 'light'
}

/** The accessible name of each option in the toggle. */
export const THEME_LABELS: Readonly<Record<ThemePreference, string>> = {
  system: 'System theme',
  light: 'Light theme',
  dark: 'Dark theme',
}
