/**
 * The four views a code template offers, and the ids that tie a tab to its
 * panel.
 *
 * Presentation layer: plain data, no React, so the tab bar, the editor panel
 * and the tests all name the same four tabs.
 */

/** Compiled HTML and Plain text are produced by the render; they are never edited. */
export type EditorTabId = 'tsx' | 'props' | 'html' | 'text'

export interface EditorTab {
  readonly id: EditorTabId
  readonly label: string
  /** File-name style labels are drawn in the mono face; prose labels are not. */
  readonly mono: boolean
  readonly readOnly: boolean
}

export const EDITOR_TABS: readonly EditorTab[] = [
  { id: 'tsx', label: 'template.tsx', mono: true, readOnly: false },
  { id: 'props', label: 'preview-props.json', mono: true, readOnly: false },
  { id: 'html', label: 'Compiled HTML', mono: false, readOnly: true },
  { id: 'text', label: 'Plain text', mono: false, readOnly: true },
]

/** The id of a tab button; the panel points back at it with aria-labelledby. */
export function tabId(baseId: string, tab: EditorTabId): string {
  return `${baseId}-tab-${tab}`
}

/** The id of a tab's panel; the tab points at it with aria-controls. */
export function panelId(baseId: string, tab: EditorTabId): string {
  return `${baseId}-panel-${tab}`
}
