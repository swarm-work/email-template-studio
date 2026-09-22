/**
 * The Stytch sign-in screen.
 *
 * **This is the one module allowed to import `@stytch/react`** — the build guard
 * in `scripts/check-worker-bundle.mjs` enforces that, and `npm run build` fails
 * if anything else does. It exists as a separate file for exactly that reason:
 * it is reached only through `React.lazy`, so the SDK is downloaded and its side
 * effects run ONLY in a build that is actually using Stytch.
 *
 * That is not a size optimisation, it is what keeps the Playwright suite green.
 * The e2e build runs on `STUDIO_DEV_IDENTITY` with no Stytch configured, and all
 * five spec files fail on any unexpected browser console error. A plain
 * top-level import in a conditionally rendered component still ships and still
 * initialises, so "we only render it in stytch mode" would not be enough.
 *
 * Everything here is the B2B family (`@stytch/react/b2b`). Do not mix it with
 * the Consumer family: the names are similar, the imports are not
 * interchangeable, and mixing them fails in confusing ways (ADR-31).
 */
import { useMemo } from 'react'
import { B2BProducts, StytchB2B, StytchB2BProvider, createStytchB2BClient } from '@stytch/react/b2b'

/**
 * Twelve hours, matching the shared-password session it replaces.
 *
 * This is the SESSION length, not the token's. The JWT itself lives about five
 * minutes and the SDK refreshes it in the background; see `server/auth.ts`.
 * The Stytch dashboard's `max_session_duration_minutes` is a CEILING that
 * silently truncates a larger request, so check it there before raising this.
 */
const SESSION_DURATION_MINUTES = 12 * 60

/** Where Stytch sends the browser back to. Must match a Redirect URL exactly. */
function redirectUrl(): string {
  return `${window.location.origin}/authenticate`
}

export default function StytchSignIn() {
  // `createStytchB2BClient` reads the PUBLIC token. It is public by design and
  // ships in the bundle; the project SECRET is a different credential and lives
  // nowhere in this repository.
  //
  // Vite inlines this at BUILD time, so an unset variable is baked in as
  // `undefined` and cannot be fixed by a Worker `var`. That is why the build
  // step sets it from a repository variable, and why the guard below exists:
  // Stytch's own token check only logs a warning, which is easy to miss.
  const token = import.meta.env.VITE_STYTCH_PUBLIC_TOKEN
  const client = useMemo(() => (token ? createStytchB2BClient(token) : null), [token])

  if (!client) {
    return (
      <div className="text-muted-foreground mx-auto max-w-md p-6 text-sm">
        <p className="text-foreground font-medium">Sign-in is not configured.</p>
        <p className="mt-2">
          The studio is set to use Stytch, but this build carries no{' '}
          <code className="font-mono">VITE_STYTCH_PUBLIC_TOKEN</code>. It is a build-time value: rebuild with
          it set, or remove <code className="font-mono">STYTCH_PROJECT_ID</code> from the Worker to fall back
          to the password gate. See <code className="font-mono">docs/DEPLOYMENT.md</code>.
        </p>
      </div>
    )
  }

  return (
    <StytchB2BProvider stytch={client}>
      <div className="mx-auto max-w-md p-6">
        <StytchB2B
          config={{
            // Discovery: the member types their address and Stytch works out
            // which organisation they belong to. The organisation's
            // `email_allowed_domains` plus RESTRICTED JIT provisioning is what
            // keeps this to swarm.work addresses (ADR-31) - there is no
            // allow-list in the Worker doing that job.
            authFlowType: 'Discovery',
            products: [B2BProducts.emailMagicLinks, B2BProducts.oauth],
            sessionOptions: { sessionDurationMinutes: SESSION_DURATION_MINUTES },
            emailMagicLinksOptions: {
              discoveryRedirectURL: redirectUrl(),
              loginRedirectURL: redirectUrl(),
              signupRedirectURL: redirectUrl(),
            },
            oauthOptions: {
              discoveryRedirectURL: redirectUrl(),
              loginRedirectURL: redirectUrl(),
              signupRedirectURL: redirectUrl(),
              providers: [{ type: 'google' }],
            },
          }}
        />
      </div>
    </StytchB2BProvider>
  )
}
