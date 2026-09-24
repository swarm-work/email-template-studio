// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SwarmLogo } from './SwarmLogo'

function sourcesIn(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('img')).map((img) => img.getAttribute('src'))
}

describe('SwarmLogo', () => {
  it('is one named image for assistive tech, whichever theme is on', () => {
    render(<SwarmLogo />)
    // The two <img> children are decorative; the wrapper is the one thing
    // that gets announced, so a screen reader never hears "Swarm" twice.
    expect(screen.getAllByRole('img')).toHaveLength(1)
    expect(screen.getByRole('img', { name: 'Swarm' })).toBeInTheDocument()
  })

  it('serves the brand kit files for both themes', () => {
    const { container } = render(<SwarmLogo />)
    expect(sourcesIn(container)).toEqual([
      '/logos/swarm-lockup-primary-on-light.svg',
      '/logos/swarm-lockup-primary-on-dark.svg',
    ])
  })

  it('uses the compact badge when asked', () => {
    const { container } = render(<SwarmLogo variant="badge" />)
    expect(sourcesIn(container)).toEqual(['/logos/swarm-badge-violet.svg', '/logos/swarm-badge-white.svg'])
  })
})
