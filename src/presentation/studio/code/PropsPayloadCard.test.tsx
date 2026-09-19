// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { ValidationResult } from '@/domain'
import { PropsPayloadCard } from './PropsPayloadCard'

const SAMPLE = JSON.stringify({ recipientName: 'Ada' }, null, 2)
const VALID: ValidationResult = { ok: true, value: { recipientName: 'Ada' } }
/** Nothing required, nothing pinned: every derived preset is on offer. */
const NO_SCHEMA = '{}'

function renderCard(props: Partial<Parameters<typeof PropsPayloadCard>[0]> = {}) {
  const onPayloadChange = vi.fn()
  render(
    <TooltipProvider>
      <PropsPayloadCard
        validation={VALID}
        payloadDirty={false}
        onFormat={() => {}}
        onReset={() => {}}
        samplePayloadText={SAMPLE}
        propsSchemaText={NO_SCHEMA}
        payloadText={SAMPLE}
        onPayloadChange={onPayloadChange}
        {...props}
      />
    </TooltipProvider>,
  )
  return onPayloadChange
}

describe('PropsPayloadCard sample data picker', () => {
  it('starts on Default, because that is what the payload is', () => {
    renderCard()

    expect(screen.getByRole('combobox', { name: 'Sample data' })).toHaveTextContent('Default')
  })

  it('replaces the payload with the chosen preset', async () => {
    const onPayloadChange = renderCard()

    await userEvent.click(screen.getByRole('combobox', { name: 'Sample data' }))
    await userEvent.click(screen.getByRole('option', { name: 'Missing optional fields' }))

    expect(onPayloadChange).toHaveBeenCalledTimes(1)
    expect(JSON.parse(onPayloadChange.mock.calls[0]?.[0] as string)).toEqual({ recipientName: '' })
  })

  it('says Custom once the payload is something nobody picked', () => {
    renderCard({ payloadText: '{"recipientName": "Grace"}' })

    expect(screen.getByRole('combobox', { name: 'Sample data' })).toHaveTextContent('Custom')
  })

  it('hides the picker when the sample data is not a JSON object', () => {
    renderCard({ samplePayloadText: 'not json', payloadText: 'not json' })

    expect(screen.queryByRole('combobox', { name: 'Sample data' })).not.toBeInTheDocument()
  })

  it('hides the picker when the schema leaves nothing to vary', () => {
    // One required string: there is no optional key to drop, and stretching it
    // is the only variant left, so this template gets Default and Long values.
    renderCard({
      propsSchemaText: JSON.stringify({
        type: 'object',
        properties: { recipientName: { type: 'string', enum: ['Ada'] } },
        required: ['recipientName'],
      }),
    })

    expect(screen.queryByRole('combobox', { name: 'Sample data' })).not.toBeInTheDocument()
  })
})
