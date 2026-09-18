// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PreviewThumbnail } from './PreviewThumbnail'

const DOCUMENT = '<!doctype html><html><body><p>Welcome, Ada</p></body></html>'

describe('PreviewThumbnail', () => {
  it('hides the picture from assistive technology and offers a button instead', () => {
    const onOpenPreview = vi.fn()
    const { container } = render(
      <PreviewThumbnail document={DOCUMENT} status="success" stale={false} onOpenPreview={onOpenPreview} />,
    )

    const frame = container.querySelector('iframe')
    expect(frame).not.toBeNull()
    expect(frame).toHaveAttribute('aria-hidden', 'true')
    expect(frame).toHaveAttribute('tabindex', '-1')
    expect(frame).toHaveAttribute('title', '')
    expect(frame).toHaveClass('pointer-events-none')
    // The sandbox is the same one the full preview uses: no scripts at all.
    expect(frame).toHaveAttribute('sandbox', '')
    expect(screen.getByRole('button', { name: 'Open full preview' })).toBeInTheDocument()
  })

  it('opens preview mode from the overlay button', async () => {
    const onOpenPreview = vi.fn()
    render(
      <PreviewThumbnail document={DOCUMENT} status="success" stale={false} onOpenPreview={onOpenPreview} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Open full preview' }))
    expect(onOpenPreview).toHaveBeenCalledTimes(1)
  })

  it('says how far it is scaled down and reuses the preview status words', () => {
    render(<PreviewThumbnail document={DOCUMENT} status="rendering" stale={false} onOpenPreview={vi.fn()} />)
    expect(screen.getByText(/of 680 px\. ⌘P opens the full preview\./)).toBeInTheDocument()
    expect(screen.getByText('Rendering…')).toBeInTheDocument()
  })

  it('says there is nothing to show before the first render', () => {
    render(<PreviewThumbnail document={null} status="idle" stale={false} onOpenPreview={vi.fn()} />)
    expect(screen.getByText('Nothing rendered yet.')).toBeInTheDocument()
    expect(document.querySelector('iframe')).toBeNull()
  })
})
