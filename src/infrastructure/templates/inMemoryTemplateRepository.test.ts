import { describe, expect, it } from 'vitest'
import { STARTER_TEMPLATES } from './registry'
import { createInMemoryTemplateRepository } from './inMemoryTemplateRepository'
import { codeVersion, describeTemplateRepository } from './templateRepositoryContract'

// The shared suite: everything an adapter must do, whoever stores the data.
// The seed is emptied first so the contract's own fixtures are all there is.
describeTemplateRepository('InMemoryTemplateRepository', () => createInMemoryTemplateRepository({ seed: [] }))

describe('InMemoryTemplateRepository seeding', () => {
  it('starts from the starter templates, newest first, with their ids and slugs intact', async () => {
    const repository = createInMemoryTemplateRepository()
    const result = await repository.list()
    if (!result.ok) throw new Error(result.failure.message)

    expect(result.value).toHaveLength(STARTER_TEMPLATES.length)
    const slugs = result.value.map((record) => record.metadata.slug)
    expect(new Set(slugs)).toEqual(new Set(STARTER_TEMPLATES.map((record) => record.metadata.slug)))
    expect(result.value[0].metadata.updatedAt >= result.value[1].metadata.updatedAt).toBe(true)
    for (const record of result.value) {
      expect(record.metadata.origin).toBe('starter')
      expect(record.metadata.revision).toBe(1)
    }
  })

  it('hands out copies, so a caller cannot edit the store by mutating what it was given', async () => {
    const repository = createInMemoryTemplateRepository()
    const first = await repository.list()
    if (!first.ok) throw new Error(first.failure.message)
    const mutable = first.value[0] as { metadata: { name: string } }
    mutable.metadata.name = 'Tampered'

    const second = await repository.list()
    if (!second.ok) throw new Error(second.failure.message)
    expect(second.value[0].metadata.name).not.toBe('Tampered')
  })

  it('counts a starter slug as taken', async () => {
    const repository = createInMemoryTemplateRepository()
    const clash = await repository.create({
      name: STARTER_TEMPLATES[0].metadata.name,
      kind: 'code',
      description: '',
      category: 'notification',
      initialVersion: codeVersion(),
    })
    expect(clash.ok).toBe(false)
    if (!clash.ok) expect(clash.failure.code).toBe('slug-taken')
  })
})
