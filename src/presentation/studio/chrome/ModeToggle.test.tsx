// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ALL_STUDIO_MODES } from '@/application/studioModes'
import { ModeToggle } from './ModeToggle'

const toast = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast }))

const REASON = 'Coming in the next step.'

function renderToggle(onChange = vi.fn()) {
  render(
    <TooltipProvider>
      <ModeToggle
        modes={ALL_STUDIO_MODES}
        value="code"
        onChange={onChange}
        reasonFor={(mode) => (mode === 'code' ? undefined : REASON)}
      />
    </TooltipProvider>,
  )
  return onChange
}

describe('ModeToggle', () => {
  it('is a labelled group of pressed buttons, one per mode', () => {
    renderToggle()
    const group = screen.getByRole('group', { name: 'Editing mode' })
    const buttons = within(group).getAllByRole('button')
    expect(buttons.map((button) => button.textContent)).toEqual(['Visual', 'Code', 'Preview'])
    expect(screen.getByRole('button', { name: 'Code' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('keeps an unavailable mode focusable and says why instead of switching', async () => {
    toast.mockClear()
    const onChange = renderToggle()
    const preview = screen.getByRole('button', { name: 'Preview' })

    // aria-disabled, never the `disabled` attribute: a disabled button cannot
    // be focused, so its reason would be unreachable from the keyboard.
    expect(preview).toHaveAttribute('aria-disabled', 'true')
    expect(preview).not.toBeDisabled()
    expect(preview).toHaveAccessibleDescription(REASON)

    await userEvent.click(preview)
    expect(onChange).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(REASON)
  })

  it('switches to a mode that is available', async () => {
    const onChange = renderToggle()
    await userEvent.click(screen.getByRole('button', { name: 'Code' }))
    expect(onChange).toHaveBeenCalledWith('code')
  })
})
