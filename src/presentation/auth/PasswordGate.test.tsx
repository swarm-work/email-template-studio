/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
})
