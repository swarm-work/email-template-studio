/**
 * Why a workspace is not offered for this template.
 *
 * Presentation layer: microcopy only (docs/DESIGN.md). Which modes a kind
 * actually offers is `application/studioModes.ts`; this only explains the
 * buttons that stay on screen so the shape of the studio is visible.
 */
import { availableModes } from '@/application/studioModes'
import {
  DEFAULT_STUDIO_FEATURES,
  VISUAL_EDITOR_OFF_MESSAGE,
  type StudioFeatures,
  type StudioMode,
  type TemplateKind,
} from '@/domain'

const VISUAL_NOT_FOR_CODE =
  'This template is written in TSX. Visual editing is only available for visual templates.'

const CODE_NOT_FOR_VISUAL =
  'This template is edited visually. Switch to Visual to change it, or convert it to a code template.'

/** The sentence for a mode this kind cannot enter, or `undefined` when it can. */
export function unavailableModeReason(
  kind: TemplateKind,
  mode: StudioMode,
  features: StudioFeatures = DEFAULT_STUDIO_FEATURES,
): string | undefined {
  if (availableModes(kind, features).includes(mode)) return undefined
  if (mode !== 'visual') return CODE_NOT_FOR_VISUAL
  // A visual template with no Visual button can only mean the rollback flag is
  // off; a code template never had one to begin with.
  return kind === 'visual' ? VISUAL_EDITOR_OFF_MESSAGE : VISUAL_NOT_FOR_CODE
}
