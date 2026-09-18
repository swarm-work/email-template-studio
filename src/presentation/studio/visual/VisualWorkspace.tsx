/**
 * Visual mode: the chrome around the editor, and the two things that can
 * happen before the editor exists — it is still downloading, or it never
 * arrived.
 *
 * Presentation layer. This module is in the MAIN chunk, which is why it holds
 * no editor import of its own: `React.lazy` is the seam, and everything on the
 * far side of it (`VisualEditorSurface`) is fetched only when a visual template
 * is opened (ADR-18).
 */
import { Component, Suspense, lazy, useId, type ReactNode } from 'react'
import type { EmailDocument, RenderError } from '@/domain'
import type { VisualEditorHandle } from '@/infrastructure/render/visualEmailRenderer'
import { RenderErrorBanner } from '../code/RenderErrorBanner'
import type { VisualEditorControls } from './editorControls'
import type { MergeFieldsData } from './MergeFieldsPanel'
import { VisualEditorSkeleton } from './VisualEditorSkeleton'

// The one dynamic import in the studio. Rolldown turns it into a separate chunk
// and the browser asks for that chunk the first time this component renders.
const VisualEditorSurface = lazy(() =>
  import('./VisualEditorSurface').then((module) => ({ default: module.VisualEditorSurface })),
)

/**
 * What the studio says when the chunk does not arrive: a stale deploy, an
 * offline browser, a proxy eating the request. It is phrased as a
 * `RenderError` so it is shown by the SAME banner as a compile or export
 * failure — one vocabulary for "the preview pipeline could not finish".
 */
export const EDITOR_LOAD_ERROR: RenderError = {
  kind: 'editor-load',
  message: 'The visual editor could not be downloaded. Check your connection and reload the page.',
}

export interface VisualWorkspaceProps {
  templateId: string
  document: EmailDocument
  theme: string
  onDocumentChange: (document: EmailDocument) => void
  onEditorReady: (handle: VisualEditorHandle) => void
  onEditorDestroy: () => void
  onControlsChange: (controls: VisualEditorControls | null) => void
  inspectorOpen: boolean
  onCloseInspector: () => void
  /** The props payload card, built by StudioPage and shown on the Data tab. */
  dataPanel: ReactNode
  /**
   * Merge-field keys and the sample payload. Passed straight through: this
   * component is in the main chunk and only the surface beyond the lazy seam
   * renders the panel that reads them (the import above is type-only, so it is
   * erased and nothing of the editor chunk leaks back here).
   */
  mergeFields: MergeFieldsData
}

export function VisualWorkspace(props: VisualWorkspaceProps) {
  const headingId = useId()

  return (
    <section
      aria-labelledby={headingId}
      // `relative` is what the off-canvas rail and its backdrop position
      // against; `overflow-hidden` keeps the rail hidden off the right edge
      // instead of widening the page while it is closed.
      //
      // The minimum height is load-bearing rather than cosmetic: below `xl` the
      // rail leaves the flow (it becomes an absolutely positioned drawer), and
      // the canvas beside it is `flex-1` inside a column whose own height comes
      // from its content. Without a floor the two would agree on nothing and
      // collapse to zero.
      className="bg-card relative flex min-h-[640px] min-w-0 flex-1 overflow-hidden rounded-lg border"
    >
      <h2 id={headingId} className="sr-only">
        Visual editor
      </h2>
      <EditorLoadBoundary>
        <Suspense fallback={<VisualEditorSkeleton />}>
          <VisualEditorSurface {...props} />
        </Suspense>
      </EditorLoadBoundary>
    </section>
  )
}

interface BoundaryState {
  readonly failed: boolean
}

/**
 * Catches a chunk that never loaded.
 *
 * A class because that is still the only way to write an error boundary in
 * React. It deliberately does NOT log: React already reports the error, and
 * the end-to-end suite fails the run on any console error, so a second copy
 * would turn one honest failure into a test that cannot tell them apart.
 */
class EditorLoadBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex min-w-0 flex-1 flex-col justify-center p-6">
        <RenderErrorBanner status="error" result={{ ok: false, error: EDITOR_LOAD_ERROR }} />
      </div>
    )
  }
}
