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
