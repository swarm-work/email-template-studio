/**
 * Turns a stored TemplateRecord into an EmailTemplate the studio can use.
 *
 * Infrastructure layer: this is where a record (plain data, and all that ever
 * travels over the wire) is given its behaviour — the props validator. Keeping
 * that assembly here is why the domain never needs Zod.
 */
import type { EmailTemplate, TemplateRecord } from '@/domain'
import { jsonSchemaPropsValidator } from '@/infrastructure/validation/jsonSchemaPropsValidator'
import { STARTER_PROPS_VALIDATORS } from './registry'

/**
 * A shipped, unedited starter keeps its hand-written Zod schema (it rejects
 * unknown keys and explains each field); everything else — including a starter
 * somebody has since edited — is validated from the JSON Schema text stored
 * with the template, so a new prop a person added is honoured.
 *
 * The lookup is by slug, not id: seeding gives the starters `tpl_<slug>` ids.
 */
export function toEmailTemplate(record: TemplateRecord): EmailTemplate {
  const { origin, slug, revision } = record.metadata
  const starter = origin === 'starter' && revision <= 1 ? STARTER_PROPS_VALIDATORS[slug] : undefined
  const validateProps = starter ?? jsonSchemaPropsValidator(record.propsSchemaText)
  return { ...record, validateProps }
}
