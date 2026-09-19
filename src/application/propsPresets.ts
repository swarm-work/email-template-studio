/**
 * The sets of sample data a template can be previewed with.
 *
 * Application layer, entirely pure: no React, no DOM, no Zod. It takes the
 * template's stored sample payload and its props JSON Schema as TEXT and
 * derives the variants from them, so nothing new is stored per template and
 * nothing has to be kept in step.
 *
 * The mock this studio was drawn from had a "Randomize Values" button. Random
 * data teaches nothing; these answer the questions an author actually has —
 * what does it normally look like, what happens when a value is long, and what
 * happens when the optional fields are missing (plan §4.7).
 */

/** Which preset: the stored sample, the long-value variant, or the sparse one. */
export type PropsPresetId = 'default' | 'long' | 'sparse'

export interface PropsPreset {
  readonly id: PropsPresetId
  /** What the picker shows. */
  readonly label: string
  /** One line saying what it is for. */
  readonly description: string
  /** The JSON text the payload editor is filled with. */
  readonly text: string
}

/**
 * How long a "long" string is made. 72 characters is past the width of the
 * 600 px canvas at the body size, so anything that wraps badly wraps here.
 */
const LONG_TARGET = 72

/** Two spaces of indent, matching what the studio's Format button writes. */
const JSON_INDENT = 2

export const PROPS_PRESET_LABELS: Readonly<Record<PropsPresetId, string>> = {
  default: 'Default',
  long: 'Long values',
  sparse: 'Missing optional fields',
}

/**
 * The part of a JSON Schema this module reads: which keys are required, and
 * which of them are pinned to a fixed set of values. Deliberately structural —
 * the application layer does not import Zod, and a schema it cannot understand
 * simply means "no constraints known", which is the safe answer here.
 */
interface SchemaNode {
  readonly properties?: Record<string, unknown>
  readonly items?: unknown
  readonly required?: unknown
  readonly enum?: unknown
  readonly const?: unknown
  readonly pattern?: unknown
  readonly maxLength?: unknown
}

/**
 * Builds the presets for one template.
 *
 * `samplePayloadText` is the template's SAVED sample, not the current draft:
 * the presets are a way back to known data, so they must not drift with the
 * edits being made. `propsSchemaText` is the template's props JSON Schema
 * (`'{}'` = anything goes); it is what keeps a derived preset VALID, which is
 * the whole point of offering it — a preset that red-lines the props card and
 * stops the preview would teach the author nothing (ADR-30).
 *
 * A derived preset that came out identical to one already in the list is
 * dropped: three identically-labelled options that all do nothing is exactly
 * the dishonest control this feature replaced.
 */
export function buildPropsPresets(
  samplePayloadText: string,
  propsSchemaText: string,
): readonly PropsPreset[] {
  const presets: PropsPreset[] = [
    {
      id: 'default',
      label: PROPS_PRESET_LABELS.default,
      description: "The template's own sample data.",
      text: samplePayloadText,
    },
  ]

  const payload = parseObject(samplePayloadText)
  if (payload === null) return presets

  const schema = parseObject(propsSchemaText) as SchemaNode | null
  const seen = new Set([stringify(payload)])

  const add = (id: PropsPresetId, description: string, value: unknown) => {
    const text = stringify(value)
    if (seen.has(text)) return
    seen.add(text)
    presets.push({ id, label: PROPS_PRESET_LABELS[id], description, text })
  }

  add('long', 'Every free-text value stretched, so you can see what wraps.', lengthenValue(payload, schema))
  add('sparse', 'Every optional key emptied, like a half-filled record.', emptyOptionals(payload, schema))
  return presets
}

