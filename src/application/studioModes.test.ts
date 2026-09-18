import { describe, expect, it } from 'vitest'
import { availableModes, clampMode, defaultMode, nextModeForPreviewToggle } from './studioModes'

describe('studio modes', () => {
  it('offers each kind its own editor plus preview', () => {
    expect(availableModes('code')).toEqual(['code', 'preview'])
    expect(availableModes('visual')).toEqual(['visual', 'preview'])
  })

  it('opens a template in its own editor', () => {
    expect(defaultMode('code')).toBe('code')
    expect(defaultMode('visual')).toBe('visual')
  })

  it('clamps a mode the kind cannot show', () => {
    expect(clampMode('code', 'visual')).toBe('code')
    expect(clampMode('visual', 'code')).toBe('visual')
    expect(clampMode('code', 'preview')).toBe('preview')
  })

  it('sends ⌘P into preview and back to the mode it came from', () => {
    expect(nextModeForPreviewToggle('code', 'code')).toBe('preview')
    expect(nextModeForPreviewToggle('visual', 'visual')).toBe('preview')
    expect(nextModeForPreviewToggle('preview', 'code')).toBe('code')
    expect(nextModeForPreviewToggle('preview', 'visual')).toBe('visual')
  })

  it('never answers ⌘P with preview again when the return mode is stale', () => {
    // A session restored straight into preview mode has no editor to go back
    // to; the press must still leave preview rather than do nothing.
    expect(nextModeForPreviewToggle('preview', 'preview')).toBe('code')
  })
})
