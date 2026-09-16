/**
 * The sign-in screen for the shared-password mode.
 *
 * This component is a convenience, not the security boundary. The real gate is
 * `server/auth.ts`: every `/api/*` route refuses a request that carries no valid
 * session cookie, whatever the browser chooses to render. Hiding the editor
 * behind this screen stops an honest visitor from poking at a studio that is not
 * theirs; it is the server that stops a dishonest one.
 *
 * How it decides what to show:
 *   1. ask the API for its status
 *   2. 200 -> we are already allowed in (a valid cookie, Cloudflare Access, or a
 *      local developer identity), so render the studio
 *   3. 401 with mode "password" -> show the password form
 *   4. 401 with any other mode -> Access is in front and the browser must be sent
 *      to the identity provider, which a reload does
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'

/** What the gate is currently doing. */
type GateState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'open' }
  | { readonly kind: 'locked'; readonly message?: string }
  | { readonly kind: 'unreachable'; readonly message: string }

interface PasswordGateProps {
  readonly children: React.ReactNode
  /** Overridable so tests do not need a server. */
  readonly fetchImpl?: typeof fetch
}

export function PasswordGate({ children, fetchImpl = (...args) => fetch(...args) }: PasswordGateProps) {
  const [state, setState] = useState<GateState>({ kind: 'checking' })
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)

  /** Asks the API what it thinks of us, without touching state. */
  const probe = useCallback(async (): Promise<GateState> => {
    let response: Response
    try {
      response = await fetchImpl('/api/send-test/status', { headers: { accept: 'application/json' } })
    } catch {
      return { kind: 'unreachable', message: 'Could not reach the studio API.' }
    }
    if (response.ok) return { kind: 'open' }
    if (response.status === 401) {
      const body = (await response.json().catch(() => null)) as { mode?: string } | null
      if (body?.mode === 'password') return { kind: 'locked' }
      // Cloudflare Access (or nothing at all) is in front. There is no password
      // for the visitor to type; reloading is what sends them to the login.
      return { kind: 'unreachable', message: 'This studio requires you to sign in. Reload to continue.' }
    }
    return { kind: 'unreachable', message: `The studio API answered with HTTP ${response.status}.` }
  }, [fetchImpl])

  // Synchronising with an external system (the API), which is what effects are
  // for. The flag stops a slow answer from setting state after unmount.
  useEffect(() => {
    let cancelled = false
    void probe().then((next) => {
      if (!cancelled) setState(next)
    })
    return () => {
      cancelled = true
    }
  }, [probe])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (submitting || password === '') return
    setSubmitting(true)
    try {
      const response = await fetchImpl('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (response.ok) {
        // The cookie is HttpOnly, so there is nothing to store here: the browser
        // will attach it to every later request on its own. Re-probe rather than
        // assuming success, so the studio only appears if the API really lets us in.
        setPassword('')
        setState(await probe())
        return
      }
      const body = (await response.json().catch(() => null)) as { message?: string } | null
      setState({ kind: 'locked', message: body?.message ?? 'That password is not correct.' })
    } catch {
      setState({ kind: 'locked', message: 'Could not reach the studio API.' })
    } finally {
      setSubmitting(false)
    }
  }

  if (state.kind === 'open') return <>{children}</>

  if (state.kind === 'checking') {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">Checking access…</p>
      </main>
    )
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-2">
          <h1 className="text-xl font-semibold tracking-tight">Email Template Studio</h1>
          <p className="text-muted-foreground text-sm">
            {state.kind === 'locked'
              ? 'This studio is password protected.'
              : 'This studio is not available right now.'}
          </p>
        </div>

        {state.kind === 'locked' ? (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="studio-password" className="text-sm font-medium">
                Password
              </label>
              <input
                id="studio-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="border-input focus-visible:ring-ring/50 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
              />
            </div>
            {state.message ? (
              <Alert variant="destructive">
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting || password === ''}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        ) : (
          <Alert variant="destructive">
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}
      </div>
    </main>
  )
}
