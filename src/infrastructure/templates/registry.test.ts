import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { STARTER_PROPS_SCHEMAS, STARTER_TEMPLATES } from './registry'

/** Only code starters are authored as TSX with a hand-written Zod schema. */
const CODE_STARTERS = STARTER_TEMPLATES.filter((template) => template.kind === 'code')
const VISUAL_STARTERS = STARTER_TEMPLATES.filter((template) => template.kind === 'visual')

/**
 * The starters store their JSON Schema as plain data (in starterCatalog.json)
 * so the browser never downloads Zod's JSON Schema converter, and so the seed
 * migration can read it without running any TypeScript. This test is the price
 * of that: it regenerates the text from the Zod schemas and fails when someone
 * edits one without editing the other.
 */
describe('starter props schemas', () => {
  it.each(CODE_STARTERS.map((template) => [template.metadata.slug, template] as const))(
    '%s stores the JSON Schema its Zod schema produces',
    (slug, template) => {
      const schema = STARTER_PROPS_SCHEMAS[slug]
      expect(schema, `no Zod schema for ${slug}`).toBeDefined()
      const generated = `${JSON.stringify(z.toJSONSchema(schema!, { io: 'input' }), null, 2)}\n`
      expect(template.propsSchemaText).toBe(generated)
    },
  )
})

describe('starter sources', () => {
  it.each(CODE_STARTERS.map((template) => [template.metadata.slug, template] as const))(
    '%s carries the text of its TSX file',
    (_slug, template) => {
      // A starter with no source would be a blank editor, and the catalog's
      // `sourceFile` is the one place a typo could produce one.
      if (template.kind !== 'code') throw new Error('unreachable')
      expect(template.source).toContain('import')
    },
  )
})

describe('visual starters', () => {
  it('ships exactly one, with an empty export and a named theme', () => {
    expect(VISUAL_STARTERS.map((template) => template.metadata.slug)).toEqual(['product-launch'])
    for (const template of VISUAL_STARTERS) {
      if (template.kind !== 'visual') throw new Error('unreachable')
      expect(template.theme).toBe('studio-v1')
      // The studio composes the export from the live editor when the template
      // is opened, so a seeded copy would only ever be a second, staler truth.
      expect(template.html).toBe('')
      expect(template.text).toBe('')
    }
  })

  it.each(VISUAL_STARTERS.map((template) => [template.metadata.slug, template] as const))(
    "%s's document is container-rooted",
    (_slug, template) => {
      if (template.kind !== 'visual') throw new Error('unreachable')
      // LOAD-BEARING: the editor package rewraps a document that has no
      // top-level `container` node, and that rewrite fires `onUpdate` before
      // anybody has typed - which would show the template as modified on open.
      expect(template.document.type).toBe('doc')
      const topLevel = template.document.content ?? []
      expect(topLevel.some((node) => node.type === 'container')).toBe(true)
      expect(topLevel.map((node) => node.type)).toEqual(['container'])
    },
  )
})
