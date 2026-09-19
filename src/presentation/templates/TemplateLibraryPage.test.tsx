// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { STARTER_TEMPLATES } from '@/infrastructure/templates/registry'
import { toEmailTemplate } from '@/infrastructure/templates/templateMapper'
import { TemplateLibraryPage } from './TemplateLibraryPage'

const TEMPLATES = STARTER_TEMPLATES.map(toEmailTemplate)

function renderPage(props: Partial<Parameters<typeof TemplateLibraryPage>[0]> = {}) {
  return render(
    <TooltipProvider>
      <TemplateLibraryPage
        templates={TEMPLATES}
        dirtyIds={new Set()}
        onOpenTemplate={() => {}}
        onCreateTemplate={async () => null}
        onDeleteTemplate={async () => {}}
        {...props}
      />
    </TooltipProvider>,
  )
}

describe('TemplateLibraryPage', () => {
  it('lists every template with its metadata and badges the modified ones', () => {
    renderPage({ dirtyIds: new Set([TEMPLATES[0].metadata.id]) })

    const cards = screen.getAllByRole('button', { name: /^Open / })
    expect(cards).toHaveLength(TEMPLATES.length)
    const modified = screen.getByRole('button', { name: `Open ${TEMPLATES[0].metadata.name}` })
    expect(modified).toHaveTextContent('Modified')
    expect(screen.getByRole('button', { name: `Open ${TEMPLATES[1].metadata.name}` })).not.toHaveTextContent(
      'Modified',
    )
    // A card is an action, not a selection that stays switched on.
    expect(cards[0]).not.toHaveAttribute('aria-pressed')
    expect(screen.getByText('password-reset.email.tsx')).toBeInTheDocument()
    expect(screen.getByText('v5')).toBeInTheDocument()
    // The kind chip is per card, and the library ships both kinds.
    const codeCount = TEMPLATES.filter((template) => template.kind === 'code').length
    expect(screen.getAllByText('Code')).toHaveLength(codeCount)
    expect(screen.getAllByText('Visual')).toHaveLength(TEMPLATES.length - codeCount)
  })

  it('calls onOpenTemplate with the template id when a card is activated', async () => {
    const onOpenTemplate = vi.fn()
    renderPage({ onOpenTemplate })
    await userEvent.click(screen.getByRole('button', { name: 'Open Team invitation' }))
    expect(onOpenTemplate).toHaveBeenCalledWith(TEMPLATES[2].metadata.id)
  })

  it('narrows the grid as you type and offers a way back', async () => {
    renderPage()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search templates' }), 'password')
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(1)

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search templates' }))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search templates' }), 'invoice')
    expect(screen.getByText('No templates match "invoice".')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.getAllByRole('button', { name: /^Open / })).toHaveLength(TEMPLATES.length)
  })

  it('opens the create dialog from "New template"', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'New template' }))
    const dialog = await screen.findByRole('dialog', { name: 'New template' })
    expect(dialog).toBeInTheDocument()
    // Blank is the default start, and the kind is a real choice.
    expect(screen.getByRole('radio', { name: /Visual/ })).toBeChecked()
  })

  it('opens the delete dialog from a card\u2019s overflow menu', async () => {
    renderPage()
    await userEvent.click(
      screen.getByRole('button', { name: `More actions for ${TEMPLATES[0].metadata.name}` }),
    )
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete template…' }))
    expect(await screen.findByRole('dialog', { name: /^Delete/ })).toBeInTheDocument()
    // Typing the slug is what unlocks it; nothing is destroyed by one click.
    expect(screen.getByRole('button', { name: 'Delete template' })).toBeDisabled()
  })

  it('shows the empty state when there is nothing to list', () => {
    renderPage({ templates: [] })
    expect(screen.getByText('No templates yet')).toBeInTheDocument()
    expect(screen.getByText('Create a template to start authoring email.')).toBeInTheDocument()
  })
})
