import { describe, expect, it } from 'vitest'
import {
  applyMergeFields,
  findUnsafeHrefs,
  isMergeFieldKey,
  listPayloadKeys,
  readPayloadValue,
  listDocumentMergeFields,
  listMergeFields,
  mergeFieldsJsonSchema,
  missingMergeFields,
  parsePayloadObject,
  setPayloadValue,
  withMissingKeys,
} from './mergeFields'

describe('applyMergeFields', () => {
  // Table-driven: one row per kind of value, because the interesting part of
  // this function is which values count as a value at all.
  const cases: ReadonlyArray<{
    name: string
    payload: Record<string, unknown>
    expected: string
    missing: string[]
  }> = [
    { name: 'a string', payload: { name: 'Ada' }, expected: 'Hi Ada!', missing: [] },
    { name: 'a number', payload: { name: 42 }, expected: 'Hi 42!', missing: [] },
    { name: 'a boolean', payload: { name: false }, expected: 'Hi false!', missing: [] },
    { name: 'an empty string', payload: { name: '' }, expected: 'Hi !', missing: [] },
    { name: 'null', payload: { name: null }, expected: 'Hi {{name}}!', missing: ['name'] },
    { name: 'undefined', payload: { name: undefined }, expected: 'Hi {{name}}!', missing: ['name'] },
    { name: 'an object', payload: { name: { first: 'Ada' } }, expected: 'Hi {{name}}!', missing: ['name'] },
    { name: 'an array', payload: { name: ['Ada'] }, expected: 'Hi {{name}}!', missing: ['name'] },
    { name: 'a missing key', payload: {}, expected: 'Hi {{name}}!', missing: ['name'] },
  ]

  for (const { name, payload, expected, missing } of cases) {
    it(`substitutes ${name}`, () => {
      const result = applyMergeFields('Hi {{name}}!', payload, { escape: 'none' })
      expect(result.text).toBe(expected)
      expect(result.missing).toEqual(missing)
    })
  }

  it('reads dotted paths', () => {
    const payload = { user: { profile: { first_name: 'Grace' } } }
    const result = applyMergeFields('Hello {{user.profile.first_name}}', payload, { escape: 'none' })
    expect(result.text).toBe('Hello Grace')
    expect(result.missing).toEqual([])
  })

  it('treats a path through a non-object as missing', () => {
    const result = applyMergeFields('{{user.name}}', { user: 'Ada' }, { escape: 'none' })
    expect(result.text).toBe('{{user.name}}')
    expect(result.missing).toEqual(['user.name'])
  })

  it('accepts spaces inside the braces and normalises the token it leaves behind', () => {
    const result = applyMergeFields('{{ first }} {{  first  }}', {}, { escape: 'none' })
    expect(result.text).toBe('{{first}} {{first}}')
    expect(result.missing).toEqual(['first'])
  })

  it('escapes HTML-significant characters when asked to', () => {
    const payload = { name: '<b>Ada</b> & "Grace"' }
    const result = applyMergeFields('<p>{{name}}</p>', payload, { escape: 'html' })
    expect(result.text).toBe('<p>&lt;b&gt;Ada&lt;/b&gt; &amp; &quot;Grace&quot;</p>')
  })

  it('leaves values alone when escaping is off', () => {
    const result = applyMergeFields('{{name}}', { name: 'a & b' }, { escape: 'none' })
    expect(result.text).toBe('a & b')
  })

  it('reports each missing key once, in order', () => {
    const result = applyMergeFields('{{b}} {{a}} {{b}}', {}, { escape: 'none' })
    expect(result.missing).toEqual(['b', 'a'])
  })

  it('leaves text with no tokens untouched', () => {
    const result = applyMergeFields('<p>Nothing here</p>', { name: 'Ada' }, { escape: 'html' })
    expect(result.text).toBe('<p>Nothing here</p>')
    expect(result.missing).toEqual([])
  })

  it('ignores things that only look like tokens', () => {
    const result = applyMergeFields('{{ 1nope }} {{}} { {name} }', { name: 'Ada' }, { escape: 'none' })
    expect(result.text).toBe('{{ 1nope }} {{}} { {name} }')
    expect(result.missing).toEqual([])
  })
})

