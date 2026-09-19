// Adds matchers such as toBeInTheDocument() to Vitest's expect.
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Without Vitest globals, Testing Library does not unmount between tests on its own.
afterEach(() => {
  cleanup()
})

/**
 * jsdom has no ResizeObserver, and Radix's popper-based components (tooltip,
 * dropdown menu) observe their trigger the moment they open. Without this stub
 * opening one throws in a place the test cannot catch.
 */
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

/**
 * jsdom implements neither the Pointer Capture API nor `scrollIntoView`, and
 * Radix's `Select` calls all four while it opens (it captures the pointer to
 * follow a press-and-drag selection, then scrolls the chosen item into view).
 * Same reason as the ResizeObserver stub above: without them, opening a select
 * in a test throws inside the library.
 */
if (typeof Element !== 'undefined') {
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.setPointerCapture ??= () => {}
  Element.prototype.releasePointerCapture ??= () => {}
  Element.prototype.scrollIntoView ??= () => {}
}
