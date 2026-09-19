/**
 * What the studio would store if Save were pressed right now.
 *
 * Application layer: one pure function, no React, no DOM, no Zod. It is a
 * module of its own rather than a helper inside StudioPage because of the rule
 * it carries: the html and text a version stores are the UNRESOLVED render,
 * with every `{{key}}` still in it (ADR-26), and that is worth a test.
 */
import type { EmailDocument, TemplateEnvelope, TemplateKind } from '@/domain'
import { mergeFieldsJsonSchema } from './mergeFields'
import type { VersionInput } from './repositories/templateRepository'

/** Everything a version is built from: the draft, plus the last good render. */
export interface VersionInputSources {
  readonly kind: TemplateKind
  readonly envelope: TemplateEnvelope
  readonly samplePayloadText: string
  /**
   * The pipeline's own output, NOT the preview a person is looking at. The
   * preview has sample values substituted in; a stored version has to work for
   * every recipient, so it keeps the tokens. `null` before the first render.
   */
  readonly html: string | null
  readonly text: string | null
  /** A code template's TSX. Ignored for a visual one. */
  readonly source: string
  /** A visual template's canvas. Ignored for a code one. */
  readonly document: EmailDocument
  /** The visual theme stored with the template. */
  readonly theme: string
  /** A code template's hand-written schema, carried forward untouched. */
  readonly propsSchemaText: string
  /** Every `{{key}}` in play; a visual template's schema is written from these. */
  readonly mergeFieldKeys: readonly string[]
}

/**
 * The version to send, or `null` when nothing has been rendered yet — which is
 * also why Save is unavailable in that state (`saveTemplateReason`).
 */
export function buildVersionInput(sources: VersionInputSources): VersionInput | null {
  if (sources.html === null || sources.text === null) return null
  const common = {
    envelope: sources.envelope,
    samplePayloadText: sources.samplePayloadText,
    html: sources.html,
    text: sources.text,
  }
  if (sources.kind === 'visual') {
    return {
      ...common,
      kind: 'visual',
      document: sources.document,
      theme: sources.theme,
      // A visual template has no hand-written schema: its contract is the set
      // of merge fields on the canvas, written out so a later consumer knows
      // what values this email needs.
      propsSchemaText: mergeFieldsJsonSchema(sources.mergeFieldKeys),
    }
  }
  return { ...common, kind: 'code', source: sources.source, propsSchemaText: sources.propsSchemaText }
}
