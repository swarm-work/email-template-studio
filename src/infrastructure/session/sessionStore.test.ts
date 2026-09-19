import { describe, expect, it } from 'vitest'
import {
  createSessionStore,
  SESSION_STORAGE_KEY,
  type PersistedStudioState,
  type StorageLike,
} from './sessionStore'

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  }
}

const emptyState: PersistedStudioState = { selectedId: 'a', device: 'desktop', mode: 'code', drafts: {} }

describe('createSessionStore', () => {
  it('round-trips a valid state', () => {
    const storage = memoryStorage()
    const store = createSessionStore(storage)
    const state: PersistedStudioState = {
      selectedId: 'a',
      device: 'mobile',
      mode: 'preview',
      drafts: {
        a: {
          baseRevision: 3,
          baseVersionNumber: 2,
          source: 's',
          payloadText: 'p',
          document: { type: 'doc', content: [] },
          envelope: { subject: 'Hello', preheader: '', replyTo: 'reply@example.test' },
        },
      },
    }
    store.save(state)
    expect(store.load()).toEqual(state)
  })

  it('still reads a payload written before the visual editor existed', () => {
    const storage = memoryStorage()
    const store = createSessionStore(storage)
    // Exactly what v1 of the studio wrote: no mode, no document, no envelope,
    // and a `localPublishes` map that no longer exists.
    storage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        selectedId: 'a',
        device: 'mobile',
        drafts: { a: { source: 's', payloadText: 'p' } },
        localPublishes: { a: '2026-09-08T10:00:00Z' },
      }),
    )
    expect(store.load()).toEqual({
      selectedId: 'a',
      device: 'mobile',
      mode: 'code',
      drafts: {
        a: {
          // 0 means "we do not know which revision this draft started from",
          // which is what suppresses the conflict banner for old drafts.
          baseRevision: 0,
          baseVersionNumber: 0,
          source: 's',
          payloadText: 'p',
          document: null,
          envelope: null,
        },
      },
    })
  })

  it('falls back to the code mode when the stored mode is nonsense', () => {
    const storage = memoryStorage()
    const store = createSessionStore(storage)
    storage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ selectedId: 'a', device: 'desktop', mode: 'hologram', drafts: {} }),
    )
    expect(store.load()?.mode).toBe('code')
  })

  it('ignores corrupt or unexpected data instead of throwing', () => {
    const storage = memoryStorage()
    const store = createSessionStore(storage)
    storage.setItem(SESSION_STORAGE_KEY, '{not json')
    expect(store.load()).toBeNull()
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ selectedId: 1, drafts: 'nope' }))
    expect(store.load()).toBeNull()
  })

  it('is a no-op without storage', () => {
    const store = createSessionStore(null)
    expect(store.load()).toBeNull()
    expect(() => store.save(emptyState)).not.toThrow()
  })
})
