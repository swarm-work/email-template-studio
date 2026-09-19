// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useUnsavedChangesGuard } from './useUnsavedChangesGuard'

afterEach(() => vi.restoreAllMocks())

describe('useUnsavedChangesGuard', () => {
  it('registers nothing while there is nothing to lose', () => {
    const add = vi.spyOn(window, 'addEventListener')
    renderHook(() => useUnsavedChangesGuard(false))
    expect(add.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(0)
  })

  it('registers a beforeunload handler while the draft is dirty', () => {
    const add = vi.spyOn(window, 'addEventListener')
    renderHook(() => useUnsavedChangesGuard(true))
    expect(add.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1)
  })

  it('removes the handler when the draft stops being dirty', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesGuard(dirty), {
      initialProps: { dirty: true },
    })
    rerender({ dirty: false })
    expect(remove.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1)
  })

  it('removes the handler on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() => useUnsavedChangesGuard(true))
    unmount()
    expect(remove.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1)
  })

  it('cancels the event, which is what makes the browser ask', () => {
    renderHook(() => useUnsavedChangesGuard(true))
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })
})
