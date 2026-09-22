/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { PasswordGate } from './PasswordGate'

// The real sign-in screen pulls in the Stytch SDK, which wants a browser and a
// project. Mocking the module - not the package - keeps these tests about the
// GATE's routing decision, which is the part that can regress.
vi.mock('./StytchSignIn', () => ({
  default: () => <p>stytch sign-in</p>,
}))

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
  it('renders the studio straight away when the API is already reachable', async () => {
    render(
      <PasswordGate fetchImpl={fetchStub([() => json({ enabled: true })])}>
        <p>studio</p>
      </PasswordGate>,
    )
    expect(await screen.findByText('studio')).toBeInTheDocument()
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
