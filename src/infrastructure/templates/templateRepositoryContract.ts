/**
 * The behaviour every `TemplateRepository` adapter has to show, written once.
 *
 * Infrastructure layer, test support: `describeTemplateRepository()` is a Vitest
 * suite you hand a factory. The in-memory adapter runs it today and the HTTP
 * adapter will run the same suite later, so "the two stores behave the same" is
 * a test rather than a hope. No React, no DOM.
 */
import { describe, expect, it } from 'vitest'
import type { TemplateId } from '@/domain'
import type {
  NewTemplateInput,
  TemplateRepository,
  VersionInput,
} from '@/application/repositories/templateRepository'
import { MAX_HTML_BYTES, MAX_NAME_LENGTH, MAX_SUBJECT_LENGTH, MAX_TAGS } from '@shared/templateContracts'

/** A minimal code version, with only the fields a test cares about overridden. */
export function codeVersion(overrides: Partial<Extract<VersionInput, { kind: 'code' }>> = {}): VersionInput {
  return {
    kind: 'code',
    envelope: { subject: 'Hello', preheader: '', replyTo: '' },
    samplePayloadText: '{}\n',
    propsSchemaText: '{}',
    html: '<p>Hello</p>',
    text: 'Hello',
    source: 'export default function T() { return null }\n',
    ...overrides,
  }
}

/** A minimal visual version; `convertToCode` needs one of these to convert. */
export function visualVersion(
  overrides: Partial<Extract<VersionInput, { kind: 'visual' }>> = {},
): VersionInput {
  return {
    kind: 'visual',
    envelope: { subject: 'Hello', preheader: '', replyTo: '' },
    samplePayloadText: '{}\n',
    propsSchemaText: '{}',
    html: '<p>Hello</p>',
    text: 'Hello',
    document: { type: 'doc', content: [] },
    theme: 'studio-v1',
    ...overrides,
  }
}

/** What the create dialog would collect, minus the first version. */
function newTemplate(overrides: Partial<NewTemplateInput> = {}): NewTemplateInput {
  return {
    name: 'Product launch',
    kind: 'code',
    description: 'Announces a new product.',
    category: 'notification',
    ...overrides,
  }
}

/** Unwraps a result, failing the test with the repository's own message instead of `undefined`. */
function expectOk<T>(result: { ok: true; value: T } | { ok: false; failure: { message: string } }): T {
  if (!result.ok) throw new Error(`Expected success, got: ${result.failure.message}`)
  return result.value
}

/**
 * Runs the shared suite. `makeRepository` must hand back a repository seeded
 * with nothing, or with templates the suite is free to ignore.
 */
