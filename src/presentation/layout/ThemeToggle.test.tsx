// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { THEME_STORAGE_KEY } from './theme'
import { ThemeToggle } from './ThemeToggle'

/** The `change` handlers `useTheme` registered, so a test can play the OS. */
const listeners = new Set<(event: { matches: boolean }) => void>()

/**
 * jsdom has no `matchMedia`, so every test installs one. `prefersDark` is what
 * the fake operating system answers; the handlers are kept so a test can flip
 * the setting afterwards, which is the branch `System` lives on.
 */
function stubMatchMedia(prefersDark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: prefersDark,
      addEventListener: (_type: string, handler: (event: { matches: boolean }) => void) =>
        listeners.add(handler),
      removeEventListener: (_type: string, handler: (event: { matches: boolean }) => void) =>
        listeners.delete(handler),
    })),
  )
}

beforeEach(() => {
  listeners.clear()
  window.localStorage.clear()
  document.documentElement.classList.remove('dark')
  stubMatchMedia(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ThemeToggle', () => {
  it('offers three options and starts on System', () => {
    render(<ThemeToggle />)

    const group = screen.getByRole('radiogroup', { name: 'Colour theme' })
    expect(group).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'System theme' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getAllByRole('radio')).toHaveLength(3)
  })

  it('puts .dark on the document and remembers the choice', async () => {
    render(<ThemeToggle />)

    await userEvent.click(screen.getByRole('radio', { name: 'Dark theme' }))

    expect(document.documentElement).toHaveClass('dark')
    expect(document.querySelector('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')

    await userEvent.click(screen.getByRole('radio', { name: 'Light theme' }))
    expect(document.documentElement).not.toHaveClass('dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('follows the operating system while the preference is System', () => {
    stubMatchMedia(true)
    render(<ThemeToggle />)

    expect(screen.getByRole('radio', { name: 'System theme' })).toHaveAttribute('aria-checked', 'true')
    expect(document.documentElement).toHaveClass('dark')
  })

  it('follows the operating system LIVE, and lets go of it on unmount', () => {
    const { unmount } = render(<ThemeToggle />)
    expect(document.documentElement).not.toHaveClass('dark')

    // Somebody flips the machine to dark (or a schedule does it at sunset)
    // while the studio is open, and the preference is still System.
    act(() => {
      for (const listener of listeners) listener({ matches: true })
    })
    expect(document.documentElement).toHaveClass('dark')

    act(() => {
      for (const listener of listeners) listener({ matches: false })
    })
    expect(document.documentElement).not.toHaveClass('dark')

    // A subscription nobody removes is a listener calling setState on an
    // unmounted tree, which React reports as an error in the console.
    unmount()
    expect(listeners.size).toBe(0)
  })

  it('still renders when localStorage throws (a private window)', async () => {
    const storage = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('access denied')
    })

    render(<ThemeToggle />)
    await userEvent.click(screen.getByRole('radio', { name: 'Dark theme' }))
    expect(document.documentElement).toHaveClass('dark')

    storage.mockRestore()
    setItem.mockRestore()
  })
})
