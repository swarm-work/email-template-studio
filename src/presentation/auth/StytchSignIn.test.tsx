/**
 * @vitest-environment jsdom
 */
import type { ReactNode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StytchSignIn from './StytchSignIn'

/**
 * The real SDK wants a browser, a project token and a network - and the
 * prebuilt `<StytchB2B>` form is Stytch's own UI, not this file's. Both are
 * stubbed so these tests are only about what THIS component decides: what it
 * shows, when, and how it reacts to `session.onChange` - not the SDK's own
 * rendering (mirrors how `PasswordGate.test.tsx` mocks this whole module for
 * the same reason, one level up).
 */
const { getSync, onChange, getOnChangeCallback } = vi.hoisted(() => {
  let callback: ((session: unknown) => void) | undefined
  return {
    getSync: vi.fn((): unknown => null),
    onChange: vi.fn((cb: (session: unknown) => void) => {
      callback = cb
      return () => {
        callback = undefined
      }
    }),
    getOnChangeCallback: () => callback,
  }
})

vi.mock('./stytchClient', () => ({
  stytchClient: { session: { getSync, onChange } },
}))

vi.mock('@stytch/react/b2b', () => ({
  B2BProducts: { emailMagicLinks: 'emailMagicLinks', oauth: 'oauth' },
  // `SIGNED_IN_EVENTS` (module scope, StytchSignIn.tsx) reads several keys off
  // this at import time to build a Set; a Proxy answers all of them without
  // this file having to list each one.
  StytchEventType: new Proxy({}, { get: () => 'stub-event' }),
  shadcnTheme: {},
  StytchB2BProvider: ({ children }: { children: ReactNode }) => children,
  StytchB2B: () => <p>stytch form</p>,
}))

describe('StytchSignIn', () => {
  beforeEach(() => {
    getSync.mockReturnValue(null)
    onChange.mockClear()
  })

  afterEach(() => {
    window.history.pushState({}, '', '/')
  })

  describe('a cached session', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('shows "Restoring your session…" and then the form once the timeout elapses', async () => {
      // A cached session (the SDK's own `localStorage` copy) means the client
      // constructor's background refresh might resolve it before the member
      // ever needs to see the form - see StytchSignIn.tsx's `RESTORE_TIMEOUT_MS`.
      getSync.mockReturnValue({ member_session_id: 'cached' })
      render(<StytchSignIn />)

      expect(screen.getByText('Restoring your session…')).toBeInTheDocument()
      expect(screen.queryByText('stytch form')).not.toBeInTheDocument()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })

      expect(screen.getByText('stytch form')).toBeInTheDocument()
      expect(screen.queryByText('Restoring your session…')).not.toBeInTheDocument()
    })
  })

  it('calls onSignedIn when session.onChange reports a real session', () => {
    const onSignedIn = vi.fn()
    render(<StytchSignIn onSignedIn={onSignedIn} />)

    act(() => getOnChangeCallback()?.({ member_session_id: 'fresh' }))

    expect(onSignedIn).toHaveBeenCalledTimes(1)
  })

  it('stops waiting, without calling onSignedIn, when session.onChange reports the session is gone', () => {
    getSync.mockReturnValue({ member_session_id: 'cached' })
    const onSignedIn = vi.fn()
    render(<StytchSignIn onSignedIn={onSignedIn} />)
    expect(screen.getByText('Restoring your session…')).toBeInTheDocument()

    act(() => getOnChangeCallback()?.(null))

    expect(screen.getByText('stytch form')).toBeInTheDocument()
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('shows the form at once when there is no cached session', () => {
    render(<StytchSignIn />)

    expect(screen.getByText('stytch form')).toBeInTheDocument()
    expect(screen.queryByText('Restoring your session…')).not.toBeInTheDocument()
  })

  it('shows the form at once on /authenticate, even with a cached session, so the callback token is not discarded', () => {
    // An older session cookie can make `getSync()` truthy right as Stytch
    // redirects back with a magic-link/OAuth token in the URL. Starting on
    // "Restoring…" here would hide <StytchB2B> - the one thing that consumes
    // that token - for up to five seconds, and often longer than the round
    // trip has left to live.
    window.history.pushState({}, '', '/authenticate')
    getSync.mockReturnValue({ member_session_id: 'cached' })
    render(<StytchSignIn />)

    expect(screen.getByText('stytch form')).toBeInTheDocument()
    expect(screen.queryByText('Restoring your session…')).not.toBeInTheDocument()
  })
})
