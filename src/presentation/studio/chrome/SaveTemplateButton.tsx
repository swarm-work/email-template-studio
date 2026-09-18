/**
 * The studio's one primary action.
 *
 * Presentation layer. There is exactly one primary button on this screen on
 * purpose (docs/DESIGN.md); the mock's second one ("Publish Template") was a
 * simulation and is gone. Saving needs somewhere to save to, which is phase 7b,
 * so until then the button is present, focusable and honest about why.
 */
import { Save } from 'lucide-react'
import { ReasonedButton } from '@/presentation/shared/ReasonedButton'

/** Exported so ⌘S can answer with exactly the same sentence the button does. */
export const SAVE_TEMPLATE_REASON = 'Coming with saved templates.'

export function SaveTemplateButton() {
  return (
    <ReasonedButton size="sm" reason={SAVE_TEMPLATE_REASON}>
      <Save aria-hidden="true" />
      Save template
    </ReasonedButton>
  )
}
