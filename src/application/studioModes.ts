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

/** The modes offered for this kind, in the order the mode toggle shows them. */
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
