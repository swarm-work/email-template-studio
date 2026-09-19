/// <reference types="vite/client" />

/** Injected at build time from package.json (see vite.config.ts). */
declare const __APP_VERSION__: string

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
}
