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
 *      local developer identity), so render the studio. If `authMode` on that
 *      body is "stytch", this is also the ONLY place that ever loads
 *      `stytchKeepAlive.ts` - see that effect below - so the JWT stays fresh
 *      for as long as the studio stays open, not just for the five minutes
 *      after sign-in (ADR-31, update 2026-09-29, third revision).
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
 *      second revision). A bounded re-probe (`STALE_REPROBE_DELAYS_MS` below)
 *      keeps asking the API while that refresh catches up.
 *   6. 401 with any other mode ("disabled" - `server/auth.ts` names the
 *      config-time absence of any auth setting "none", but the value this
 *      request actually answers with is "disabled"; see docs/DEPLOYMENT.md -
 *      or "cloudflare-access") -> the browser must be sent to the identity
 *      provider, which a reload does; "disabled" additionally surfaces the
 *      server's own reason, since no reload will ever fix it.
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
import { AUTHENTICATE_PATH } from './authenticatePath'

/**
 * Lazily loaded on purpose, and the ONLY way this module reaches Stytch.
 *
 * A static import here would put the SDK in the first download of every build,
 * including the Playwright one, whose five spec files all fail on an unexpected
 * console error. `scripts/check-worker-bundle.mjs` enforces the seam.
 */
const StytchSignIn = lazy(() => import('./StytchSignIn'))

/**
 * Delays for the bounded stale-session re-probe schedule below: 2s, 5s, 10s,
 * 20s. The common case - an ordinary background refresh, seconds away once
 * the SDK loads, see `stytchClient.ts` - resolves on the first or second try;
 * a slower one (a JWKS outage clearing up, `server/auth.ts`) still gets caught
 * well inside the five-minute JWT lifetime. Four tries and then stop: without
 * a bound this would poll forever against a session that is never coming back
 * (a real sign-out, the hard 60-minute expiry).
 */
