import { describe, expect, it } from 'vitest'
import { InMemoryTemplateStore } from './inMemoryTemplateStore.ts'
import { codeVersion, CTX, describeTemplateStore, newTemplate } from './templateStoreContract.ts'

describeTemplateStore('in-memory', () => new InMemoryTemplateStore())

describe('InMemoryTemplateStore extras', () => {
  it('applies the seed passed to the constructor', async () => {
    const store = new InMemoryTemplateStore([{ input: newTemplate('welcome'), ctx: CTX }])

    expect((await store.list()).map((template) => template.slug)).toEqual(['welcome'])
    expect((await store.get('tpl_welcome'))?.createdBy).toBe(CTX.by)
  })

  it('hands out copies, so a caller cannot edit the store by editing what it got back', async () => {
    const store = new InMemoryTemplateStore()
    await store.create(newTemplate('welcome', { tags: ['sign-up'] }), CTX)

    const first = await store.get('tpl_welcome')
    expect(first).not.toBeNull()
    // `tags` is readonly to TypeScript, but a determined caller can still write
    // to the array at runtime; the store must not care.
    const tags = first!.tags as string[]
    tags.push('tampered')

    expect((await store.get('tpl_welcome'))?.tags).toEqual(['sign-up'])
  })

  it('keeps each template on its own version counter', async () => {
    const store = new InMemoryTemplateStore()
    await store.create(newTemplate('one'), CTX)
    await store.create(newTemplate('two'), CTX)
    await store.addVersion('tpl_one', 1, codeVersion(), CTX)

    expect((await store.get('tpl_one'))?.versionNumber).toBe(2)
    expect((await store.get('tpl_two'))?.versionNumber).toBe(1)
  })
})
