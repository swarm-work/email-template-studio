// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TemplateBreadcrumb } from './TemplateBreadcrumb'

function renderCrumb() {
  const onBackToLibrary = vi.fn()
  const onRename = vi.fn()
  render(<TemplateBreadcrumb name="Product launch" onBackToLibrary={onBackToLibrary} onRename={onRename} />)
  return { onBackToLibrary, onRename }
}

describe('TemplateBreadcrumb back control', () => {
  it('is a real, named button - the feedback was that the old grey crumb was not findable', () => {
    renderCrumb()
    const back = screen.getByRole('button', { name: 'Back to templates' })
    // The visible word is part of the accessible name, so "click Templates"
    // in voice control still lands on it.
    expect(back).toHaveTextContent('Templates')
    // The arrow is decoration; the name already says "back".
    expect(back.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  it('goes back to the library and does nothing else', async () => {
    const { onBackToLibrary, onRename } = renderCrumb()
    await userEvent.click(screen.getByRole('button', { name: 'Back to templates' }))
    expect(onBackToLibrary).toHaveBeenCalledTimes(1)
    expect(onRename).not.toHaveBeenCalled()
  })

  it('keeps the template name as the page heading next to it', () => {
    renderCrumb()
    expect(screen.getByRole('heading', { level: 1, name: 'Product launch' })).toBeInTheDocument()
  })
})
