// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PreviewToolbar } from './PreviewToolbar'

const toast = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast }))

const NOTHING_RENDERED = 'Nothing rendered yet.'

function renderToolbar(downloadReason?: string) {
  const handlers = { html: vi.fn(), text: vi.fn(), refresh: vi.fn() }
  render(
    <TooltipProvider>
      <PreviewToolbar
        headingId="preview-heading"
        device="desktop"
        status="success"
        stale={false}
        renderedAt={new Date('2026-09-18T10:22:33Z')}
        onRefresh={handlers.refresh}
        onDownloadHtml={handlers.html}
        onDownloadText={handlers.text}
        downloadReason={downloadReason}
      />
    </TooltipProvider>,
  )
  return handlers
}

describe('PreviewToolbar', () => {
  it('echoes the device and the state of the render on screen', () => {
    renderToolbar()
    expect(screen.getByText('Desktop · up to 680px')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Up to date')
  })

  it('downloads the HTML and the plain text', async () => {
    const handlers = renderToolbar()
    await userEvent.click(screen.getByRole('button', { name: 'Download HTML' }))
    await userEvent.click(screen.getByRole('button', { name: 'Download plain text' }))
    expect(handlers.html).toHaveBeenCalledTimes(1)
    expect(handlers.text).toHaveBeenCalledTimes(1)
  })

  it('keeps the downloads focusable and says why while nothing has rendered', async () => {
    toast.mockClear()
    const handlers = renderToolbar(NOTHING_RENDERED)
    const download = screen.getByRole('button', { name: 'Download HTML' })

    expect(download).toHaveAttribute('aria-disabled', 'true')
    expect(download).not.toBeDisabled()
    expect(download).toHaveAccessibleDescription(NOTHING_RENDERED)

    await userEvent.click(download)
    expect(handlers.html).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(NOTHING_RENDERED)
  })
})
