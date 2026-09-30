/**
 * Signing out of Stytch.
 *
 * This is a separate module from `StytchSignIn.tsx` for one reason: the header
 * is mounted on every screen, and its account menu is where the sign-out
 * control lives (the header-less `WorkspaceGate` screens offer it too, through
 * the same `useSignedInIdentity`). If it reached the SDK through a normal import, the 214 KB chunk would
 * be in the first download of every page, including builds with no Stytch at
 * all — the very thing `StytchSignIn.tsx` is lazily loaded to avoid.
 *
 * So the SDK is reached through a **dynamic `import()`** - of `./stytchClient`,
 * not `@stytch/react/b2b` directly, so this reuses the SAME client instance
 * `stytchKeepAlive.ts` is keeping alive rather than building a second one.
 * `scripts/check-worker-bundle.mjs` permits this file to name the SDK for
 * exactly that reason, and evaluates it only when somebody actually clicks
 * sign out.
 *
 * Two things here are easy to get wrong and both are deliberate.
 */

/**
 * True while a call to `signOutOfStytch` below is revoking the session.
 *
 * `stytchKeepAlive.ts`'s `session.onChange` listener checks this before
 * calling its own `onEnded` callback: `revoke({ forceClear: true })` clears
 * the LOCAL session - and so fires that listener with `null` - before this
 * function's own `reload()` ever runs. Without this flag, that split second
 * shows the sign-in screen (loading its whole lazy chunk) right before the
 * page navigates away anyway - a flash of the wrong screen on the one path
 * that was never actually going back to it.
 */
let signOutInProgress = false

/** Whether a sign-out this module started is still revoking. */
export function isStytchSignOutInProgress(): boolean {
  return signOutInProgress
}

/**
 * Ends the Stytch session and reloads onto the sign-in screen.
 *
 * Returns a sentence to show the person when something went wrong, or `null`
 * when the sign-out completed and the page is about to reload.
 */
export async function signOutOfStytch(
  reload: () => void = () => window.location.assign('/'),
): Promise<string | null> {
  const token = import.meta.env.VITE_STYTCH_PUBLIC_TOKEN
  if (!token) {
    // Nothing to revoke: this build has no Stytch in it. Say so rather than
    // throwing, since the caller is a control on screens that are always there.
    return 'This studio is not using Stytch, so there is no session to end.'
  }

  try {
    const { stytchClient } = await import('./stytchClient')
    if (!stytchClient) {
      // Can't actually happen when `token` above is set - `stytchClient.ts`
      // reads the same variable - but the import's return type is nullable,
      // and this keeps that honest rather than asserting it away.
      return 'This studio is not using Stytch, so there is no session to end.'
    }

    // `forceClear` is the whole point of this function.
    //
    // Without it, `revoke()` REJECTS on a network failure and leaves the local
    // session object in place, so the person stays signed in while believing
    // they signed out. With it, the local session is cleared either way. The
    // server-side session may outlive this call when Stytch is unreachable, but
    // the token expires within about five minutes regardless (ADR-31), and a
    // visibly-still-signed-in user is the worse of the two failures.
    //
    // Set right before the call that can trigger it, not earlier - see the
    // comment on `signOutInProgress` above.
    signOutInProgress = true
    await stytchClient.session.revoke({ forceClear: true })
  } catch {
    // Reaching here means the revoke could not be delivered. The local session
    // is already cleared by `forceClear`, so carrying on to the reload is
    // correct: the browser will land on the sign-in screen either way.
    reload()
    return null
  } finally {
    signOutInProgress = false
  }

  reload()
  return null
}
