/**
 * Reads, remembers and applies the studio's colour theme.
 *
 * Presentation layer: this is the one module that touches `documentElement`,
 * `localStorage` and `matchMedia`. The rules it follows (what a stored value
 * means, what 'system' resolves to) are pure functions in `../layout/theme.ts`.
 *
 * It does NOT touch the email: `.studio-sheet` and the preview document pin
 * themselves to `color-scheme: light`, because a dark app is not a dark email.
 *
 * The very first paint is set by the inline script in `index.html`; this hook
 * cannot run that early. `themeBootstrap.test.ts` keeps the two in step.
 */
import { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import {
  parseThemePreference,
  resolveTheme,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from '@/presentation/layout/theme'

/** The media query the operating system answers when the preference is 'system'. */
const DARK_QUERY = '(prefers-color-scheme: dark)'

export interface UseThemeResult {
  /** What the person chose, including 'system'. */
  readonly preference: ThemePreference
  /** What is on screen right now. */
  readonly resolved: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
}

/**
 * Every access to `localStorage` is wrapped: a private window, a browser with
 * site data blocked, or an iframe with third-party storage off all THROW on
 * the property access itself, and a theme toggle is not worth a broken page.
 */
function readStoredPreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

function writeStoredPreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Nothing to do and nothing to say: the choice still applies to this tab.
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches
}

/**
 * Puts `.dark` on `<html>` and keeps `<meta name="color-scheme">` in step, so
 * the browser draws its own furniture (scrollbars, form controls, the canvas
 * behind the page) in the same theme as the app.
 */
function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle('dark', resolved === 'dark')
  let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]')
  if (meta === null) {
    meta = document.createElement('meta')
    meta.name = 'color-scheme'
    document.head.append(meta)
  }
  meta.content = resolved
}

export function useTheme(): UseThemeResult {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference)
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark)

  // The operating system can change while the studio is open (a schedule, or
  // somebody flipping the setting), and 'system' has to follow it live.
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(DARK_QUERY)
    const onChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const resolved = resolveTheme(preference, prefersDark)

  // A layout effect, not a plain one: it runs before the browser paints, so
  // choosing a theme never shows a frame of the old palette. The FIRST paint is
  // not this hook's to win -- the bundle has not loaded yet -- and is handled by
  // the inline bootstrap in `index.html`, which this effect then keeps in step.
  useLayoutEffect(() => {
    applyTheme(resolved)
  }, [resolved])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    writeStoredPreference(next)
  }, [])

  return { preference, resolved, setPreference }
}
