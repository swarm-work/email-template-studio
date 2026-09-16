import { describe, expect, it } from 'vitest'
import { parseRecipientList, recipientProblem } from './parseRecipientList'

describe('parseRecipientList', () => {
  it('splits on commas, semicolons, line breaks and a mix of them', () => {
    expect(parseRecipientList('a@x.io, b@x.io; c@x.io\nd@x.io\r\ne@x.io').addresses).toEqual([
      'a@x.io',
      'b@x.io',
      'c@x.io',
      'd@x.io',
      'e@x.io',
    ])
  })

  it('takes the address out of a pasted "Name <address>" pair', () => {
    expect(parseRecipientList('Ada <ada@x.io>, Grace Hopper <grace@x.io>').addresses).toEqual([
      'ada@x.io',
      'grace@x.io',
    ])
  })

  it('dedupes case-insensitively and keeps the first spelling', () => {
    expect(parseRecipientList('Ada@X.io, ada@x.io, ADA@x.io').addresses).toEqual(['Ada@X.io'])
  })

  it('collects invalid parts instead of throwing', () => {
    const list = parseRecipientList('a@x.io, nope, also bad')
    expect(list.addresses).toEqual(['a@x.io'])
    expect(list.invalid).toEqual(['nope', 'also bad'])
  })

  it('treats empty and whitespace-only text as no recipients', () => {
    expect(parseRecipientList('')).toEqual({ addresses: [], invalid: [], notAllowed: [] })
    expect(parseRecipientList('  ,\n ; ')).toEqual({ addresses: [], invalid: [], notAllowed: [] })
  })

  it('reports allow-list misses only when an allow-list is given', () => {
    const text = 'qa@x.io, stranger@y.io'
    expect(parseRecipientList(text).notAllowed).toEqual([])
    expect(parseRecipientList(text, ['QA@X.io']).notAllowed).toEqual(['stranger@y.io'])
  })
})

describe('recipientProblem', () => {
  const list = (text: string, allowed?: readonly string[]) => parseRecipientList(text, allowed)

  it('asks for a recipient when nothing usable was typed', () => {
    expect(recipientProblem(list(''), 10)).toBe('Add at least one recipient.')
  })

  it('names the parts that are not addresses', () => {
    expect(recipientProblem(list('foo'), 10)).toBe('Check this address: foo.')
    expect(recipientProblem(list('a, b'), 10)).toBe('Check these addresses: a, b.')
  })

  it('counts how many addresses are over the cap', () => {
    const eleven = Array.from({ length: 11 }, (_, index) => `p${index}@x.io`).join(', ')
    expect(recipientProblem(list(eleven), 10)).toBe('Up to 10 addresses per send. Remove 1.')
  })

  it('names the first address the allow-list refuses', () => {
    expect(recipientProblem(list('a@x.io, b@y.io', ['c@z.io']), 10)).toBe(
      "a@x.io is not in the server's allow-list.",
    )
  })

  it('reports the most basic problem first and nothing at all when the list is fine', () => {
    // Invalid beats the cap, which beats the allow-list.
    const eleven = Array.from({ length: 11 }, (_, index) => `p${index}@x.io`).join(', ')
    expect(recipientProblem(list(`${eleven}, junk`, []), 10)).toBe('Check this address: junk.')
    expect(recipientProblem(list(eleven, []), 10)).toBe('Up to 10 addresses per send. Remove 1.')
    expect(recipientProblem(list('a@x.io', ['a@x.io']), 10)).toBeNull()
    expect(recipientProblem(list('a@x.io'), 10)).toBeNull()
  })
})
