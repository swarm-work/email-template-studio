/**
 * What "Start from: Blank" and "Start from: Copy of …" actually send.
 *
 * Infrastructure layer: the repository port always receives a COMPLETE first
 * version (plan §3.4), so `startFrom` is resolved here, in the browser, rather
 * than being a server feature. No React, no DOM.
 */
import type { VersionInput } from '@/application/repositories/templateRepository'
import type { EmailDocument, TemplateKind, TemplateRecord } from '@/domain'
import { DEFAULT_STUDIO_THEME } from '@/infrastructure/render/studioTheme'
import blankSource from './blank.email.tsx?raw'
import blankDocument from './starters/blank.visual.json'
import { prettyJson } from './starterCatalog'

/**
 * The sample data the blank code starter renders with. `firstName` is here
 * because the starter uses `{{firstName}}`: a new template should show a
 * resolved merge field on its very first preview, not an unresolved token.
 */
const BLANK_SAMPLE_PAYLOAD = { firstName: 'Ada', productName: 'Meridian' }

/** A blank template's envelope: a subject that is obviously a placeholder. */
const BLANK_ENVELOPE = { subject: 'A new email', preheader: '', replyTo: '' } as const

/**
 * The first version of a brand-new template.
 *
 * `html` and `text` are empty on purpose: nothing has been rendered yet, and
 * the studio writes the real export on the first save. Every other field is
 * filled in, so the template opens as something you can read and change rather
 * than an empty editor.
 */
export function blankVersionInput(kind: TemplateKind): VersionInput {
  const common = {
    envelope: { ...BLANK_ENVELOPE },
    samplePayloadText: prettyJson(BLANK_SAMPLE_PAYLOAD),
    propsSchemaText: '{}',
    html: '',
    text: '',
    note: 'Created from a blank template.',
  }
  if (kind === 'code') return { ...common, kind: 'code', source: blankSource }
  return {
    ...common,
    kind: 'visual',
    document: blankDocument as EmailDocument,
    theme: DEFAULT_STUDIO_THEME,
  }
}

/**
 * The first version of a template copied from an existing one: the same
 * content, carried over field for field. The copy is a separate template from
 * then on — nothing links the two.
 */
export function versionInputFromRecord(record: TemplateRecord): VersionInput {
  const common = {
    envelope: record.envelope,
    samplePayloadText: record.samplePayloadText,
    propsSchemaText: record.propsSchemaText,
    note: `Copied from ${record.metadata.name}.`,
  }
  if (record.kind === 'code') {
    return { ...common, kind: 'code', source: record.source, html: '', text: '' }
  }
  return {
    ...common,
    kind: 'visual',
    document: record.document,
    theme: record.theme,
    // A visual template's export is saved with it, so the copy can keep it and
    // show a preview before the canvas has composed anything.
    html: record.html,
    text: record.text,
  }
}
