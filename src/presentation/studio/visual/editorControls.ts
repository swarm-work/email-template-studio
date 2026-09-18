/**
 * What the visual editor lets the chrome around it do.
 *
 * Presentation layer: plain types, deliberately free of any editor import. The
 * sub-header's undo/redo buttons live in the MAIN chunk and the editor lives in
 * the lazy one, so the two have to meet on a type that costs nothing to load.
 */

export interface VisualEditorControls {
  readonly canUndo: boolean
  readonly canRedo: boolean
  readonly undo: () => void
  readonly redo: () => void
  /** False when no block is selected, which is what disables delete / duplicate. */
  readonly hasNodeSelection: boolean
}
