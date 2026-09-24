/**
 * The frame every sign-in screen sits in: the page ground and the card.
 *
 * Purely presentational. It knows nothing about passwords, Stytch or the API;
 * `PasswordGate` decides WHICH screen to show and puts it inside this frame,
 * so the password form, the Stytch form and the "not available" notice all
 * read as one family. Keeping the ground and the card here, rather than in the
 * gate, also keeps `StytchSignIn.tsx` down to the one job the build guard cares
 * about (being the only importer of `@stytch/react`).
 *
 * The shape comes from the owner's mockup: a very light lavender ground, the
 * studio's faint dot grid, one soft green glow to the right of the card, and a
 * white card with a square logo placeholder over the title. It is drawn with
 * the app's tokens (`--auth-*` in src/index.css) so the dark theme (ADR-29)
 * needs no second copy of anything.
 */

interface AuthGroundProps {
  readonly children: React.ReactNode
}

/**
 * The full-height page behind a sign-in card.
 *
 * `min-h-dvh` rather than `min-h-screen`: on a phone the dynamic viewport
 * height shrinks when the browser chrome is showing, and `100vh` would leave
 * the card scrolled slightly off centre. `relative` + `isolate` give the glow
 * something to be positioned against and stop its `z-index` leaking out.
 *
 * The dot grid is the studio's own (`.dot-grid`, behind the preview sheet),
 * spaced out from 16px to 24px here because on an empty page the tighter grid
 * reads as texture rather than as a faint reference plane.
 */
export function AuthGround({ children }: AuthGroundProps) {
  return (
    <main className="dot-grid bg-auth-ground text-foreground relative isolate flex min-h-dvh items-center justify-center overflow-hidden bg-[size:24px_24px] p-6">
      {/*
       * The glow. Decorative, so it is hidden from assistive technology and
       * cannot catch a click. It is a plain radial gradient on a blurred box:
       * `closest-side` makes the colour fade to nothing before the box edge, and
       * the blur softens what is left so no ring is visible on a large monitor.
       * It sits right of centre because the mockup does; nothing depends on it.
       */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-1/2 -z-10 size-[42rem] translate-x-[8%] -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,var(--auth-glow),transparent)] opacity-60 blur-3xl"
      />
      {children}
    </main>
  )
}

interface AuthCardProps {
  /** The heading. Defaults to the studio's name, which is what every screen uses today. */
  readonly title?: string
  readonly children: React.ReactNode
}

/**
 * The white card: logo placeholder, title, then whatever the screen puts inside.
 *
 * The card sets NO horizontal padding of its own below the title. The Stytch
 * form arrives with its container's own padding (40px top and bottom, 36px at
 * the sides - `MainContainer.module.css` in the SDK, not adjustable through its
 * theme without shrinking every other spacing with it), so the header here
 * uses the same 36px, and a screen that is not Stytch's wraps its content in
 * `AuthCardBody` to get the same inset. That is what keeps the three screens
 * lining up instead of each carrying a slightly different gutter.
 *
 * On a shadow: the design system says hairlines, not shadows (docs/DESIGN.md
 * principle 2), and the exception it lists is a surface floating over an
 * empty page - which is exactly what this card is. It keeps the hairline too,
 * so in dark mode, where a shadow over a dark ground disappears, the card
 * still has an edge.
 */
export function AuthCard({ title = 'Email Template Studio', children }: AuthCardProps) {
  return (
    <div className="bg-card text-card-foreground ring-foreground/10 w-full max-w-md overflow-hidden rounded-2xl shadow-[0_12px_40px_-16px_oklch(0_0_0/0.22)] ring-1 dark:shadow-[0_12px_40px_-16px_oklch(0_0_0/0.7)]">
      <div className="flex flex-col items-center px-9 pt-10 text-center">
        {/*
         * A placeholder, on purpose: the studio has no logo yet and the mockup
         * shows the square it will go in. Decorative until it is an image with
         * a name, so it is hidden from assistive technology.
         */}
        <div aria-hidden="true" className="bg-auth-tint size-16 rounded-xl" />
        <h1 className="mt-5 text-xl font-semibold tracking-tight">{title}</h1>
      </div>
      {children}
    </div>
  )
}

interface AuthCardBodyProps {
  readonly children: React.ReactNode
}

/**
 * The inset a non-Stytch screen uses under the title, matched to the Stytch
 * container's own padding so the password form and the Stytch form put their
 * first control at the same place.
 */
export function AuthCardBody({ children }: AuthCardBodyProps) {
  return <div className="px-9 pt-10 pb-10">{children}</div>
}
