import { describe, expect, it } from 'vitest'
import type { RenderStatus } from '@/domain'
import {
  NOTHING_RENDERED_TO_SAVE_REASON,
  NOTHING_TO_SAVE_REASON,
  RENDER_IN_PROGRESS_REASON,
  saveTemplateReason,
  type SaveTemplateReasonInput,
} from './SaveTemplateButton'

/** A template that is dirty, rendered and has nothing wrong with it. */
function saveable(patch: Partial<SaveTemplateReasonInput> = {}): SaveTemplateReasonInput {
  return { dirty: true, rendered: true, status: 'success' as RenderStatus, errors: [], ...patch }
}

describe('saveTemplateReason', () => {
  it('lets a dirty, rendered, error-free template be saved', () => {
    expect(saveTemplateReason(saveable())).toBeUndefined()
  })

  it('names the first error, and counts the rest', () => {
    // The precedence matters: an error is the reason even when the template is
    // also clean or still rendering, because it is the one you have to fix.
    expect(saveTemplateReason(saveable({ errors: ['Preview payload'] }))).toBe(
      'Fix 1 error to save: Preview payload.',
    )
    expect(saveTemplateReason(saveable({ errors: ['Preview payload', 'Render'] }))).toBe(
      'Fix 2 errors to save: Preview payload (+1 more).',
    )
  })

  it('refuses to save before anything has been rendered', () => {
    expect(saveTemplateReason(saveable({ rendered: false, status: 'idle' }))).toBe(
      NOTHING_RENDERED_TO_SAVE_REASON,
    )
  })

  it('refuses to save while a render is in flight', () => {
    // The pipeline keeps the last good export while a newer render runs, so
    // saving here would pair the new source with the PREVIOUS edit's HTML.
    expect(saveTemplateReason(saveable({ status: 'rendering' }))).toBe(RENDER_IN_PROGRESS_REASON)
    expect(saveTemplateReason(saveable({ status: 'blocked' }))).toBe(RENDER_IN_PROGRESS_REASON)
  })

  it('says there is nothing to save before it mentions the render', () => {
    expect(saveTemplateReason(saveable({ dirty: false }))).toBe(NOTHING_TO_SAVE_REASON)
    expect(saveTemplateReason(saveable({ dirty: false, status: 'rendering' }))).toBe(NOTHING_TO_SAVE_REASON)
  })
})
