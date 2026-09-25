/**
 * One Vitest suite that every TemplateStore implementation has to pass.
 *
 * Server layer: it imports only Vitest and the port in templateStore.ts. Call
 * `describeTemplateStore('in-memory', () => new InMemoryTemplateStore())` from a
 * test file; the factory is called fresh for each case, so nothing leaks between
 * them. This is the contract, written once instead of copied per implementation.
 *
 * Every case works inside one workspace, `WS`, except the last group, which is
 * the isolation rule of ADR-32 spelled out as tests.
 */
import { describe, expect, it } from 'vitest'
import type { NewTemplateInput, NewVersionInput, TemplateStore, WriteContext } from './templateStore.ts'

/** A fixed author and clock, so a failure is never about wall-clock time. */
export const CTX: WriteContext = { by: 'tester@example.test', at: '2026-09-18T10:00:00.000Z' }

/** A later write, so "newest first" orderings have something to sort by. */
export const LATER_CTX: WriteContext = { by: 'other@example.test', at: '2026-09-18T11:00:00.000Z' }

/** The workspace every case lives in. It need not exist as a row: the store does not check. */
export const WS = 'ws_test'

/** A second workspace, for the isolation cases. */
export const OTHER_WS = 'ws_other'

/** A code version; override any field a case cares about. */
export function codeVersion(overrides: Partial<NewVersionInput> = {}): NewVersionInput {
  return {
    kind: 'code',
    envelope: { subject: 'Hello', preheader: '', replyTo: '' },
    source: 'export default function Email() { return null }\n',
    document: null,
    theme: 'studio-v1',
    html: '<p>hi</p>',
    text: 'hi',
    propsSample: '{}',
    propsSchema: '{}',
    note: '',
    ...overrides,
  }
}

/** A visual version: a document instead of source, stored as JSON text. */
export function visualVersion(overrides: Partial<NewVersionInput> = {}): NewVersionInput {
  return codeVersion({
    kind: 'visual',
    source: null,
    document: JSON.stringify({ type: 'doc', content: [] }),
    ...overrides,
  })
}

/** A whole new template; `slug` doubles as the id suffix so cases stay readable. */
export function newTemplate(slug: string, overrides: Partial<NewTemplateInput> = {}): NewTemplateInput {
  return {
    id: `tpl_${slug}`,
    workspaceId: WS,
    slug,
    name: slug,
    description: '',
    category: 'notification',
    status: 'draft',
    tags: [],
    origin: 'user',
    version: codeVersion(),
    ...overrides,
  }
}

/** Narrows a WriteOutcome to `saved`, failing the test with a readable message if it is not. */
function expectSaved(outcome: Awaited<ReturnType<TemplateStore['create']>>) {
  expect(outcome.status).toBe('saved')
  if (outcome.status !== 'saved') throw new Error('unreachable')
  return outcome.template
}