describe('listMergeFields', () => {
  it('lists each key once, in order of appearance', () => {
    expect(listMergeFields('{{b}} {{a}} {{b}} {{user.name}}')).toEqual(['b', 'a', 'user.name'])
  })

  it('returns nothing for a string with no tokens', () => {
    expect(listMergeFields('Welcome aboard')).toEqual([])
  })
})

describe('listDocumentMergeFields', () => {
  it('finds chips, loose text and link hrefs', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'container',
          content: [
            {
              type: 'paragraph',
              content: [
                { type: 'text', text: 'Hi ' },
                { type: 'mergeField', attrs: { key: 'firstName' } },
                { type: 'text', text: ', your code is {{code}}' },
                {
                  type: 'text',
                  text: 'here',
                  marks: [{ type: 'link', attrs: { href: 'https://x.test/{{token}}' } }],
                },
              ],
            },
            { type: 'button', attrs: { href: 'https://x.test/{{token}}' } },
          ],
        },
      ],
    }
    expect(listDocumentMergeFields(document)).toEqual(['firstName', 'code', 'token'])
  })

  it('answers with nothing for an empty or absent document', () => {
    expect(listDocumentMergeFields(null)).toEqual([])
    expect(listDocumentMergeFields({ type: 'doc', content: [] })).toEqual([])
  })

  it('ignores a chip with no key', () => {
    expect(listDocumentMergeFields({ type: 'mergeField', attrs: {} })).toEqual([])
  })
})

describe('withMissingKeys', () => {
  it('adds only the keys that have no value and keeps the rest', () => {
    const result = withMissingKeys('{\n  "name": "Ada"\n}', ['name', 'company'])
    expect(JSON.parse(result)).toEqual({ name: 'Ada', company: '' })
  })

  it('creates nested objects for dotted keys', () => {
    expect(JSON.parse(withMissingKeys('{}', ['user.first_name']))).toEqual({ user: { first_name: '' } })
  })

  it('keeps the indentation the payload already used', () => {
    expect(withMissingKeys('{\n    "name": "Ada"\n}', ['company'])).toBe(
      '{\n    "name": "Ada",\n    "company": ""\n}',
    )
  })

  it('starts from an empty object when the text is not a JSON object', () => {
    expect(JSON.parse(withMissingKeys('not json', ['name']))).toEqual({ name: '' })
    expect(JSON.parse(withMissingKeys('[1, 2]', ['name']))).toEqual({ name: '' })
  })

  it('does not overwrite a value that is already there', () => {
    expect(JSON.parse(withMissingKeys('{"count": 0}', ['count']))).toEqual({ count: 0 })
  })
})

describe('setPayloadValue', () => {
  it('sets a top-level key', () => {
    expect(JSON.parse(setPayloadValue('{"name":"Ada"}', 'name', 'Grace'))).toEqual({ name: 'Grace' })
  })

  it('creates the objects a dotted path needs', () => {
    expect(JSON.parse(setPayloadValue('{}', 'user.profile.name', 'Ada'))).toEqual({
      user: { profile: { name: 'Ada' } },
    })
  })

  it('replaces a scalar standing where an object is needed', () => {
    expect(JSON.parse(setPayloadValue('{"user":"Ada"}', 'user.name', 'Ada'))).toEqual({
      user: { name: 'Ada' },
    })
  })

  it('leaves the other keys alone', () => {
    expect(JSON.parse(setPayloadValue('{"a":1,"b":2}', 'b', 'x'))).toEqual({ a: 1, b: 'x' })
  })
})

describe('findUnsafeHrefs', () => {
  it('finds javascript: and data: links whatever the quoting', () => {
    const html = `<a href="javascript:alert(1)">a</a><a href='data:text/html,x'>b</a><a href=JavaScript:x>c</a>`
    expect(findUnsafeHrefs(html)).toEqual(['javascript:alert(1)', 'data:text/html,x', 'JavaScript:x'])
  })

  it('sees through whitespace inside the scheme', () => {
    expect(findUnsafeHrefs('<a href="java\nscript:alert(1)">x</a>')).toEqual(['java\nscript:alert(1)'])
  })

  it('leaves ordinary links alone', () => {
    const html = '<a href="https://example.com">x</a><a href="mailto:ada@example.com">y</a>'
    expect(findUnsafeHrefs(html)).toEqual([])
  })

  it('reports each distinct href once', () => {
    const html = '<a href="javascript:x">a</a><a href="javascript:x">b</a>'
    expect(findUnsafeHrefs(html)).toEqual(['javascript:x'])
  })
})

