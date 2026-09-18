import { describe, expect, it } from 'vitest'
import {
  apiErrorSchema,
  createTemplateRequest,
  envelopeSchema,
  MAX_DOCUMENT_BYTES,
  MAX_HTML_BYTES,
  MAX_SLUG_LENGTH,
  MAX_SOURCE_BYTES,
  MAX_TEXT_BYTES,
  saveVersionRequest,
  slugify,
  slugSchema,
  templateDetailSchema,
  updateMetadataRequest,
  versionBodySchema,
  versionSummarySchema,
} from './templateContracts.ts'

const codeVersion = {
  kind: 'code' as const,
  envelope: { subject: 'Hello', preheader: '', replyTo: '' },
  html: '<p>hi</p>',
  text: 'hi',
  propsSample: '{}',
  propsSchema: '{}',
  source: 'export default () => null',
}

describe('slugify', () => {
  it('turns a human name into a slug', () => {
    expect(slugify('Welcome & verification')).toBe('welcome-verification')
    expect(slugify('  Password   reset  ')).toBe('password-reset')
    expect(slugify('Añejo Café')).toBe('anejo-cafe')
  })

  it('returns an empty string when nothing usable is left', () => {
    expect(slugify('---')).toBe('')
    expect(slugify('🎉')).toBe('')
  })

  it('truncates a long name to a slug the schema still accepts', () => {
    // 'x x x …' would slugify to 'x-x-x-…', which is cut mid-separator.
    const slug = slugify('x '.repeat(80))
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH)
    expect(slugSchema.safeParse(slug).success).toBe(true)
  })
})

describe('envelopeSchema', () => {
  it('accepts an empty reply-to, meaning "use the send server\'s sender"', () => {
    expect(envelopeSchema.safeParse({ subject: 'S', preheader: '', replyTo: '' }).success).toBe(true)
  })

  it('rejects a reply-to that is not an address', () => {
    expect(envelopeSchema.safeParse({ subject: 'S', preheader: '', replyTo: 'nope' }).success).toBe(false)
  })
})

describe('versionBodySchema', () => {
  it('round-trips a code version and defaults the note', () => {
    const parsed = versionBodySchema.parse(codeVersion)
    expect(parsed).toMatchObject({ kind: 'code', source: 'export default () => null', note: '' })
  })

  it('round-trips a visual version', () => {
    const parsed = versionBodySchema.parse({
      ...codeVersion,
      kind: 'visual',
      source: undefined,
      document: { type: 'doc', content: [] },
      theme: 'studio-v1',
    })
    expect(parsed).toMatchObject({ kind: 'visual', theme: 'studio-v1' })
  })

  it('refuses a visual version whose document is not a doc node', () => {
    const result = versionBodySchema.safeParse({
      ...codeVersion,
      kind: 'visual',
      document: { type: 'paragraph' },
      theme: 'studio-v1',
    })
    expect(result.success).toBe(false)
  })

  it('refuses HTML over the size cap', () => {
    const result = versionBodySchema.safeParse({ ...codeVersion, html: 'x'.repeat(MAX_HTML_BYTES + 1) })
    expect(result.success).toBe(false)
  })

  it('refuses a document over the size cap', () => {
    const result = versionBodySchema.safeParse({
      ...codeVersion,
      kind: 'visual',
      document: { type: 'doc', filler: 'x'.repeat(MAX_DOCUMENT_BYTES + 1) },
      theme: 'studio-v1',
    })
    expect(result.success).toBe(false)
  })

  it('refuses a version whose fields are each within their cap but too big together', () => {
    const result = versionBodySchema.safeParse({
      ...codeVersion,
      html: 'x'.repeat(MAX_HTML_BYTES),
      text: 'x'.repeat(MAX_TEXT_BYTES),
      source: 'x'.repeat(MAX_SOURCE_BYTES),
    })
    expect(result.success).toBe(false)
  })

  it('counts bytes, not characters, against the cap', () => {
    // Four bytes per emoji: half the cap in emoji is over the cap in bytes.
    const result = versionBodySchema.safeParse({
      ...codeVersion,
      html: '🎉'.repeat(MAX_HTML_BYTES / 2),
    })
    expect(result.success).toBe(false)
  })
})

