// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { RepositoryResult, TemplateRepository } from '@/application/repositories/templateRepository'
import type { TemplateRecord } from '@/domain'
import { STARTER_TEMPLATES } from '@/infrastructure/templates/registry'
import { createInMemoryTemplateRepository } from '@/infrastructure/templates/inMemoryTemplateRepository'
import { useTemplateLibrary } from './useTemplateLibrary'

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
})
