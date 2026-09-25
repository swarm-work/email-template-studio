// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { COLLAPSE_THRESHOLD_PX, nextCollapsed, SETTLE_MS, useCollapseOnScroll } from './useCollapseOnScroll'

const idle = { settling: false, held: false }

describe('nextCollapsed', () => {
  it('collapses when scrolling down past the threshold', () => {
    expect(
      nextCollapsed(false, { ...idle, previousScrollTop: 10, scrollTop: COLLAPSE_THRESHOLD_PX + 1 }),
    ).toBe(true)
  })

  it('stays open for a small nudge under the threshold', () => {
    expect(nextCollapsed(false, { ...idle, previousScrollTop: 0, scrollTop: COLLAPSE_THRESHOLD_PX })).toBe(
      false,
    )
  })

  it('does not collapse on an UPWARD move, even far down the page', () => {
    // This is the browser clamping scrollTop after the panel grew, not a person.
    expect(nextCollapsed(false, { ...idle, previousScrollTop: 400, scrollTop: 300 })).toBe(false)
  })

  it('stays collapsed while scrolled down in either direction, and opens only at the top', () => {
    expect(nextCollapsed(true, { ...idle, previousScrollTop: 400, scrollTop: 20 })).toBe(true)
    expect(nextCollapsed(true, { ...idle, previousScrollTop: 20, scrollTop: 0 })).toBe(false)
  })

  it('never collapses while held, e.g. while focus is in the panel', () => {
    expect(nextCollapsed(false, { ...idle, held: true, previousScrollTop: 0, scrollTop: 500 })).toBe(false)
  })

  it('changes nothing while the layout settles after a change', () => {
    // Collapsing made the scroller taller and the browser clamped to 0: that
    // must not reopen the panel, or the two would take turns forever.
    expect(nextCollapsed(true, { ...idle, settling: true, previousScrollTop: 200, scrollTop: 0 })).toBe(true)
    expect(nextCollapsed(false, { ...idle, settling: true, previousScrollTop: 0, scrollTop: 500 })).toBe(
      false,
    )
  })
})

/** A scroller whose scrollTop the test sets, plus a readout of the hook. */
function Harness({ hold }: { hold?: () => boolean }) {
  const scroller = useRef<HTMLDivElement>(null)
  const { collapsed, expand } = useCollapseOnScroll({ scroller, hold })
  return (
    <>
      <div data-testid="scroller" ref={scroller} />
      <output data-testid="state">{collapsed ? 'collapsed' : 'open'}</output>
      <button type="button" onClick={expand}>
        expand
      </button>
    </>
  )
}

function scrollTo(top: number) {
  const scroller = screen.getByTestId('scroller')
  act(() => {
    scroller.scrollTop = top
    scroller.dispatchEvent(new Event('scroll'))
  })
}

describe('useCollapseOnScroll', () => {
  afterEach(() => vi.useRealTimers())

  it('collapses on scroll down and opens again on scroll to top', () => {
    vi.useFakeTimers()
    render(<Harness />)
    expect(screen.getByTestId('state')).toHaveTextContent('open')

    scrollTo(200)
    expect(screen.getByTestId('state')).toHaveTextContent('collapsed')

    act(() => vi.advanceTimersByTime(SETTLE_MS + 1))
    scrollTo(0)
    expect(screen.getByTestId('state')).toHaveTextContent('open')
  })

  it('opens on request (the summary row click) while still scrolled down', () => {
    render(<Harness />)
    scrollTo(200)
    act(() => screen.getByRole('button', { name: 'expand' }).click())
    expect(screen.getByTestId('state')).toHaveTextContent('open')
  })

  it('stays open while held', () => {
    render(<Harness hold={() => true} />)
    scrollTo(500)
    expect(screen.getByTestId('state')).toHaveTextContent('open')
  })
})
