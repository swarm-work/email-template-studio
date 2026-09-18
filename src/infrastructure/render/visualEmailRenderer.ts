/**
 * Turns a live visual editor into the same `RenderResult` the code pipeline
 * produces: HTML plus its plain-text alternative part.
 *
 * Infrastructure layer. It may not import React or anything from `@/application`,
 * and it must never import `@react-email/editor` at the TOP level: that package
 * is 2.5 MB and belongs in the lazily loaded editor chunk. The one `import()`
 * below joins that chunk group instead (ADR-18, plan §3.10).
 */
import type { Editor } from '@tiptap/core'
import type { RenderResult } from '@/domain'

/**
 * What the composer needs from the editor: the live Tiptap instance.
 *
 * `@react-email/editor`'s own ref happens to satisfy this, so the surface can
 * pass its ref straight through, and a test can pass `{ editor: null }` or a
 * stub without building an editor.
 */
export interface VisualEditorHandle {
  readonly editor: Editor | null
}

export interface ComposeVisualEmailOptions {
  /** Inbox preview line; '' means the email renders no <Preview> element. */
  readonly preheader: string
}

/** The seam the preview hook renders through, so tests can pass a fake composer. */
export type VisualComposer = (
  handle: VisualEditorHandle,
  options: ComposeVisualEmailOptions,
) => Promise<RenderResult>

/** Shown when the editor is not ready (or was destroyed) but a compose was asked for. */
const NO_EDITOR_MESSAGE = 'The visual editor is not ready yet, so there is nothing to export.'

/**
 * Composes the editor's document into an email.
 *
 * `composeReactEmail` returns three strings; we keep `unformattedHtml`, not
 * `html`. The latter is run through prettier for a source view and measured
 * 1.2-1.7x larger, and what is stored and sent has to be what a mail client
 * will actually receive (ADR-18).
 */
export async function composeVisualEmail(
  handle: VisualEditorHandle,
  { preheader }: ComposeVisualEmailOptions,
): Promise<RenderResult> {
  const editor = handle.editor
  if (!editor) return failure(NO_EDITOR_MESSAGE)

  const startedAt = performance.now()
  try {
    // Dynamic, so nothing in the main chunk reaches the editor package. It
    // resolves from the already-loaded editor chunk, so this costs no request.
    const { composeReactEmail } = await import('@react-email/editor/core')
    const { unformattedHtml, text } = await composeReactEmail({
      editor,
      // '' would render an empty <Preview>, which mail clients show as a line
      // of whitespace; `undefined` renders no preview element at all.
      preview: preheader || undefined,
    })
    return { ok: true, html: unformattedHtml, text, durationMs: Math.round(performance.now() - startedAt) }
  } catch (error) {
    return failure(error instanceof Error ? error.message : String(error))
  }
}

/** Every failure in this module is the same stage, so it is written once. */
function failure(message: string): RenderResult {
  return { ok: false, error: { kind: 'compose', message } }
}