export function describeTemplateStore(name: string, makeStore: () => TemplateStore): void {
  describe(`TemplateStore contract: ${name}`, () => {
    it('creates a template at version 1 and revision 1', async () => {
      const store = makeStore()
      const created = expectSaved(await store.create(newTemplate('welcome'), CTX))

      expect(created.id).toBe('tpl_welcome')
      expect(created.workspaceId).toBe(WS)
      expect(created.versionNumber).toBe(1)
      expect(created.revision).toBe(1)
      expect(created.kind).toBe('code')
      expect(created.createdBy).toBe(CTX.by)
      expect(created.updatedAt).toBe(CTX.at)
      expect(created.version.versionNumber).toBe(1)
      expect(created.version.source).toContain('export default')
      expect(await store.get(WS, 'tpl_welcome')).toEqual(created)
    })

    it('appends versions 2 and 3 and moves the revision forward with them', async () => {
      const store = makeStore()
      const v1 = expectSaved(await store.create(newTemplate('welcome'), CTX))

      const v2 = expectSaved(
        await store.addVersion(WS, 'tpl_welcome', v1.revision, codeVersion({ note: 'second' }), LATER_CTX),
      )
      expect(v2.versionNumber).toBe(2)
      expect(v2.revision).toBe(2)
      expect(v2.updatedBy).toBe(LATER_CTX.by)

      const v3 = expectSaved(
        await store.addVersion(WS, 'tpl_welcome', v2.revision, codeVersion({ note: 'third' }), LATER_CTX),
      )
      expect(v3.versionNumber).toBe(3)
      expect(v3.revision).toBe(3)
      expect(v3.version.note).toBe('third')
    })

    it('refuses a stale expectedRevision, writes nothing, and hands back the current template', async () => {
      const store = makeStore()
      const v1 = expectSaved(await store.create(newTemplate('welcome'), CTX))
      await store.addVersion(WS, 'tpl_welcome', v1.revision, codeVersion({ note: 'second' }), LATER_CTX)

      // 1 is now stale: the row moved to revision 2 above.
      const outcome = await store.addVersion(WS, 'tpl_welcome', 1, codeVersion({ note: 'stale' }), LATER_CTX)
      expect(outcome.status).toBe('conflict')
      if (outcome.status !== 'conflict') throw new Error('unreachable')
      expect(outcome.template.revision).toBe(2)
      expect(outcome.template.versionNumber).toBe(2)
      expect(outcome.template.version.note).toBe('second')

      // Nothing was appended: the history is still two versions long.
      expect(await store.listVersions(WS, 'tpl_welcome')).toHaveLength(2)
    })

    it('answers not-found for a template that does not exist', async () => {
      const store = makeStore()
      expect(await store.get(WS, 'tpl_missing')).toBeNull()
      expect(await store.listVersions(WS, 'tpl_missing')).toBeNull()
      expect(await store.remove(WS, 'tpl_missing')).toBe('not-found')
      expect((await store.addVersion(WS, 'tpl_missing', 1, codeVersion(), CTX)).status).toBe('not-found')
      expect((await store.updateMetadata(WS, 'tpl_missing', 1, { name: 'x' }, CTX)).status).toBe('not-found')
    })

    it('removes a template and its versions with it', async () => {
      const store = makeStore()
      const created = expectSaved(await store.create(newTemplate('welcome'), CTX))
      await store.addVersion(WS, 'tpl_welcome', created.revision, codeVersion(), CTX)

      expect(await store.remove(WS, 'tpl_welcome')).toBe('deleted')
      expect(await store.get(WS, 'tpl_welcome')).toBeNull()
      // The cascade: history must not outlive the template it belongs to.
      expect(await store.listVersions(WS, 'tpl_welcome')).toBeNull()
      expect(await store.list(WS)).toHaveLength(0)
    })

    it('lists versions newest first', async () => {
      const store = makeStore()
      const v1 = expectSaved(await store.create(newTemplate('welcome'), CTX))
      const v2 = expectSaved(
        await store.addVersion(WS, 'tpl_welcome', v1.revision, codeVersion({ note: 'second' }), LATER_CTX),
      )
      await store.addVersion(WS, 'tpl_welcome', v2.revision, visualVersion({ note: 'third' }), LATER_CTX)

      const versions = await store.listVersions(WS, 'tpl_welcome')
      expect(versions?.map((version) => version.versionNumber)).toEqual([3, 2, 1])
      expect(versions?.[0]).toMatchObject({ kind: 'visual', note: 'third', createdBy: LATER_CTX.by })
    })

    it('lists templates newest-updated first', async () => {
      const store = makeStore()
      await store.create(newTemplate('first'), CTX)
      await store.create(newTemplate('second'), LATER_CTX)

      expect((await store.list(WS)).map((template) => template.slug)).toEqual(['second', 'first'])
    })

    it('bumps the revision on a metadata change without adding a version', async () => {
      const store = makeStore()
      const created = expectSaved(await store.create(newTemplate('welcome'), CTX))

      const patched = expectSaved(
        await store.updateMetadata(
          WS,
          'tpl_welcome',
          created.revision,
          { name: 'Welcome & verification', status: 'ready', tags: ['sign-up'] },
          LATER_CTX,
        ),
      )
      expect(patched.revision).toBe(2)
      expect(patched.versionNumber).toBe(1)
      expect(patched.name).toBe('Welcome & verification')
      expect(patched.status).toBe('ready')
      expect(patched.tags).toEqual(['sign-up'])
      expect(patched.updatedBy).toBe(LATER_CTX.by)
      expect(await store.listVersions(WS, 'tpl_welcome')).toHaveLength(1)
    })

    it('refuses a stale expectedRevision on a metadata change too', async () => {
      const store = makeStore()
      const created = expectSaved(await store.create(newTemplate('welcome'), CTX))
      await store.updateMetadata(WS, 'tpl_welcome', created.revision, { name: 'Renamed' }, CTX)

      const outcome = await store.updateMetadata(WS, 'tpl_welcome', 1, { name: 'Also renamed' }, CTX)
      expect(outcome.status).toBe('conflict')
      expect((await store.get(WS, 'tpl_welcome'))?.name).toBe('Renamed')
    })

    it('refuses a slug that another template already holds', async () => {
      const store = makeStore()
      await store.create(newTemplate('welcome'), CTX)
      const second = expectSaved(await store.create(newTemplate('reset'), CTX))

      expect((await store.create(newTemplate('welcome', { id: 'tpl_other' }), CTX)).status).toBe('slug-taken')
      expect(
        (await store.updateMetadata(WS, 'tpl_reset', second.revision, { slug: 'welcome' }, CTX)).status,
      ).toBe('slug-taken')
      // Re-sending its OWN slug is not a clash, it is a no-op rename.
      expect(
        (await store.updateMetadata(WS, 'tpl_reset', second.revision, { slug: 'reset' }, CTX)).status,
      ).toBe('saved')
    })

    it('refuses a create over an id that already exists, leaving the history intact', async () => {
      const store = makeStore()
      const created = expectSaved(await store.create(newTemplate('welcome'), CTX))
      await store.addVersion(WS, 'tpl_welcome', created.revision, codeVersion({ note: 'second' }), LATER_CTX)

      // A fresh slug, an id that is taken: SQLite refuses it as a duplicate
      // primary key, and the in-memory store has to refuse it the same way
      // rather than replacing the row and dropping its versions.
      await expect(store.create(newTemplate('other', { id: 'tpl_welcome' }), CTX)).rejects.toThrow()

      const survivor = await store.get(WS, 'tpl_welcome')
      expect(survivor?.slug).toBe('welcome')
      expect(survivor?.versionNumber).toBe(2)
      expect(await store.listVersions(WS, 'tpl_welcome')).toHaveLength(2)
    })

    it('converting a visual template to code is one way: the kind follows the current version', async () => {
      const store = makeStore()
      const created = expectSaved(
        await store.create(newTemplate('newsletter', { version: visualVersion() }), CTX),
      )
      expect(created.kind).toBe('visual')

      const converted = expectSaved(
        await store.addVersion(
          WS,
          'tpl_newsletter',
          created.revision,
          codeVersion({ note: 'converted' }),
          CTX,
        ),
      )
      // Once the current version is code, nothing in the store can make it
      // visual again by itself: the route reads this and answers 422 not-visual.
      expect(converted.kind).toBe('code')
      expect(converted.version.document).toBeNull()
      expect((await store.list(WS))[0].kind).toBe('code')
      // The visual version is still in the history; conversion adds, never deletes.
      expect((await store.listVersions(WS, 'tpl_newsletter'))?.map((v) => v.kind)).toEqual(['code', 'visual'])
    })

    describe('keeps workspaces apart (ADR-32)', () => {
      it('never shows, changes or removes a template through another workspace', async () => {
        const store = makeStore()
        const created = expectSaved(await store.create(newTemplate('welcome'), CTX))

        // Reads: it is simply not there.
        expect(await store.list(OTHER_WS)).toEqual([])
        expect(await store.get(OTHER_WS, 'tpl_welcome')).toBeNull()
        expect(await store.listVersions(OTHER_WS, 'tpl_welcome')).toBeNull()

        // Writes: not-found, never conflict, and nothing moves.
        const version = await store.addVersion(OTHER_WS, 'tpl_welcome', created.revision, codeVersion(), CTX)
        expect(version.status).toBe('not-found')
        const patch = await store.updateMetadata(
          OTHER_WS,
          'tpl_welcome',
          created.revision,
          { name: 'x' },
          CTX,
        )
        expect(patch.status).toBe('not-found')
        expect(await store.remove(OTHER_WS, 'tpl_welcome')).toBe('not-found')

        const untouched = await store.get(WS, 'tpl_welcome')
        expect(untouched?.revision).toBe(1)
        expect(untouched?.name).toBe('welcome')
      })

      it('lets two workspaces use the same slug', async () => {
        const store = makeStore()
        await store.create(newTemplate('welcome'), CTX)
        const twin = await store.create(
          newTemplate('welcome', { id: 'tpl_welcome-2', workspaceId: OTHER_WS }),
          CTX,
        )
        expect(twin.status).toBe('saved')
        expect((await store.list(WS)).map((t) => t.id)).toEqual(['tpl_welcome'])
        expect((await store.list(OTHER_WS)).map((t) => t.id)).toEqual(['tpl_welcome-2'])
      })
    })
  })
}