describe('request schemas', () => {
  it('accepts a create request and defaults description and tags', () => {
    const parsed = createTemplateRequest.parse({
      name: 'Welcome',
      category: 'onboarding',
      initialVersion: codeVersion,
    })
    expect(parsed).toMatchObject({ description: '', tags: [] })
  })

  it('refuses a slug that is not slug-shaped', () => {
    const result = createTemplateRequest.safeParse({
      name: 'Welcome',
      slug: 'Not A Slug',
      category: 'onboarding',
      initialVersion: codeVersion,
    })
    expect(result.success).toBe(false)
  })

  it('requires the concurrency token on a save', () => {
    expect(saveVersionRequest.safeParse({ version: codeVersion }).success).toBe(false)
    expect(saveVersionRequest.safeParse({ expectedRevision: 3, version: codeVersion }).success).toBe(true)
  })

  it('allows a metadata patch to change only one field', () => {
    const parsed = updateMetadataRequest.parse({ expectedRevision: 1, status: 'ready' })
    expect(parsed).toEqual({ expectedRevision: 1, status: 'ready' })
  })

  it('caps the number of tags', () => {
    const tags = Array.from({ length: 11 }, (_, index) => `tag-${index}`)
    expect(updateMetadataRequest.safeParse({ expectedRevision: 1, tags }).success).toBe(false)
  })
})

describe('apiErrorSchema', () => {
  it('parses an error body and keeps the codes closed', () => {
    const parsed = apiErrorSchema.parse({ status: 'error', code: 'slug-taken', message: 'Taken' })
    expect(parsed.code).toBe('slug-taken')
    expect(apiErrorSchema.safeParse({ status: 'error', code: 'kaboom', message: 'x' }).success).toBe(false)
  })
})

describe('response schemas', () => {
  const summary = {
    id: 'tpl_welcome',
    slug: 'welcome',
    name: 'Welcome',
    description: '',
    category: 'onboarding',
    status: 'draft',
    tags: [],
    origin: 'starter',
    kind: 'code',
    versionNumber: 2,
    revision: 3,
    createdBy: 'seed',
    createdAt: '2026-09-18T10:00:00Z',
    updatedBy: 'seed',
    updatedAt: '2026-09-18T10:00:00Z',
  }
  const versionMeta = { versionNumber: 2, createdBy: 'seed', createdAt: '2026-09-18T10:00:00Z' }

  it('round-trips a code template detail, keeping both halves of the intersection', () => {
    const parsed = templateDetailSchema.parse({
      ...summary,
      version: { ...codeVersion, ...versionMeta },
    })
    expect(parsed.version).toMatchObject({ kind: 'code', note: '', versionNumber: 2 })
  })

  it('round-trips a visual template detail', () => {
    const parsed = templateDetailSchema.parse({
      ...summary,
      kind: 'visual',
      version: {
        ...codeVersion,
        kind: 'visual',
        source: undefined,
        document: { type: 'doc', content: [] },
        theme: 'studio-v1',
        ...versionMeta,
      },
    })
    expect(parsed.version).toMatchObject({ kind: 'visual', theme: 'studio-v1' })
  })

  it('refuses a detail whose version body is invalid', () => {
    const result = templateDetailSchema.safeParse({
      ...summary,
      version: { ...codeVersion, source: undefined, ...versionMeta },
    })
    expect(result.success).toBe(false)
  })

  it('parses a version summary and refuses version number 0', () => {
    const row = { versionNumber: 1, kind: 'code', note: 'first', createdBy: 'seed', createdAt: 'now' }
    expect(versionSummarySchema.parse(row)).toEqual(row)
    expect(versionSummarySchema.safeParse({ ...row, versionNumber: 0 }).success).toBe(false)
  })
})
