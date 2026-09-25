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
        lastRenderMs={null}
        live={false}
        activePage="templates"
        onNavigate={() => {}}
        {...props}
      />
    </TooltipProvider>,
  )
}

describe('GlobalHeader brand', () => {
  it('links home through the Swarm lockup and the product name', () => {
    renderHeader()
    // The name algorithm joins inline siblings without a space, so match the
    // two parts rather than one exact string.
    const home = screen.getByRole('link', { name: /^Swarm\s*Email Template Studio$/ })
    expect(home).toHaveAttribute('href', '/')
    expect(screen.getByRole('img', { name: 'Swarm' })).toBeInTheDocument()
  })
})

describe('GlobalHeader identity', () => {
  it('names the workspace when nobody is signed in, as it always has', () => {
    renderHeader()
    expect(screen.getByRole('img', { name: 'Signed in to meridian-platform' })).toHaveTextContent('MP')
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })

  it('names the PERSON once the API reports one', () => {
    // The whole point of ADR-31: the avatar, the send log and D1's created_by
    // column all stop saying `shared-password` and start naming a human.
    renderHeader({ signedInAs: 'jericho.delrosario@swarm.work' })
    const avatar = screen.getByRole('img', { name: 'Signed in as jericho.delrosario@swarm.work' })
    expect(avatar).toHaveTextContent('JD')
  })

  it('offers sign out only when there is something to sign out of', async () => {
    const onSignOut = vi.fn()
    renderHeader({ signedInAs: 'echo@swarm.work', onSignOut })
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })

  it('hides sign out when the mode has no session of its own to end', () => {
    // Cloudflare Access and the shared password both land here: under Access the
    // identity provider owns signing out, and under the password there is no
    // person to sign out.
    renderHeader({ signedInAs: 'echo@swarm.work' })
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
  })
})

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
          lastRenderMs={24}
          live
          activePage="templates"
          onNavigate={() => {}}
        />
      </TooltipProvider>,
    )
    expect(screen.getByText(/render worker/)).toHaveTextContent('LIVE · render worker 24 ms')
  })

  it('carries no environment badge: it said "Local" everywhere, production included', () => {
    renderHeader()
    // The render pill still starts with "Local ·"; a badge would be the bare word.
    expect(screen.queryByText('Local', { exact: true })).not.toBeInTheDocument()
  })

  it('names the avatar with a role that can carry a name', () => {
    renderHeader()
    expect(screen.getByRole('img', { name: 'Signed in to meridian-platform' })).toHaveTextContent('MP')
  })
})
