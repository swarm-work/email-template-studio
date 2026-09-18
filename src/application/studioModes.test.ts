import { describe, expect, it } from 'vitest'
import { availableModes, clampMode, defaultMode } from './studioModes'

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
})
