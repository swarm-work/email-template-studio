// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { useScaledFrame } from './useScaledFrame'

/**
 * jsdom measures everything as zero, so the box's width is fed in by hand: the
 * stub keeps the callback and the test calls it with the width it wants.
 */
function stubResizeObserver() {
  const callbacks: ResizeObserverCallback[] = []
  const disconnect = vi.fn()
  class Stub {
    constructor(callback: ResizeObserverCallback) {
      callbacks.push(callback)
    }
    observe() {}
    unobserve() {}
    disconnect = disconnect
  }
  vi.stubGlobal('ResizeObserver', Stub as unknown as typeof ResizeObserver)
  return {
    resizeTo(width: number) {
      const entry = { contentRect: { width } } as ResizeObserverEntry
      // `act` flushes the state update the observer causes, exactly as the
      // browser would paint it.
      act(() => {
        for (const callback of callbacks) callback([entry], {} as ResizeObserver)
      })
    },
    disconnect,
  }
}

function Probe({ frameWidth = 680 }: { frameWidth?: number }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const scale = useScaledFrame(boxRef, frameWidth)
  return (
    <div ref={boxRef}>
      <output>{scale}</output>
    </div>
  )
}

function scale() {
  return Number(screen.getByRole('status').textContent)
}

describe('useScaledFrame', () => {
  it('scales the frame to the width of its box, to three decimals', () => {
    const observer = stubResizeObserver()
    render(<Probe />)

    observer.resizeTo(272)
    expect(scale()).toBeCloseTo(0.4, 3)

    observer.resizeTo(300)
    // 300 / 680 = 0.4411764…, kept to three decimals so a sub-pixel wobble
    // during a drag does not re-render on every frame.
    expect(scale()).toBe(0.441)
  })

  it('never shrinks past a fifth or grows past life size', () => {
    const observer = stubResizeObserver()
    render(<Probe />)

    observer.resizeTo(10)
    expect(scale()).toBe(0.2)

    observer.resizeTo(1400)
    expect(scale()).toBe(1)
  })

  it('stops observing when the box goes away', () => {
    const observer = stubResizeObserver()
    const view = render(<Probe />)
    view.unmount()
    expect(observer.disconnect).toHaveBeenCalled()
  })
})
