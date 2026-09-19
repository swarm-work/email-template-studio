// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { EmailDocument } from '@/domain'
import { STUDIO_FONT_STACK } from './studioTheme'
import { createNodeStyleResolver } from './visualStyleResolver'

/**
 * jsdom rather than node: the editor package's theming module is part of a
 * bundle that touches `document` while it loads. The resolver itself is a plain
 * function of a node and a depth.
 */
const EMPTY: EmailDocument = { type: 'doc', content: [] }

describe('createNodeStyleResolver', () => {
  it('gives a paragraph the studio theme’s font stack', async () => {
    const resolve = await createNodeStyleResolver(EMPTY)
    const style = resolve({ type: 'paragraph' }, 0)
    expect(style.fontFamily).toBe(STUDIO_FONT_STACK)
    // The theme extends 'basic', so the sizes come with it.
    expect(Object.keys(style).length).toBeGreaterThan(1)
  })

  it('styles a heading by its level', async () => {
    const resolve = await createNodeStyleResolver(EMPTY)
    const h1 = resolve({ type: 'heading', attrs: { level: 1 } }, 0)
    const h3 = resolve({ type: 'heading', attrs: { level: 3 } }, 0)
    expect(h1.fontSize).toBeDefined()
    expect(h1.fontSize).not.toBe(h3.fontSize)
  })

  it('falls back to the default theme for a name it has never heard of', async () => {
    const resolve = await createNodeStyleResolver(EMPTY, 'studio-v99')
    expect(resolve({ type: 'paragraph' }, 0).fontFamily).toBe(STUDIO_FONT_STACK)
  })

  it('prefers the styles the document carries over the theme’s own', async () => {
    const document: EmailDocument = {
      type: 'doc',
      content: [
        {
          type: 'globalContent',
          attrs: {
            data: {
              styles: [
                {
                  id: 'paragraph',
                  title: 'Paragraph',
                  classReference: 'paragraph',
                  inputs: [{ label: 'Font size', type: 'number', prop: 'fontSize', value: 21, unit: 'px' }],
                },
              ],
            },
          },
        },
        { type: 'container', content: [] },
      ],
    }

    const resolve = await createNodeStyleResolver(document)
    // The editor expresses font sizes relative to the body's 14 px, so the
    // 21 px written into the document comes back as 1.5em. Either way it is
    // the DOCUMENT's size, not the theme's.
    expect(resolve({ type: 'paragraph' }, 0).fontSize).toBe('1.5em')
  })

  it('gives the body the theme’s own body panel, not just the reset', async () => {
    // The editor's BaseTemplate renders `<Body style={merged.body}>`, while
    // `getResolvedNodeStyles` has no theme key for a body and answers with the
    // universal reset. Asking only the latter lost the background colour, the
    // line height and the base font from every converted template.
    const resolve = await createNodeStyleResolver(EMPTY)
    const body = resolve({ type: 'body' }, 0)
    expect(body.backgroundColor).toBeDefined()
    expect(body.lineHeight).toBeDefined()
    expect(body.fontFamily).toBe(STUDIO_FONT_STACK)
  })

  it('returns only scalars, so the converter can always print what it is given', async () => {
    const resolve = await createNodeStyleResolver(EMPTY)
    for (const value of Object.values(resolve({ type: 'button' }, 0))) {
      expect(['string', 'number']).toContain(typeof value)
    }
  })
})
