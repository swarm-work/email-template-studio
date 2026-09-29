/**
 * The Stytch sign-in screen.
 *
 * **This is one of three modules allowed to name the Stytch SDK** - the build
 * guard in `scripts/check-worker-bundle.mjs` enforces that, and `npm run build`
 * fails if anything else does. The other two are `stytchClient.ts` (the one
 * place the client is actually built - this file just imports it, so sign-in
 * and the keep-alive share one session manager) and `stytchSignOut.ts`. This
 * file exists separately because it is reached only through `React.lazy`, so
 * the SDK is downloaded and its side effects run ONLY in a build that is
 * actually using Stytch.
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
 *
 * The page ground, the card, the logo square and the title are NOT here: they
 * are `AuthScreen.tsx`, drawn by `PasswordGate` around this component. This
 * file only makes the prebuilt form fit inside that card.
 */
import { useEffect, useState } from 'react'
import {
  B2BProducts,
  StytchB2B,
  StytchB2BProvider,
  StytchEventType,
  shadcnTheme,
  type Callbacks,
  type PresentationConfig,
  type Strings,
  type StytchEvent,
  type Theme,
} from '@stytch/react/b2b'
import { AUTHENTICATE_PATH } from './authenticatePath'
import { SESSION_IDLE_TIMEOUT_MINUTES, stytchClient as client } from './stytchClient'

/** Where Stytch sends the browser back to. Must match a Redirect URL exactly. */
function redirectUrl(): string {
  return `${window.location.origin}${AUTHENTICATE_PATH}`
}

/**
 * How the prebuilt form is drawn, so it looks like part of the studio rather
 * than a widget dropped into it.
 *
 * Stytch's UI renders into the ordinary page (a shadow root is opt-in via
 * `enableShadowDOM`, which is left off) and styles itself entirely through
 * `--st-*` CSS variables that this object becomes. The `shadcn` preset points
 * every one of those at the app's own tokens - `var(--primary)`,
 * `var(--border)`, `var(--font-sans)` and so on. The card around this form
 * pins those tokens to their light values (`theme-light` in `AuthScreen.tsx`),
 * so the form is light too, whatever the app theme, with no theme switching
 * here and no second palette.
 *
 * The overrides on top of the preset:
 * - The form must FILL the card, not be a second card inside it. So its
 *   container is full width, square-cornered, borderless and transparent.
 * - `background` is transparent for that reason, and it is shared: inputs and
 *   the outline (Google) button paint with the same variable, so they come
 *   out white on the white card with a hairline - the studio's own input look.
 *   The mockup's tinted input fill is not reachable without tinting the whole
 *   container too, and the hairline wins that trade.
 * - Two preset values reach for Tailwind variables the studio's stylesheet
 *   does not emit (`--breakpoint-sm`, `--shadow`); they are pinned to plain
 *   values so the result does not depend on which utilities happen to be in
 *   use elsewhere. No shadow on controls is the design system's rule anyway.
 * - Buttons and inputs take the studio's 8px control radius (`--radius`), not
 *   the preset's derived 6.4px, so they match the password form's controls.
 */
const theme: Theme = {
  ...shadcnTheme,
  'container-width': '100%',
  'container-radius': '0',
  'container-border': 'transparent',
  background: 'transparent',
  'mobile-breakpoint': '768px',
  shadow: 'none',
  'button-radius': 'var(--radius)',
  'input-radius': 'var(--radius)',
}

const presentation: PresentationConfig = {
  theme,
  options: {
    // The card already carries the title, so the SDK's own "Sign up or log in"
    // heading is dropped. This hides the description with it.
    hideHeaderText: true,
  },
}

/**
 * Wording changes. Keys are the SDK's message ids; anything not listed keeps
 * its English default. The email field's visible label ("Email") is NOT
 * something these can bring back: the discovery form renders it visually
 * hidden and exposes no option for that, so the placeholder does the
 * explaining on its own.
 */
const strings: Strings = {
  'formField.email.placeholder': 'developer@company.com',
  'methodDivider.text': 'OR',
}

/**
 * The SDK events after which a real Stytch session exists.
 *
 * A Discovery sign-in ends in one of two places: the member picked an existing
 * organisation (intermediate session EXCHANGE) or made a new one (organizations
 * CREATE). Only then is the session cookie the Worker verifies actually set;
 * the OAuth/magic-link "authenticate" events before it only yield an
 * intermediate session, which the Worker rightly rejects. The other three are
 * the non-discovery flows, listed so this stays correct if the flow type ever
 * changes; today they never fire.
 *
 * Without this hook nothing tells the gate that sign-in finished: it probed the
 * API once on mount, got 401, and would sit on the form until a manual reload.
 */
const SIGNED_IN_EVENTS: ReadonlySet<StytchEventType> = new Set([
  StytchEventType.B2BDiscoveryIntermediateSessionExchange,
  StytchEventType.B2BDiscoveryOrganizationsCreate,
  StytchEventType.B2BOAuthAuthenticate,
  StytchEventType.B2BMagicLinkAuthenticate,
  StytchEventType.B2BSSOAuthenticate,
])

