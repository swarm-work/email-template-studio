/**
 * Who is signed in, and whether there is a session this studio can end.
 *
 * Presentation layer. One hook so the header and the screens rendered OUTSIDE
 * the header (`WorkspaceGate`: no workspace, unknown workspace, list error) ask
 * the same question the same way; before it, a person with no workspace had no
 * way to sign out at all.
 *
 * The status route already echoes the caller's email back, so this needs no
 * new endpoint. `authMode` decides whether sign-out exists at all: under
 * Cloudflare Access signing out is the identity provider's business, and under
 * the shared password or the developer identity there is no session to end
 * (ADR-31).
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

export interface SignedInIdentity {
  /** The email the API names, or undefined before it answers (or if it fails). */
  readonly signedInAs?: string
  /** Ends the Stytch session. Present only in Stytch mode, so a control can hang off it. */
  readonly onSignOut?: () => void
}

/**
 * Imported on click, not at the top of the file: the header is on every screen,
 * and a static import would pull the Stytch chunk into the first download of
 * every build (see src/presentation/auth/stytchSignOut.ts).
 *
 * Never fails silently. On a header-less gate screen this button is the only
 * way out, so a sentence from `signOutOfStytch` is shown as a toast, and a
 * chunk that will not load (a deploy replaced it) reloads the page, which
 * fetches the new one.
 */
function signOut(): void {
  void import('./stytchSignOut')
    .then(({ signOutOfStytch }) => signOutOfStytch())
    .then((problem) => {
      if (problem) toast.error(problem)
    })
    .catch(() => window.location.reload())
}

export function useSignedInIdentity(): SignedInIdentity {
  const [identity, setIdentity] = useState<SignedInIdentity>({})

  useEffect(() => {
    let cancelled = false
    void fetch('/api/send-test/status', { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) return null
        return (await response.json()) as { user?: string; authMode?: string }
      })
      .then((body) => {
        if (cancelled || !body) return
        setIdentity({ signedInAs: body.user, onSignOut: body.authMode === 'stytch' ? signOut : undefined })
      })
      // A failure here costs the name and the sign-out control and nothing
      // else. The gate above has already decided whether the studio opens.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return identity
}
