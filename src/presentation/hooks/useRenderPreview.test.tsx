// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { RenderResult } from '@/domain'
import type { TemplateRenderer } from '@/infrastructure/render/renderClient'
import { useRenderPreview } from './useRenderPreview'

function fakeRenderer(results: RenderResult[]): TemplateRenderer & { calls: number } {
  const renderer = {
    calls: 0,
    async render() {
      renderer.calls += 1
      return results[Math.min(renderer.calls - 1, results.length - 1)]
    },
    dispose() {},
  }
  return renderer
}

const ok: RenderResult = { ok: true, html: '<p>ok</p>', text: '', durationMs: 5 }
const failed: RenderResult = { ok: false, error: { kind: 'render', message: 'boom' } }

describe('useRenderPreview', () => {
  it('is blocked while props are null and renders after the debounce otherwise', async () => {
    vi.useFakeTimers()
    const renderer = fakeRenderer([ok])
    const { result, rerender } = renderHook(
      ({ props }: { props: Record<string, unknown> | null }) =>
        useRenderPreview(renderer, 't1', 'src', props, 100),
      { initialProps: { props: null as Record<string, unknown> | null } },
    )
    expect(result.current.status).toBe('blocked')

    rerender({ props: { name: 'Ada' } })
    expect(result.current.status).toBe('rendering')
    expect(renderer.calls).toBe(0)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150)
    })
    expect(renderer.calls).toBe(1)
    expect(result.current.status).toBe('success')
    expect(result.current.html).toBe('<p>ok</p>')
    vi.useRealTimers()
  })

  it('keeps the last good HTML when a later render fails', async () => {
    vi.useFakeTimers()
    const renderer = fakeRenderer([ok, failed])
    const { result, rerender } = renderHook(
      ({ source }: { source: string }) => useRenderPreview(renderer, 't1', source, { a: 1 }, 50),
      { initialProps: { source: 'v1' } },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80)
    })
    expect(result.current.status).toBe('success')

    rerender({ source: 'v2' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80)
    })
    expect(result.current.status).toBe('error')
    expect(result.current.result).toEqual(failed)
    expect(result.current.html).toBe('<p>ok</p>')
    vi.useRealTimers()
  })

  it('hides output from a previous template when the reset key changes', async () => {
    vi.useFakeTimers()
    const renderer = fakeRenderer([ok])
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useRenderPreview(renderer, key, 'src', { a: 1 }, 50),
      { initialProps: { key: 't1' } },
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(80)
    })
    expect(result.current.html).toBe('<p>ok</p>')

    rerender({ key: 't2' })
    expect(result.current.html).toBeNull()
    expect(result.current.status).toBe('rendering')
    vi.useRealTimers()
  })
})
