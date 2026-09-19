import { describe, expect, it } from 'vitest'
import { buildConvertToCodeInput, CONVERSION_NOTE, convertedSamplePayload } from './convertedVersion'

const PROPS = [
  { name: 'userFirstName', mergeFieldKey: 'user.first_name' },
  { name: 'recipientName', mergeFieldKey: 'recipientName' },
]

describe('convertedSamplePayload', () => {
  it('adds one entry per prop, reading the value the canvas used', () => {
    const before = JSON.stringify({ user: { first_name: 'Ada' }, recipientName: 'Ada Lovelace' }, null, 2)
    const after = JSON.parse(convertedSamplePayload(before, PROPS))
    expect(after.userFirstName).toBe('Ada')
    // Already flat, already right: nothing to add.
    expect(after.recipientName).toBe('Ada Lovelace')
  })

  it('keeps the original keys, because the subject still substitutes from them', () => {
    const before = JSON.stringify({ user: { first_name: 'Ada' } })
    const after = JSON.parse(convertedSamplePayload(before, PROPS))
    expect(after.user).toEqual({ first_name: 'Ada' })
  })

  it('leaves a key with no value as an empty string rather than dropping it', () => {
    const after = JSON.parse(convertedSamplePayload('{}', PROPS))
    expect(after.userFirstName).toBe('')
  })

  it('does not touch text it could not read as a JSON object', () => {
    expect(convertedSamplePayload('{ "user": ', PROPS)).toBe('{ "user": ')
  })
})

describe('buildConvertToCodeInput', () => {
  const input = buildConvertToCodeInput({
    expectedRevision: 7,
    source: 'export default function T() {}',
    html: '<p>Hi {{user.first_name}}</p>',
    text: 'Hi {{user.first_name}}',
    samplePayloadText: '{"user":{"first_name":"Ada"}}',
    props: PROPS,
  })

  it('carries the revision the conversion was prepared against', () => {
    expect(input.expectedRevision).toBe(7)
  })

  it('stores the render UNRESOLVED, so a later send can still substitute', () => {
    expect(input.html).toContain('{{user.first_name}}')
    expect(input.text).toContain('{{user.first_name}}')
  })

  it('writes a props schema of the new prop names', () => {
    const schema = JSON.parse(input.propsSchemaText)
    expect(Object.keys(schema.properties)).toEqual(['userFirstName', 'recipientName'])
    expect(schema.properties.userFirstName).toEqual({ type: 'string' })
  })

  it('says in the version history where the version came from', () => {
    expect(input.note).toBe(CONVERSION_NOTE)
  })
})
