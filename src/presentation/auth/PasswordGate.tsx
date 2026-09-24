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
 *   4. 401 with mode "stytch" -> lazily load and show the Stytch sign-in screen
 *   5. 401 with any other mode -> Access is in front and the browser must be sent
 *      to the identity provider, which a reload does
 *
 * The name is now narrower than the job: this gate covers the password mode AND
 * the Stytch mode. Renaming it to `AuthGate` belongs with the change that
 * deletes the password half, so the rename and its test file move once rather
 * than twice (docs/STYTCH_PLAN.md, T10).
 */
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AuthCard, AuthCardBody, AuthGround } from './AuthScreen'

/**
 * Lazily loaded on purpose, and the ONLY way this module reaches Stytch.
 *
 * A static import here would put the SDK in the first download of every build,
 * including the Playwright one, whose five spec files all fail on an unexpected
 * console error. `scripts/check-worker-bundle.mjs` enforces the seam.
 */
const StytchSignIn = lazy(() => import('./StytchSignIn'))

/**
 * The path Stytch redirects back to after a magic link or an OAuth round trip.
 * The SPA has no router: `wrangler.jsonc` serves index.html for unknown paths
 * (`not_found_handling: "single-page-application"`), so a pathname check is the
 * whole of the routing. Do NOT add this to `run_worker_first` - sending it to
 * the Worker would break the flow.
 */
const AUTHENTICATE_PATH = '/authenticate'

/**
 * The default fetch, hoisted to module scope so it is the SAME function on
 * every render.
 *
 * As a default parameter it was a new arrow each render, which fed `probe`
 * (`useCallback([fetchImpl])`), which fed `useEffect([probe])`. The effect then
 * re-ran on every render, and because its `setState` always stores a fresh
 * object it never compared equal, so the render it caused ran the effect again.
 * Measured before this fix: **3,767 requests to `/api/send-test/status` in 600
 * milliseconds**, per open tab, forever.
 *
 * The tests never caught it because they all pass a `fetchImpl` of their own,
 * which is stable - so the bug only existed in the one path nobody injected.
 */
const defaultFetch: typeof fetch = (...args) => fetch(...args)

/** What the gate is currently doing. */
type GateState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'open' }
  | { readonly kind: 'locked'; readonly message?: string }
  | { readonly kind: 'stytch' }
  | { readonly kind: 'unreachable'; readonly message: string }

interface PasswordGateProps {
  readonly children: React.ReactNode
  /** Overridable so tests do not need a server. */
  readonly fetchImpl?: typeof fetch
}

export function PasswordGate({ children, fetchImpl = defaultFetch }: PasswordGateProps) {
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
      if (body?.mode === 'stytch') return { kind: 'stytch' }
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

  // Mid-flow: Stytch has sent the browser back with a token in the URL and the
  // sign-in component completes the exchange. This is checked BEFORE `open`
  // because the probe legitimately 401s here - the session does not exist yet -
  // and before `checking` so the round trip does not flash "Checking access".
  const onAuthenticatePath = typeof window !== 'undefined' && window.location.pathname === AUTHENTICATE_PATH

  if (onAuthenticatePath || state.kind === 'stytch') {
    return (
      <AuthGround>
        <AuthCard>
          {/* The fallback shows while the lazy chunk downloads. It takes the
              same inset as the form it is standing in for, so the card does
              not jump in height when the form arrives. */}
          <Suspense
            fallback={
              <AuthCardBody>
                <p className="text-muted-foreground text-center text-sm">Loading sign-in…</p>
              </AuthCardBody>
            }
          >
            <StytchSignIn />
          </Suspense>
        </AuthCard>
      </AuthGround>
    )
  }

  if (state.kind === 'open') return <>{children}</>

  // The same ground as the screens that follow it, so the page does not change
  // colour when the answer arrives. No card yet: there is nothing to put in it,
  // and an empty card that then fills would flash.
  if (state.kind === 'checking') {
    return (
      <AuthGround>
        <p className="text-muted-foreground text-sm">Checking access…</p>
      </AuthGround>
    )
  }

  return (
    <AuthGround>
      <AuthCard>
        <AuthCardBody>
          <div className="space-y-6">
            <p className="text-muted-foreground text-center text-sm">
              {state.kind === 'locked'
                ? 'This studio is password protected.'
                : 'This studio is not available right now.'}
            </p>

            {state.kind === 'locked' ? (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="studio-password">Password</Label>
                  <Input
                    id="studio-password"
                    type="password"
                    autoComplete="current-password"
                    autoFocus
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="h-9 px-3"
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
        </AuthCardBody>
      </AuthCard>
    </AuthGround>
  )
}
