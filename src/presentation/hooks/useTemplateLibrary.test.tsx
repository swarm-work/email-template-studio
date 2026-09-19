// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { RepositoryResult, TemplateRepository } from '@/application/repositories/templateRepository'
import type { EmailTemplate, TemplateRecord } from '@/domain'
import { STARTER_TEMPLATES } from '@/infrastructure/templates/registry'
import { createInMemoryTemplateRepository } from '@/infrastructure/templates/inMemoryTemplateRepository'
import { codeVersion } from '@/infrastructure/templates/templateRepositoryContract'
import { useTemplateLibrary, type TemplateLibraryState } from './useTemplateLibrary'

/** A repository that only answers `list()`, with whatever the test wants. */
function listOnly(answer: () => Promise<RepositoryResult<readonly TemplateRecord[]>>): TemplateRepository {
  return { list: answer } as unknown as TemplateRepository
}

describe('useTemplateLibrary', () => {
  it('starts loading and ends ready when the repository has templates', async () => {
    const repository = createInMemoryTemplateRepository()
    const { result } = renderHook(() => useTemplateLibrary(repository))

    expect(result.current.state.kind).toBe('loading')
    await waitFor(() => expect(result.current.state.kind).toBe('ready'))
    if (result.current.state.kind !== 'ready') throw new Error('expected ready')
    expect(result.current.state.templates).toHaveLength(STARTER_TEMPLATES.length)
    // The mapper ran: a record alone has no validator.
    expect(typeof result.current.state.templates[0].validateProps).toBe('function')
  })

  it('reports empty as its own state, not as a ready list of length zero', async () => {
    const repository = createInMemoryTemplateRepository({ seed: [] })
    const { result } = renderHook(() => useTemplateLibrary(repository))
    await waitFor(() => expect(result.current.state.kind).toBe('empty'))
  })

  it('keeps the failure so the screen can explain it, and retries on reload', async () => {
    let attempts = 0
    const repository = listOnly(async () => {
      attempts += 1
      return attempts === 1
        ? { ok: false, failure: { code: 'unreachable', message: 'Could not reach the studio API.' } }
        : { ok: true, value: STARTER_TEMPLATES }
    })

    const { result } = renderHook(() => useTemplateLibrary(repository))
    await waitFor(() => expect(result.current.state.kind).toBe('error'))
    if (result.current.state.kind !== 'error') throw new Error('expected error')
    expect(result.current.state.failure.message).toBe('Could not reach the studio API.')

    result.current.reload()
    await waitFor(() => expect(result.current.state.kind).toBe('ready'))
  })

  it('keeps the list on screen while a refetch runs, so a write cannot unmount the editor', async () => {
    const repository = createInMemoryTemplateRepository()
    const { result } = renderHook(() => useTemplateLibrary(repository))
    await waitFor(() => expect(result.current.state.kind).toBe('ready'))

    // `reload` is the same path a successful create/save/remove takes.
    act(() => result.current.reload())
    expect(result.current.state.kind).toBe('ready')

    await waitFor(() => expect(result.current.state.kind).toBe('ready'))
  })

  it('shows a created template without ever going back to loading', async () => {
    const repository = createInMemoryTemplateRepository()
    const { result } = renderHook(() => useTemplateLibrary(repository))
    await waitFor(() => expect(result.current.state.kind).toBe('ready'))
    const before = templateCount(result.current.state)

    const seen: string[] = []
    await act(async () => {
      const created = await result.current.create({
        name: 'Invoice receipt',
        kind: 'code',
        description: '',
        category: 'billing',
        initialVersion: codeVersion(),
      })
      expect(created.ok).toBe(true)
      seen.push(result.current.state.kind)
    })

    // The editor and its CodeMirror instance stay mounted across a write.
    expect(seen).not.toContain('loading')
    await waitFor(() => expect(templateCount(result.current.state)).toBe(before + 1))
  })

  it('shows a new version on the card after a save, still without loading', async () => {
    const repository = createInMemoryTemplateRepository()
    const { result } = renderHook(() => useTemplateLibrary(repository))
    await waitFor(() => expect(result.current.state.kind).toBe('ready'))
    // A code template, because a version has to match the template's kind.
    const target = readyTemplates(result.current.state).find((one) => one.kind === 'code')
    if (!target) throw new Error('expected a code starter')

    await act(async () => {
      const saved = await result.current.saveVersion(
        target.metadata.id,
        target.metadata.revision,
        codeVersion({ source: 'export default function T() { return null }\n' }),
      )
      expect(saved.ok).toBe(true)
      expect(result.current.state.kind).toBe('ready')
    })

    await waitFor(() => {
      const again = byId(result.current.state, target.metadata.id)
      expect(again.metadata.version.number).toBe(target.metadata.version.number + 1)
    })
  })

  it('has the saved version on the card the moment the save resolves', async () => {
    // Not "eventually, once the refetch lands": until the list agrees with the
    // server the studio still says "Unsaved changes", the status bar still
    // quotes the old version and Save is still live — so a second click would
    // write the same version twice.
    const repository = createInMemoryTemplateRepository()
    const { result } = renderHook(() => useTemplateLibrary(repository))
    await waitFor(() => expect(result.current.state.kind).toBe('ready'))
    const target = readyTemplates(result.current.state).find((one) => one.kind === 'code')
    if (!target) throw new Error('expected a code starter')

    await act(async () => {
      await result.current.saveVersion(target.metadata.id, target.metadata.revision, codeVersion())
    })

    const again = byId(result.current.state, target.metadata.id)
    expect(again.metadata.version.number).toBe(target.metadata.version.number + 1)
    expect(again.metadata.revision).toBeGreaterThan(target.metadata.revision)
    // The mapper ran on the patched record too, so it is a whole EmailTemplate.
    expect(typeof again.validateProps).toBe('function')
  })

  it('has the new revision on the card the moment a metadata patch resolves', async () => {
    // The next metadata write quotes this revision as its `expectedRevision`.
    // While it lagged, a rename followed by "Mark as ready" was refused with a
    // 409 and the studio blamed a second editor who did not exist.
    const repository = createInMemoryTemplateRepository()
    const { result } = renderHook(() => useTemplateLibrary(repository))
    await waitFor(() => expect(result.current.state.kind).toBe('ready'))
    const target = firstTemplate(result.current.state)

    await act(async () => {
      await result.current.updateMetadata(target.metadata.id, target.metadata.revision, { name: 'Renamed' })
    })
    const afterFirst = byId(result.current.state, target.metadata.id)
    expect(afterFirst.metadata.name).toBe('Renamed')
    expect(afterFirst.metadata.revision).toBeGreaterThan(target.metadata.revision)

    // A second write against what the list now holds is accepted.
    await act(async () => {
      const second = await result.current.updateMetadata(
        afterFirst.metadata.id,
        afterFirst.metadata.revision,
        { status: 'ready' },
      )
      expect(second.ok).toBe(true)
    })
    expect(byId(result.current.state, target.metadata.id).metadata.status).toBe('ready')
  })

  it('has the created template in the list before create resolves, so the editor opens on it', async () => {
    const repository = createInMemoryTemplateRepository()
    const { result } = renderHook(() => useTemplateLibrary(repository))
    await waitFor(() => expect(result.current.state.kind).toBe('ready'))

    let createdId = ''
    await act(async () => {
      const created = await result.current.create({
        name: 'Invoice receipt',
        kind: 'code',
        description: '',
        category: 'billing',
        initialVersion: codeVersion(),
      })
      if (!created.ok) throw new Error('expected the create to work')
      createdId = created.value.metadata.id
    })

    // Without this the route would open the editor on `templates[0]` — some
    // other template entirely — until the N+1 refetch landed.
    expect(byId(result.current.state, createdId).metadata.name).toBe('Invoice receipt')
  })

  it('drops a removed template from the list', async () => {
    const repository = createInMemoryTemplateRepository()
    const { result } = renderHook(() => useTemplateLibrary(repository))
    await waitFor(() => expect(result.current.state.kind).toBe('ready'))
    const before = templateCount(result.current.state)
    const target = firstTemplate(result.current.state)

    await act(async () => {
      expect((await result.current.remove(target.metadata.id)).ok).toBe(true)
      expect(result.current.state.kind).toBe('ready')
    })

    await waitFor(() => expect(templateCount(result.current.state)).toBe(before - 1))
  })

  it('shows a metadata change without writing a version', async () => {
    const repository = createInMemoryTemplateRepository()
    const { result } = renderHook(() => useTemplateLibrary(repository))
    await waitFor(() => expect(result.current.state.kind).toBe('ready'))
    const target = firstTemplate(result.current.state)

    await act(async () => {
      const patched = await result.current.updateMetadata(target.metadata.id, target.metadata.revision, {
        status: 'ready',
      })
      expect(patched.ok).toBe(true)
    })

    await waitFor(() => {
      const again = byId(result.current.state, target.metadata.id)
      expect(again.metadata.status).toBe('ready')
      expect(again.metadata.version.number).toBe(target.metadata.version.number)
    })
  })
})

/** The list, or a test failure naming what the state actually was. */
function readyTemplates(state: TemplateLibraryState): readonly EmailTemplate[] {
  if (state.kind !== 'ready') throw new Error(`expected ready, got ${state.kind}`)
  return state.templates
}

function templateCount(state: TemplateLibraryState): number {
  return readyTemplates(state).length
}

function firstTemplate(state: TemplateLibraryState): EmailTemplate {
  return readyTemplates(state)[0]
}

/** The list is sorted newest-first, so a saved template moves; find it by id. */
function byId(state: TemplateLibraryState, id: string): EmailTemplate {
  const found = readyTemplates(state).find((template) => template.metadata.id === id)
  if (!found) throw new Error(`no template with the id ${id}`)
  return found
}
