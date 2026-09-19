import { describe, expect, it } from 'vitest'
import { STARTER_TEMPLATES } from '@/infrastructure/templates/registry'
import { DEFAULT_STUDIO_THEME, STUDIO_FONT_STACK, STUDIO_THEMES, studioTheme } from './studioTheme'

describe('STUDIO_THEMES', () => {
  it('extends the package theme instead of restating it', () => {
    const theme = STUDIO_THEMES[DEFAULT_STUDIO_THEME]
    // Everything the package already decided about sizes, weights and spacing
    // is inherited; only the family is ours.
    expect(theme.extends).toBe('basic')
    const properties = new Set(Object.values(theme.styles).flatMap((style) => Object.keys(style ?? {})))
    expect([...properties]).toEqual(['fontFamily'])
  })

  it('sets the family on every block Outlook will not inherit it for', () => {
    const theme = STUDIO_THEMES[DEFAULT_STUDIO_THEME]
    expect(Object.keys(theme.styles).sort()).toEqual([
      'body',
      'button',
      'h1',
      'h2',
      'h3',
      'link',
      'listItem',
      'paragraph',
    ])
    for (const style of Object.values(theme.styles)) {
      expect(style?.fontFamily).toBe(STUDIO_FONT_STACK)
    }
  })
})

describe('studioTheme', () => {
  it('falls back to the default for a theme this build has never heard of', () => {
    // A version saved by a later studio must still open, with today's theme,
    // rather than refusing to mount.
    expect(studioTheme('studio-v99')).toBe(STUDIO_THEMES[DEFAULT_STUDIO_THEME])
    expect(studioTheme(DEFAULT_STUDIO_THEME)).toBe(STUDIO_THEMES[DEFAULT_STUDIO_THEME])
  })

  it('knows the theme every shipped visual starter names', () => {
    for (const template of STARTER_TEMPLATES) {
      if (template.kind !== 'visual') continue
      expect(STUDIO_THEMES[template.theme]).toBeDefined()
    }
  })
})
