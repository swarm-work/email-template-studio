// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStudioShortcuts, type StudioShortcutHandlers } from './useStudioShortcuts'

function renderHarness(overrides: Partial<StudioShortcutHandlers> = {}) {
  const handlers = {
    enabled: true,
    onSave: vi.fn(),
    onPreview: vi.fn(),
    onFormat: vi.fn(),
    onSendTest: vi.fn(),
    onShowShortcuts: vi.fn(),
    ...overrides,
  }
  function Harness() {
    useStudioShortcuts(handlers)
    return (
      <div>
        <input aria-label="Subject" />
        <div contentEditable aria-label="Canvas" />
      </div>
    )
  }
  render(<Harness />)
  return handlers
}

/** Dispatches a key on `target` and reports whether the handler prevented the default. */
function press(target: EventTarget, init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event.defaultPrevented
}

describe('useStudioShortcuts', () => {
  it('fires the allow-listed combos even while someone is typing', () => {
    const handlers = renderHarness()
    const input = screen.getByLabelText('Subject')

    expect(press(input, { key: 's', metaKey: true })).toBe(true)
    expect(handlers.onSave).toHaveBeenCalledTimes(1)

    expect(press(input, { key: 'p', ctrlKey: true })).toBe(true)
    expect(handlers.onPreview).toHaveBeenCalledTimes(1)

    press(input, { key: 'F', metaKey: true, shiftKey: true })
    expect(handlers.onFormat).toHaveBeenCalledTimes(1)

    press(input, { key: 'Enter', metaKey: true })
    expect(handlers.onSendTest).toHaveBeenCalledTimes(1)
  })

  it('ignores a bare "?" inside a field or an editor, and opens the dialog outside one', () => {
    const handlers = renderHarness()

    press(screen.getByLabelText('Subject'), { key: '?' })
    press(screen.getByLabelText('Canvas'), { key: '?' })
    expect(handlers.onShowShortcuts).not.toHaveBeenCalled()

    press(document.body, { key: '?' })
    expect(handlers.onShowShortcuts).toHaveBeenCalledTimes(1)
  })

  it('never touches undo, redo or "/" — those belong to the editor', () => {
    const handlers = renderHarness()

    expect(press(document.body, { key: 'z', metaKey: true })).toBe(false)
    expect(press(document.body, { key: 'z', metaKey: true, shiftKey: true })).toBe(false)
    expect(press(document.body, { key: '/' })).toBe(false)

    for (const handler of [handlers.onSave, handlers.onPreview, handlers.onFormat, handlers.onSendTest]) {
      expect(handler).not.toHaveBeenCalled()
    }
  })

  it('registers nothing while it is disabled', () => {
    const handlers = renderHarness({ enabled: false })
    press(document.body, { key: 's', metaKey: true })
    expect(handlers.onSave).not.toHaveBeenCalled()
  })
})
