import { expect, it } from 'vitest'
// Vite's `?raw`, not `node:fs`: this file runs in the jsdom/node vitest
// environment inside `src`, whose tsconfig carries no Node types (see
// `themeBootstrap.test.ts` for the same pattern) - `?raw` reads the file as
// plain text through Vite's own pipeline instead.
import stytchClientSource from './stytchClient.ts?raw'

/**
 * A cheap tripwire, not a real safety net.
 *
 * Every test in this project mocks `./stytchClient` (see
 * `stytchKeepAlive.test.ts`, `StytchSignIn.test.tsx`, `PasswordGate.test.tsx`),
 * so nothing here ever runs the REAL client construction, and no behavioral
 * test would ever notice a well-meaning "simplification" that passes the
 * SDK's auto-extend-on-every-background-refresh option back into
 * `createStytchB2BClient` - see that file's own module comment for why that
 * option must stay out: it would let any open, untouched tab keep a session
 * alive forever. This just greps the source for that option's literal name,
 * so at least a plain text search back into the file fails CI instead of
 * shipping silently. It is deliberately NOT spelled out in `stytchClient.ts`'s
 * own comment, so that comment can never trip this same check.
 */
it('never re-introduces the SDK option that auto-extends a session on every background refresh', () => {
  expect(stytchClientSource).not.toContain('keepSessionAlive')
})

/**
 * Every test that touches Stytch mocks this whole module, so nothing would
 * otherwise notice this constant quietly drifting from 60 - the one number
 * `StytchSignIn.tsx` (sign-in) and `stytchKeepAlive.ts` (every extension) are
 * both supposed to agree on. A plain text search back into the source is a
 * cheap tripwire for that, same as the check above. The match is anchored to
 * the end of the line on purpose: a plain "contains" check would also pass for
 * `600` or `60 * 12` (720 minutes, twelve hours), which is exactly the drift
 * this exists to catch.
 */
it('still sets SESSION_IDLE_TIMEOUT_MINUTES to 60', () => {
  expect(stytchClientSource).toMatch(/SESSION_IDLE_TIMEOUT_MINUTES = 60\s*$/m)
})
