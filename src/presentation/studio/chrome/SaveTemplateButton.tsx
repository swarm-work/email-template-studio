/**
 * The studio's one primary action.
 *
 * Presentation layer. There is exactly one primary button on this screen on
 * purpose (docs/DESIGN.md); the mock's second one ("Publish Template") was a
 * simulation and is gone. The rules about WHEN a template can be saved live in
 * `saveTemplateReason` below, so the sub-header, ⌘S and the tests all read one
 * sentence rather than three.
 */
import { Loader2, Save } from 'lucide-react'
import type { RenderStatus } from '@/domain'
import { ReasonedButton } from '@/presentation/shared/ReasonedButton'

/** Nothing has changed, so there is no version to write. */
export const NOTHING_TO_SAVE_REASON = 'There are no changes to save.'

/** The render has not produced anything yet, so there is no export to store with it. */
export const NOTHING_RENDERED_TO_SAVE_REASON = 'Wait for the preview to render before saving.'

/** A render is in flight, so the export on hand belongs to the PREVIOUS edit. */
export const RENDER_IN_PROGRESS_REASON = 'Wait for the preview to finish rendering.'

export interface SaveTemplateReasonInput {
  /** True when the draft differs from the saved template in any way. */
  readonly dirty: boolean
  /** True once the pipeline has produced HTML for this template. */
  readonly rendered: boolean
  /** Where the render pipeline is right now. Only `success` may be saved. */
  readonly status: RenderStatus
  /** The labels of the diagnostics in the `error` state right now. */
  readonly errors: readonly string[]
}

/**
 * Why Save cannot be pressed, or `undefined` when it can.
 *
 * A saved version carries the exported HTML and plain text with it, which is
 * why a template that has not rendered — or has rendered with errors — cannot
 * be saved: the version would be stored with a broken or missing export and
 * every later consumer would inherit it.
 *
 * A render that is still RUNNING is refused for the same reason. The pipeline
 * keeps the last successful export while a newer one is in flight, so saving in
 * that window would pair the new source (or the new document) with the previous
 * edit's HTML — a mismatch nothing on screen would show, because the studio
 * renders again the next time the template is opened.
 */
export function saveTemplateReason({
  dirty,
  rendered,
  status,
  errors,
}: SaveTemplateReasonInput): string | undefined {
  // The first error is named, so "fix what?" is answered by the button itself
  // rather than only by the diagnostics rail.
  if (errors.length > 0) {
    const more = errors.length === 1 ? '' : ` (+${errors.length - 1} more)`
    return `Fix ${errors.length} ${errors.length === 1 ? 'error' : 'errors'} to save: ${errors[0]}${more}.`
  }
  if (!rendered) return NOTHING_RENDERED_TO_SAVE_REASON
  if (!dirty) return NOTHING_TO_SAVE_REASON
  if (status !== 'success') return RENDER_IN_PROGRESS_REASON
  return undefined
}

export interface SaveTemplateButtonProps {
  /** True while a save is in flight; the button says so and cannot be pressed again. */
  saving: boolean
  /** From `saveTemplateReason`. `undefined` means the button works. */
  reason?: string
  onSave: () => void
}

export function SaveTemplateButton({ saving, reason, onSave }: SaveTemplateButtonProps) {
  return (
    <ReasonedButton
      size="sm"
      // While a save is in flight the button explains itself the same way as
      // any other unavailable control, rather than going quietly grey.
      reason={saving ? 'A save is already in progress.' : reason}
      onClick={onSave}
    >
      {saving ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
      {saving ? 'Saving…' : 'Save template'}
    </ReasonedButton>
  )
}
