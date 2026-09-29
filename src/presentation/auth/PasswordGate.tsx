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
 *   4. 401 with mode "stytch" and session "refused" -> a cookie WAS presented
 *      and this server said no to it for a reason reloading cannot fix (wrong
 *      organisation, or a claim problem that will never heal on its own).
 *      Show the refusal panel and a Sign out button on every load, not only
 *      right after a fresh sign-in attempt.
 *   5. 401 with mode "stytch" and session "absent" or "stale" -> either no
 *      cookie yet, or one the SDK's own background refresh can fix (the JWT
 *      lives about five minutes - see server/auth.ts). Both lazily load and
 *      show the ordinary Stytch sign-in screen, which is also what loads the
 *      SDK and lets that refresh happen; a "stale" session must NEVER reach
 *      the refusal panel below, or a team member who left a tab open for an
 *      hour is told they are not on the team (ADR-31, update 2026-09-29,
 *      second revision).
 *   6. 401 with any other mode -> Access is in front and the browser must be sent
 *      to the identity provider, which a reload does
 *
 * The name is now narrower than the job: this gate covers the password mode AND
 * the Stytch mode. Renaming it to `AuthGate` belongs with the change that
 * deletes the password half, so the rename and its test file move once rather
 * than twice (docs/STYTCH_PLAN.md, T10).
 */
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
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
  /**
   * No Stytch cookie yet, OR one the SDK's own background refresh can still
   * fix (session "stale" - see the module comment) - either way, the ordinary
   * "show the sign-in form" state, which is also what loads the SDK and lets
   * that refresh happen. `stale: true` only on the second kind, so the effect
   * below knows to re-probe once and pick up the refreshed cookie.
   */
  | { readonly kind: 'stytch'; readonly stale?: boolean }
  /**
   * A Stytch cookie WAS presented and the server refused it for a reason
   * reloading cannot fix. Shown on every load, not only right after a sign-in
   * attempt - see the module comment. `refusal` picks the wording: only a
   * real member of another organisation is told "not on the Swarm team" -
   * everything else keeps the older, less presumptuous message, because a
   * genuine Swarm member can hit it too (server/auth.ts, AuthResult).
   */
  | { readonly kind: 'stytch-refused'; readonly message: string; readonly refusal: 'organization' | 'claims' }
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
      const body = (await response.json().catch(() => null)) as {
        mode?: string
        session?: string
        refusal?: string
        message?: string
      } | null
      if (body?.mode === 'password') return { kind: 'locked' }
      if (body?.mode === 'stytch') {
        // 'refused' means a cookie WAS presented and this server said no to it
        // for a reason reloading cannot fix (wrong organisation, or a claim
        // problem that will never heal) - so the reason is worth showing on
        // EVERY load, not only right after a sign-in attempt.
        //
        // 'absent' (no cookie yet) and 'stale' (a cookie the SDK's own
        // background refresh can still fix - the JWT lives about five
        // minutes, see server/auth.ts) both fall through to the ordinary
        // sign-in screen below. Treating 'stale' as a refusal is the exact bug
        // ADR-31's 2026-09-29 update fixed: it turned a sleeping tab into a
        // "you are not on the team" dead end for a real Swarm member, with
        // only Sign out to escape it. Nothing but a fresh sign-in reaches
        // this component with 'stale' left unhandled, so an older server that
        // sends neither value also lands here, same as 'absent'.
        if (body.session === 'refused') {
          return {
            kind: 'stytch-refused',
            message: body.message ?? 'The studio API refused this Stytch session.',
            // An older server sends no `refusal` at all; 'organization' is the
            // reason every such server ever had, so it is the safe default.
            refusal: body.refusal === 'claims' ? 'claims' : 'organization',
          }
        }
        return { kind: 'stytch', stale: body.session === 'stale' }
      }
      // Cloudflare Access, or an unconfigured server (mode "none"), is in
      // front. There is no password for the visitor to type; reloading is
      // what sends them to the login - except mode "none" never lets a reload
      // succeed, so its own message (already public in this 401 body) is
      // shown instead of the generic one, in case it names a forgotten
      // setting an operator can actually fix.
      return {
        kind: 'unreachable',
        message:
          body?.mode === 'none' && body.message
            ? body.message
            : 'This studio requires you to sign in. Reload to continue.',
      }
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

  /**
   * A "stale" session (see the module comment) is one the SDK's own
   * background refresh should mend by itself once it loads - but that refresh
   * fires no event this gate can listen for, unlike a full sign-in
   * (`onStytchSignedIn` below). So this gives the SDK a moment to fetch a
   * fresh cookie, then asks the API again, exactly once - the ref, not state,
   * is what makes it "once": re-entering the 'stytch' state later (a second
   * stale reading after this same probe) must not restart the timer.
   */
  const reprobedStaleSession = useRef(false)
  useEffect(() => {
    if (state.kind !== 'stytch' || !state.stale || reprobedStaleSession.current) return
    reprobedStaleSession.current = true
    let cancelled = false
    const timer = window.setTimeout(() => {
      void probe().then((next) => {
        if (!cancelled) setState(next)
      })
    }, 2000)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [state, probe])

  /**
   * Stytch has finished: its session cookie is set. Two things follow.
   *
   * Leave `/authenticate` first, so a reload lands on the studio and not on the
   * callback path with no token. `replaceState` rather than `pushState`: the
   * callback URL should not be in the back-button history at all.
   *
   * Then ask the API again. The probe stays the single source of truth for
   * "open" - the gate never opens on Stytch's word alone, because the Worker is
   * the one that verifies the token, and it may still say no. If it still says
   * no, `probe` itself resolves to `stytch-refused` and the refusal panel
   * below renders - the same panel a reload would show, so this is no longer a
   * separate code path.
   */
  const onStytchSignedIn = useCallback(() => {
    if (typeof window !== 'undefined' && window.location.pathname === AUTHENTICATE_PATH) {
      window.history.replaceState(null, '', '/')
    }
    void probe().then(setState)
  }, [probe])

  /**
   * Revokes the Stytch session and reloads onto the sign-in screen, through the
   * same lazy seam the header uses (a static import here would put the SDK in
   * every build's first download - see stytchSignOut.ts).
   *
   * Must never fail silently: this button is the only way out of the refusal
   * panel below, so a sentence from `signOutOfStytch` is surfaced as a toast,
   * and a chunk that will not load (a deploy replaced it) reloads the page,
   * which fetches the new one. Mirrors `useSignedInIdentity.ts`'s `signOut`.
   */
  const onSignOut = useCallback(() => {
    void import('./stytchSignOut')
      .then(({ signOutOfStytch }) => signOutOfStytch())
      .then((problem) => {
        if (problem) toast.error(problem)
      })
      .catch(() => window.location.reload())
  }, [])

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
            <StytchSignIn onSignedIn={onStytchSignedIn} />
          </Suspense>
        </AuthCard>
      </AuthGround>
    )
  }

  // A Stytch cookie WAS presented and this server refused it - wrong
  // organisation, expired, or malformed. Shown on EVERY load the status probe
  // reports it, not only right after a sign-in attempt: the person may have
  // reloaded, or opened the studio in a new tab, with the same refused cookie
  // still on the browser. Reloading alone would just show this again, so the
  // only way forward the screen offers is signing out.
  if (state.kind === 'stytch-refused') {
    // Only a real, verified member of another organisation is told they are
    // not on the Swarm team - that is literally true for them. Every other
    // refusal (a malformed token, a session with no email or no subject) can
    // land on a genuine Swarm member too, so it keeps the plainer, older
    // wording rather than accusing them of being a stranger.
    const isOrganizationRefusal = state.refusal === 'organization'
    return (
      <AuthGround>
        <AuthCard>
          <AuthCardBody>
            <div className="space-y-4">
              <p className="text-foreground text-center text-sm font-medium">
                {isOrganizationRefusal
                  ? 'This studio is only for the Swarm team'
                  : 'Signed in with Stytch, but the studio API refused the session'}
              </p>
              <Alert variant="destructive">
                <AlertDescription>{state.message}</AlertDescription>
              </Alert>
              <Button type="button" variant="outline" className="w-full" onClick={onSignOut}>
                {isOrganizationRefusal ? 'Sign out' : 'Sign out of Stytch and try again'}
              </Button>
            </div>
          </AuthCardBody>
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
