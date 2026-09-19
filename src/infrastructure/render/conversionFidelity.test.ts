// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { Editor } from '@tiptap/core'
import { composeReactEmail } from '@react-email/editor/core'
import { conversionPayload, documentToTsx } from '@/application/visual/documentToTsx'
import { GOLDENS } from '@/application/visual/__fixtures__/goldens'
import type { EmailDocument } from '@/domain'
import { studioEditorExtensions } from './editorExtensions'
import { renderTemplate } from './renderTemplate'
import { studioTheme } from './studioTheme'

/**
 * Fidelity: the converted TSX says the same thing the canvas did.
 *
 * "The same thing" is deliberately NOT byte equality. The visual export is
 * built by the editor's serializer and the converted one by React Email
 * directly, so the two differ in table scaffolding, comments and whitespace and
 * always will (ADR-28, docs/TECH_DEBT.md). What must not differ is what a
 * reader sees: the words, and where the links go.
 *
 * It needs a real editor, so it runs in jsdom — `composeReactEmail` has no
 * document-only mode (plan §1.2).
 */
const editors: Editor[] = []

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
})

/** A headless editor holding `document`, with the studio's own extensions. */
function editorFor(document: EmailDocument): Editor {
  const editor = new Editor({
    extensions: studioEditorExtensions({
      theme: studioTheme('studio-v1'),
      placeholder: '',
    }),
    content: document as Record<string, unknown>,
  })
  editors.push(editor)
  return editor
}

describe('conversion fidelity', () => {
  // Two documents is the point: one full of inline marks, one full of blocks.
  for (const name of ['marks', 'blocks']) {
    it(`keeps the words and the links of the ${name} document`, async () => {
      const golden = GOLDENS.find((fixture) => fixture.name === name)
      if (!golden) throw new Error(`no golden named ${name}`)

      // No preheader on either side: the <Preview> element pads itself with
      // invisible characters, and comparing THAT would be comparing React Email
      // with itself rather than the two pipelines.
      const converted = documentToTsx(golden.document, {
        componentName: 'FidelityEmail',
        propsInterfaceName: 'FidelityProps',
        subject: '',
        preheader: '',
      })
      expect(converted.ok).toBe(true)
      if (!converted.ok) return

      const visual = await composeReactEmail({ editor: editorFor(golden.document) })
      const code = await renderTemplate(converted.source, conversionPayload(converted.props))
      expect(code.ok, code.ok ? '' : code.error.message).toBe(true)
      if (!code.ok) return

      expect(visibleText(code.html)).toBe(visibleText(visual.unformattedHtml))
      expect([...linkTargets(code.html)]).toEqual([...linkTargets(visual.unformattedHtml)])
    })
  }
})

/** Everything a reader would actually see, with whitespace normalised. */
function visibleText(html: string): string {
  return (
    html
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&zwnj;|&#8203;|&#847;|&#xFEFF;|&#65279;/gi, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;|&#39;/g, "'")
      // The combining grapheme joiner is replaced on its own: inside a character
      // class it reads as a combining mark, which oxlint rightly warns about.
      .replace(/\u034f/g, ' ')
      .replace(/[\s\u00a0\u200c\ufeff]+/g, ' ')
      .trim()
  )
}

/** Every distinct `href`, sorted, so a link that moved is a failure. */
function linkTargets(html: string): Set<string> {
  const found = [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1])
  return new Set([...new Set(found)].sort())
}
