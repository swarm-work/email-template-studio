// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { THEME_STORAGE_KEY } from './theme'
import { AccountMenu, type AccountMenuProps } from './AccountMenu'

/** The `change` handlers `useTheme` registered, so a test can play the OS. */
const listeners = new Set<(event: { matches: boolean }) => void>()

/**
 * jsdom has no `matchMedia`, so every test installs one. `prefersDark` is what
 * the fake operating system answers; the handlers are kept so a test can flip
 * the setting afterwards, which is the branch an untouched preference lives on.
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

function renderMenu(props: Partial<AccountMenuProps> = {}) {
  return render(<AccountMenu workspaceName="meridian-platform" {...props} />)
}

/** Opens the menu from its avatar trigger and returns the dark-mode switch. */
async function openMenu(triggerName: RegExp = /^Signed in/) {
  await userEvent.click(screen.getByRole('button', { name: triggerName }))
  return screen.findByRole('menuitemcheckbox', { name: 'Dark mode' })
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

describe('AccountMenu identity', () => {
  it('names the workspace when nobody is signed in, as the avatar always has', async () => {
    renderMenu()
    const trigger = screen.getByRole('button', { name: 'Signed in to meridian-platform' })
    expect(trigger).toHaveTextContent('MP')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')

    await openMenu()
    expect(screen.getByRole('menu')).toHaveTextContent('meridian-platform')
  })

  it('names the PERSON once the API reports one, at the top of the menu', async () => {
    renderMenu({ signedInAs: 'jericho.delrosario@swarm.work' })
    const trigger = screen.getByRole('button', { name: 'Signed in as jericho.delrosario@swarm.work' })
    expect(trigger).toHaveTextContent('JD')

    await openMenu()
    expect(screen.getByRole('menu')).toHaveTextContent('Signed in asjericho.delrosario@swarm.work')
  })

  it('offers Sign out only when there is a session to end', async () => {
    const onSignOut = vi.fn()
    renderMenu({ signedInAs: 'echo@swarm.work', onSignOut })
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('has no Sign out in developer or password mode', async () => {
    // Cloudflare Access, the shared password and the developer identity all
    // land here: there is no session of the studio's own to end.
    renderMenu({ signedInAs: 'echo@swarm.work' })
    await openMenu()
    expect(screen.queryByRole('menuitem', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('reads the shared-password identity as initials too', () => {
    renderMenu({ signedInAs: 'shared-password' })
    expect(screen.getByRole('button', { name: 'Signed in as shared-password' })).toHaveTextContent('SP')
  })
})

describe('AccountMenu dark mode', () => {
  it('starts off, following a light operating system, and writes nothing', async () => {
    renderMenu()
    const toggle = await openMenu()
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull()
  })

  it('starts ON under a dark operating system before anyone has chosen', async () => {
    stubMatchMedia(true)
    renderMenu()
    expect(document.documentElement).toHaveClass('dark')
    expect(await openMenu()).toHaveAttribute('aria-checked', 'true')
  })

  it('puts .dark on the document, remembers the choice and keeps the menu open', async () => {
    renderMenu()
    await userEvent.click(await openMenu())

    expect(document.documentElement).toHaveClass('dark')
    expect(document.querySelector('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    // Still open, so the change can be seen and undone in place.
    const toggle = screen.getByRole('menuitemcheckbox', { name: 'Dark mode' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')

    await userEvent.click(toggle)
    expect(document.documentElement).not.toHaveClass('dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
  })

  it('reads a stored choice back, and it wins over the operating system', async () => {
    stubMatchMedia(true)
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light')
    renderMenu()
    expect(document.documentElement).not.toHaveClass('dark')
    expect(await openMenu()).toHaveAttribute('aria-checked', 'false')
  })

  it('follows the operating system LIVE until a choice is made, and lets go on unmount', () => {
    const { unmount } = renderMenu()
    expect(document.documentElement).not.toHaveClass('dark')

    // Somebody flips the machine to dark (or a schedule does it at sunset)
    // while the studio is open, and nobody has touched the switch.
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

  it('still works when localStorage throws (a private window)', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('access denied')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('access denied')
    })

    renderMenu()
    await userEvent.click(await openMenu())
    expect(document.documentElement).toHaveClass('dark')

    getItem.mockRestore()
    setItem.mockRestore()
  })
})
