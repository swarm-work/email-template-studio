import { describe, expect, it } from 'vitest'
import { versionBodySchema } from '@shared/templateContracts'
import { blankVersionInput } from './blankTemplate'
import { toVersionBody } from './templateMapper'

describe('blankVersionInput', () => {
  it('produces a code version the API would accept', () => {
    const input = blankVersionInput('code')
    expect(input.kind).toBe('code')
    const parsed = versionBodySchema.safeParse(toVersionBody(input))
    expect(parsed.success).toBe(true)
  })

  it('produces a visual version the API would accept', () => {
    const parsed = versionBodySchema.safeParse(toVersionBody(blankVersionInput('visual')))
    expect(parsed.success).toBe(true)
  })

  it('starts the blank canvas at a container, which is what the editor expects', () => {
    // A document that is not container-rooted makes the visual editor fire an
    // `onUpdate` on load — an edit nobody made (plan §3.3, TECH_DEBT #38).
    const input = blankVersionInput('visual')
    if (input.kind !== 'visual') throw new Error('expected a visual version')
    const document = input.document as { type: string; content?: { type: string }[] }
    expect(document.type).toBe('doc')
    expect(document.content?.map((node) => node.type)).toEqual(['container'])
  })

  it('gives the code starter a sample value for the merge field it uses', () => {
    // A new template should show a resolved merge field on its first preview,
    // not an unresolved `{{firstName}}` and a warning about it.
    const input = blankVersionInput('code')
    if (input.kind !== 'code') throw new Error('expected a code version')
    expect(input.source).toContain('{{firstName}}')
    expect(JSON.parse(input.samplePayloadText)).toHaveProperty('firstName')
  })
})
