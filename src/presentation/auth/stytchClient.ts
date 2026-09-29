/**
 * The one place the Stytch client is built.
 *
 * Both `StytchSignIn.tsx` (the sign-in form) and `stytchSignOut.ts` (sign-out)
 * import `stytchClient` from here rather than building one of their own, and so
 * does `stytchKeepAlive.ts` (the background refresh - see that file). A second
 * `createStytchB2BClient` call would mean a second session manager, and
 * Stytch's own registry cancels the OLDER one's background refresh the moment
 * a second client registers (`SessionManager.mjs`'s `SessionManagerRegistry`)
 * - so a second client does not merely waste memory, it silently kills the
 * refresh the first one was running.
 *
 * This file still only ever loads through a dynamic `import()` or through
 * `StytchSignIn.tsx`, which is itself reached only via `React.lazy` - see that
 * file's module comment and `scripts/check-worker-bundle.mjs`. So the SDK is
 * still never in the first download of a build that is not using Stytch.
 */
import { createStytchB2BClient } from '@stytch/react/b2b'

/**
 * The Stytch client, created ONCE, at module scope.
 *
 * Not inside a component, and not in a `useMemo`: React's StrictMode calls
 * `useMemo` initialisers twice in development, which built two clients, each
 * with its own session manager and bootstrap fetch. Stytch warns about exactly
 * this ("multiple copies of the Stytch client ... unintended side effects"),
 * and a session exchange racing against a second session manager is the kind
 * of side effect it means. Module scope runs once per page load, full stop.
 *
 * This is still safe for the lazy seam: this module is only ever reached
 * through `React.lazy` (via `StytchSignIn.tsx`) or a dynamic `import()` (via
 * `stytchSignOut.ts` and `stytchKeepAlive.ts`), so "module scope" here means
 * "the moment Stytch is actually needed", not app start-up.
 *
 * `createStytchB2BClient` reads the PUBLIC token. It is public by design and
 * ships in the bundle; the project SECRET is a different credential and lives
 * nowhere in this repository.
 *
 * Vite inlines the token at BUILD time, so an unset variable is baked in as
 * `undefined` and cannot be fixed by a Worker `var`. That is why the build
 * step sets it from a repository variable, and why the null branch below
 * exists: Stytch's own token check only logs a warning, which is easy to miss.
 */
const PUBLIC_TOKEN = import.meta.env.VITE_STYTCH_PUBLIC_TOKEN
export const stytchClient = PUBLIC_TOKEN ? createStytchB2BClient(PUBLIC_TOKEN) : null
