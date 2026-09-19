/**
 * What the studio writes when a visual template becomes a code template.
 *
 * Application layer, pure: no React, no DOM, no Zod. It is a module of its own,
 * like `versionInput.ts`, because of the two rules it carries — the sample
 * payload has to keep working after the conversion, and the stored html/text
 * keep their `{{key}}` tokens (ADR-26, ADR-28).
 */
import { mergeFieldsJsonSchema, parsePayloadObject, readPayloadValue, setPayloadValue } from '../mergeFields'
import type { ConvertToCodeInput } from '../repositories/templateRepository'
import type { ConvertedProp } from './documentToTsx'

/** The one-line "what changed" stored with the new version. */
export const CONVERSION_NOTE = 'Converted from the visual editor.'

export interface ConvertedVersionSources {
  /** The revision the conversion was prepared against. */
  readonly expectedRevision: number
  /** The generated TSX. */
  readonly source: string
  /** The smoke render's output, with merge fields still unresolved. */
  readonly html: string
  readonly text: string
  /** The visual template's sample payload, as it is on screen. */
  readonly samplePayloadText: string
  readonly props: readonly ConvertedProp[]
}

/** Everything `POST /api/templates/:id/convert` needs, assembled in one place. */
export function buildConvertToCodeInput(sources: ConvertedVersionSources): ConvertToCodeInput {
  return {
    expectedRevision: sources.expectedRevision,
    source: sources.source,
    html: sources.html,
    text: sources.text,
    samplePayloadText: convertedSamplePayload(sources.samplePayloadText, sources.props),
    // The converted component's contract: one required string per prop. The
    // same shape a visual template stored, under the new names.
    propsSchemaText: mergeFieldsJsonSchema(sources.props.map((prop) => prop.name)),
    note: CONVERSION_NOTE,
  }
}

/**
 * The sample payload after conversion: everything that was there, plus one
 * entry per prop.
 *
 * A dotted merge field becomes a flat prop (`{{user.first_name}}` →
 * `userFirstName`), so a payload written for the canvas would leave the
 * converted component with nothing to render. The old keys are KEPT rather than
 * rewritten, because the subject and the preheader still substitute from them
 * by their original names (ADR-26).
 *
 * Text that is not a JSON object is left exactly as it is: it is somebody's
 * half-typed JSON, and replacing it would throw their work away.
 */
export function convertedSamplePayload(samplePayloadText: string, props: readonly ConvertedProp[]): string {
  if (parsePayloadObject(samplePayloadText) === null) return samplePayloadText
  let payloadText = samplePayloadText
  for (const prop of props) {
    // A field whose key is already the prop's name needs nothing doing.
    if (prop.name === prop.mergeFieldKey) continue
    payloadText = setPayloadValue(
      payloadText,
      prop.name,
      readPayloadValue(samplePayloadText, prop.mergeFieldKey),
    )
  }
  return payloadText
}