describe('mergeFieldsJsonSchema', () => {
  it('requires every discovered key as a string', () => {
    expect(JSON.parse(mergeFieldsJsonSchema(['name', 'code']))).toEqual({
      type: 'object',
      properties: { name: { type: 'string' }, code: { type: 'string' } },
      required: ['name', 'code'],
      additionalProperties: true,
    })
  })

  it('nests dotted keys', () => {
    expect(JSON.parse(mergeFieldsJsonSchema(['user.first_name']))).toEqual({
      type: 'object',
      properties: {
        user: {
          type: 'object',
          properties: { first_name: { type: 'string' } },
          required: ['first_name'],
          additionalProperties: true,
        },
      },
      required: ['user'],
      additionalProperties: true,
    })
  })

  it('lets the object win when a key is also a prefix of another', () => {
    const schema = JSON.parse(mergeFieldsJsonSchema(['user', 'user.name'])) as {
      properties: { user: { type: string } }
    }
    expect(schema.properties.user.type).toBe('object')
  })

  it('accepts any object when there are no keys', () => {
    expect(mergeFieldsJsonSchema([])).toBe('{}')
  })
})

describe('isMergeFieldKey', () => {
  it('accepts identifiers and dotted paths', () => {
    for (const key of ['name', '_x', 'user.first_name', 'a.b.c']) expect(isMergeFieldKey(key)).toBe(true)
  })

  it('refuses anything the substitution could not find later', () => {
    for (const key of ['', '1name', 'a b', 'a.', '.a', 'a-b', '{{a}}']) {
      expect(isMergeFieldKey(key)).toBe(false)
    }
  })

  it('agrees with the token pattern', () => {
    // The two regexes are written out separately for readability, so this is
    // the test that stops them drifting apart.
    expect(listMergeFields('{{user.first_name}} {{_x}}').every(isMergeFieldKey)).toBe(true)
  })
})

describe('missingMergeFields', () => {
  it('keeps the keys the payload cannot fill in, in the order given', () => {
    const payload = { name: 'Ada', count: 0, blank: '', nothing: null, nested: { a: 'b' } }
    expect(missingMergeFields(['name', 'nothing', 'count', 'absent', 'blank', 'nested'], payload)).toEqual([
      'nothing',
      'absent',
      'nested',
    ])
  })

  it('answers with nothing when there are no keys', () => {
    expect(missingMergeFields([], {})).toEqual([])
  })
})

describe('listPayloadKeys', () => {
  it('flattens nested objects into dotted paths', () => {
    expect(listPayloadKeys('{"name":"Ada","user":{"first":"G","tags":["a"]}}')).toEqual([
      'name',
      'user.first',
      'user.tags',
    ])
  })

  it('answers with nothing for text that is not a JSON object', () => {
    expect(listPayloadKeys('nope')).toEqual([])
    expect(listPayloadKeys('[1]')).toEqual([])
  })
})

describe('readPayloadValue', () => {
  it('reads scalars as text and everything else as empty', () => {
    const payload = '{"name":"Ada","count":3,"on":true,"nested":{"x":"y"},"nothing":null}'
    expect(readPayloadValue(payload, 'name')).toBe('Ada')
    expect(readPayloadValue(payload, 'count')).toBe('3')
    expect(readPayloadValue(payload, 'on')).toBe('true')
    expect(readPayloadValue(payload, 'nested.x')).toBe('y')
    expect(readPayloadValue(payload, 'nested')).toBe('')
    expect(readPayloadValue(payload, 'nothing')).toBe('')
    expect(readPayloadValue(payload, 'absent')).toBe('')
  })

  it('answers with empty text for an unreadable payload', () => {
    expect(readPayloadValue('{oops', 'name')).toBe('')
  })
})

describe('parsePayloadObject', () => {
  it('answers with the object when the text is one', () => {
    expect(parsePayloadObject('{"name":"Ada"}')).toEqual({ name: 'Ada' })
    expect(parsePayloadObject('{}')).toEqual({})
  })

  it('answers with null for anything that is not a JSON object', () => {
    // Each of these is a reason the Data tab must not write over the text:
    // half-typed JSON, a document that stored something else, an empty editor.
    for (const text of ['{oops', '[1]', 'null', '3', '"Ada"', '']) {
      expect(parsePayloadObject(text), text).toBeNull()
    }
  })
})
