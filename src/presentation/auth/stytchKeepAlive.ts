/**
 * Keeps the Stytch session JWT fresh for as long as the studio stays open.
 *
 * Importing this module - not calling anything in it - is what starts the
 * refresh: `stytchClient.ts`'s constructor calls `performBackgroundRefresh()`
 * immediately when the `stytch_session` cookie exists (`StytchB2BClient.mjs`),
 * and its `SessionManager` then re-runs that every three minutes on its own
 * (`SessionManager.mjs`'s `REFRESH_INTERVAL_MS`). So the only job left here is
 * the two things the SDK does NOT do by itself: catch a tab waking from sleep
 * (the interval timer does not fire while the tab was suspended) and tell the
 * caller when the session really ends.
 *
 * `PasswordGate.tsx` reaches this file through a dynamic `import()`, only once
 * the gate is open in Stytch mode - never in developer, password or Access
 * mode, and never before the gate has actually opened. That keeps this out of
 * the first download exactly like `stytchSignOut.ts` (see
 * `scripts/check-worker-bundle.mjs`), even though, unlike that file, nothing
 * here names the SDK package directly - it only imports `stytchClient.ts`.
 *
 * The wake-up call is throttled (`MIN_HIDDEN_MS_TO_REFRESH`,
 * `MIN_MS_SINCE_LAST_REFRESH` below), so an ordinary alt-tab or a burst of
 * `visibilitychange` events costs at most one network round trip, and its
 * failure is swallowed - a tab waking with no network yet must not print
 * "Uncaught (in promise)" to the console for a call whose result nothing here
 * needs to act on.
 */
import { stytchClient as defaultClient } from './stytchClient'
import { isStytchSignOutInProgress } from './stytchSignOut'

/** The parts of the Stytch client this module actually touches. */
interface KeepAliveClient {
  readonly session: {
    /** `last_accessed_at` (an RFC 3339 timestamp) is what the throttle below reads. */
    getSync(): { readonly last_accessed_at?: unknown } | null
    authenticate(): Promise<unknown>
    onChange(callback: (session: unknown) => void): () => void
  }
}

/**
 * A tab must have been hidden at least this long before waking it is worth an
 * extra `authenticate()` call. An ordinary backgrounded tab - switched away
 * from, not suspended - keeps its timers running (throttled, not stopped), so
 * the SDK's own three-minute interval (`SessionManager.mjs`) is almost
 * certainly still doing its job underneath anything shorter; calling again on
 * every quick alt-tab would just be noise the SDK is already covering.
 */
const MIN_HIDDEN_MS_TO_REFRESH = 2 * 60 * 1000

/**
 * Skip the call, even after a long-enough sleep, if the session was refreshed
 * more recently than this. Read from the SDK's own `last_accessed_at`
 * (`MemberSession`) rather than from a timestamp this module keeps itself, so
 * it also sees the SDK's OWN three-minute interval landing while the tab was
 * hidden - a background tab's timers are throttled, not stopped, so that
 * interval keeps a real chance of firing on its own even through a sleep just
 * over the threshold above.
 */
const MIN_MS_SINCE_LAST_REFRESH = 2 * 60 * 1000

/**
 * Starts the keep-alive and returns a cleanup function.
 *
 * `client`, `doc` and `now` are overridable for tests only; every real caller
 * leaves them at their defaults, which is what makes `client` the same
 * instance `StytchSignIn.tsx` and `stytchSignOut.ts` use (see `stytchClient.ts`'s
 * module comment on why a second instance would be worse than none).
 *
 * `onEnded`, if given, fires once the session is really gone (signed out
 * elsewhere, or the hard 60-minute expiry) - not on every refresh - so the
 * gate can show sign-in again instead of leaving a dead session parked behind
 * an open studio.
 */
export function keepStytchSessionFresh(
  client: KeepAliveClient | null = defaultClient,
  doc: Document = document,
  onEnded?: () => void,
  now: () => number = () => Date.now(),
): () => void {
  if (!client) return () => undefined

  // A tab's `setTimeout` does not fire while the tab is suspended (mobile
  // Safari backgrounding, laptop sleep), so a long-asleep tab can wake up with
  // a JWT older than the SDK thinks it is. No `session_duration_minutes` here
  // on purpose: this only refreshes the JWT, it must never extend the
  // session's own 60-minute lifetime just because a tab happened to be open.
  //
  // `hiddenSince` is seeded from the CURRENT state rather than left undefined,
  // so a keep-alive that starts while the tab is already hidden (this is
  // reached once the gate opens, which a background tab can already be) still
  // measures from a real moment instead of never being able to trigger at all.
  let hiddenSince: number | undefined = doc.visibilityState === 'hidden' ? now() : undefined

  const onVisible = () => {
    if (doc.visibilityState !== 'visible') {
      hiddenSince = now()
      return
    }
    const hiddenForMs = hiddenSince === undefined ? 0 : now() - hiddenSince
    hiddenSince = undefined
    if (hiddenForMs < MIN_HIDDEN_MS_TO_REFRESH) return

    const session = client.session.getSync()
    if (!session) return

    const lastAccessedAt = Date.parse(String(session.last_accessed_at ?? ''))
    if (Number.isFinite(lastAccessedAt) && now() - lastAccessedAt < MIN_MS_SINCE_LAST_REFRESH) return

    // A tab waking with no network yet (or ever) must not print "Uncaught (in
    // promise)" to the console: this call failing changes nothing the caller
    // needs to react to here - the JWT is still whatever it was, and the next
    // successful wake, or the ordinary sign-in screen's own background
    // refresh, catches up later.
    void client.session.authenticate().catch(() => undefined)
  }
  doc.addEventListener('visibilitychange', onVisible)

  const unsubscribe = client.session.onChange((session) => {
    // Skipped while the member's OWN sign-out is revoking (`stytchSignOut.ts`):
    // that call is already reloading the page once it finishes, so calling
    // `onEnded` here would only flash the sign-in screen's lazy chunk in the
    // instant before that reload happens anyway.
    if (!session && !isStytchSignOutInProgress()) onEnded?.()
  })

  return () => {
    doc.removeEventListener('visibilitychange', onVisible)
    unsubscribe()
  }
}
