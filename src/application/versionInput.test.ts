import { describe, expect, it } from 'vitest'
import type { EmailDocument } from '@/domain'
import { buildVersionInput, type VersionInputSources } from './versionInput'

const document: EmailDocument = {
  type: 'doc',
  content: [{ type: 'container', content: [{ type: 'paragraph' }] }],
}

function sources(patch: Partial<VersionInputSources> = {}): VersionInputSources {
  return {
    kind: 'code',
    envelope: { subject: 'Hello {{firstName}}', preheader: '', replyTo: '' },
    samplePayloadText: '{"firstName":"Ada"}',
    html: '<p>Hello {{firstName}}</p>',
    text: 'Hello {{firstName}}',
    source: 'export default function T() { return null }\n',
    document,
    theme: 'studio-v1',
    propsSchemaText: '{"type":"object"}',
    mergeFieldKeys: ['firstName'],
    ...patch,
  }
}

describe('buildVersionInput', () => {
  it('stores the UNRESOLVED export, with every merge field still in it', () => {
    // ADR-26: a stored version has to work for every recipient, so the sample
    // values a person is looking at must never reach the database.
    const input = buildVersionInput(sources())
    expect(input?.html).toContain('{{firstName}}')
    expect(input?.text).toContain('{{firstName}}')
    expect(input?.html).not.toContain('Ada')
    expect(input?.envelope.subject).toContain('{{firstName}}')
  })

  it('carries a code template’s source and its hand-written schema', () => {
    const input = buildVersionInput(sources())
    expect(input?.kind).toBe('code')
    if (input?.kind !== 'code') throw new Error('expected a code version')
    expect(input.source).toContain('export default')
    expect(input.propsSchemaText).toBe('{"type":"object"}')
  })

  it('writes a visual template’s schema from the merge fields on the canvas', () => {
    const input = buildVersionInput(sources({ kind: 'visual', mergeFieldKeys: ['orderId'] }))
    expect(input?.kind).toBe('visual')
    if (input?.kind !== 'visual') throw new Error('expected a visual version')
    expect(input.document).toBe(document)
    expect(input.theme).toBe('studio-v1')
    // Not the code template's schema: a visual template's contract is its keys.
    expect(input.propsSchemaText).toContain('orderId')
  })

  it('is null until there is a render to store, which is what makes Save unavailable', () => {
    expect(buildVersionInput(sources({ html: null }))).toBeNull()
    expect(buildVersionInput(sources({ text: null }))).toBeNull()
  })
})
