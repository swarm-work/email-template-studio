import { describe, expect, it } from 'vitest'
import type { TemplateRecord } from '@/domain'
import { STARTER_TEMPLATES } from './registry'
import { toEmailTemplate } from './templateMapper'

/** A record that is not a starter, so it is validated from its JSON Schema text. */
function recordWithSchema(propsSchemaText: string): TemplateRecord {
  return {
    ...STARTER_TEMPLATES[0],
    metadata: {
      ...STARTER_TEMPLATES[0].metadata,
      id: 'made-up' as TemplateRecord['metadata']['id'],
      slug: 'made-up',
      origin: 'user',
    },
    propsSchemaText,
  }
}

describe('toEmailTemplate', () => {
  it('gives a starter its strict schema, which rejects unknown keys', () => {
    const template = toEmailTemplate(STARTER_TEMPLATES[0])
    const props = JSON.parse(template.samplePayloadText) as Record<string, unknown>
    expect(template.validateProps(props).ok).toBe(true)
    expect(template.validateProps({ ...props, typo: 1 }).ok).toBe(false)
  })

  it('validates any other template from its stored JSON Schema', () => {
    const template = toEmailTemplate(
      recordWithSchema(
        JSON.stringify({
          type: 'object',
          properties: { name: { type: 'string' } },
          required: ['name'],
        }),
      ),
    )
    expect(template.validateProps({ name: 'Ada' }).ok).toBe(true)
    expect(template.validateProps({}).ok).toBe(false)
  })

  it('still gives a starter its strict schema after it is seeded with a tpl_ id', () => {
    const seeded: TemplateRecord = {
      ...STARTER_TEMPLATES[0],
      metadata: {
        ...STARTER_TEMPLATES[0].metadata,
        id: 'tpl_welcome-verification' as TemplateRecord['metadata']['id'],
      },
    }
    const props = JSON.parse(seeded.samplePayloadText) as Record<string, unknown>
    expect(toEmailTemplate(seeded).validateProps({ ...props, typo: 1 }).ok).toBe(false)
  })

  it('validates an edited starter from the schema it now stores', () => {
    // revision 2 means somebody saved over the shipped starter: their schema wins.
    const edited: TemplateRecord = {
      ...STARTER_TEMPLATES[0],
      metadata: { ...STARTER_TEMPLATES[0].metadata, revision: 2 },
      propsSchemaText: JSON.stringify({ type: 'object', properties: { extra: { type: 'string' } } }),
    }
    expect(toEmailTemplate(edited).validateProps({ extra: 'new prop' }).ok).toBe(true)
  })

  it('accepts any object when the schema is "{}" or unreadable', () => {
    expect(toEmailTemplate(recordWithSchema('{}')).validateProps({ anything: true }).ok).toBe(true)
    expect(toEmailTemplate(recordWithSchema('not json')).validateProps({ anything: true }).ok).toBe(true)
  })
})
