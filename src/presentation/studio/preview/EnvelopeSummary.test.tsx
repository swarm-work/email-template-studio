// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { TemplateEnvelope } from '@/domain'
import { EnvelopeSummary } from './EnvelopeSummary'

const ENVELOPE: TemplateEnvelope = {
  subject: 'Verify your email address',
  preheader: 'One click and you are in',
  replyTo: '',
}

describe('EnvelopeSummary', () => {
  it('shows the draft envelope and the fixed sample recipient', () => {
    render(<EnvelopeSummary envelope={ENVELOPE} fallbackSubject="Saved subject" from="studio@example.test" />)

    expect(screen.getByText('Verify your email address')).toBeInTheDocument()
    expect(screen.getByText('One click and you are in')).toBeInTheDocument()
    expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument()
    expect(screen.getByText(/ada@example.com/)).toBeInTheDocument()
    // The sender comes from the send server, not from the template.
    expect(screen.getByText('studio@example.test')).toBeInTheDocument()
  })

  it('falls back to the saved subject and says an empty preheader is empty', () => {
    render(
      <EnvelopeSummary
        envelope={{ subject: '   ', preheader: '', replyTo: '' }}
        fallbackSubject="Saved subject"
        from="studio@example.test"
      />,
    )
    expect(screen.getByText('Saved subject')).toBeInTheDocument()
    expect(screen.getByText('No preheader text.')).toBeInTheDocument()
  })

  it('names no sender while the send server is not connected', () => {
    render(<EnvelopeSummary envelope={ENVELOPE} fallbackSubject="Saved subject" from={null} />)
    expect(screen.getByText('— Set by the send server.')).toBeInTheDocument()
  })
})
