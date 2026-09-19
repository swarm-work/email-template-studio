import { describe, expect, it } from 'vitest'
import { describeVersionConflict } from './versionConflict'

describe('describeVersionConflict', () => {
  it('names both versions in every sentence', () => {
    const copy = describeVersionConflict(5, 7)
    expect(copy).not.toBeNull()
    expect(copy?.banner).toBe('You have unsaved edits made against v5. This template is now v7.')
    expect(copy?.title).toBe('This template was saved elsewhere as v7.')
    expect(copy?.discardLabel).toBe('Discard mine and load v7')
  })

  it('says nothing when the draft started from the current version', () => {
    expect(describeVersionConflict(7, 7)).toBeNull()
  })

  it('says nothing when the draft records no base version', () => {
    // 0 is what a draft written before phase 1 carries; it is "unknown", not v0.
    expect(describeVersionConflict(0, 7)).toBeNull()
  })

  it('still describes a draft that is somehow ahead of the template', () => {
    // A restored backup can move a template backwards. The wording stays true.
    const copy = describeVersionConflict(9, 4)
    expect(copy?.banner).toBe('You have unsaved edits made against v9. This template is now v4.')
  })
})
