// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiKeysPage } from './ApiKeysPage'

function renderPage() {
  return render(<ApiKeysPage environment="Local" />)
}

describe('ApiKeysPage', () => {
  it('shows seeded credentials, webhooks and integration snippets', () => {
    renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'API Keys & Integration' })).toBeInTheDocument()
    expect(screen.getByText('Welcome emails sandbox')).toBeInTheDocument()
    expect(screen.getByText('st_local_K8m4q9d2…')).toBeInTheDocument()
    expect(screen.getByText('Delivery audit trail')).toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('fetch')
  })

  it('generates a show-once mock key and requires the stored checkbox before closing', async () => {
    vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
      if (!(array instanceof Uint8Array)) return array
      array.set([0, 1, 2, 3, 4, 5, 250, 251, 252, 253, 254, 255, 16, 17, 18, 19])
      return array
    })

    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Generate key' }))
    const dialog = screen.getByRole('dialog', { name: 'Generate API key' })

    await userEvent.click(within(dialog).getByRole('button', { name: 'Generate key' }))
    expect(within(dialog).getByText('st_local_AAECAwQF-vv8_f7_EBESEw')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeDisabled()

    await userEvent.click(within(dialog).getByRole('checkbox', { name: /I copied this key/ }))
    expect(within(dialog).getByRole('button', { name: 'Done' })).toBeEnabled()
    expect(screen.getByText('Transactional send key')).toBeInTheDocument()
  })

  it('adds a webhook endpoint with selected topics', async () => {
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: 'Add webhook' }))
    const dialog = screen.getByRole('dialog', { name: 'Add webhook endpoint' })

    await userEvent.clear(within(dialog).getByLabelText('Name'))
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Product event sink')
    await userEvent.clear(within(dialog).getByLabelText('Endpoint URL'))
    await userEvent.type(within(dialog).getByLabelText('Endpoint URL'), 'https://hooks.example.test/events')
    await userEvent.click(within(dialog).getByRole('button', { name: 'opened' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add endpoint' }))

    expect(screen.getByText('Product event sink')).toBeInTheDocument()
    expect(screen.getByText('https://hooks.example.test/events')).toBeInTheDocument()
  })
})
