/**
 * The few constants the visual canvas and the inspector rail share.
 *
 * Presentation layer: plain data, no React. They live here rather than in a
 * component so the chip, the sheet and the sub-header's inspector toggle can
 * all name the same number or the same id without importing each other.
 */

import type { EmailDocument } from '@/domain'

/**
 * The width of the email itself, in CSS pixels. 600 px is the width almost
 * every email template has used for twenty years: it is what fits the reading
 * pane of Outlook on a 1024 px screen without a horizontal scrollbar.
 */
export const CANVAS_WIDTH_PX = 600

/**
 * The id of the inspector rail, so the sub-header's toggle can point at it with
 * `aria-controls`. One constant, because an id that only half matches is
 * invisible to everyone except the screen-reader user it fails.
 */
export const INSPECTOR_RAIL_ID = 'studio-inspector-rail'

/**
 * The placeholder shown in an empty block, which is also the slash-menu hint.
 *
 * It does NOT mention images, and that is deliberate: the editor package's own
 * slash menu has no Image item and cannot be given one without replacing the
 * whole menu (docs/DESIGN.md, "Editor hooks inventory"). Pictures go in through
 * the inspector's "Insert image" button, or by pasting or dropping a file.
 */
export const CANVAS_PLACEHOLDER = 'Type "/" for blocks — text, button, section, columns, divider'

/**
 * What a visual template with no document yet starts from: one container with
 * one empty paragraph in it.
 *
 * It is CONTAINER-ROOTED on purpose. The editor package quietly rewraps a
 * document that is not, and that rewrite fires `onUpdate` before anybody has
 * typed (see documentUpdateGuard.ts).
 */
export const EMPTY_EMAIL_DOCUMENT: EmailDocument = {
  type: 'doc',
  content: [{ type: 'container', content: [{ type: 'paragraph' }] }],
}
