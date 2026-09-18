/**
 * Why a workspace is not offered for this template.
 *
 * Presentation layer: microcopy only (docs/DESIGN.md). Which modes a kind
 * actually offers is `application/studioModes.ts`; this only explains the
 * buttons that stay on screen so the shape of the studio is visible.
 */
import type { StudioMode, TemplateKind } from '@/domain'
import { availableModes } from '@/application/studioModes'

const VISUAL_NOT_FOR_CODE =
  'This template is written in TSX. Visual editing is only available for visual templates.'

const CODE_NOT_FOR_VISUAL =
  'This template is edited visually. Convert it to a code template to edit its source.'

/** The sentence for a mode this kind cannot enter, or `undefined` when it can. */
export function unavailableModeReason(kind: TemplateKind, mode: StudioMode): string | undefined {
  if (availableModes(kind).includes(mode)) return undefined
  return mode === 'visual' ? VISUAL_NOT_FOR_CODE : CODE_NOT_FOR_VISUAL
}
