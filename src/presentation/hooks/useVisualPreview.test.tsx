// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenderResult } from '@/domain'
import type { VisualEditorHandle } from '@/infrastructure/render/visualEmailRenderer'
import { useVisualPreview } from './useVisualPreview'

/** A handle is only ever passed straight back to the composer, so a stub will do. */
const HANDLE = { editor: null } as VisualEditorHandle

function ok(html: string): RenderResult {
  return { ok: true, html, text: html.replace(/<[^>]+>/g, ''), durationMs: 3 }
}

const failure: RenderResult = { ok: false, error: { kind: 'compose', message: 'nope' } }

/** Records every call so the tests can assert on how OFTEN the editor was asked. */
function composerReturning(...results: RenderResult[]) {
  const calls: { preheader: string }[] = []
  let index = 0
  const compose = vi.fn(async (_handle: VisualEditorHandle, options: { preheader: string }) => {
    calls.push({ preheader: options.preheader })
    return results[Math.min(index++, results.length - 1)]
  })
  return { compose, calls }
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useVisualPreview', () => {
  it('reports idle and never composes while it is switched off', () => {
    const { compose } = composerReturning(ok('<p>x</p>'))
    const { result } = renderHook(() =>
      useVisualPreview({ enabled: false, resetKey: 't1', preheader: '', revision: 0, compose }),
    )

    expect(result.current.status).toBe('idle')
    act(() => result.current.onReady(HANDLE))
    act(() => vi.advanceTimersByTime(1000))
    expect(compose).not.toHaveBeenCalled()
    expect(result.current.html).toBeNull()
  })

  it('waits for the editor, then composes once the debounce has passed', async () => {
    const { compose } = composerReturning(ok('<p>one</p>'))
    const { result } = renderHook(() =>
      useVisualPreview({
        enabled: true,
        resetKey: 't1',
        preheader: 'Hello',
        revision: 0,
        compose,
        debounceMs: 50,
      }),
    )

    // No handle yet: a result is on its way, which is what "rendering" means.
    expect(result.current.status).toBe('rendering')
    expect(compose).not.toHaveBeenCalled()

    act(() => result.current.onReady(HANDLE))
    act(() => vi.advanceTimersByTime(49))
    expect(compose).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1))
    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(compose).toHaveBeenCalledTimes(1)
    expect(compose).toHaveBeenCalledWith(HANDLE, { preheader: 'Hello' })
    expect(result.current.html).toBe('<p>one</p>')
    expect(result.current.text).toBe('one')
    expect(result.current.renderedAt).toBeInstanceOf(Date)
  })

  it('composes once for a burst of edits, not once per keystroke', async () => {
    const { compose } = composerReturning(ok('<p>final</p>'))
    const { result, rerender } = renderHook(
      ({ revision }) =>
        useVisualPreview({
          enabled: true,
          resetKey: 't1',
          preheader: '',
          revision,
          compose,
          debounceMs: 50,
        }),
      { initialProps: { revision: 0 } },
    )
    act(() => result.current.onReady(HANDLE))

    for (const revision of [1, 2, 3]) {
      rerender({ revision })
      act(() => vi.advanceTimersByTime(20))
    }
    act(() => vi.advanceTimersByTime(50))

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(compose).toHaveBeenCalledTimes(1)
  })

  it('keeps the last good export when a newer compose fails', async () => {
    const { compose } = composerReturning(ok('<p>good</p>'), failure)
    const { result, rerender } = renderHook(
      ({ revision }) =>
        useVisualPreview({
          enabled: true,
          resetKey: 't1',
          preheader: '',
          revision,
          compose,
          debounceMs: 10,
        }),
      { initialProps: { revision: 0 } },
    )
    act(() => result.current.onReady(HANDLE))
    act(() => vi.advanceTimersByTime(10))
    await waitFor(() => expect(result.current.html).toBe('<p>good</p>'))

    rerender({ revision: 1 })
    act(() => vi.advanceTimersByTime(10))
    await waitFor(() => expect(result.current.status).toBe('error'))
    // The failure is reported, and the last thing that DID export is still there
    // so the preview does not flash empty on a half-typed edit.
    expect(result.current.result).toEqual(failure)
    expect(result.current.html).toBe('<p>good</p>')
  })

  it('drops a result that arrives after the template changed', async () => {
    const { compose } = composerReturning(ok('<p>first</p>'))
    const { result, rerender } = renderHook(
      ({ resetKey }) =>
        useVisualPreview({
          enabled: true,
          resetKey,
          preheader: '',
          revision: 0,
          compose,
          debounceMs: 10,
        }),
      { initialProps: { resetKey: 't1' } },
    )
    act(() => result.current.onReady(HANDLE))
    act(() => vi.advanceTimersByTime(10))
    await waitFor(() => expect(result.current.html).toBe('<p>first</p>'))

    rerender({ resetKey: 't2' })
    // Nothing from the previous template survives the switch, so the second
    // template never shows the first one's email for a frame.
    expect(result.current.html).toBeNull()
    expect(result.current.result).toBeNull()
  })

  it('stops composing once the editor is destroyed', async () => {
    const { compose } = composerReturning(ok('<p>x</p>'))
    const { result, rerender } = renderHook(
      ({ revision }) =>
        useVisualPreview({
          enabled: true,
          resetKey: 't1',
          preheader: '',
          revision,
          compose,
          debounceMs: 10,
        }),
      { initialProps: { revision: 0 } },
    )
    act(() => result.current.onReady(HANDLE))
    act(() => vi.advanceTimersByTime(10))
    await waitFor(() => expect(compose).toHaveBeenCalledTimes(1))

    act(() => result.current.onDestroy())
    rerender({ revision: 1 })
    act(() => vi.advanceTimersByTime(100))
    expect(compose).toHaveBeenCalledTimes(1)
  })

  it('composes again when Refresh is pressed, with nothing else changed', async () => {
    const { compose } = composerReturning(ok('<p>x</p>'))
    const { result } = renderHook(() =>
      useVisualPreview({
        enabled: true,
        resetKey: 't1',
        preheader: '',
        revision: 0,
        compose,
        debounceMs: 10,
      }),
    )
    act(() => result.current.onReady(HANDLE))
    act(() => vi.advanceTimersByTime(10))
    await waitFor(() => expect(compose).toHaveBeenCalledTimes(1))

    act(() => result.current.refresh())
    act(() => vi.advanceTimersByTime(10))
    await waitFor(() => expect(compose).toHaveBeenCalledTimes(2))
  })
})
