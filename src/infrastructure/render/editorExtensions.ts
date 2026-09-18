/**
 * The extension list the studio's canvas runs on: the editor package's own
 * defaults, plus the merge-field node.
 *
 * Infrastructure layer. It imports `@react-email/editor`'s extension subpaths,
 * so it may only be imported from the lazy editor chunk (today:
 * `VisualEditorSurface.tsx` and this module's own test). No React, no DOM, no
 * application code.
 *
 * Why this file exists at all: `EmailEditor`'s `extensions` prop REPLACES the
 * package's defaults rather than adding to them (dist/index.mjs, `const base =
 * extensionsProp ?? [...]`). Passing `[MergeField]` would therefore silently
 * remove StarterKit, the placeholder and the theming, so the defaults are
 * restated here — in the same order, with the same options — and the merge
 * field is appended.
 *
 * `@tiptap/core` and `@tiptap/extension-placeholder` are declared in
 * `package.json` at the EXACT version `@react-email/editor` resolves (3.31.3),
 * not relied on through npm's hoisting. Two copies of tiptap would be two
 * different `Extension` classes, and the merge-field node would register
 * against a schema the editor never instantiates — silently, with no type
 * error. They must be bumped in the same step as the editor package (ADR-26).
 */
import { Placeholder } from '@tiptap/extension-placeholder'
import type { Extensions } from '@tiptap/core'
import { StarterKit } from '@react-email/editor/extensions'
import { EmailTheming } from '@react-email/editor/plugins'
import type { ThemeConfig } from '@react-email/editor/plugins'
import { MergeField } from './mergeFieldNode'

export interface StudioEditorExtensionsOptions {
  /** The same value the `theme` prop would carry; `EmailTheming` needs it. */
  readonly theme: ThemeConfig
  /** Empty-block hint. Matches the package's `placeholder` prop. */
  readonly placeholder: string
}

/**
 * The package's default extensions plus `MergeField`.
 *
 * The image extension is NOT listed: `EmailEditor` appends it itself whenever
 * `onUploadImage` is passed, whether or not this prop is given.
 */
export function studioEditorExtensions({ theme, placeholder }: StudioEditorExtensionsOptions): Extensions {
  return [
    StarterKit.configure(),
    Placeholder.configure({ placeholder, includeChildren: true }),
    EmailTheming.configure({ theme }),
    MergeField,
  ]
}
