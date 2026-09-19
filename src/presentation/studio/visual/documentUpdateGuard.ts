/**
 * Decides whether an `onUpdate` from the visual editor is really a person's
 * edit.
 *
 * Presentation layer: one pure factory, no React and no editor import.
 *
 * Why it exists: the editor package normalises a document that is not rooted in
 * a `container` node, and that normalisation runs while the editor is being
 * BUILT — before it reports itself ready. Letting such an update through would
 * mark a template "Unsaved changes" before anybody touched it. Our fixtures are
 * container-rooted, so it should never happen — this is the belt to that pair
 * of braces (plan §8).
 */

export interface DocumentUpdateGuard {
  /**
   * True when this update should reach the draft. Pass whether the editor has
   * announced itself ready: everything from that moment on is a person's doing,
   * whether they typed on the canvas or ran a command from the inspector rail.
   */
  accepts(editorReady: boolean): boolean
}

export function createDocumentUpdateGuard(): DocumentUpdateGuard {
  let seenUpdate = false
  return {
    accepts(editorReady: boolean): boolean {
      const isFirst = !seenUpdate
      seenUpdate = true
      // Only the FIRST update is ever dropped, and only before the editor is
      // ready. Focus is deliberately NOT the test: `Inspector.Document` writes
      // through `setGlobalContent` without focusing the canvas, so a rail edit
      // made before the canvas was ever clicked is unfocused and completely
      // real.
      return editorReady || !isFirst
    },
  }
}
