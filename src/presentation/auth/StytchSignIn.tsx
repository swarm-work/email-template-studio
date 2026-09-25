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
 *
 * The page ground, the card, the logo square and the title are NOT here: they
 * are `AuthScreen.tsx`, drawn by `PasswordGate` around this component. This
 * file only makes the prebuilt form fit inside that card.
 */
import {
  B2BProducts,
  StytchB2B,
  StytchB2BProvider,
  StytchEventType,
  createStytchB2BClient,
  shadcnTheme,
  type Callbacks,
  type PresentationConfig,
  type Strings,
  type StytchEvent,
  type Theme,
} from '@stytch/react/b2b'

/**
 * One hour, for now - and an open decision (docs/STYTCH_LOG.md, decision 1).
 *
 * It was twelve hours, to match the shared-password session it replaces. On
 * 2026-09-24 the first sign-in that ever completed did so with this lowered to
 * 60, in the same change that fixed the double Stytch client; twelve has not
 * been re-tried since. Stytch sends this value on the discovery exchange, and
 * the project has a maximum session duration in its dashboard. Whether that
 * ceiling rejects a larger request or silently truncates it was never
 * observed either way, so: raise the ceiling first, then raise this, and
 * watch the exchange call once.
 *
 * This is the SESSION length, not the token's. The JWT itself lives about five
 * minutes and the SDK refreshes it in the background; see `server/auth.ts`.
 */
const SESSION_DURATION_MINUTES = 60

/** Where Stytch sends the browser back to. Must match a Redirect URL exactly. */
function redirectUrl(): string {
  return `${window.location.origin}/authenticate`
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
 * The Stytch client, created ONCE, at module scope.
 *
 * Not inside the component, and not in a `useMemo`: React's StrictMode calls
 * `useMemo` initialisers twice in development, which built two clients, each
 * with its own session manager and bootstrap fetch. Stytch warns about exactly
 * this ("multiple copies of the Stytch client ... unintended side effects"),
 * and a session exchange racing against a second session manager is the kind
 * of side effect it means. Module scope runs once per page load, full stop.
 *
 * This is still safe for the lazy seam: this module is only ever imported
 * through `React.lazy` from PasswordGate, in stytch mode, so "module scope"
 * here means "the moment sign-in is actually needed", not app start-up.
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
const client = PUBLIC_TOKEN ? createStytchB2BClient(PUBLIC_TOKEN) : null

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

interface StytchSignInProps {
  /** Called once Stytch holds a full session, so the gate can ask the API again. */
  readonly onSignedIn?: () => void
}

export default function StytchSignIn({ onSignedIn }: StytchSignInProps) {
  // Rebuilt per render on purpose: it closes over `onSignedIn`, and the SDK
  // reads `callbacks` on each event rather than caching the first one.
  const callbacks: Callbacks = {
    onEvent: (event: StytchEvent) => {
      if (SIGNED_IN_EVENTS.has(event.type)) onSignedIn?.()
    },
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
        presentation={presentation}
        strings={strings}
      />
    </StytchB2BProvider>
  )
}
