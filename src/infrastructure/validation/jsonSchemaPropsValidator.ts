/**
 * Adapter: turns the JSON Schema text stored with a template into the domain's
 * `PropsValidator`. Infrastructure layer, because only infrastructure knows Zod.
 *
 * Templates created in the studio carry a JSON Schema rather than a hand-written
 * Zod schema, so this is the validator every non-starter template gets.
 */
import { z } from 'zod'
import type { PropsValidator } from '@/domain'
import { zodPropsValidator } from './zodPropsValidator'

/** Accepts any JSON object. Used when a template declares no contract. */
const ANY_OBJECT = z.looseObject({})

/**
 * Builds a validator from JSON Schema text.
 *
 * Deliberately permissive: a schema we cannot read must never stop someone
 * previewing their template, so anything unparseable degrades to "any object"
 * instead of failing. '{}' means the same thing on purpose.
 */
export function jsonSchemaPropsValidator(schemaText: string): PropsValidator {
  return zodPropsValidator(schemaFromText(schemaText))
}

function schemaFromText(schemaText: string): z.ZodType {
  let parsed: unknown
  try {
    parsed = JSON.parse(schemaText)
  } catch {
    return ANY_OBJECT
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return ANY_OBJECT
  if (Object.keys(parsed).length === 0) return ANY_OBJECT
  try {
    // z.fromJSONSchema is experimental and throws on constructs it cannot map.
    return z.fromJSONSchema(parsed as Record<string, unknown>)
  } catch {
    return ANY_OBJECT
  }
}
