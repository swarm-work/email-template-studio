/**
 * The theme styles the converter needs, borrowed from the editor's own theming.
 *
 * Infrastructure layer: it implements `NodeStyleResolver`, which the pure
 * converter in `@/application/visual/documentToTsx.ts` declares. It must not
 * import React or anything from `src/presentation`, and it reaches
 * `@react-email/editor/plugins` through a DYNAMIC import so the 2.5 MB editor
 * stays in its lazily loaded chunk (ADR-18, plan §3.10) — this module is the
 * only reason the converter needs that package at all.
 *
 * Why it exists: a visual template's look lives in the THEME, not in the
 * document. Without it every converted template would come out unstyled.
 */
import type { EditorTheme, PanelGroup } from '@react-email/editor/plugins'
import type { EmailDocument, EmailDocumentNode } from '@/domain'
import type { NodeStyleResolver } from '@/application/visual/documentToTsx'
import { DEFAULT_STUDIO_THEME, studioTheme } from './studioTheme'

/**
 * Builds the resolver for one document.
 *
 * It mirrors what the editor does at export time, in this order:
 * 1. the `theme` PROP always wins, so the base theme is the one the stored
 *    theme name extends (plan §1.2);
 * 2. a document that has been through the editor carries the resolved panel
 *    styles in its `globalContent` node — those are used when they are there;
 * 3. otherwise the studio theme's own overrides are applied to the base
 *    theme's panels, which is exactly what the editor would have seeded.
 *
 * Awaiting it downloads nothing extra when the canvas is already open: the
 * import resolves from the editor chunk that is already in memory.
 */
export async function createNodeStyleResolver(
  document: EmailDocument,
  themeName: string = DEFAULT_STUDIO_THEME,
): Promise<NodeStyleResolver> {
  const { EDITOR_THEMES, getMergedCssJs, getResolvedNodeStyles, themeStylesToPanelOverrides } =
    await import('@react-email/editor/plugins')

  const config = studioTheme(themeName)
  const base: EditorTheme = config.extends ?? 'basic'
  const stored = globalPanelStyles(document)
  const panels = stored ?? themeStylesToPanelOverrides(config.styles, EDITOR_THEMES[base])
  const merged = getMergedCssJs(base, panels)

  return (node: EmailDocumentNode, depth: number) => {
    const resolved = getResolvedNodeStyles({ type: node.type, attrs: { ...node.attrs } }, depth, merged)
    // The `<Body>` is the exception. `getResolvedNodeStyles` has no theme key
    // for it, so it answers with the universal reset (margin and padding) and
    // nothing else — while the editor's own BaseTemplate renders
    // `<Body style={merged.body}>`: the background colour, the line height and
    // the base font. Without this, every converted email lost its white
    // background and inherited React Email's default line height instead of the
    // theme's. Layered the way the package layers everything else: reset
    // underneath, the panel's own styles on top.
    if (node.type === 'body') return toPlainStyle({ ...resolved, ...(merged.body ?? {}) })
    return toPlainStyle(resolved)
  }
}

/**
 * The panel styles a document carries in its `globalContent` node, if any.
 *
 * The editor stores them under `attrs.data.styles` (see `setGlobalStyles`), and
 * they are the record of "what this email actually looked like" — including any
 * overrides made after it was created, which the theme name alone cannot say.
 */
function globalPanelStyles(document: EmailDocument): PanelGroup[] | null {
  for (const node of document.content ?? []) {
    if (node.type !== 'globalContent') continue
    const data = node.attrs?.data
    if (data === null || typeof data !== 'object') continue
    const styles = (data as Record<string, unknown>).styles
    // The one cast in this module: the document is plain JSON to every layer
    // above, and this is the shape the editor wrote into it.
    if (Array.isArray(styles) && styles.length > 0) return styles as PanelGroup[]
  }
  return null
}

/**
 * React's `CSSProperties` down to the scalars the converter prints. Anything
 * else — `undefined`, a nested object — has no inline-style spelling and is
 * dropped rather than guessed at.
 */
function toPlainStyle(style: object): Record<string, string | number> {
  const plain: Record<string, string | number> = {}
  for (const [property, value] of Object.entries(style)) {
    if (typeof value === 'string' || typeof value === 'number') plain[property] = value
  }
  return plain
}
