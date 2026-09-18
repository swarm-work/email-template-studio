import { describe, expect, it } from 'vitest'
import { DEFAULT_STUDIO_FEATURES, type StudioFeatures } from '@/domain'
import { availableModes, clampMode, defaultMode, nextModeForPreviewToggle } from './studioModes'

/** The rollback switch of docs/DEPLOYMENT.md, thrown. */
const EDITOR_OFF: StudioFeatures = { visualEditor: false }

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

  it('takes the visual canvas away when the feature flag is off', () => {
    expect(availableModes('visual', EDITOR_OFF)).toEqual(['preview'])
    // A code template never had a Visual button, so nothing changes for it.
    expect(availableModes('code', EDITOR_OFF)).toEqual(['code', 'preview'])
  })

  it('opens a visual template in preview while the flag is off', () => {
    expect(defaultMode('visual', EDITOR_OFF)).toBe('preview')
    expect(clampMode('visual', 'visual', EDITOR_OFF)).toBe('preview')
    expect(defaultMode('visual', DEFAULT_STUDIO_FEATURES)).toBe('visual')
  })

  it('assumes every feature is on when nobody says otherwise', () => {
    // "We have not heard from the server yet" must never read as "switched off",
    // or the studio would flash a read-only banner on every load.
    expect(availableModes('visual')).toEqual(availableModes('visual', DEFAULT_STUDIO_FEATURES))
  })

  it('never answers ⌘P with preview again when the return mode is stale', () => {
    // A session restored straight into preview mode has no editor to go back
    // to; the press must still leave preview rather than do nothing.
    expect(nextModeForPreviewToggle('preview', 'preview')).toBe('code')
  })
})
