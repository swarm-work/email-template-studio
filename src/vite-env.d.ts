/// <reference types="vite/client" />

/** The installed @react-email/components version, injected at build time. */
declare const __REACT_EMAIL_VERSION__: string

/** Build-time variables the app reads. Vite inlines these into the bundle. */
interface ImportMetaEnv {
  /**
   * Which template store to use. 'http' (the default, and what an unset value
   * means) talks to the D1-backed API; 'memory' runs the studio with no
   * database at all, and everything it writes is gone on reload.
   */
  readonly VITE_DATA_MODE?: 'memory' | 'http'

  /**
   * The Stytch PUBLIC token, used by the browser SDK to identify the project.
   * Public by design - it is visible in the shipped bundle - and not the same
   * thing as the Stytch project SECRET, which belongs nowhere in this repository.
   *
   * It is a BUILD-TIME value and a wrangler `var` cannot deliver it: Vite inlines
   * `VITE_`-prefixed variables into the bundle when the bundle is built, long
   * before any Worker configuration is read. A CI job that builds without it in
   * the environment ships a bundle with an undefined token over a working one,
   * and nothing fails loudly - which is why it is declared here rather than left
   * to `import.meta.env`'s index signature, and why it is set from a repository
   * variable in `.github/workflows/ci.yml`.
   *
   * Locally it goes in `.env.local`. Leaving it unset is the correct state for
   * any build that is not using Stytch, including the Playwright suite.
   */
  readonly VITE_STYTCH_PUBLIC_TOKEN?: string
}
