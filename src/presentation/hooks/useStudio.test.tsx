// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { templateId, type EmailTemplate, type TemplateId } from '@/domain'
import { STARTER_TEMPLATES } from '@/infrastructure/templates/registry'
import { toEmailTemplate } from '@/infrastructure/templates/templateMapper'
import type { PersistedStudioState, StudioSessionStore } from '@/infrastructure/session/sessionStore'
import { hydrate, useStudio } from './useStudio'

const TEMPLATES: readonly EmailTemplate[] = STARTER_TEMPLATES.map(toEmailTemplate)
const FIRST = TEMPLATES[0].metadata.id
const SECOND = TEMPLATES[1].metadata.id

/**
 * Every starter is a code template, so the one case that needs two kinds — the
 * route opening a visual template while the stored mode is 'code' — gets a
 * fixture built from a starter's metadata.
 */
const VISUAL_ID = templateId('tpl_visual-fixture')
const VISUAL: EmailTemplate = toEmailTemplate({
  metadata: {
    ...STARTER_TEMPLATES[0].metadata,
    id: VISUAL_ID,
    name: 'Visual fixture',
    slug: 'visual-fixture',
  },
  envelope: STARTER_TEMPLATES[0].envelope,
  samplePayloadText: STARTER_TEMPLATES[0].samplePayloadText,
  propsSchemaText: STARTER_TEMPLATES[0].propsSchemaText,
  kind: 'visual',
  document: { type: 'doc', content: [] },
  theme: 'studio-v1',
  html: '',
  text: '',
})
const MIXED: readonly EmailTemplate[] = [...TEMPLATES, VISUAL]

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

  it('writes nothing before the first edit, so the autosave note stays quiet', async () => {
    vi.useFakeTimers()
    const store = fakeStore()
    const { result } = renderHook(() => useStudio({ templates: TEMPLATES, store }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })
    // The hydrated state is the state the store already holds; re-persisting it
    // would make the sub-header say "Autosaved just now" about nothing.
    expect(store.saves).toHaveLength(0)
    expect(result.current.lastSavedAt).toBeNull()
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

describe('useStudio route selection', () => {
  it('opens what the route asked for, and follows it when the route changes', () => {
    const store = fakeStore()
    const { result, rerender } = renderHook(
      ({ selectedId }: { selectedId: TemplateId }) => useStudio({ templates: TEMPLATES, store, selectedId }),
      { initialProps: { selectedId: FIRST as TemplateId } },
    )
    expect(result.current.template.metadata.id).toBe(FIRST)

    rerender({ selectedId: SECOND as TemplateId })
    expect(result.current.template.metadata.id).toBe(SECOND)
    expect(result.current.state.selectedId).toBe(SECOND)
  })

  it('keeps a draft per template, because drafts are keyed by template id', () => {
    const store = fakeStore()
    const { result, rerender } = renderHook(
      ({ selectedId }: { selectedId: TemplateId }) => useStudio({ templates: TEMPLATES, store, selectedId }),
      { initialProps: { selectedId: FIRST as TemplateId } },
    )

    act(() => result.current.actions.updateSource('// edited in the first'))
    rerender({ selectedId: SECOND as TemplateId })
    expect(result.current.sourceDirty).toBe(false)

    rerender({ selectedId: FIRST as TemplateId })
    expect(result.current.draft.source).toBe('// edited in the first')
    expect(result.current.sourceDirty).toBe(true)
  })

  it('clamps the mode when the route opens a template of the other kind', () => {
    const store = fakeStore(persisted({ selectedId: FIRST, mode: 'code' }))
    const { result } = renderHook(() => useStudio({ templates: MIXED, store, selectedId: VISUAL_ID }))
    expect(result.current.template.metadata.id).toBe(VISUAL_ID)
    // A visual template offers 'visual' and 'preview'; 'code' is not on offer.
    expect(result.current.state.mode).toBe('visual')
  })

  it('leaves the stored selection alone when the route has not chosen one', () => {
    const store = fakeStore(persisted({ selectedId: SECOND }))
    const { result } = renderHook(() => useStudio({ templates: TEMPLATES, store, selectedId: null }))
    expect(result.current.template.metadata.id).toBe(SECOND)
    expect(result.current.state.selectedId).toBe(SECOND)
  })

  it('ignores an id that is not in the list rather than storing a dangling selection', () => {
    const store = fakeStore()
    const { result } = renderHook(() =>
      useStudio({ templates: TEMPLATES, store, selectedId: templateId('tpl_gone') }),
    )
    expect(result.current.state.selectedId).toBe(FIRST)
    expect(result.current.template.metadata.id).toBe(FIRST)
  })
})
