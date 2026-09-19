/**
 * Merge fields: finding `{{key}}` tokens and filling them in from the payload.
 *
 * Application layer, entirely pure: no React, no DOM, no Zod, no editor. Every
 * function here takes strings or plain document data and returns strings or
 * plain data, which is why the whole module is table-testable and why the same
 * substitution can later run on a server (ADR-26).
 *
 * The one rule worth remembering: a key with no value in the payload stays
 * VISIBLE as `{{key}}`. An email that quietly says "Hi ," is a worse outcome
 * than one that says "Hi {{firstName}}," and is reported as a warning.
 */
import type { EmailDocumentNode, PreviewPayload } from '@/domain'

/**
 * What a merge field looks like: `{{` + a dotted path of identifiers + `}}`,
 * with optional spaces inside the braces. Global, so it can be used to scan a
 * whole string — always via `new RegExp(source, flags)` or after resetting
 * `lastIndex`, because a global regex remembers where it stopped.
 */
export const MERGE_FIELD_PATTERN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\s*\}\}/g

/** How values are escaped when they are dropped into the surrounding text. */
export type MergeFieldEscape = 'html' | 'none'

export interface ApplyMergeFieldsOptions {
  /**
   * `'html'` for exported HTML (escapes `& < > "`, which is safe in element
   * text AND inside a double-quoted attribute); `'none'` for the plain-text
   * part, the subject and the preheader, where an escape would be visible.
   */
  readonly escape: MergeFieldEscape
}

export interface AppliedMergeFields {
  readonly text: string
  /** Keys that had no usable value, in the order they first appear. */
  readonly missing: readonly string[]
}

/**
 * Replaces every `{{key}}` in `text` with its value from `payload`.
 *
 * Strings are used verbatim; numbers and booleans through `String()`. Anything
 * else — `null`, `undefined`, an object, an array — counts as no value: the
 * token is left on screen and the key is reported in `missing`.
 */
export function applyMergeFields(
  text: string,
  payload: PreviewPayload,
  { escape }: ApplyMergeFieldsOptions,
): AppliedMergeFields {
  const missing: string[] = []
  const replaced = text.replace(scanner(), (_token, key: string) => {
    const value = readPath(payload, key)
    if (value === null) {
      if (!missing.includes(key)) missing.push(key)
      // Normalised on purpose: `{{ name }}` comes back as `{{name}}`, so the
      // warning row and the token on screen spell the key the same way.
      return `{{${key}}}`
    }
    return escape === 'html' ? escapeHtml(value) : value
  })
  return { text: replaced, missing }
}

/**
 * Which of `keys` the payload cannot fill in, by the same rule
 * `applyMergeFields` uses.
 *
 * It exists because the studio knows keys the exported HTML has not caught up
 * with yet — a chip typed a moment ago, during the export's debounce — and the
 * diagnostics row should say so straight away rather than a beat later.
 */
export function missingMergeFields(keys: readonly string[], payload: PreviewPayload): string[] {
  return keys.filter((key) => readPath(payload, key) === null)
}

/** Every distinct key mentioned in a string, in order of first appearance. */
export function listMergeFields(text: string): string[] {
  const keys: string[] = []
  for (const match of text.matchAll(scanner())) {
    const key = match[1]
    if (!keys.includes(key)) keys.push(key)
  }
  return keys
}

/**
 * Every distinct key in a visual document: the `mergeField` chips, plus any
 * `{{key}}` still sitting in plain text or in a link's href (typed into the
 * link dialog, or pasted before the paste rule could convert it).
 */
export function listDocumentMergeFields(document: EmailDocumentNode | null | undefined): string[] {
  const keys: string[] = []
  const add = (key: string) => {
    if (key !== '' && !keys.includes(key)) keys.push(key)
  }

  const walk = (node: EmailDocumentNode) => {
    if (node.type === 'mergeField') add(String(node.attrs?.key ?? ''))
    if (typeof node.text === 'string') listMergeFields(node.text).forEach(add)
    const href = node.attrs?.href
    if (typeof href === 'string') listMergeFields(href).forEach(add)
    // Marks are shaped like nodes (a link mark carries its href in `attrs`), so
    // they go through the same walk rather than a second, near-identical one.
    node.marks?.forEach(walk)
    node.content?.forEach(walk)
  }

  if (document) walk(document)
  return keys
}

