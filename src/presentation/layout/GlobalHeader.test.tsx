// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { GlobalHeader } from './GlobalHeader'

function renderHeader(props: Partial<Parameters<typeof GlobalHeader>[0]> = {}) {
  return render(
    <TooltipProvider>
      <GlobalHeader
        workspace="meridian-platform"
        environment="Local"
        lastRenderMs={null}
        live={false}
        activePage="templates"
        onNavigate={() => {}}
        {...props}
      />
    </TooltipProvider>,
  )
}

describe('GlobalHeader', () => {
  it('marks exactly the active page with aria-current', () => {
    renderHeader({ activePage: 'templates' })

    expect(screen.getByRole('button', { name: 'Template Studio' })).toHaveAttribute('aria-current', 'page')
    const current = screen
      .getAllByRole('button')
      .filter((button) => button.getAttribute('aria-current') === 'page')
    expect(current).toHaveLength(1)
  })

  it('navigates to a page that exists and only explains the ones that do not', async () => {
    const onNavigate = vi.fn()
    renderHeader({ onNavigate })

    await userEvent.click(screen.getByRole('button', { name: 'API Keys & Webhooks' }))
    expect(onNavigate).toHaveBeenCalledWith('api')

    onNavigate.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Domains' }))
    expect(onNavigate).not.toHaveBeenCalled()
  })

  it('gives every planned control a reason, not just a disabled state', () => {
    renderHeader()

    const planned = screen.getByRole('button', { name: 'Domains' })
    expect(planned).toHaveAttribute('aria-disabled', 'true')
    expect(planned).toHaveAccessibleDescription('Planned for a later milestone.')
    expect(screen.getByRole('button', { name: 'Feedback' })).toHaveAccessibleDescription(
      'Planned for a later milestone.',
    )
  })

  it('only says LIVE when the send server reports itself connected', () => {
    const { rerender } = renderHeader()
    expect(screen.getByText(/render worker/)).toHaveTextContent('Local · render worker —')

    rerender(
      <TooltipProvider>
        <GlobalHeader
          workspace="meridian-platform"
          environment="Local"
          lastRenderMs={24}
          live
          activePage="templates"
          onNavigate={() => {}}
        />
      </TooltipProvider>,
    )
    expect(screen.getByText(/render worker/)).toHaveTextContent('LIVE · render worker 24 ms')
  })

  it('names the avatar with a role that can carry a name', () => {
    renderHeader()
    expect(screen.getByRole('img', { name: 'Signed in to meridian-platform' })).toHaveTextContent('MP')
  })
})
