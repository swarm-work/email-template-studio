/**
 * The editor themes a visual template can be authored with.
 *
 * Infrastructure layer: it describes the editor package's `ThemeConfig` shape,
 * so the type comes from that package — but as a TYPE ONLY, which TypeScript
 * erases, so no runtime import of the 2.5 MB editor leaks out of the lazy chunk.
 *
 * A theme is not in the document: `getJSON()` does not carry it, so each saved
 * version stores its theme's NAME (`TemplateRecord.theme`) and the studio
 * passes the matching config back as the editor's `theme` prop (ADR-18).
 */
import type { ThemeConfig } from '@react-email/editor/plugins'

/**
 * The studio's one theme. Frozen per version and not user-switchable in v1
 * (docs/TECH_DEBT.md: theme picker), so a template always re-opens looking the
 * way it was saved.
 */
export const DEFAULT_STUDIO_THEME = 'studio-v1'

/**
 * The font stack, written once. `Geist Variable` is the studio's own face — the
 * exact family name `@fontsource-variable/geist` registers, so the canvas
 * really does render in it — and everything after it is a face that exists on a
 * normal desktop, which is what keeps an Outlook rendering the same size and
 * shape as a Gmail one. No mail client has Geist, so the fallbacks are what a
 * reader will actually see.
 *
 * `FontFallbackNote` in the inspector explains this stack to the person
 * editing, and reads it from here so the note can never drift from the export.
 */
export const STUDIO_FONT_STACK = "'Geist Variable', -apple-system, 'Segoe UI', Arial, sans-serif"

/**
 * `extends: 'basic'` keeps every size, weight and spacing the package already
 * chose; the only thing overridden is the family. It is repeated per component
 * rather than set once on `body` because Outlook on Windows does not inherit
 * font-family into table cells, and a React Email document is tables.
 */
const STUDIO_V1: ThemeConfig = {
  extends: 'basic',
  styles: {
    body: { fontFamily: STUDIO_FONT_STACK },
    h1: { fontFamily: STUDIO_FONT_STACK },
    h2: { fontFamily: STUDIO_FONT_STACK },
    h3: { fontFamily: STUDIO_FONT_STACK },
    paragraph: { fontFamily: STUDIO_FONT_STACK },
    listItem: { fontFamily: STUDIO_FONT_STACK },
    link: { fontFamily: STUDIO_FONT_STACK },
    button: { fontFamily: STUDIO_FONT_STACK },
  },
}

/** Every theme the studio knows, by the name stored on a version. */
export const STUDIO_THEMES: Readonly<Record<string, ThemeConfig>> = {
  [DEFAULT_STUDIO_THEME]: STUDIO_V1,
}

/**
 * The config for a stored theme name, falling back to the default.
 *
 * The fallback is load-bearing rather than defensive: a version saved by a
 * later studio can name a theme this build has never heard of, and opening it
 * with the current theme is far better than an editor that will not mount.
 */
export function studioTheme(name: string): ThemeConfig {
  return STUDIO_THEMES[name] ?? STUDIO_THEMES[DEFAULT_STUDIO_THEME]
}
