import { describe, expect, it } from 'vitest'
import { previewStatusPresentation } from './previewStatus'

describe('previewStatusPresentation', () => {
  it('names every render status', () => {
    expect(previewStatusPresentation('idle', false)).toEqual({ badge: 'neutral', label: 'Idle' })
    expect(previewStatusPresentation('blocked', false)).toEqual({ badge: 'warning', label: 'Paused' })
    expect(previewStatusPresentation('rendering', false)).toEqual({ badge: 'loading', label: 'Rendering…' })
    expect(previewStatusPresentation('success', false)).toEqual({ badge: 'success', label: 'Up to date' })
    expect(previewStatusPresentation('error', false)).toEqual({ badge: 'danger', label: 'Render failed' })
  })

  it('says a good render is on screen when the newest one failed', () => {
    expect(previewStatusPresentation('error', true).label).toBe('Showing last good render')
    // Stale wins over every status: it describes the picture, not the request.
    expect(previewStatusPresentation('rendering', true).label).toBe('Showing last good render')
  })
})
