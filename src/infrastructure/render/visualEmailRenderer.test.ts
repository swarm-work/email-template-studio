import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/core'
import { composeVisualEmail, type VisualEditorHandle } from './visualEmailRenderer'

/**
 * The real composer needs a live editor, a DOM and 2.5 MB of package. The seam
 * this module actually owns is the one below it: which of the three returned
 * strings is kept, how the preheader is passed, and what a throw becomes.
 */
const composeReactEmail = vi.fn()
vi.mock('@react-email/editor/core', () => ({
  composeReactEmail: (...args: unknown[]) => composeReactEmail(...args),
}))

/** Stands in for a live editor; `composeReactEmail` is mocked, so it is never used. */
const EDITOR = { name: 'fake editor' } as unknown as Editor
const HANDLE: VisualEditorHandle = { editor: EDITOR }

describe('composeVisualEmail', () => {
  it('keeps the UNFORMATTED html and passes the preheader through', async () => {
    composeReactEmail.mockResolvedValueOnce({
      html: '<html>\n  <body>\n    pretty\n  </body>\n</html>',
      unformattedHtml: '<html><body>compact</body></html>',
      text: 'compact',
    })

    const result = await composeVisualEmail(HANDLE, { preheader: 'Inbox line' })

    expect(composeReactEmail).toHaveBeenCalledWith({ editor: EDITOR, preview: 'Inbox line' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // Prettier's indentation measured 1.2-1.7x larger, and what is stored and
    // sent has to be what the mail client receives (ADR-18).
    expect(result.html).toBe('<html><body>compact</body></html>')
    expect(result.text).toBe('compact')
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('asks for no preview element at all when the preheader is empty', async () => {
    composeReactEmail.mockResolvedValueOnce({ html: '', unformattedHtml: '', text: '' })
    await composeVisualEmail(HANDLE, { preheader: '' })
    // '' would render an empty <Preview>, which shows as a blank line in the inbox.
    expect(composeReactEmail).toHaveBeenCalledWith({ editor: EDITOR, preview: undefined })
  })

  it('turns a throw into a compose error rather than letting it escape', async () => {
    composeReactEmail.mockRejectedValueOnce(new Error('unknown node type: sparkle'))

    const result = await composeVisualEmail(HANDLE, { preheader: '' })

    expect(result).toEqual({
      ok: false,
      error: { kind: 'compose', message: 'unknown node type: sparkle' },
    })
  })

  it('refuses politely when the editor is not ready', async () => {
    const result = await composeVisualEmail({ editor: null }, { preheader: '' })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.kind).toBe('compose')
    expect(result.error.message).toMatch(/not ready/)
    expect(composeReactEmail).not.toHaveBeenCalled()
  })
})
