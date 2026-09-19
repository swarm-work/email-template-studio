/**
 * The export stored with the current version, dressed as a preview state.
 *
 * Presentation layer: one `useMemo`, no fetching and no rendering. It is what a
 * visual template shows when the canvas is switched off (`STUDIO_VISUAL_EDITOR`
 * — docs/DEPLOYMENT.md): the last thing the studio exported, straight off the
 * record, with no editor loaded and nothing recomputed.
 *
 * It is a separate module rather than a helper inside `StudioPage` because it
 * is the client half of the rollback switch, and that deserves its own test.
 */
import { useMemo } from 'react'
import type { EmailTemplate } from '@/domain'
import type { RenderPreviewState } from './useRenderPreview'

/** Why Refresh does nothing while this state is the one on screen. */
export const SAVED_EXPORT_REASON =
  'This is the export saved with the current version. There is nothing to render again.'

export function useSavedExport(template: EmailTemplate): RenderPreviewState {
  return useMemo(() => {
    const html = template.kind === 'visual' ? template.html : ''
    const text = template.kind === 'visual' ? template.text : ''
    // A template that has never been saved has no export yet, and then the
    // honest answer is "nothing rendered" rather than an empty white page.
    if (html === '') {
      return { status: 'idle', result: null, html: null, text: null, renderedAt: null, refresh: NO_REFRESH }
    }
    return {
      status: 'success',
      result: { ok: true, html, text, durationMs: 0 },
      html,
      text,
      // Null on purpose: nothing was rendered just now, so there is no time to
      // put on the toolbar and nothing for the sparkline to count.
      renderedAt: null,
      refresh: NO_REFRESH,
    }
  }, [template])
}

/** Nothing to refresh: the text came off the record, not out of a pipeline. */
function NO_REFRESH() {}
