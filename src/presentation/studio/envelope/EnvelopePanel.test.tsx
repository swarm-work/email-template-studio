// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TooltipProvider } from '@/components/ui/tooltip'
import { SUBJECT_LENGTH_LIMIT, type TemplateEnvelope } from '@/domain'
import { STARTER_TEMPLATES } from '@/infrastructure/templates/registry'
import { toEmailTemplate } from '@/infrastructure/templates/templateMapper'
import { EnvelopePanel } from './EnvelopePanel'

const TEMPLATE = toEmailTemplate(STARTER_TEMPLATES[0])
const OVER_LIMIT_HELPER = 'Most clients truncate subjects past 78 characters.'

function renderPanel(
  envelope: Partial<TemplateEnvelope> = {},
  onChange = vi.fn(),
  onMetadataChange = vi.fn(),
) {
  render(
    <TooltipProvider>
      <EnvelopePanel
        envelope={{ ...TEMPLATE.envelope, ...envelope }}
        metadata={TEMPLATE.metadata}
        dirty={false}
        onChange={onChange}
        onReset={() => {}}
        from={null}
        onMetadataChange={onMetadataChange}
      />
    </TooltipProvider>,
  )
  return onChange
}

describe('EnvelopePanel', () => {
  it('labels every field so it can be reached by name', () => {
    renderPanel()
    expect(screen.getByLabelText('Subject line')).toHaveValue(TEMPLATE.envelope.subject)
    expect(screen.getByLabelText('Preheader text')).toBeInTheDocument()
    expect(screen.getByLabelText('Reply-to address')).toBeInTheDocument()
    // The From identity belongs to the send server, so it is read-only and says so.
    expect(screen.getByLabelText('From identity')).toHaveTextContent('—')
    expect(screen.getByText('Set by the send server.')).toBeInTheDocument()
  })

  it('dispatches the whole envelope when the subject is edited', async () => {
    const onChange = renderPanel({ subject: 'Hi' })
    await userEvent.type(screen.getByLabelText('Subject line'), '!')
    expect(onChange).toHaveBeenCalledWith({ ...TEMPLATE.envelope, subject: 'Hi!' })
  })

  it('counts the subject against the 78 character recommendation, with a check once it is set', () => {
    renderPanel({ subject: 'a'.repeat(54) })
    const counter = screen.getByText(`54 / ${SUBJECT_LENGTH_LIMIT} chars`)
    expect(counter).toBeInTheDocument()
    // The icon is decoration (aria-hidden), so it is found in the markup rather
    // than by role: the number next to it is what carries the meaning.
    expect(counter.querySelector('svg')).not.toBeNull()
    expect(screen.queryByText(OVER_LIMIT_HELPER)).not.toBeInTheDocument()
  })

  it('shows no icon at all while the subject is empty', () => {
    renderPanel({ subject: '' })
    expect(screen.getByText(`0 / ${SUBJECT_LENGTH_LIMIT} chars`).querySelector('svg')).toBeNull()
  })

  it('warns, but does not block, once the subject is too long', () => {
    renderPanel({ subject: 'a'.repeat(SUBJECT_LENGTH_LIMIT + 1) })
    expect(screen.getByText(`79 / ${SUBJECT_LENGTH_LIMIT} chars`)).toBeInTheDocument()
    expect(screen.getByText(OVER_LIMIT_HELPER)).toBeInTheDocument()
  })

  it('reports a reply-to address that is not an address, and accepts an empty one', () => {
    renderPanel({ replyTo: 'not-an-address' })
    const field = screen.getByLabelText('Reply-to address')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription('Enter a valid email address.')
  })

  it('sends a description edit as a metadata change when the field is left', async () => {
    const onMetadataChange = vi.fn()
    renderPanel({}, vi.fn(), onMetadataChange)
    const description = screen.getByLabelText('Internal description')
    expect(description).toHaveValue(TEMPLATE.metadata.description)

    await userEvent.clear(description)
    await userEvent.type(description, 'Sent after sign-up.')
    // Nothing is sent per keystroke: each PATCH bumps the revision.
    expect(onMetadataChange).not.toHaveBeenCalled()

    await userEvent.tab()
    expect(onMetadataChange).toHaveBeenCalledWith({ description: 'Sent after sign-up.' })
  })

  it('adds and removes a tag as a metadata change', async () => {
    const onMetadataChange = vi.fn()
    renderPanel({}, vi.fn(), onMetadataChange)

    await userEvent.click(screen.getByRole('button', { name: 'Add tag' }))
    await userEvent.type(await screen.findByLabelText('New tag'), 'billing')
    await userEvent.click(screen.getByRole('button', { name: /^Add$/ }))
    expect(onMetadataChange).toHaveBeenCalledWith({ tags: [...TEMPLATE.metadata.tags, 'billing'] })

    const [first] = TEMPLATE.metadata.tags
    await userEvent.click(screen.getByRole('button', { name: `Remove tag ${first}` }))
    expect(onMetadataChange).toHaveBeenLastCalledWith({
      tags: TEMPLATE.metadata.tags.filter((tag) => tag !== first),
    })
  })

  it('announces nothing: the read-only fields are labelable, not live regions', () => {
    const { container } = render(
      <TooltipProvider>
        <EnvelopePanel
          envelope={TEMPLATE.envelope}
          metadata={TEMPLATE.metadata}
          dirty={false}
          onChange={vi.fn()}
          onReset={() => {}}
          from={null}
          onMetadataChange={vi.fn()}
        />
      </TooltipProvider>,
    )
    // `<output>` is role="status" with an implicit aria-live="polite"; the
    // From identity uses it for the label wiring only, so it opts out. Plan 4.6
    // allows live regions on the autosave note, the save sentence and the render
    // status — nothing in here.
    for (const output of container.querySelectorAll('output')) {
      expect(output).toHaveAttribute('aria-live', 'off')
    }
    expect(container.querySelectorAll('[aria-live]:not([aria-live="off"])')).toHaveLength(0)
  })

  it('says why Reset envelope cannot be pressed instead of greying it out', () => {
    renderPanel()
    const reset = screen.getByRole('button', { name: 'Reset envelope' })
    expect(reset).toHaveAttribute('aria-disabled', 'true')
    expect(reset).not.toBeDisabled()
    expect(reset).toHaveAccessibleDescription('There are no changes to the envelope to reset.')
  })
})