const STALE_REPROBE_DELAYS_MS = [2_000, 5_000, 10_000, 20_000]

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
  /**
   * `authMode` is undefined only for a pre-fix server or a body that failed to
   * parse; the keep-alive effect below treats anything other than exactly
   * `'stytch'` as "do not touch the SDK", so that absence is the safe default.
   */
  | { readonly kind: 'open'; readonly authMode?: string }
  | { readonly kind: 'locked'; readonly message?: string }
  /**
   * No Stytch cookie yet, OR one the SDK's own background refresh can still
   * fix (session "stale" - see the module comment) - either way, the ordinary
   * "show the sign-in form" state, which is also what loads the SDK and lets
   * that refresh happen. `stale: true` only on the second kind, so the effect
   * below knows to keep re-probing until it clears. `message` is set ONLY
   * when the server's `staleReason` is 'keys' (server/auth.ts) - a JWKS outage
   * or an unknown signing key names something worth showing. An ordinary
   * expired-or-not-yet-valid JWT (`staleReason: 'expired'`) sets no message at
   * all: it is not evidence of a problem, it is what every sleeping tab shows
   * every few minutes, and repeating a sentence about it on each reload would
   * read as an error where there is none (ADR-31, update 2026-09-29, fourth
   * revision - this is the bug that update fixed).
   */
  | { readonly kind: 'stytch'; readonly stale?: boolean; readonly message?: string }
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
    if (response.ok) {
      // `authMode` is what tells the keep-alive effect below whether it is
      // safe to load the SDK: both 200 bodies carry it (server/app.ts), and it
      // is exactly the same string the 401 branch below already switches on.
      const body = (await response.json().catch(() => null)) as { authMode?: string } | null
      return { kind: 'open', authMode: body?.authMode }
    }
    if (response.status === 401) {
      const body = (await response.json().catch(() => null)) as {
        mode?: string
        session?: string
        refusal?: string
        staleReason?: string
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
        const stale = body.session === 'stale'
        // Shown only for a real operational problem this server hit (a JWKS
        // outage, an unknown signing key - `staleReason: 'keys'`). An ordinary
        // expired-or-not-yet-valid JWT (`staleReason: 'expired'`, or no
        // `staleReason` at all from a server older than this field) sets no
        // message: it is the routine five-minute timeout the SDK's own
        // background refresh fixes within seconds, not something worth
        // alarming a member with on every reload past five minutes (ADR-31,
        // update 2026-09-29, fourth revision).
        const message = stale && body.staleReason === 'keys' ? body.message : undefined
        return { kind: 'stytch', stale, message }
      }
      // Cloudflare Access, or an unconfigured server (wire mode "disabled" -
      // `loadAuthConfig`'s OWN config mode is called "none", but
      // `createDisabledAuthenticator` is what actually answers this request,
      // and its `Authenticator.mode` - the value on the wire - is "disabled";
      // see server/auth.ts and docs/DEPLOYMENT.md), is in front. There is no
      // password for the visitor to type; reloading is what sends them to the
      // login - except "disabled" never lets a reload succeed, so its own
      // message (already public in this 401 body) is shown instead of the
      // generic one, in case it names a forgotten setting an operator can
      // actually fix.
      return {
        kind: 'unreachable',
        message:
          body?.mode === 'disabled' && body.message
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
   * background refresh should mend by itself once it loads. `StytchSignIn`'s
   * own `session.onChange` listener is the fast path for that; this is the
   * fallback net for everything it might miss (the chunk has not finished
   * downloading yet, the refresh needed a retry). So this asks the API again
   * on a short backoff (`STALE_REPROBE_DELAYS_MS`) until the session clears,
   * proves genuinely dead, or the schedule runs out - the ref, not state, is
   * what tracks how many attempts have run: re-entering 'stytch' with the
   * SAME staleness (this effect's own probe answering "still stale") must
   * continue the count, but a FRESH stale reading once the count has already
   * reset (a new sign-in, a later reload) must start over.
   */
  const staleReprobeAttempts = useRef(0)
  useEffect(() => {
    if (state.kind !== 'stytch' || !state.stale) {
      staleReprobeAttempts.current = 0
      return undefined
    }
    const attempt = staleReprobeAttempts.current
    if (attempt >= STALE_REPROBE_DELAYS_MS.length) return undefined
    let cancelled = false
    const timer = window.setTimeout(() => {
      staleReprobeAttempts.current = attempt + 1
      void probe().then((next) => {
        if (!cancelled) setState(next)
      })
    }, STALE_REPROBE_DELAYS_MS[attempt])
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [state, probe])

  /**
   * The ONLY place `stytchKeepAlive.ts` is ever imported, and the ONLY
   * condition that triggers it: the gate is open (a valid session got the
   * studio rendered) AND this deployment is in Stytch mode. Developer,
   * password and Cloudflare Access builds never satisfy this, so they never
   * import it - the SDK stays exactly as absent from those builds as it was
   * before this effect existed (`scripts/check-worker-bundle.mjs`).
   *
   * Keyed on the boolean, not on `state` itself: the two are equivalent
   * today, since nothing sets a NEW 'open' state once this effect's own
   * `onEnded` callback below has moved past it, but the boolean says exactly
   * what this effect cares about - if 'open' ever grows a field that can
   * change without `authMode` changing with it, this stays stable instead of
   * tearing the keep-alive down and rebuilding it (dropping and
   * re-registering its `session.onChange` listener) for no reason.
   *
   * `onEnded` is what lets a session that ends for real (signed out
   * elsewhere, the hard 60-minute expiry) show the sign-in form immediately,
   * rather than waiting for the next API call to notice.
   */
  const isOpenInStytchMode = state.kind === 'open' && state.authMode === 'stytch'
  useEffect(() => {
    if (!isOpenInStytchMode) return undefined
    let cancelled = false
    let stop: (() => void) | undefined
    void import('./stytchKeepAlive')
      .then((keepAlive) => {
        if (!cancelled)
          stop = keepAlive.keepStytchSessionFresh(undefined, undefined, () => setState({ kind: 'stytch' }))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      stop?.()
    }
  }, [isOpenInStytchMode])

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
          {/* The server's own reason for 'stale', set here only when the
              server's `staleReason` was 'keys' (a JWKS outage, an unknown
              signing key) - see the GateState comment and probe() above.
              Absent for the ordinary "no cookie yet" and "JWT past its five
              minutes, refresh under way" (`staleReason: 'expired'`) cases,
              which say nothing a member needs to read while the bounded
              re-probe above and the sign-in screen's own background refresh
              sort it out. */}
          {state.kind === 'stytch' && state.message ? (
            <p className="text-muted-foreground px-9 pt-6 text-center text-sm">{state.message}</p>
          ) : null}
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
