/// <reference types="vite/client" />

/** Injected at build time from package.json (see vite.config.ts). */
declare const __APP_VERSION__: string

/** Build-time variables the app reads. Vite inlines these into the bundle. */
interface ImportMetaEnv {
  /** Which template store to use: 'memory' (default) or 'http' (phase 7b). */
  readonly VITE_DATA_MODE?: 'memory' | 'http'
}
