// @vitest-environment jsdom
/**
 * The inline script in `index.html` is a hand-written copy of `resolveTheme`,
 * because nothing from the bundle can run before the first paint. A copy drifts
 * unless something compares it with the original, so this test lifts the script
 * out of `index.html` and runs the real thing against the real rule.
 */
import { afterEach, describe, expect, it } from 'vitest'
// Vite's `?raw` rather than `node:fs`: this file runs in the jsdom environment,
// which is the browser program - it has no Node types and no `process.cwd()`.
import indexHtml from '../../../index.html?raw'
import { resolveTheme, THEME_PREFERENCES, THEME_STORAGE_KEY } from './theme'

/** The one inline `<script>` in the document head. */
const BOOTSTRAP = indexHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? ''

const realMatchMedia = window.matchMedia

afterEach(() => {
  window.matchMedia = realMatchMedia
  window.localStorage.clear()
})

/** A fresh document head, the way the browser hands one to the script. */
function resetDocument() {
  document.documentElement.className = ''
  document.head.innerHTML = '<meta name="color-scheme" content="light" />'
}

/** Runs the script the way a browser would, with a chosen preference and OS setting. */
function runBootstrap(stored: string | null, prefersDark: boolean) {
  resetDocument()
  window.localStorage.clear()
  if (stored !== null) window.localStorage.setItem(THEME_STORAGE_KEY, stored)
  window.matchMedia = (() => ({ matches: prefersDark })) as unknown as typeof window.matchMedia

  new Function(BOOTSTRAP)()

  return {
    dark: document.documentElement.classList.contains('dark'),
    colourScheme: document.querySelector('meta[name="color-scheme"]')?.getAttribute('content'),
  }
}

describe('the index.html theme bootstrap', () => {
  it('exists, and reads the same storage key the app writes', () => {
    expect(BOOTSTRAP).not.toBe('')
    expect(BOOTSTRAP).toContain(THEME_STORAGE_KEY)
  })

  it.each(
    THEME_PREFERENCES.flatMap((preference) =>
      [true, false].map((prefersDark) => [preference, prefersDark] as const),
    ),
  )('resolves %s with prefers-dark=%s the way resolveTheme does', (preference, prefersDark) => {
    const expected = resolveTheme(preference, prefersDark) === 'dark'

    expect(runBootstrap(preference, prefersDark).dark).toBe(expected)
  })

  it('treats an absent or unknown value as system, like parseThemePreference', () => {
    expect(runBootstrap(null, true).dark).toBe(true)
    expect(runBootstrap('DARK', false).dark).toBe(false)
  })

  it('pins the browser furniture to the same theme', () => {
    expect(runBootstrap('dark', false).colourScheme).toBe('dark')
    expect(runBootstrap('light', true).colourScheme).toBe('light')
  })

  it('survives a browser that refuses storage', () => {
    resetDocument()
    const real = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('storage is blocked')
      },
    })

    try {
      // A private window throws on the property access itself, which is why the
      // script's try/catch wraps the read rather than just the parse.
      expect(() => new Function(BOOTSTRAP)()).not.toThrow()
      expect(document.documentElement.classList.contains('dark')).toBe(false)
    } finally {
      // Hand the real storage back to the other tests.
      if (real !== undefined) Object.defineProperty(window, 'localStorage', real)
    }
  })
})
