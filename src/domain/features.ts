/**
 * Domain model: which optional parts of the studio are switched on.
 *
 * Plain data, like the rest of the domain: no React, Zod or browser APIs. The
 * values come from the send server (`GET /api/send-test/status`), which mirrors
 * this shape in `server/config.ts`; the browser only ever reads them.
 */

export interface StudioFeatures {
  /**
   * false = the visual canvas is switched off for everyone. A visual template
   * then opens in Preview mode and is read-only until the flag is switched
   * back on. This is the rollback lever of docs/DEPLOYMENT.md.
   */
  readonly visualEditor: boolean
}

/**
 * Everything on. Used before the server has answered and by every test that
 * does not care about the flag, so "we have not asked yet" never reads as
 * "the editor is switched off".
 */
export const DEFAULT_STUDIO_FEATURES: StudioFeatures = { visualEditor: true }

/** What the studio says when a visual template is open while the flag is off. */
export const VISUAL_EDITOR_OFF_MESSAGE =
  'The visual editor is switched off. This template is read-only until it is switched back on.'