/** JSON text → plain object, or null for anything else (an array counts as anything else). */
function parseObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text)
    return isPlainObject(value) ? value : null
  } catch {
    return null
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Trailing newline included, so the text matches what `formatJson` writes. */
function stringify(value: unknown): string {
  return `${JSON.stringify(value, null, JSON_INDENT)}\n`
}

/** The sub-schema for one property, when the schema says anything about it. */
function propertySchema(schema: SchemaNode | null, key: string): SchemaNode | null {
  const property = schema?.properties?.[key]
  return isPlainObject(property) ? (property as SchemaNode) : null
}

/** The sub-schema for an array's entries. */
function itemsSchema(schema: SchemaNode | null): SchemaNode | null {
  return isPlainObject(schema?.items) ? (schema.items as SchemaNode) : null
}

/** The keys the schema insists on. No schema means nothing is required. */
function requiredKeys(schema: SchemaNode | null): ReadonlySet<string> {
  const required = schema?.required
  if (!Array.isArray(required)) return new Set()
  return new Set(required.filter((key): key is string => typeof key === 'string'))
}

/**
 * True when the schema pins this value to a shape a longer string cannot have.
 *
 * `role: 'member'` is declared `enum: ['admin','member','viewer']`, and
 * "member member member…" is not one of those three — so the value is left
 * exactly as it was. Same for `const`, `pattern` and `maxLength`.
 */
function isConstrained(schema: SchemaNode | null): boolean {
  if (schema === null) return false
  return (
    schema.enum !== undefined ||
    schema.const !== undefined ||
    schema.pattern !== undefined ||
    schema.maxLength !== undefined
  )
}

/**
 * Every free string made long, walking the payload and the schema together.
 *
 * The schema is walked alongside the value rather than looked up once, because
 * the constraint that matters is the one on the key being stretched, however
 * deep it sits.
 */
function lengthenValue(value: unknown, schema: SchemaNode | null): unknown {
  if (isConstrained(schema)) return value
  if (typeof value === 'string') return lengthen(value)
  if (Array.isArray(value)) {
    const items = itemsSchema(schema)
    return value.map((item) => lengthenValue(item, items))
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, lengthenValue(item, propertySchema(schema, key))]),
    )
  }
  return value
}

/**
 * Makes one value long without making it nonsense.
 *
 * A repeated URL is not a URL and a repeated address is not an address, so
 * those two grow in the one place where a long value is still valid: the path,
 * and the part before the `@`. Everything else is simply said again until it
 * is long enough, which is what a long name or a long product title looks like.
 */
function lengthen(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length >= LONG_TARGET) return value

  if (/^https?:\/\//i.test(trimmed)) {
    const padding = 'a-rather-long-campaign-path-segment'
    return `${trimmed.replace(/\/+$/, '')}/${repeatTo(padding, LONG_TARGET - trimmed.length, '-')}`
  }

  const at = trimmed.indexOf('@')
  if (at > 0 && !trimmed.includes(' ')) {
    const local = trimmed.slice(0, at)
    const domain = trimmed.slice(at)
    return `${repeatTo(local, LONG_TARGET - domain.length, '.')}${domain}`
  }

  return repeatTo(trimmed, LONG_TARGET, ' ')
}

/** Repeats `piece`, joined by `separator`, until the result reaches `target`. */
function repeatTo(piece: string, target: number, separator: string): string {
  let result = piece
  while (result.length < target) result = `${result}${separator}${piece}`
  return result
}

/**
 * Every key kept, every OPTIONAL value emptied.
 *
 * Required keys keep their sample value: emptying them would break the
 * template's own schema, and the preset is called "Missing optional fields"
 * precisely because that is what a real send with a half-filled record looks
 * like. A template with no schema has no required keys, so everything empties.
 */
function emptyOptionals(value: Record<string, unknown>, schema: SchemaNode | null): unknown {
  const required = requiredKeys(schema)
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      const child = propertySchema(schema, key)
      if (!required.has(key)) return [key, emptyValue(item)]
      // Required, so it keeps its value — but an object under it may have
      // optional keys of its own.
      return [key, isPlainObject(item) ? emptyOptionals(item, child) : item]
    }),
  )
}

/**
 * "Empty" is per type: `''` for a string, `0` for a number, `false` for a
 * boolean, `[]` for a list. A number left as `''` would be a type error rather
 * than the thin value this preset is meant to show.
 */
function emptyValue(value: unknown): unknown {
  if (typeof value === 'string') return ''
  if (typeof value === 'number') return 0
  if (typeof value === 'boolean') return false
  if (Array.isArray(value)) return []
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, emptyValue(item)]))
  }
  return value
}
