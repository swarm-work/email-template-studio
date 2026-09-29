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
 */
import { stytchClient as defaultClient } from './stytchClient'

/** The parts of the Stytch client this module actually touches. */
interface KeepAliveClient {
  readonly session: {
    getSync(): unknown
    authenticate(): Promise<unknown>
    onChange(callback: (session: unknown) => void): () => void
  }
}

/**
 * Starts the keep-alive and returns a cleanup function.
 *
 * `client` and `doc` are overridable for tests only; every real caller leaves
 * them at their defaults, which is what makes this the same client instance
 * `StytchSignIn.tsx` and `stytchSignOut.ts` use (see `stytchClient.ts`'s
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
): () => void {
  if (!client) return () => undefined

  // A tab's `setTimeout` does not fire while the tab is suspended (mobile
  // Safari backgrounding, laptop sleep), so a long-asleep tab can wake up with
  // a JWT older than the SDK thinks it is. No `session_duration_minutes` here
  // on purpose: this only refreshes the JWT, it must never extend the
  // session's own 60-minute lifetime just because a tab happened to be open.
  const onVisible = () => {
    if (doc.visibilityState === 'visible' && client.session.getSync()) {
      void client.session.authenticate()
    }
  }
  doc.addEventListener('visibilitychange', onVisible)

  const unsubscribe = client.session.onChange((session) => {
    if (!session) onEnded?.()
  })

  return () => {
    doc.removeEventListener('visibilitychange', onVisible)
    unsubscribe()
  }
}
