/**
 * The views a template offers behind a tab strip, and the ids that tie a tab to
 * its panel.
 *
 * Presentation layer: plain data, no React, so the tab bar, the editor panel
 * and the tests all name the same tabs.
 *
 * There are two sets. A CODE template is edited in two of its four tabs; a
 * VISUAL template has no editable source at all, so its three tabs are exports
 * and every one of them is read-only (ADR-18).
 */

/** Compiled HTML and Plain text are produced by the render; they are never edited. */
export type EditorTabId = 'tsx' | 'props' | 'html' | 'text'

/** What a visual template can be looked at as, once it has been exported. */
export type VisualExportTabId = 'html' | 'text' | 'document'

export interface EditorTab<Id extends string = string> {
  readonly id: Id
  readonly label: string
  /** File-name style labels are drawn in the mono face; prose labels are not. */
  readonly mono: boolean
  readonly readOnly: boolean
}

export const EDITOR_TABS: readonly EditorTab<EditorTabId>[] = [
  { id: 'tsx', label: 'template.tsx', mono: true, readOnly: false },
  { id: 'props', label: 'preview-props.json', mono: true, readOnly: false },
  { id: 'html', label: 'Compiled HTML', mono: false, readOnly: true },
  { id: 'text', label: 'Plain text', mono: false, readOnly: true },
]

export const VISUAL_EXPORT_TABS: readonly EditorTab<VisualExportTabId>[] = [
  { id: 'html', label: 'Exported HTML', mono: false, readOnly: true },
  { id: 'text', label: 'Plain text', mono: false, readOnly: true },
  { id: 'document', label: 'document.json', mono: true, readOnly: true },
]

/** The id of a tab button; the panel points back at it with aria-labelledby. */
export function tabId(baseId: string, tab: string): string {
  return `${baseId}-tab-${tab}`
}

/** The id of a tab's panel; the tab points at it with aria-controls. */
export function panelId(baseId: string, tab: string): string {
  return `${baseId}-panel-${tab}`
}
