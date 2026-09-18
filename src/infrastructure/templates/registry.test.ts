import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { STARTER_PROPS_SCHEMAS, STARTER_TEMPLATES } from './registry'

/**
 * The starters store their JSON Schema as literal text (see
 * starterPropsSchemas.ts) so the browser never downloads Zod's JSON Schema
 * converter. This test is the price of that: it regenerates the text from the
 * Zod schemas and fails when someone edits one without editing the other.
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
