import { describe, expect, it } from 'vitest'
import { STARTER_TEMPLATES } from '@/infrastructure/templates/registry'
import { filterTemplates } from './filterTemplates'

const slugs = (templates: readonly { metadata: { slug: string } }[]) =>
  templates.map((template) => template.metadata.slug)

describe('filterTemplates', () => {
  it('returns everything for an empty or blank query', () => {
    expect(filterTemplates(STARTER_TEMPLATES, '')).toHaveLength(STARTER_TEMPLATES.length)
    expect(filterTemplates(STARTER_TEMPLATES, '   ')).toHaveLength(STARTER_TEMPLATES.length)
  })

  it('matches the name whatever the case', () => {
    expect(slugs(filterTemplates(STARTER_TEMPLATES, 'PASSWORD'))).toEqual(['password-reset'])
  })

  it('matches the slug, the description, the category and the tags', () => {
    expect(slugs(filterTemplates(STARTER_TEMPLATES, 'team-invitation'))).toEqual(['team-invitation'])
    expect(slugs(filterTemplates(STARTER_TEMPLATES, 'sign-up'))).toEqual(['welcome-verification'])
    expect(slugs(filterTemplates(STARTER_TEMPLATES, 'security'))).toEqual(['password-reset'])
    expect(slugs(filterTemplates(STARTER_TEMPLATES, 'Row/Column'))).toEqual(['team-invitation'])
  })

  it('ignores accents on both sides of the comparison', () => {
    const accented = [
      {
        ...STARTER_TEMPLATES[0],
        metadata: { ...STARTER_TEMPLATES[0].metadata, name: 'Rétention client' },
      },
    ]
    expect(filterTemplates(accented, 'retention')).toHaveLength(1)
    expect(filterTemplates(accented, 'rétention')).toHaveLength(1)
  })

  it('requires every word of a multi-word query to match', () => {
    expect(slugs(filterTemplates(STARTER_TEMPLATES, 'reset password'))).toEqual(['password-reset'])
    expect(filterTemplates(STARTER_TEMPLATES, 'reset invitation')).toHaveLength(0)
  })

  it('returns nothing when the query matches nothing', () => {
    expect(filterTemplates(STARTER_TEMPLATES, 'invoice')).toHaveLength(0)
  })
})
