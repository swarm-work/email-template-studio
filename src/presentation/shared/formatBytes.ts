/**
 * Byte sizes for the studio's status strips: how big a rendered email is, and
 * whether Gmail will clip it.
 *
 * Presentation layer: measuring and formatting only, no rules about what the
 * studio should then do. No React, no DOM nodes (TextEncoder is part of the
 * JavaScript platform in both the browser and Node, so the tests need no jsdom).
 */

/**
 * Gmail stops rendering a message at roughly 102 KB and hides the rest behind a
 * "View entire message" link. 102 * 1024 is the number the mail community quotes.
 */
export const GMAIL_CLIPPING_LIMIT_BYTES = 102 * 1024

/** Reused instead of allocating one encoder per keystroke. */
const ENCODER = new TextEncoder()

/** How many bytes `text` takes as UTF-8 — not its character count. */
export function byteLength(text: string): number {
  return ENCODER.encode(text).length
}

/**
 * "812 B", "14.2 KB", "1.3 MB". One decimal place from a kilobyte up, because
 * "14.23 KB" reads as precision the measurement does not have.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${round(kb)} KB`
  return `${round(kb / 1024)} MB`
}

/** True when a rendered email is big enough for Gmail to clip it. */
export function isOverGmailLimit(bytes: number): boolean {
  return bytes > GMAIL_CLIPPING_LIMIT_BYTES
}

/** One decimal place, with a trailing ".0" trimmed so 14 KB does not read "14.0 KB". */
function round(value: number): string {
  return value.toFixed(1).replace(/\.0$/, '')
}
