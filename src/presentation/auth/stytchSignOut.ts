/**
 * Signing out of Stytch.
 *
 * This is a separate module from `StytchSignIn.tsx` for one reason: the header
 * is mounted on every screen, and the header is where the sign-out control
 * lives. If it reached the SDK through a normal import, the 214 KB chunk would
 * be in the first download of every page, including builds with no Stytch at
 * all — the very thing `StytchSignIn.tsx` is lazily loaded to avoid.
 *
 * So the SDK is reached through a **dynamic `import()`**, evaluated only when
 * somebody actually clicks sign out. `scripts/check-worker-bundle.mjs` permits
 * this file to name the package for exactly that reason.
 *
 * Two things here are easy to get wrong and both are deliberate.
 */

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
    // throwing, since the caller is a button in a header that is always there.
    return 'This studio is not using Stytch, so there is no session to end.'
  }

  try {
    const { createStytchB2BClient } = await import('@stytch/react/b2b')
    const client = createStytchB2BClient(token)

    // `forceClear` is the whole point of this function.
    //
    // Without it, `revoke()` REJECTS on a network failure and leaves the local
    // session object in place, so the person stays signed in while believing
    // they signed out. With it, the local session is cleared either way. The
    // server-side session may outlive this call when Stytch is unreachable, but
    // the token expires within about five minutes regardless (ADR-31), and a
    // visibly-still-signed-in user is the worse of the two failures.
    await client.session.revoke({ forceClear: true })
  } catch {
    // Reaching here means the revoke could not be delivered. The local session
    // is already cleared by `forceClear`, so carrying on to the reload is
    // correct: the browser will land on the sign-in screen either way.
    reload()
    return null
  }

  reload()
  return null
}
