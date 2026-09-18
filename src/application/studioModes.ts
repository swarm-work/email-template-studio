/**
 * Which studio workspaces a template can reach, by kind.
 *
 * Application layer: pure functions over domain types. No React, no DOM, no Zod.
 * The reducer and the session store both clamp the stored mode through these,
 * so a code template can never end up showing the visual canvas.
 */
import type { StudioMode, TemplateKind } from '@/domain'

const MODES_BY_KIND: Readonly<Record<TemplateKind, readonly StudioMode[]>> = {
  visual: ['visual', 'preview'],
  code: ['code', 'preview'],
}

/**
 * Every mode, in the order the toggle draws them. The toggle shows all three so
 * the shape of the studio is visible; each button carries its own reason when
 * it cannot be pressed, and the reducer clamps whatever is chosen through
 * `clampMode`, so a kind can never end up in a mode it does not offer.
 */
export const ALL_STUDIO_MODES: readonly StudioMode[] = ['visual', 'code', 'preview']

/** The modes this kind offers, its own editor first. Used by `clampMode`, below. */
export function availableModes(kind: TemplateKind): readonly StudioMode[] {
  return MODES_BY_KIND[kind]
}

/** The mode a template of this kind opens in: its own editor. */
export function defaultMode(kind: TemplateKind): StudioMode {
  return MODES_BY_KIND[kind][0]
}

/** Keeps `mode` if this kind offers it, otherwise falls back to the default mode. */
export function clampMode(kind: TemplateKind, mode: StudioMode): StudioMode {
  return availableModes(kind).includes(mode) ? mode : defaultMode(kind)
}

/**
 * Where ⌘P should go next.
 *
 * Preview is a round trip, not a destination: the first press leaves the editor
 * you were in, the second press brings you back to it. `returnMode` is the mode
 * the studio came from, so this stays a pure function of two values and the
 * component only has to remember one of them.
 */
export function nextModeForPreviewToggle(mode: StudioMode, returnMode: StudioMode): StudioMode {
  if (mode !== 'preview') return 'preview'
  // Coming back to "preview" would be a press that does nothing, so a return
  // mode that is itself preview falls back to the editor for this kind.
  return returnMode === 'preview' ? 'code' : returnMode
}