/**
 * How long the "Restoring your session…" message is shown before giving up on
 * the background refresh and falling back to the ordinary Discovery form.
 *
 * This screen is reached with a cached-but-stale session (the gate's probe
 * said 'stale' - see PasswordGate.tsx) more often than with no session at
 * all, now that `stytchKeepAlive.ts` keeps the JWT fresh for as long as the
 * studio stays open: the case left here is a tab that was asleep long enough
 * for the keep-alive's own refresh to miss, or the moment right after this
 * chunk finishes downloading. The SDK's constructor already kicked off
 * `performBackgroundRefresh()` (`StytchB2BClient.mjs`) before this component
 * had a chance to render, so this is usually seconds, not minutes - but a
 * genuinely dead session (signed out elsewhere, an hour without use) must
 * not leave a member staring at this sentence forever.
 */
const RESTORE_TIMEOUT_MS = 5_000

interface StytchSignInProps {
  /** Called once Stytch holds a full session, so the gate can ask the API again. */
  readonly onSignedIn?: () => void
}

export default function StytchSignIn({ onSignedIn }: StytchSignInProps) {
  // A cached session (the SDK keeps the last one in `localStorage`) means the
  // background refresh from the client constructor might resolve it into a
  // real session before the member ever needs to see the Discovery form - see
  // `RESTORE_TIMEOUT_MS`. `useState`'s lazy initialiser reads this once, at
  // mount, which is exactly when it is useful: later renders keep whatever
  // this component decided the first time.
  //
  // On the `/authenticate` callback specifically, this ALWAYS starts false,
  // even when an older session cookie makes `getSync()` truthy: "restoring"
  // renders the placeholder text below instead of `<StytchB2B>`, which is the
  // ONE component that actually consumes the magic-link/OAuth token sitting in
  // this URL. Starting "restoring" here would hide it behind that text for up
  // to `RESTORE_TIMEOUT_MS`, and unless the earlier session happens to end
  // first, the token in the URL is never consumed at all - the round trip
  // silently does nothing.
  const [restoring, setRestoring] = useState(() => {
    if (typeof window !== 'undefined' && window.location.pathname === AUTHENTICATE_PATH) return false
    return Boolean(client?.session.getSync())
  })

  // Not from `onEvent` below: a background refresh is not a UI mutation, so it
  // fires no Stytch UI event at all (`ui/b2b/utils.mjs`). `session.onChange`
  // is the one hook that also sees THAT kind of update.
  //
  // No `fromCache` check here: the SDK marks its cache refreshed BEFORE it
  // notifies `onChange` (`SessionManager.mjs`), so by the time this callback
  // runs, `getInfo().fromCache` already reads `false` for every notification -
  // checking it here always passed and caught nothing. Any non-null session
  // notification - a completed background refresh, a fresh sign-in - is real
  // enough to ask the API again.
  useEffect(() => {
    if (!client) return undefined
    // A local alias so the callback below closes over a binding TypeScript
    // knows is non-null, rather than the imported one (which it treats as
    // possibly reassigned across the closure boundary).
    const activeClient = client
    return activeClient.session.onChange((session) => {
      if (session) {
        onSignedIn?.()
      } else {
        // The cached session turned out to be gone for real (revoked, or the
        // refresh failed outright) - stop waiting and show the sign-in form.
        setRestoring(false)
      }
    })
  }, [onSignedIn])

  useEffect(() => {
    if (!restoring) return undefined
    const timer = window.setTimeout(() => setRestoring(false), RESTORE_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [restoring])

  // Rebuilt per render on purpose: it closes over `onSignedIn`, and the SDK
  // reads `callbacks` on each event rather than caching the first one.
  const callbacks: Callbacks = {
    onEvent: (event: StytchEvent) => {
      if (SIGNED_IN_EVENTS.has(event.type)) onSignedIn?.()
    },
  }

  if (client && restoring) {
    return (
      <div className="text-muted-foreground px-9 pt-10 pb-10 text-center text-sm">
        Restoring your session…
      </div>
    )
  }

  if (!client) {
    return (
      <div className="text-muted-foreground px-9 pt-10 pb-10 text-sm">
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
      <StytchB2B
        callbacks={callbacks}
        config={{
          // Discovery: the member types their address and Stytch works out
          // which organisation they belong to. The organisation's
          // `email_allowed_domains` plus RESTRICTED JIT provisioning is what
          // is SUPPOSED to keep this to swarm.work addresses, but the Stytch
          // project also has `create_organization_enabled` on, which lets a
          // stranger mint their own organisation with no domain restriction at
          // all. The actual lock is server-side: `STYTCH_ALLOWED_ORGANIZATIONS`
          // in the Worker (ADR-31, update 2026-09-29), checked in
          // `server/auth.ts` against the token's organisation slug after this
          // form has already handed back a session.
          authFlowType: 'Discovery',
          products: [B2BProducts.emailMagicLinks, B2BProducts.oauth],
          sessionOptions: { sessionDurationMinutes: SESSION_IDLE_TIMEOUT_MINUTES },
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
        presentation={presentation}
        strings={strings}
      />
    </StytchB2BProvider>
  )
}
