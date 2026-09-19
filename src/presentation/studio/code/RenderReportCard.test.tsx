// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { RenderReportCard } from './RenderReportCard'

const HISTORY = [18, 21, 19, 24, 22, 20, 26, 23, 19, 18, 25, 21]

describe('RenderReportCard', () => {
  it('reports the sizes and timings of the render that is on screen', () => {
    render(
      <RenderReportCard html={'<p>hello</p>'} text="" propsCount={5} durationMs={21.4} history={HISTORY} />,
    )

    const region = screen.getByRole('region', { name: 'Render report' })
    // Twice: the HTML row and the approximate-size row agree while there is no
    // plain-text part yet.
    expect(within(region).getAllByText('12 B')).toHaveLength(2)
    // Nothing has rendered a plain-text part here, so the row measures nothing.
    expect(within(region).getByText('—')).toBeInTheDocument()
    expect(within(region).getByText('5')).toBeInTheDocument()
    expect(within(region).getByText('21 ms')).toBeInTheDocument()
    expect(within(region).getByText('Planned')).toBeInTheDocument()
  })

  it('measures the plain-text part beside the HTML', () => {
    render(
      <RenderReportCard html={'<p>hello</p>'} text="hello" propsCount={1} durationMs={9} history={HISTORY} />,
    )
    const region = screen.getByRole('region', { name: 'Render report' })
    expect(within(region).getByText('5 B')).toBeInTheDocument()
    // HTML 12 B + text 5 B: the approximate email size is both parts together.
    expect(within(region).getByText('17 B')).toBeInTheDocument()
  })

  it('gives the sparkline a text alternative naming the range', () => {
    render(<RenderReportCard html="<p>x</p>" text="" propsCount={0} durationMs={18} history={HISTORY} />)
    expect(screen.getByRole('img', { name: 'Last 12 renders, 18 to 26 milliseconds' })).toBeInTheDocument()
  })

  it('says so rather than drawing a line through one point', () => {
    render(<RenderReportCard html={null} text="" propsCount={null} durationMs={null} history={[18]} />)
    expect(screen.getByText('Not enough renders yet.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