/**
 * The key on its own, without the braces: what the Data tab's "Add field"
 * validates a typed name against. Written out rather than derived from
 * `MERGE_FIELD_PATTERN` so both are readable; `mergeFields.test.ts` asserts the
 * two agree.
 */
export const MERGE_FIELD_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/

/** True when `value` could be a merge-field key: `name`, `user.first_name`. */
export function isMergeFieldKey(value: string): boolean {
  return MERGE_FIELD_KEY_PATTERN.test(value)
}

/**
 * Every dotted path in the sample payload that holds a value, so the Data tab
 * can show a key the JSON has but the document no longer uses ("Unused").
 * Nested objects are walked; anything that is not a JSON object is a leaf.
 */
export function listPayloadKeys(payloadText: string): string[] {
  const payload = parsePayloadObject(payloadText)
  if (!payload) return []
  const keys: string[] = []
  const walk = (value: Record<string, unknown>, prefix: string) => {
    for (const [name, child] of Object.entries(value)) {
      const path = prefix === '' ? name : `${prefix}.${name}`
      if (child !== null && typeof child === 'object' && !Array.isArray(child)) {
        walk(child as Record<string, unknown>, path)
      } else {
        keys.push(path)
      }
    }
  }
  walk(payload, '')
  return keys
}

/** The value at a dotted path as text for an input; '' when there is none. */
export function readPayloadValue(payloadText: string, key: string): string {
  const payload = parsePayloadObject(payloadText)
  return payload ? (readPath(payload, key) ?? '') : ''
}

/**
 * The payload text as a plain object, or `null` when it is not one — broken
 * JSON, `null`, an array, a bare number.
 *
 * Exported because two callers need to tell "no values yet" from "I could not
 * read this": `StudioPage` resolves against the object it can parse (ADR-26),
 * and the Data tab refuses to WRITE over text it could not read, which would
 * otherwise throw away everything somebody had typed.
 */
export function parsePayloadObject(payloadText: string): Record<string, unknown> | null {
  return parseObject(payloadText)
}

/**
 * Adds `"key": ""` for every key the payload has no value for, keeping what is
 * already there. Behind the Data tab's "Fill in missing keys".
 *
 * Text that is not a JSON object has nothing to preserve, so it is replaced by
 * a fresh object with the keys in it.
 */
export function withMissingKeys(payloadText: string, keys: readonly string[]): string {
  const payload = parsePayloadObject(payloadText) ?? {}
  const next = structuredCopy(payload)
  for (const key of keys) {
    if (readPath(payload, key) === null) writePath(next, key, '')
  }
  return stringifyLike(payloadText, next)
}

/**
 * Sets one key in the payload text. A dotted key creates the objects it needs,
 * so `setPayloadValue('{}', 'user.name', 'Ada')` gives `{"user":{"name":"Ada"}}`.
 *
 * Like `withMissingKeys`, text that is not a JSON object has nothing to keep
 * and is REPLACED. Callers must therefore not offer this over text they could
 * not read: the Data tab checks `parsePayloadObject` first and disables its
 * inputs, so a half-typed JSON is never overwritten by one keystroke.
 */
export function setPayloadValue(payloadText: string, key: string, value: string): string {
  const next = structuredCopy(parsePayloadObject(payloadText) ?? {})
  writePath(next, key, value)
  return stringifyLike(payloadText, next)
}

/**
 * Hrefs that became dangerous once the values were substituted in.
 *
 * A payload value is data, and `<a href="{{link}}">` with `link` set to
 * `javascript:…` would turn that data into code in the reader's client. This
 * runs on the RESOLVED html, so it sees what would actually be sent, and the
 * studio reports a hit as a diagnostics error.
 */
