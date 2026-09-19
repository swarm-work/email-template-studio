import { describe, expect, it, vi } from 'vitest'
import { createTemplateRepository } from './createTemplateRepository'

/**
 * The two adapters are told apart by what they do, not by what they are: the
 * HTTP one asks `fetch` for the list, and the in-memory one answers out of its
 * own seed without touching the network. That is the property worth testing —
 * a build that silently ran in memory would lose every save on reload.
 */
async function usesFetch(mode: string | undefined): Promise<boolean> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'))
  try {
    await createTemplateRepository(mode).list()
    return fetchSpy.mock.calls.length > 0
  } finally {
    fetchSpy.mockRestore()
  }
}

describe('createTemplateRepository', () => {
  it('uses the API when the mode is unset', async () => {
    expect(await usesFetch(undefined)).toBe(true)
  })

  it('uses the API when the mode is misspelled, rather than falling back to memory', async () => {
    expect(await usesFetch('in-memory')).toBe(true)
  })

  it('uses the in-memory store only for the literal "memory"', async () => {
    expect(await usesFetch('memory')).toBe(false)
  })
})
