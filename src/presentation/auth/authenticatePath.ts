/**
 * The path Stytch redirects back to after a magic link or an OAuth round trip.
 * The SPA has no router: `wrangler.jsonc` serves index.html for unknown paths
 * (`not_found_handling: "single-page-application"`), so a pathname check is
 * the whole of the routing.
 *
 * Shared by `PasswordGate.tsx` (which routes on it) and `StytchSignIn.tsx`
 * (which builds the redirect URL Stytch is configured to send back to, and
 * decides its initial "restoring" state from it), so the two can never drift
 * apart. Must match a Redirect URL exactly in the Stytch dashboard. Do NOT add
 * it to `run_worker_first` in `wrangler.jsonc` - sending it to the Worker
 * would break the callback.
 */
export const AUTHENTICATE_PATH = '/authenticate'
