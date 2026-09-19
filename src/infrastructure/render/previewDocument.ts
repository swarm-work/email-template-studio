/**
 * Wraps rendered email HTML for display inside the preview iframe.
 *
 * Isolation layers (see docs/ARCHITECTURE.md):
 * 1. The iframe uses `sandbox=""`: no scripts, no forms, no same-origin access.
 * 2. We inject a Content-Security-Policy meta tag so that even if a script
 *    tag slipped through it could not run, and only images/fonts can load.
 * 3. We pin the document to `color-scheme: light`. A frame inherits the
 *    colour scheme of the page that embeds it, so with the studio in dark mode
 *    an email that styles nothing would be drawn white-on-white. The email is
 *    what it will be in the recipient's inbox, not what the app is wearing.
 */
export const PREVIEW_CSP =
  "default-src 'none'; img-src https: http: data: cid:; style-src 'unsafe-inline'; font-src https: data:"

export function buildPreviewDocument(html: string): string {
  const meta =
    `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">` +
    '<meta name="color-scheme" content="light">'
  const headTag = /<head[^>]*>/i
  if (headTag.test(html)) return html.replace(headTag, (match) => `${match}${meta}`)
  return `<!doctype html><html><head><meta charset="utf-8">${meta}</head><body>${html}</body></html>`
}
