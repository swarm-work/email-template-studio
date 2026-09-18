// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { STARTER_TEMPLATES } from '@/infrastructure/templates/registry'
import { toEmailTemplate } from '@/infrastructure/templates/templateMapper'
import { TemplateLibrary } from './TemplateLibrary'

const TEMPLATES = STARTER_TEMPLATES.map(toEmailTemplate)

describe('TemplateLibrary', () => {
  it('lists every template with its metadata and marks the selected one', () => {
    render(
      <TemplateLibrary
        templates={TEMPLATES}
        selectedId={TEMPLATES[1].metadata.id}
        dirtyIds={new Set([TEMPLATES[0].metadata.id])}
        onSelect={() => {}}
      />,
    )
    const cards = screen.getAllByRole('button')
    expect(cards).toHaveLength(TEMPLATES.length)
    expect(cards[1]).toHaveAttribute('aria-pressed', 'true')
    expect(cards[0]).toHaveAttribute('aria-pressed', 'false')
    expect(cards[0]).toHaveTextContent('Modified')
    expect(cards[1]).not.toHaveTextContent('Modified')
    expect(screen.getByText('password-reset.email.tsx')).toBeInTheDocument()
    expect(screen.getByText('v5')).toBeInTheDocument()
  })

  it('calls onSelect with the template id when a card is activated', async () => {
    const onSelect = vi.fn()
    render(
      <TemplateLibrary
        templates={TEMPLATES}
        selectedId={TEMPLATES[0].metadata.id}
        dirtyIds={new Set()}
        onSelect={onSelect}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Team invitation/ }))
    expect(onSelect).toHaveBeenCalledWith(TEMPLATES[2].metadata.id)
  })
})
