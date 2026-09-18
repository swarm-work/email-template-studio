// @vitest-environment jsdom
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { MergeFieldsPanel, NO_MERGE_FIELDS_MESSAGE } from './MergeFieldsPanel'

/**
 * The panel is controlled: it never keeps the payload, it hands a new string
 * back. This wrapper closes that loop, which is what lets a test type into a
 * value field and then read the JSON that came out.
 */
function Harness({
  keys,
  initialPayload = '{}',
  onInsert = () => {},
  onPayload,
}: {
  keys: readonly string[]
  initialPayload?: string
  onInsert?: (key: string) => void
  onPayload?: (text: string) => void
}) {
  const [payloadText, setPayloadText] = useState(initialPayload)
  return (
    <TooltipProvider>
      <MergeFieldsPanel
        keys={keys}
        payloadText={payloadText}
        onPayloadChange={(next) => {
          setPayloadText(next)
          onPayload?.(next)
        }}
        onInsert={onInsert}
      />
      <output data-testid="payload">{payloadText}</output>
    </TooltipProvider>
  )
}

function payload(): unknown {
  return JSON.parse(screen.getByTestId('payload').textContent ?? '{}')
}

describe('MergeFieldsPanel', () => {
  it('says what to do when there are no merge fields yet', () => {
    render(<Harness keys={[]} />)
    expect(screen.getByText(NO_MERGE_FIELDS_MESSAGE)).toBeInTheDocument()
    expect(screen.getByText('0 in document')).toBeInTheDocument()
  })

  it('counts the keys in the document and marks the ones with no value', () => {
    render(<Harness keys={['firstName', 'company']} initialPayload='{"firstName":"Ada"}' />)

    expect(screen.getByText('2 in document')).toBeInTheDocument()
    expect(screen.getByText('Not in payload')).toBeInTheDocument()
    expect(screen.queryByText('Unused')).not.toBeInTheDocument()
  })

  it('marks a payload key the document no longer uses as unused', () => {
    render(<Harness keys={['firstName']} initialPayload='{"firstName":"Ada","leftover":"x"}' />)

    expect(screen.getByText('1 in document')).toBeInTheDocument()
    expect(screen.getByText('Unused')).toBeInTheDocument()
    expect(screen.getByLabelText('{{leftover}}')).toHaveValue('x')
  })

  it('writes a typed sample value into the payload', async () => {
    render(<Harness keys={['firstName']} />)

    await userEvent.type(screen.getByLabelText('{{firstName}}'), 'Ada')
    expect(payload()).toEqual({ firstName: 'Ada' })
  })

  it('fills in every missing key at once', async () => {
    render(<Harness keys={['firstName', 'user.company']} initialPayload='{"firstName":"Ada"}' />)

    await userEvent.click(screen.getByRole('button', { name: 'Fill in missing keys' }))
    expect(payload()).toEqual({ firstName: 'Ada', user: { company: '' } })
  })

  it('counts an empty sample value as a value, like the diagnostics row does', async () => {
    render(<Harness keys={['firstName']} />)

    const fill = screen.getByRole('button', { name: 'Fill in missing keys' })
    await userEvent.click(fill)
    expect(payload()).toEqual({ firstName: '' })
    // The key now HAS a value - an empty one - so there is nothing left to fill.
    expect(screen.getByRole('button', { name: 'Fill in missing keys' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.queryByText('Not in payload')).not.toBeInTheDocument()
  })

  it('refuses to write over sample values it could not read', async () => {
    const onPayload = vi.fn()
    // One missing comma: what the JSON editor below looks like mid-edit.
    const broken = '{\n  "firstName": "Ada"\n  "company": "Acme"\n}'
    render(<Harness keys={['firstName']} initialPayload={broken} onPayload={onPayload} />)

    expect(screen.getByLabelText('{{firstName}}')).toHaveAttribute('readonly')
    await userEvent.type(screen.getByLabelText('{{firstName}}'), 'x')
    for (const name of ['Fill in missing keys', 'Add field']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-disabled', 'true')
    }
    expect(onPayload).not.toHaveBeenCalled()
    expect(screen.getByTestId('payload')).toHaveTextContent('Acme')
  })

  it('explains why filling in is not available when nothing is missing', async () => {
    render(<Harness keys={['firstName']} initialPayload='{"firstName":"Ada"}' />)

    const fill = screen.getByRole('button', { name: 'Fill in missing keys' })
    expect(fill).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getAllByText('Every merge field already has a value.').length).toBeGreaterThan(0)
  })

  it('inserts a chip on the canvas from a row', async () => {
    const onInsert = vi.fn()
    render(<Harness keys={['firstName']} onInsert={onInsert} />)

    await userEvent.click(screen.getByRole('button', { name: 'Insert {{firstName}}' }))
    expect(onInsert).toHaveBeenCalledWith('firstName')
  })

  it('adds a new field, inserting it and giving it a place in the payload', async () => {
    const onInsert = vi.fn()
    render(<Harness keys={[]} onInsert={onInsert} />)

    await userEvent.type(screen.getByLabelText('Add field'), 'orderNumber')
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }))

    expect(onInsert).toHaveBeenCalledWith('orderNumber')
    expect(payload()).toEqual({ orderNumber: '' })
  })

  it('refuses a name that could never be a merge field, and says why', async () => {
    const onInsert = vi.fn()
    render(<Harness keys={[]} onInsert={onInsert} />)

    await userEvent.type(screen.getByLabelText('Add field'), '1order')
    const add = screen.getByRole('button', { name: 'Add field' })
    expect(add).toHaveAttribute('aria-disabled', 'true')

    await userEvent.click(add)
    expect(onInsert).not.toHaveBeenCalled()
  })

  it('offers the sample values as JSON, which is the same payload', async () => {
    render(<Harness keys={['firstName']} initialPayload='{"firstName":"Ada"}' />)

    await userEvent.click(screen.getByRole('button', { name: 'Sample values (JSON)' }))
    expect(await screen.findByLabelText('Preview payload JSON')).toBeInTheDocument()
  })
})
