/**
 * @vitest-environment jsdom
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PasswordGate } from './PasswordGate'

// The real sign-in screen pulls in the Stytch SDK, which wants a browser and a
// project. Mocking the module - not the package - keeps these tests about the
// GATE's routing decision, which is the part that can regress.
vi.mock('./StytchSignIn', () => ({
  default: () => <p>stytch sign-in</p>,
}))

// Same reason: signing out reaches the real Stytch client. Mirrors
// WorkspaceGate.test.tsx, which mocks the same pair for the same reason.
const { signOutOfStytch, toastError } = vi.hoisted(() => ({
  signOutOfStytch: vi.fn<() => Promise<string | null>>(async () => null),
  toastError: vi.fn(),
}))
vi.mock('./stytchSignOut', () => ({ signOutOfStytch }))
vi.mock('sonner', () => ({ toast: { error: toastError } }))

// The keep-alive reaches the real SDK too (through `stytchClient.ts`). Mocking
// it here keeps these tests about WHEN the gate loads it, not what it does
// once loaded - that is `stytchKeepAlive.test.ts`'s job.
//
// `keepAliveModule` is a mutable box, not a plain object, because ONE test
// below (the cancellation one) needs to control exactly when
// `import('./stytchKeepAlive')` settles - a dynamic import resolves once and
// is cached forever after, like any ES module, so whatever
// `keepAliveModule.current` holds the FIRST time anything in this file
// actually imports the module is what every test, including this one, gets.
// That test runs first in its describe block for exactly this reason.
const { keepAlive, keepAliveModule } = vi.hoisted(() => {
  const keepAlive = vi.fn((_client?: unknown, _doc?: unknown, _onEnded?: () => void) => () => {})
  return { keepAlive, keepAliveModule: { current: Promise.resolve({ keepStytchSessionFresh: keepAlive }) } }
})
vi.mock('./stytchKeepAlive', () => keepAliveModule.current)

/** Builds a fetch stub that answers the status check, then the sign-in POST. */
function fetchStub(responses: Array<() => Response>) {
  let call = 0
  return vi.fn(async () => {
    const next = responses[Math.min(call, responses.length - 1)]
    call += 1
    return next()
  }) as unknown as typeof fetch
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('PasswordGate', () => {
  beforeEach(() => {
    signOutOfStytch.mockClear()
    toastError.mockClear()
    keepAlive.mockClear()
  })

  it('renders the studio straight away when the API is already reachable', async () => {
    render(
      <PasswordGate fetchImpl={fetchStub([() => json({ enabled: true })])}>
        <p>studio</p>
      </PasswordGate>,
    )
    expect(await screen.findByText('studio')).toBeInTheDocument()
  })

  it('probes once with its DEFAULT fetch, not in a loop', async () => {
    // Every other test here injects a fetchImpl, which is a STABLE reference -
    // so none of them exercised the default, and none of them could catch this.
    // Before the fix the default was a new arrow per render, feeding probe,
    // feeding the effect: 3,767 requests in 600ms, per open tab, forever.
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ enabled: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', spy)

    render(
      <PasswordGate>
        <p>studio</p>
      </PasswordGate>,
    )
    await screen.findByText('studio')
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(spy.mock.calls.length).toBeLessThan(5)
  })

  it('probes once with its DEFAULT fetch when the session is refused too, not only on the 200 path', async () => {
    // The 3,767-request loop above was only ever exercised by the 200 path -
    // every OTHER state, including the refusal panel this gate can now sit
    // on for as long as the browser has the cookie, used an injected
    // `fetchImpl` and so never ran through the default. A regression that
    // re-introduced the loop only on a non-200 answer would pass every test
    // above and fail silently in production.
    const spy = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 'unauthenticated', mode: 'stytch', session: 'refused' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        }),
    )
    vi.stubGlobal('fetch', spy)

    render(
      <PasswordGate>
        <p>studio</p>
      </PasswordGate>,
    )
    await screen.findByText('This studio is only for the Swarm team')
    await new Promise((resolve) => setTimeout(resolve, 300))

    expect(spy.mock.calls.length).toBeLessThan(5)
  })

  it('shows the Stytch sign-in when the API reports the stytch mode', async () => {
    render(
      <PasswordGate fetchImpl={fetchStub([() => json({ code: 'unauthenticated', mode: 'stytch' }, 401)])}>
        <p>studio</p>
      </PasswordGate>,
    )
    expect(await screen.findByText('stytch sign-in')).toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.queryByText('studio')).not.toBeInTheDocument()
  })

  it('still shows the ordinary sign-in when the session is merely absent (no cookie yet)', async () => {
    // An explicit `session: 'absent'`, as a server new enough to send it would.
    render(
      <PasswordGate
        fetchImpl={fetchStub([
          () => json({ code: 'unauthenticated', mode: 'stytch', session: 'absent' }, 401),
        ])}
      >
        <p>studio</p>
      </PasswordGate>,
    )
    expect(await screen.findByText('stytch sign-in')).toBeInTheDocument()
    expect(screen.queryByText(/only for the Swarm team/i)).not.toBeInTheDocument()
  })

  it('shows the ordinary sign-in, not the refusal panel, when the session is merely "stale"', async () => {
    // The bug ADR-31's 2026-09-29 update (second revision) fixed: the Stytch
    // JWT lives about five minutes, so a team member who reopens the studio
    // later gets exactly this from the server. Routing it to the refusal
    // panel turned a routine refresh into a lockout with only Sign out to
    // escape it - the ordinary sign-in screen is what actually loads the SDK
    // and lets the background refresh happen.
    render(
      <PasswordGate
        fetchImpl={fetchStub([
          () =>
            json(
              {
                code: 'unauthenticated',
                mode: 'stytch',
                session: 'stale',
                staleReason: 'expired',
                message: 'Stytch session token has expired.',
              },
              401,
            ),
        ])}
      >
        <p>studio</p>
      </PasswordGate>,
    )
    expect(await screen.findByText('stytch sign-in')).toBeInTheDocument()
    expect(screen.queryByText(/only for the Swarm team/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    // The ordinary five-minute timeout - the bug ADR-31's 2026-09-29 update
    // (fourth revision) fixed: this exact server message must NOT appear above
    // the sign-in form on every reload past five minutes, or a routine refresh
    // reads as an error.
    expect(screen.queryByText('Stytch session token has expired.')).not.toBeInTheDocument()
  })

  it("hides the server's message for an ordinary stale reading even when the server sends no staleReason at all (an older server)", async () => {
    render(
      <PasswordGate
        fetchImpl={fetchStub([
          () =>
            json(
              {
                code: 'unauthenticated',
                mode: 'stytch',
                session: 'stale',
                message: 'Stytch session token has expired.',
              },
              401,
            ),
        ])}
      >
        <p>studio</p>
      </PasswordGate>,
    )
    expect(await screen.findByText('stytch sign-in')).toBeInTheDocument()
    expect(screen.queryByText('Stytch session token has expired.')).not.toBeInTheDocument()
  })

  it('shows the plainer refusal wording, not "only for the Swarm team", for a claims-kind refusal', async () => {
    // A Google-only sign-in with no email claim can happen to a genuine Swarm
    // member (server/auth.ts), so `refusal: 'claims'` must not accuse them of
    // being on the wrong team.
    const reason = 'Stytch session token carries no email address. Claims present: iss, sub.'
    render(
      <PasswordGate
        fetchImpl={fetchStub([
          () =>
            json(
              {
                code: 'unauthenticated',
                mode: 'stytch',
                session: 'refused',
                refusal: 'claims',
                message: reason,
              },
              401,
            ),
        ])}
      >
        <p>studio</p>
      </PasswordGate>,
    )
    expect(
      await screen.findByText('Signed in with Stytch, but the studio API refused the session'),
    ).toBeInTheDocument()
    expect(screen.queryByText('This studio is only for the Swarm team')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out of Stytch and try again' })).toBeInTheDocument()
  })

  it('shows a refusal panel on every load when the server refuses the Stytch session', async () => {
    // No /authenticate path and no prior sign-in attempt in THIS render: this is
    // what a reload, or a brand new tab, sees with a refused cookie already set.
    const reason =
      "This studio is only for the swarm organisation. You signed in as x@y.com in organisation 'acme'."
    render(
      <PasswordGate
        fetchImpl={fetchStub([
          () => json({ code: 'unauthenticated', mode: 'stytch', session: 'refused', message: reason }, 401),
        ])}
      >
        <p>studio</p>
      </PasswordGate>,
    )
    expect(await screen.findByText('This studio is only for the Swarm team')).toBeInTheDocument()
    expect(await screen.findByText(reason)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    // The sign-in form has nothing to offer here - the cookie is already the
    // problem - so it must not render alongside the refusal.
    expect(screen.queryByText('stytch sign-in')).not.toBeInTheDocument()
    expect(screen.queryByText('studio')).not.toBeInTheDocument()
  })

  it('signs out from the refusal panel, and never fails silently', async () => {
    signOutOfStytch.mockResolvedValueOnce('Could not reach Stytch to sign out.')
    render(
      <PasswordGate
        fetchImpl={fetchStub([
          () =>
            json(
              {
                code: 'unauthenticated',
                mode: 'stytch',
                session: 'refused',
                message: 'refused by the allow-list',
              },
              401,
            ),
        ])}
      >
        <p>studio</p>
      </PasswordGate>,
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(signOutOfStytch).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Could not reach Stytch to sign out.'))
  })

  it('reloads the page when signing out fails outright, rather than leaving the button dead', async () => {
    // The chunk-failure branch: `signOutOfStytch` itself rejects (a deploy
    // replaced the chunk between page load and this click). A dropped promise
    // here would leave the ONLY way out of this panel doing nothing when
    // clicked.
    // jsdom's `location.reload` is not implemented and the property is not
    // writable/configurable enough for `vi.spyOn` to replace directly, so the
    // whole `location` object is swapped for one with a stub in its place.
    const originalLocation = window.location
    const reload = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload },
    })
    try {
      signOutOfStytch.mockRejectedValueOnce(new Error('chunk failed to load'))
      render(
        <PasswordGate
          fetchImpl={fetchStub([
            () =>
              json({ code: 'unauthenticated', mode: 'stytch', session: 'refused', message: 'refused' }, 401),
          ])}
        >
          <p>studio</p>
        </PasswordGate>,
      )
      await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }))
      await waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    }
  })

  it('completes the round trip on /authenticate even though the probe still refuses', async () => {
    // Stytch has just redirected back with a token in the URL. No session exists
    // yet, so the API legitimately answers 401 - and the gate must still render
    // the sign-in component so it can finish the exchange, rather than showing
    // the "reload to continue" dead end.
    window.history.pushState({}, '', '/authenticate')
    try {
      render(
        <PasswordGate fetchImpl={fetchStub([() => json({ code: 'unauthenticated', mode: 'stytch' }, 401)])}>
          <p>studio</p>
        </PasswordGate>,
      )
      expect(await screen.findByText('stytch sign-in')).toBeInTheDocument()
    } finally {
      window.history.pushState({}, '', '/')
    }
  })

  it('still shows the password form when the API reports the password mode', async () => {
    render(
      <PasswordGate fetchImpl={fetchStub([() => json({ code: 'unauthenticated', mode: 'password' }, 401)])}>
        <p>studio</p>
      </PasswordGate>,
    )
    expect(await screen.findByLabelText('Password')).toBeInTheDocument()
    expect(screen.queryByText('studio')).not.toBeInTheDocument()
  })

  it('signs in and then reveals the studio', async () => {
    const responses = [
      () => json({ code: 'unauthenticated', mode: 'password' }, 401),
      () => json({ status: 'signed-in' }),
      () => json({ enabled: true }),
    ]
    render(
      <PasswordGate fetchImpl={fetchStub(responses)}>
        <p>studio</p>
      </PasswordGate>,
    )
    await userEvent.type(await screen.findByLabelText('Password'), 'correct-horse-battery-staple')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('studio')).toBeInTheDocument()
  })

  it('keeps the form up and explains when the password is wrong', async () => {
    const responses = [
      () => json({ code: 'unauthenticated', mode: 'password' }, 401),
      () => json({ code: 'invalid-password', message: 'That password is not correct.' }, 401),
    ]
    render(
      <PasswordGate fetchImpl={fetchStub(responses)}>
        <p>studio</p>
      </PasswordGate>,
    )
    await userEvent.type(await screen.findByLabelText('Password'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('That password is not correct.')).toBeInTheDocument()
    expect(screen.queryByText('studio')).not.toBeInTheDocument()
  })

  it('does not offer a password box when the gate is Cloudflare Access', async () => {
    render(
      <PasswordGate
        fetchImpl={fetchStub([() => json({ code: 'unauthenticated', mode: 'cloudflare-access' }, 401)])}
      >
        <p>studio</p>
      </PasswordGate>,
    )
    await waitFor(() => expect(screen.queryByLabelText('Password')).not.toBeInTheDocument())
    expect(screen.getByText(/requires you to sign in/i)).toBeInTheDocument()
  })

  it('shows the server\'s own reason when the wire mode is "disabled", not the generic sentence', async () => {
    // The wire value `createDisabledAuthenticator` actually sends is
    // "disabled" (server/auth.ts), never "none" - "none" only ever names
    // `loadAuthConfig`'s internal config branch (docs/DEPLOYMENT.md). Comparing
    // against "none" here meant this branch never ran and every operator saw
    // the generic sentence instead of the setting they forgot.
    render(
      <PasswordGate
        fetchImpl={fetchStub([
          () =>
            json(
              {
                code: 'unauthenticated',
                mode: 'disabled',
                message: 'STYTCH_ALLOWED_ORGANIZATIONS is not set. Set it to a comma-separated list...',
              },
              401,
            ),
        ])}
      >
        <p>studio</p>
      </PasswordGate>,
    )
    expect(await screen.findByText(/STYTCH_ALLOWED_ORGANIZATIONS is not set/)).toBeInTheDocument()
    expect(screen.queryByText(/reload to continue/i)).not.toBeInTheDocument()
  })

  it('still shows the generic sentence for a mode this gate does not otherwise recognise', async () => {
    render(
      <PasswordGate fetchImpl={fetchStub([() => json({ code: 'unauthenticated', mode: 'none' }, 401)])}>
        <p>studio</p>
      </PasswordGate>,
    )
    expect(await screen.findByText(/requires you to sign in\. reload to continue/i)).toBeInTheDocument()
  })

  it('shows the server\'s reason above the sign-in form for a "stale" session caused by a real key problem', async () => {
    // Before this fix, `{ kind: 'stytch', stale: true }` carried no message at
    // all: a JWKS outage or an unknown signing key (server/auth.ts) showed the
    // exact same blank sign-in screen as an ordinary five-minute-old JWT, with
    // no way to tell the two apart from the screen alone. `staleReason: 'keys'`
    // is what now tells the gate THIS stale reading is worth the sentence,
    // unlike an ordinary expired JWT (see the tests above).
    render(
      <PasswordGate
        fetchImpl={fetchStub([
          () =>
            json(
              {
                code: 'unauthenticated',
                mode: 'stytch',
                session: 'stale',
                staleReason: 'keys',
                message: 'Could not load the Stytch signing keys: HTTP 500',
              },
              401,
            ),
        ])}
      >
        <p>studio</p>
      </PasswordGate>,
    )
    expect(await screen.findByText('Could not load the Stytch signing keys: HTTP 500')).toBeInTheDocument()
    expect(await screen.findByText('stytch sign-in')).toBeInTheDocument()
  })

  describe('the Stytch keep-alive', () => {
    // Runs FIRST in this block on purpose - see the comment on `keepAliveModule`
    // above. It replaces `import('./stytchKeepAlive')`'s ONE resolution with a
    // deferred promise this test controls, so it can prove the effect's
    // `cancelled` flag actually does something: leave the state the effect
    // depends on WHILE the import is still in flight, then let the import
    // resolve, and confirm `keepStytchSessionFresh` was never called. Without
    // this flag, the resolved module would call it on a gate that has already
    // moved on - exactly the shape of bug a real deploy would only surface as
    // Stytch's own "multiple copies of the client" warning or a session that
    // stops refreshing for no visible reason.
    it('never calls keepStytchSessionFresh if the gate leaves the open-in-Stytch-mode state before the dynamic import resolves', async () => {
      let resolveImport!: (mod: { keepStytchSessionFresh: typeof keepAlive }) => void
      keepAliveModule.current = new Promise((resolve) => {
        resolveImport = resolve
      })

      const { unmount } = render(
        <PasswordGate fetchImpl={fetchStub([() => json({ enabled: true, authMode: 'stytch' })])}>
          <p>studio</p>
        </PasswordGate>,
      )
      await screen.findByText('studio')

      // The effect has started `import('./stytchKeepAlive')`; nothing has
      // resolved it yet. Unmounting right now, before it settles, is exactly
      // the race the `cancelled` flag guards against.
      unmount()

      resolveImport({ keepStytchSessionFresh: keepAlive })
      await keepAliveModule.current
      // Give the now-resolved import's own `.then()` a turn to run.
      await act(async () => {
        await Promise.resolve()
      })

      expect(keepAlive).not.toHaveBeenCalled()
    })

    it('loads it exactly once when the API opens in Stytch mode', async () => {
      render(
        <PasswordGate fetchImpl={fetchStub([() => json({ enabled: true, authMode: 'stytch' })])}>
          <p>studio</p>
        </PasswordGate>,
      )
      await screen.findByText('studio')
      await waitFor(() => expect(keepAlive).toHaveBeenCalledTimes(1))
    })

    it('shows the Stytch sign-in again once its onEnded callback fires, for a session that ends for real', async () => {
      // Untested before: the gate wires its own `() => setState({ kind: 'stytch' })`
      // as `keepStytchSessionFresh`'s third argument, but nothing ever called it
      // to check what happens next. Capturing exactly what the mock received and
      // invoking it is what proves the wiring, not just that a callback of SOME
      // kind was passed.
      render(
        <PasswordGate fetchImpl={fetchStub([() => json({ enabled: true, authMode: 'stytch' })])}>
          <p>studio</p>
        </PasswordGate>,
      )
      await screen.findByText('studio')
      await waitFor(() => expect(keepAlive).toHaveBeenCalledTimes(1))

      const onEnded = keepAlive.mock.calls[0][2] as (() => void) | undefined
      expect(onEnded).toBeTypeOf('function')
      act(() => onEnded?.())

      expect(await screen.findByText('stytch sign-in')).toBeInTheDocument()
      expect(screen.queryByText('studio')).not.toBeInTheDocument()
    })

    it('never loads it in developer mode', async () => {
      render(
        <PasswordGate fetchImpl={fetchStub([() => json({ enabled: true, authMode: 'developer' })])}>
          <p>studio</p>
        </PasswordGate>,
      )
      await screen.findByText('studio')
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(keepAlive).not.toHaveBeenCalled()
    })

    it('never loads it when signed in through the shared password', async () => {
      render(
        <PasswordGate fetchImpl={fetchStub([() => json({ enabled: true, authMode: 'password' })])}>
          <p>studio</p>
        </PasswordGate>,
      )
      await screen.findByText('studio')
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(keepAlive).not.toHaveBeenCalled()
    })

    it('never loads it behind Cloudflare Access', async () => {
      render(
        <PasswordGate fetchImpl={fetchStub([() => json({ enabled: true, authMode: 'cloudflare-access' })])}>
          <p>studio</p>
        </PasswordGate>,
      )
      await screen.findByText('studio')
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(keepAlive).not.toHaveBeenCalled()
    })

    it('never loads it when the 200 body carries no authMode at all (a pre-fix server)', async () => {
      render(
        <PasswordGate fetchImpl={fetchStub([() => json({ enabled: true })])}>
          <p>studio</p>
        </PasswordGate>,
      )
      await screen.findByText('studio')
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(keepAlive).not.toHaveBeenCalled()
    })

    it('never loads it on a 401 in Stytch mode - the sign-in screen owns the client there', async () => {
      render(
        <PasswordGate fetchImpl={fetchStub([() => json({ code: 'unauthenticated', mode: 'stytch' }, 401)])}>
          <p>studio</p>
        </PasswordGate>,
      )
      await screen.findByText('stytch sign-in')
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(keepAlive).not.toHaveBeenCalled()
    })

    it('runs its cleanup on unmount', async () => {
      const stop = vi.fn()
      keepAlive.mockReturnValueOnce(stop)
      const { unmount } = render(
        <PasswordGate fetchImpl={fetchStub([() => json({ enabled: true, authMode: 'stytch' })])}>
          <p>studio</p>
        </PasswordGate>,
      )
      await screen.findByText('studio')
      await waitFor(() => expect(keepAlive).toHaveBeenCalledTimes(1))
      unmount()
      await waitFor(() => expect(stop).toHaveBeenCalledTimes(1))
    })
  })

  describe('the bounded re-probe on a stale session', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    const staleBody = {
      code: 'unauthenticated',
      mode: 'stytch',
      session: 'stale',
      staleReason: 'expired',
      message: 'Stytch session token has expired.',
    }

    it('opens the studio once the session clears, on the first re-probe at 2 seconds', async () => {
      const spy = vi
        .fn()
        .mockImplementationOnce(async () => json(staleBody, 401))
        .mockImplementationOnce(async () => json({ enabled: true, authMode: 'stytch' }))
      render(
        <PasswordGate fetchImpl={spy}>
          <p>studio</p>
        </PasswordGate>,
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(screen.getByText('stytch sign-in')).toBeInTheDocument()
      expect(spy).toHaveBeenCalledTimes(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })
      expect(spy).toHaveBeenCalledTimes(2)
      expect(screen.getByText('studio')).toBeInTheDocument()
    })

    it('keeps trying on a backoff and stops after the schedule runs out', async () => {
      const spy = vi.fn(async () => json(staleBody, 401))
      render(
        <PasswordGate fetchImpl={spy}>
          <p>studio</p>
        </PasswordGate>,
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(spy).toHaveBeenCalledTimes(1) // the initial probe on mount

      for (const [index, delayMs] of [2_000, 5_000, 10_000, 20_000].entries()) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(delayMs)
        })
        expect(spy).toHaveBeenCalledTimes(index + 2)
      }

      // The schedule is exhausted: waiting arbitrarily longer adds no more.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000)
      })
      expect(spy).toHaveBeenCalledTimes(5)
      expect(screen.getByText('stytch sign-in')).toBeInTheDocument()
      // The ordinary five-minute timeout (`staleReason: 'expired'`) is never
      // shown, even after the whole re-probe schedule has run out with no
      // change - see the "hides the server's message" tests above.
      expect(screen.queryByText('Stytch session token has expired.')).not.toBeInTheDocument()
    })

    it('cancels the pending re-probe on unmount, before it fires', async () => {
      const spy = vi.fn(async () => json(staleBody, 401))
      const { unmount } = render(
        <PasswordGate fetchImpl={spy}>
          <p>studio</p>
        </PasswordGate>,
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(spy).toHaveBeenCalledTimes(1)

      unmount()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000)
      })
      expect(spy).toHaveBeenCalledTimes(1)
    })
  })
})
