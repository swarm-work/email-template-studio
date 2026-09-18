import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { STARTER_PROPS_SCHEMAS, STARTER_TEMPLATES } from './registry'

/**
 * The starters store their JSON Schema as plain data (in starterCatalog.json)
 * so the browser never downloads Zod's JSON Schema converter, and so the seed
 * migration can read it without running any TypeScript. This test is the price
 * of that: it regenerates the text from the Zod schemas and fails when someone
 * edits one without editing the other.
 */
describe('starter props schemas', () => {
  it.each(STARTER_TEMPLATES.map((template) => [template.metadata.slug, template] as const))(
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
  it.each(STARTER_TEMPLATES.map((template) => [template.metadata.slug, template] as const))(
    '%s carries the text of its TSX file',
    (_slug, template) => {
      // A starter with no source would be a blank editor, and the catalog's
      // `sourceFile` is the one place a typo could produce one.
      expect(template.kind).toBe('code')
      if (template.kind !== 'code') throw new Error('unreachable')
      expect(template.source).toContain('import')
    },
  )
})