export function findUnsafeHrefs(html: string): string[] {
  const found: string[] = []
  const hrefs = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s">]+))/gi
  for (const match of html.matchAll(hrefs)) {
    const value = match[1] ?? match[2] ?? match[3] ?? ''
    // Whitespace and control characters are stripped first because browsers
    // ignore them inside a scheme: `java\nscript:alert(1)` still runs.
    const scheme = value.replace(/[\s -]/g, '').toLowerCase()
    if (scheme.startsWith('javascript:') || scheme.startsWith('data:')) {
      if (!found.includes(value)) found.push(value)
    }
  }
  return found
}

/**
 * The JSON Schema text stored with a visual version (`propsSchemaText`): every
 * discovered key required, every value a string, nested from dotted keys.
 *
 * `additionalProperties: true` at every level because the payload is sample
 * data a person types: extra keys are their business, missing ones are the
 * studio's. A key that is also a prefix of another (`user` and `user.name`)
 * becomes the object, since that is the only reading that can be satisfied.
 *
 * No keys at all gives `'{}'`, the studio's spelling of "any object" — the same
 * text a template with no contract stores (see jsonSchemaPropsValidator.ts).
 */
export function mergeFieldsJsonSchema(keys: readonly string[]): string {
  if (keys.length === 0) return '{}'
  const root: SchemaTree = { children: new Map() }
  for (const key of keys) {
    let node = root
    for (const segment of key.split('.')) {
      const existing = node.children.get(segment) ?? { children: new Map() }
      node.children.set(segment, existing)
      node = existing
    }
  }
  return JSON.stringify(schemaFor(root), null, 2)
}

/* -------------------------------------------------------------------------
 * Internals
 * ---------------------------------------------------------------------- */

interface SchemaTree {
  readonly children: Map<string, SchemaTree>
}

function schemaFor(node: SchemaTree): Record<string, unknown> {
  if (node.children.size === 0) return { type: 'string' }
  const properties: Record<string, unknown> = {}
  for (const [name, child] of node.children) properties[name] = schemaFor(child)
  return {
    type: 'object',
    properties,
    required: [...node.children.keys()],
    additionalProperties: true,
  }
}

/** A fresh global regex per scan, so no two scans share a `lastIndex`. */
function scanner(): RegExp {
  return new RegExp(MERGE_FIELD_PATTERN.source, 'g')
}

/**
 * The value at a dotted path, as the string to substitute, or `null` for
 * "no usable value here".
 */
function readPath(payload: PreviewPayload, key: string): string | null {
  let current: unknown = payload
  for (const segment of key.split('.')) {
    if (current === null || typeof current !== 'object' || Array.isArray(current)) return null
    current = (current as Record<string, unknown>)[segment]
  }
  if (typeof current === 'string') return current
  if (typeof current === 'number' || typeof current === 'boolean') return String(current)
  // null, undefined, objects and arrays have no sensible one-line spelling.
  return null
}

/** Writes `value` at a dotted path, creating plain objects on the way down. */
function writePath(target: Record<string, unknown>, key: string, value: string): void {
  const segments = key.split('.')
  let current = target
  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment]
    // A string where an object is needed is replaced: `user.name` cannot be
    // filled in while `user` is the text "Ada".
    if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }
  current[segments[segments.length - 1]] = value
}

/** The payload text as a plain object, or null when it is anything else. */
function parseObject(payloadText: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(payloadText)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/** A deep copy, so nothing here ever edits the caller's object. */
function structuredCopy(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}

/**
 * Re-prints the payload with the indentation the previous text used, so
 * pressing a button in the Data tab does not silently reformat the JSON
 * somebody hand-aligned. Key order survives because `JSON.parse` keeps
 * insertion order for non-numeric keys.
 */
function stringifyLike(previousText: string, value: Record<string, unknown>): string {
  const indented = /\n([ \t]+)\S/.exec(previousText)
  const indent = indented ? indented[1] : '  '
  return JSON.stringify(value, null, indent)
}

/**
 * Escapes the four characters that could otherwise end the element or the
 * attribute a value was dropped into. `'` is left alone: the studio's exported
 * HTML quotes attributes with `"`, and escaping it would show up as `&#39;` in
 * the reader's inbox.
 */
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
