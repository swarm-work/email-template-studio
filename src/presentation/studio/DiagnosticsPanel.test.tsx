// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { buildDiagnostics } from '@/application/buildDiagnostics'
import { DiagnosticsPanel } from './DiagnosticsPanel'

describe('DiagnosticsPanel', () => {
  it('separates real checks from placeholders and summarises errors', () => {
    const items = buildDiagnostics({
      validation: { ok: false, kind: 'schema', issues: [{ path: 'recipientName', message: 'Required' }] },
      renderStatus: 'blocked',
      renderResult: null,
      kind: 'code',
      contentDirty: false,
      payloadDirty: true,
    })
    render(<DiagnosticsPanel items={items} />)

    const region = screen.getByRole('region', { name: 'Diagnostics' })
    expect(within(region).getByText('1 error')).toBeInTheDocument()
    expect(within(region).getByText('Preview payload')).toBeInTheDocument()
    expect(within(region).getByText(/Schema invalid\. recipientName: Required/)).toBeInTheDocument()

    // Placeholder checks are behind the collapsed deliverability section and never claim to pass.
    expect(screen.queryByText('SPF / DKIM / DMARC')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Deliverability · not connected/ })).toBeInTheDocument()
  })
})
