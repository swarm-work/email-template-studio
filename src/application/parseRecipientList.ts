/**
 * Use case: turn what someone typed into the To field into a list of addresses.
 *
 * The field is free text, so this has to be forgiving about separators and
 * about pasted "Name <address>" pairs, and strict about what counts as an
 * address (the same `z.email()` rule the server applies, so the client never
 * promises something the server will refuse).
 *
 * Nothing throws: bad parts are collected so the UI can name them. The server
 * re-checks everything; this only exists to explain problems before a send.
 */
import { z } from 'zod'

export interface RecipientList {
  /** Valid, de-duplicated addresses, in the order they were typed. */
  readonly addresses: readonly string[]
  /** Parts that are not addresses, kept as typed so the message can quote them. */
  readonly invalid: readonly string[]
  /** Valid addresses the server's allow-list does not contain. Empty unless `allowed` was given. */
  readonly notAllowed: readonly string[]
}

/** Commas, semicolons and line breaks separate addresses. Spaces never do: "Ada <a@x.io>" is one entry. */
const SEPARATORS = /[,;\r\n]+/

/** The address inside angle brackets, as mail clients and Attio paste it. */
const BRACKETED = /<([^>]*)>/

export function parseRecipientList(text: string, allowed?: readonly string[]): RecipientList {
  const allowedByLowerCase = new Set((allowed ?? []).map((address) => address.toLowerCase()))
  const seen = new Set<string>()
  const addresses: string[] = []
  const invalid: string[] = []
  const notAllowed: string[] = []

  for (const part of text.split(SEPARATORS)) {
    const trimmed = part.trim()
    if (trimmed === '') continue
    const bracketed = BRACKETED.exec(trimmed)
    const address = (bracketed ? bracketed[1] : trimmed).trim()
    if (address === '') continue
    if (!z.email().safeParse(address).success) {
      invalid.push(address)
      continue
    }
    const key = address.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    addresses.push(address)
    if (allowed !== undefined && !allowedByLowerCase.has(key)) notAllowed.push(address)
  }

  return { addresses, invalid, notAllowed }
}

/**
 * The single reason sending is not possible yet, or null when it is.
 *
 * Order matters: an empty field is the most basic problem, but "empty" means
 * nothing usable was typed at all. Once there is a part that is simply not an
 * address, naming it is more helpful than asking for a recipient again.
 */
export function recipientProblem(list: RecipientList, max: number): string | null {
  if (list.addresses.length === 0 && list.invalid.length === 0) return 'Add at least one recipient.'
  if (list.invalid.length > 0) {
    return list.invalid.length === 1
      ? `Check this address: ${list.invalid[0]}.`
      : `Check these addresses: ${list.invalid.join(', ')}.`
  }
  if (list.addresses.length > max) {
    return `Up to ${max} addresses per send. Remove ${list.addresses.length - max}.`
  }
  if (list.notAllowed.length > 0) {
    return `${list.notAllowed[0]} is not in the server's allow-list.`
  }
  return null
}
