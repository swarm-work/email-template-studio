// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EmailTemplate, TemplateId } from '@/domain'
import { STARTER_TEMPLATES } from '@/infrastructure/templates/registry'
import { toEmailTemplate } from '@/infrastructure/templates/templateMapper'
import type { PersistedStudioState, StudioSessionStore } from '@/infrastructure/session/sessionStore'
import { hydrate, useStudio } from './useStudio'

const TEMPLATES: readonly EmailTemplate[] = STARTER_TEMPLATES.map(toEmailTemplate)
const FIRST = TEMPLATES[0].metadata.id
const SECOND = TEMPLATES[1].metadata.id

/** A store that records what was written, so a test can count the saves. */
function fakeStore(initial: PersistedStudioState | null = null): StudioSessionStore & {
  saves: PersistedStudioState[]
} {
  const store = {
    saves: [] as PersistedStudioState[],
    load: () => initial,
    save(state: PersistedStudioState) {
      store.saves.push(state)
    },
    clear() {},
  }
  return store
}

function persisted(overrides: Partial<PersistedStudioState> = {}): PersistedStudioState {
  return {
    selectedId: SECOND,
    device: 'desktop',
    mode: 'code',
    drafts: {},
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('hydrate', () => {
  it('falls back to the first template when nothing is stored', () => {
    expect(hydrate(null, TEMPLATES)).toEqual({
      selectedId: FIRST,
      drafts: {},
      device: 'desktop',
      mode: 'code',
    })
  })

  it('clamps a stored mode the selected template cannot show', () => {
    // Every starter is a code template, so 'visual' is not on offer.
    expect(hydrate(persisted({ mode: 'visual' }), TEMPLATES).mode).toBe('code')
    expect(hydrate(persisted({ mode: 'preview' }), TEMPLATES).mode).toBe('preview')
  })

  it('drops an unknown selected id and the drafts of templates that are gone', () => {
    const state = hydrate(
      persisted({
        selectedId: 'deleted-template',
        mode: 'visual',
        drafts: {
          'deleted-template': {
            baseRevision: 0,
            baseVersionNumber: 0,
            source: 'gone',
            payloadText: '',
            document: null,
            envelope: null,
          },
        },
      }),
      TEMPLATES,
    )
    expect(state.selectedId).toBe(FIRST)
    expect(state.drafts).toEqual({})
    expect(state.mode).toBe('code')
  })
})

describe('useStudio session saves', () => {
  it('waits for the debounce, then saves once', async () => {
    vi.useFakeTimers()
    const store = fakeStore()
    const { result } = renderHook(() => useStudio({ templates: TEMPLATES, store }))

    act(() => result.current.actions.updateSource('// edited'))
    act(() => result.current.actions.updateSource('// edited twice'))
    expect(store.saves).toHaveLength(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(store.saves).toHaveLength(1)
    expect(store.saves[0].drafts[FIRST].source).toBe('// edited twice')
  })

  it('saves a pending change when the page goes away', async () => {
    vi.useFakeTimers()
    const store = fakeStore()
    const { result } = renderHook(() => useStudio({ templates: TEMPLATES, store }))

    act(() => result.current.actions.updateSource('// edited'))
    act(() => {
      window.dispatchEvent(new Event('pagehide'))
    })
    expect(store.saves).toHaveLength(1)

    // The flush consumed the pending state, so the timer must not save it again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    expect(store.saves).toHaveLength(1)
  })

  it('saves a pending change when the studio unmounts', () => {
    vi.useFakeTimers()
    const store = fakeStore()
    const { result, unmount } = renderHook(() => useStudio({ templates: TEMPLATES, store }))

    act(() => result.current.actions.updateSource('// edited'))
    unmount()
    expect(store.saves).toHaveLength(1)
    expect(store.saves[0].drafts[FIRST].source).toBe('// edited')
  })

  it('opens on the stored template, clamped to a mode that template offers', () => {
    const store = fakeStore(persisted({ selectedId: SECOND, mode: 'visual' }))
    const { result } = renderHook(() => useStudio({ templates: TEMPLATES, store }))
    expect(result.current.template.metadata.id).toBe(SECOND as TemplateId)
    expect(result.current.state.mode).toBe('code')
  })
})
