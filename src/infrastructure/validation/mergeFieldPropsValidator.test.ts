import { describe, expect, it } from 'vitest'
import { mergeFieldPropsValidator } from './mergeFieldPropsValidator'

describe('mergeFieldPropsValidator', () => {
  it('accepts a payload with a string for every key', () => {
    const result = mergeFieldPropsValidator(['name', 'company'])({ name: 'Ada', company: 'Acme' })
    expect(result.ok).toBe(true)
  })

  it('reports the key that has no value', () => {
    const result = mergeFieldPropsValidator(['name'])({})
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues[0].path).toBe('name')
  })

  it('accepts the numbers and booleans applyMergeFields can print', () => {
    expect(mergeFieldPropsValidator(['count', 'vip'])({ count: 3, vip: true }).ok).toBe(true)
  })

  it('refuses a value it could not print, such as an array', () => {
    expect(mergeFieldPropsValidator(['tags'])({ tags: ['a'] }).ok).toBe(false)
  })

  it('allows extra keys the document does not use', () => {
    expect(mergeFieldPropsValidator(['name'])({ name: 'Ada', spare: 1 }).ok).toBe(true)
  })

  it('nests dotted keys', () => {
    const validate = mergeFieldPropsValidator(['user.first_name'])
    expect(validate({ user: { first_name: 'Ada' } }).ok).toBe(true)
    const missing = validate({ user: {} })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.issues[0].path).toBe('user.first_name')
  })

  it('lets the object win when a key is also a prefix of another', () => {
    const validate = mergeFieldPropsValidator(['user', 'user.name'])
    expect(validate({ user: { name: 'Ada' } }).ok).toBe(true)
    expect(validate({ user: 'Ada' }).ok).toBe(false)
  })

  it('accepts anything when the document has no merge fields', () => {
    expect(mergeFieldPropsValidator([])({ whatever: true }).ok).toBe(true)
  })

  it('refuses a payload that is not an object', () => {
    expect(mergeFieldPropsValidator(['name'])('Ada').ok).toBe(false)
  })
})