export function describeTemplateRepository(name: string, makeRepository: () => TemplateRepository): void {
  describe(`${name} (TemplateRepository contract)`, () => {
    it('creates a template at version 1 with revision 1', async () => {
      const repository = makeRepository()
      const created = expectOk(await repository.create({ ...newTemplate(), initialVersion: codeVersion() }))
      expect(created.metadata.version.number).toBe(1)
      expect(created.metadata.version.label).toBe('v1')
      expect(created.metadata.revision).toBe(1)
      expect(created.metadata.slug).toBe('product-launch')
      expect(created.metadata.origin).toBe('user')
      expect(created.kind).toBe('code')

      const versions = expectOk(await repository.listVersions(created.metadata.id))
      expect(versions.map((version) => version.versionNumber)).toEqual([1])
    })

    it('appends a version per save and moves the revision forward with it', async () => {
      const repository = makeRepository()
      const created = expectOk(await repository.create({ ...newTemplate(), initialVersion: codeVersion() }))
      const id = created.metadata.id

      const second = expectOk(await repository.saveVersion(id, created.metadata.revision, codeVersion()))
      const third = expectOk(await repository.saveVersion(id, second.metadata.revision, codeVersion()))

      expect(second.metadata.version.number).toBe(2)
      expect(third.metadata.version.number).toBe(3)
      expect(third.metadata.revision).toBeGreaterThan(second.metadata.revision)
      expect(second.metadata.revision).toBeGreaterThan(created.metadata.revision)

      // Newest first, and every earlier version is still there.
      const versions = expectOk(await repository.listVersions(id))
      expect(versions.map((version) => version.versionNumber)).toEqual([3, 2, 1])
    })

    it('refuses a save made against a stale revision and hands back the current template', async () => {
      const repository = makeRepository()
      const created = expectOk(await repository.create({ ...newTemplate(), initialVersion: codeVersion() }))
      const id = created.metadata.id
      const saved = expectOk(await repository.saveVersion(id, created.metadata.revision, codeVersion()))

      // Same (now stale) revision as the first save used.
      const conflict = await repository.saveVersion(id, created.metadata.revision, codeVersion())
      expect(conflict.ok).toBe(false)
      if (conflict.ok || conflict.failure.code !== 'version-conflict') {
        throw new Error('Expected a version-conflict failure')
      }
      expect(conflict.failure.current.metadata.revision).toBe(saved.metadata.revision)
      // Nothing was written.
      expect(expectOk(await repository.listVersions(id))).toHaveLength(2)
    })

    it('refuses a second template with the same slug', async () => {
      const repository = makeRepository()
      expectOk(await repository.create({ ...newTemplate(), initialVersion: codeVersion() }))
      const again = await repository.create({ ...newTemplate(), initialVersion: codeVersion() })
      expect(again.ok).toBe(false)
      if (!again.ok) expect(again.failure.code).toBe('slug-taken')
    })

    it('removes a template and its versions', async () => {
      const repository = makeRepository()
      const created = expectOk(await repository.create({ ...newTemplate(), initialVersion: codeVersion() }))
      const id = created.metadata.id

      expect((await repository.remove(id)).ok).toBe(true)
      const gone = await repository.get(id)
      expect(gone.ok).toBe(false)
      if (!gone.ok) expect(gone.failure.code).toBe('not-found')
      const versions = await repository.listVersions(id)
      expect(versions.ok).toBe(false)
      const removedTwice = await repository.remove(id)
      expect(removedTwice.ok).toBe(false)
    })

    it('bumps the revision on a metadata edit without writing a version', async () => {
      const repository = makeRepository()
      const created = expectOk(await repository.create({ ...newTemplate(), initialVersion: codeVersion() }))
      const id = created.metadata.id

      const patched = expectOk(
        await repository.updateMetadata(id, created.metadata.revision, { status: 'ready' }),
      )
      expect(patched.metadata.status).toBe('ready')
      expect(patched.metadata.revision).toBeGreaterThan(created.metadata.revision)
      expect(patched.metadata.version.number).toBe(created.metadata.version.number)
      expect(expectOk(await repository.listVersions(id))).toHaveLength(1)
    })

    it('converts a visual template to code once, and refuses to do it again', async () => {
      const repository = makeRepository()
      const created = expectOk(
        await repository.create({
          ...newTemplate({ name: 'Visual launch', kind: 'visual' }),
          initialVersion: visualVersion(),
        }),
      )
      const id: TemplateId = created.metadata.id

      const converted = expectOk(
        await repository.convertToCode(id, {
          expectedRevision: created.metadata.revision,
          source: 'export default function T() { return null }\n',
          html: '<p>Hello</p>',
          text: 'Hello',
          samplePayloadText: '{}\n',
          propsSchemaText: '{}',
        }),
      )
      expect(converted.kind).toBe('code')
      expect(converted.metadata.version.number).toBe(2)

      const again = await repository.convertToCode(id, {
        expectedRevision: converted.metadata.revision,
        source: 'export default function T() { return null }\n',
        html: '',
        text: '',
        samplePayloadText: '{}\n',
        propsSchemaText: '{}',
      })
      expect(again.ok).toBe(false)
      if (!again.ok) expect(again.failure.code).toBe('not-visual')
    })

    it('refuses a version of the other kind, so a conversion cannot be undone', async () => {
      const repository = makeRepository()
      const created = expectOk(
        await repository.create({
          ...newTemplate({ name: 'Visual launch', kind: 'visual' }),
          initialVersion: visualVersion(),
        }),
      )
      const converted = expectOk(
        await repository.convertToCode(created.metadata.id, {
          expectedRevision: created.metadata.revision,
          source: 'export default function T() { return null }\n',
          html: '<p>Hello</p>',
          text: 'Hello',
          samplePayloadText: '{}\n',
          propsSchemaText: '{}',
        }),
      )

      // Saving a visual version onto it would flip the kind back.
      const back = await repository.saveVersion(
        converted.metadata.id,
        converted.metadata.revision,
        visualVersion(),
      )
      expect(back.ok).toBe(false)
      if (!back.ok) expect(back.failure.code).toBe('invalid')
      expect(expectOk(await repository.get(converted.metadata.id)).kind).toBe('code')
    })

    it('refuses metadata and envelope fields over the caps the API enforces', async () => {
      const repository = makeRepository()

      const longName = await repository.create({
        ...newTemplate({ name: 'n'.repeat(MAX_NAME_LENGTH + 1) }),
        initialVersion: codeVersion(),
      })
      expect(longName.ok).toBe(false)
      if (!longName.ok) expect(longName.failure.code).toBe('invalid')

      const manyTags = await repository.create({
        ...newTemplate({ name: 'Tagged', tags: Array.from({ length: MAX_TAGS + 1 }, (_, i) => `t${i}`) }),
        initialVersion: codeVersion(),
      })
      expect(manyTags.ok).toBe(false)
      if (!manyTags.ok) expect(manyTags.failure.code).toBe('invalid')

      const created = expectOk(await repository.create({ ...newTemplate(), initialVersion: codeVersion() }))
      const longSubject = await repository.saveVersion(
        created.metadata.id,
        created.metadata.revision,
        codeVersion({
          envelope: { subject: 's'.repeat(MAX_SUBJECT_LENGTH + 1), preheader: '', replyTo: '' },
        }),
      )
      expect(longSubject.ok).toBe(false)
      if (!longSubject.ok) expect(longSubject.failure.code).toBe('invalid')
    })

    it('copies what it is given, so mutating an input later cannot change the store', async () => {
      const repository = makeRepository()
      const tags = ['billing']
      const created = expectOk(
        await repository.create({ ...newTemplate({ tags }), initialVersion: codeVersion() }),
      )

      tags.push('tampered')

      const fetched = expectOk(await repository.get(created.metadata.id))
      expect(fetched.metadata.tags).toEqual(['billing'])
    })

    it('refuses a version whose content is over the size cap', async () => {
      const repository = makeRepository()
      const created = expectOk(await repository.create({ ...newTemplate(), initialVersion: codeVersion() }))
      const tooBig = await repository.saveVersion(
        created.metadata.id,
        created.metadata.revision,
        codeVersion({ html: 'x'.repeat(MAX_HTML_BYTES + 1) }),
      )
      expect(tooBig.ok).toBe(false)
      if (!tooBig.ok) expect(tooBig.failure.code).toBe('payload-too-large')
    })
  })
}
