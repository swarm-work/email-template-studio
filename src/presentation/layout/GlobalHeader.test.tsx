// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { TooltipProvider } from '@/components/ui/tooltip'
import { GlobalHeader } from './GlobalHeader'

const WORKSPACE = { slug: 'meridian-platform', name: 'meridian-platform' }

function renderHeader(
  props: Partial<Parameters<typeof GlobalHeader>[0]> = {},
  path = '/w/meridian-platform/templates',
) {
  return render(
    // The nav is links, so the header needs a router to render at all; the
    // memory router also decides which link is the current page.
    <MemoryRouter initialEntries={[path]}>
      <TooltipProvider>
        <GlobalHeader workspace={WORKSPACE} lastRenderMs={null} live={false} {...props} />
      </TooltipProvider>
    </MemoryRouter>,
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

describe('GlobalHeader navigation', () => {
  it('links every enabled screen under the current workspace and marks the open one', () => {
    renderHeader({}, '/w/meridian-platform/templates')

    const studio = screen.getByRole('link', { name: 'Template Studio' })
    expect(studio).toHaveAttribute('href', '/w/meridian-platform/templates')
    expect(studio).toHaveAttribute('aria-current', 'page')

    const api = screen.getByRole('link', { name: 'API Keys & Webhooks' })
    expect(api).toHaveAttribute('href', '/w/meridian-platform/api')
    expect(api).not.toHaveAttribute('aria-current')
  })

  it('follows the URL, not a prop, for which page is current', () => {
    renderHeader({}, '/w/meridian-platform/api')
    expect(screen.getByRole('link', { name: 'API Keys & Webhooks' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Template Studio' })).not.toHaveAttribute('aria-current')
  })

  it('shows the workspace switcher in place of the plain label when given one', () => {
    renderHeader({ workspaceSwitcher: <button type="button">Pick a workspace</button> })
    expect(screen.getByRole('button', { name: 'Pick a workspace' })).toBeInTheDocument()
    expect(screen.queryByText('meridian-platform', { selector: 'span' })).not.toBeInTheDocument()
  })

  it('gives the planned control a reason, not just a disabled state', () => {
    renderHeader()
    const planned = screen.getByRole('button', { name: 'Overview & Logs' })
    expect(planned).toHaveAttribute('aria-disabled', 'true')
    expect(planned).toHaveAccessibleDescription('Planned for a later milestone.')
  })

  it('lists exactly the three product areas, with no Docs, Feedback or Domains', () => {
    renderHeader()
    const nav = screen.getByRole('navigation', { name: 'Product' })
    // The planned item is a button, the two real screens are links; the order
    // on screen is what matters.
    expect(Array.from(nav.querySelectorAll('a, button')).map((item) => item.textContent)).toEqual([
      'Overview & Logs',
      'API Keys & Webhooks',
      'Template Studio',
    ])
    expect(within(nav).getAllByRole('link')).toHaveLength(2)
    expect(screen.queryByRole('link', { name: /Docs/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Feedback' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Domains' })).not.toBeInTheDocument()
  })

  it('only says LIVE when the send server reports itself connected', () => {
    const { rerender } = renderHeader()
    expect(screen.getByText(/render worker/)).toHaveTextContent('Local · render worker —')

    rerender(
      <MemoryRouter initialEntries={['/w/meridian-platform/templates']}>
        <TooltipProvider>
          <GlobalHeader workspace={WORKSPACE} lastRenderMs={24} live />
        </TooltipProvider>
      </MemoryRouter>,
    )
    expect(screen.getByText(/render worker/)).toHaveTextContent('LIVE · render worker 24 ms')
  })

  it('carries no environment badge: it said "Local" everywhere, production included', () => {
    renderHeader()
    // The render pill still starts with "Local ·"; a badge would be the bare word.
    expect(screen.queryByText('Local', { exact: true })).not.toBeInTheDocument()
  })
})
