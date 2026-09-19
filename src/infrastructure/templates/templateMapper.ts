/**
 * Turns a stored TemplateRecord into an EmailTemplate the studio can use.
 *
 * Infrastructure layer: this is where a record (plain data, and all that ever
 * travels over the wire) is given its behaviour — the props validator. Keeping
 * that assembly here is why the domain never needs Zod.
 */
import type { VersionInput } from '@/application/repositories/templateRepository'
import { templateId, type EmailDocument, type EmailTemplate, type TemplateRecord } from '@/domain'
import type { TemplateDetailDto, VersionBodyDto } from '@shared/templateContracts'
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

/**
 * Turns one API response into the record the rest of the app speaks.
 *
 * The wire shape (`shared/templateContracts.ts`) is flat and JSON-friendly:
 * `versionNumber` rather than a version object, `propsSample`/`propsSchema`
 * rather than the studio's `…Text` names, and the document as a bare object.
 * This is the one place those two vocabularies meet.
 */
export function toTemplateRecord(dto: TemplateDetailDto): TemplateRecord {
  const version = dto.version
  const base = {
    metadata: {
      id: templateId(dto.id),
      name: dto.name,
      slug: dto.slug,
      description: dto.description,
      category: dto.category,
      status: dto.status,
      version: {
        number: version.versionNumber,
        label: `v${version.versionNumber}`,
        createdAt: version.createdAt,
      },
      revision: dto.revision,
      tags: dto.tags,
      origin: dto.origin,
      createdBy: dto.createdBy,
      createdAt: dto.createdAt,
      updatedBy: dto.updatedBy,
      updatedAt: dto.updatedAt,
    },
    envelope: version.envelope,
    samplePayloadText: version.propsSample,
    propsSchemaText: version.propsSchema,
  }
  if (version.kind === 'code') return { ...base, kind: 'code', source: version.source }
  // The contract has already checked this is a Tiptap `doc` node; the domain
  // describes documents structurally, so widening it is the only cast needed.
  return {
    ...base,
    kind: 'visual',
    document: version.document as EmailDocument,
    theme: version.theme,
    html: version.html,
    text: version.text,
  }
}

/**
 * The other direction: one new version, in the words the API uses.
 *
 * It lives beside `toTemplateRecord` so that the wire's vocabulary — the
 * `propsSample`/`propsSchema` names, and a document that travels as a plain
 * JSON object for the server to stringify into one TEXT column (plan §3.4) —
 * stops at this file rather than being spelled out again in the adapter.
 */
export function toVersionBody(input: VersionInput): VersionBodyDto {
  const common = {
    envelope: input.envelope,
    html: input.html,
    text: input.text,
    propsSample: input.samplePayloadText,
    propsSchema: input.propsSchemaText,
    note: input.note ?? '',
  }
  if (input.kind === 'code') return { ...common, kind: 'code', source: input.source }
  return {
    ...common,
    kind: 'visual',
    document: input.document as Record<string, unknown>,
    theme: input.theme,
  }
}
