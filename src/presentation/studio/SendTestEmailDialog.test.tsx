// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DEFAULT_STUDIO_FEATURES } from '@/domain'
import {
  HttpTestEmailProvider,
  NoSendEmailProvider,
  type EmailProvider,
  type OutgoingTestEmail,
  type ProviderStatus,
  type SendOutcome,
} from '@/infrastructure/providers/emailProvider'
import { STARTER_TEMPLATES } from '@/infrastructure/templates/registry'
import { toEmailTemplate } from '@/infrastructure/templates/templateMapper'
import { SendTestEmailDialog } from './SendTestEmailDialog'

const TEMPLATES = STARTER_TEMPLATES.map(toEmailTemplate)

interface FakeOptions {
  readonly messageId?: string
  readonly mode?: 'live' | 'dry-run'
  readonly recipientPolicy?: 'any' | 'allow-list'
  /** What the fake server reports; the real server sends false only on production (ADR-41). */
  readonly testSubjectPrefix?: boolean
}

/** Connected provider that records what it was asked to send. */
class FakeConnectedProvider implements EmailProvider {
  readonly id = 'fake'
  readonly label = 'Fake provider'
  readonly sent: OutgoingTestEmail[] = []
  private readonly options: FakeOptions

  constructor(options: FakeOptions = {}) {
    this.options = options
  }

  async getStatus(): Promise<ProviderStatus> {
    return {
      connected: true,
      features: DEFAULT_STUDIO_FEATURES,
      provider: 'fake',
      mode: this.options.mode ?? 'dry-run',
      from: 'studio@example.test',
      recipientPolicy: this.options.recipientPolicy ?? 'any',
      allowedRecipients: ['qa@example.test'],
      maxRecipientsPerSend: 10,
      testSubjectPrefix: this.options.testSubjectPrefix ?? true,
      region: 'us-east-1',
    }
  }

  async send(email: OutgoingTestEmail): Promise<SendOutcome> {
    this.sent.push(email)
    return {
      status: 'sent',
      mode: this.options.mode ?? 'dry-run',
      messageId: this.options.messageId ?? 'dry-run-1',
      to: [...email.to],
      from: 'studio@example.test',
      // Echoes "[TEST] " only when this fake is set to add it, as the real server
      // does. Unlike the real server it does not skip a subject that already
      // starts with [TEST]; no test here types one or reads this subject back.
      subject: this.options.testSubjectPrefix === false ? email.subject : `[TEST] ${email.subject}`,
      sentAt: new Date().toISOString(),
    }
  }
}

function renderDialog(provider: EmailProvider, overrides: { replyTo?: string; subject?: string } = {}) {
  render(
    <SendTestEmailDialog
      open
      onOpenChange={() => {}}
      template={TEMPLATES[0]}
      provider={provider}
      // Already resolved by StudioPage (ADR-26): the dialog never substitutes.
      subject={overrides.subject ?? TEMPLATES[0].envelope.subject}
      replyTo={overrides.replyTo ?? ''}
      html="<p>x</p>"
      text="x"
    />,
  )
}

describe('SendTestEmailDialog', () => {
  it('keeps sending disabled and explains why when no provider is connected', async () => {
    renderDialog(new NoSendEmailProvider())
    expect(await screen.findByText('Sending is unavailable')).toBeInTheDocument()
    expect(screen.getByText(/Sending is disabled/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Send test/ })).toBeDisabled()
    expect(screen.getByText('Not connected')).toBeInTheDocument()
  })

  it('wraps a long message id so it cannot widen the dialog', async () => {
    // jsdom does not lay out, so the check is on the class that makes the
    // unbreakable id wrap; the e2e test measures the real dialog width.
    const messageId = 'a'.repeat(70)
    expect(messageId).toHaveLength(70)
    renderDialog(new FakeConnectedProvider({ messageId }))

    await screen.findByLabelText('To')
    await userEvent.type(screen.getByLabelText('To'), 'qa@example.test')
    const sendButton = screen.getByRole('button', { name: /^Send test$/ })
    expect(sendButton).toBeEnabled()
    await userEvent.click(sendButton)

    expect(await screen.findByText('Dry run complete')).toBeInTheDocument()
    expect(screen.getByText(messageId)).toHaveClass('break-all')
  })

  it('names an address that is not an address and keeps sending disabled', async () => {
    renderDialog(new FakeConnectedProvider())

    await screen.findByLabelText('To')
    await userEvent.type(screen.getByLabelText('To'), 'not-an-email')
    expect(await screen.findByText('Check this address: not-an-email.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Send test$/ })).toBeDisabled()
  })

  it('sends every address that was typed, with the subject as edited', async () => {
    const provider = new FakeConnectedProvider()
    renderDialog(provider)

    await screen.findByLabelText('To')
    await userEvent.type(screen.getByLabelText('To'), 'ada@example.test, grace@example.test')
    await userEvent.clear(screen.getByLabelText('Subject'))
    // The trailing space also pins the trim the dialog does before sending.
    await userEvent.type(screen.getByLabelText('Subject'), 'Custom subject ')
    await userEvent.click(screen.getByRole('button', { name: /^Send test$/ }))

    expect(await screen.findByText('Dry run complete')).toBeInTheDocument()
    expect(provider.sent).toHaveLength(1)
    // Asserted whole, so a subject taken from the template instead of the field
    // (which would make the field decorative) fails here.
    expect(provider.sent[0]).toEqual({
      to: ['ada@example.test', 'grace@example.test'],
      subject: 'Custom subject',
      html: '<p>x</p>',
      text: 'x',
      replyTo: undefined,
      templateId: TEMPLATES[0].metadata.id,
    })
  })

  it('seeds Reply-to from the envelope and sends it', async () => {
    const provider = new FakeConnectedProvider()
    renderDialog(provider, { replyTo: 'support@example.test' })

    const replyTo = await screen.findByLabelText('Reply-to')
    expect(replyTo).toHaveValue('support@example.test')

    await userEvent.type(screen.getByLabelText('To'), 'qa@example.test')
    await userEvent.click(screen.getByRole('button', { name: /^Send test$/ }))

    expect(await screen.findByText('Dry run complete')).toBeInTheDocument()
    expect(provider.sent[0].replyTo).toEqual(['support@example.test'])
  })

  it('refuses to send while Reply-to is not an address', async () => {
    renderDialog(new FakeConnectedProvider())

    await screen.findByLabelText('To')
    await userEvent.type(screen.getByLabelText('To'), 'qa@example.test')
    await userEvent.type(screen.getByLabelText('Reply-to'), 'not-an-email')

    expect(await screen.findByText('Check this address: not-an-email.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Send test$/ })).toBeDisabled()
  })

  it('sends no reply-to at all when the field is left empty', async () => {
    const provider = new FakeConnectedProvider()
    renderDialog(provider)

    await screen.findByLabelText('To')
    await userEvent.type(screen.getByLabelText('To'), 'qa@example.test')
    await userEvent.click(screen.getByRole('button', { name: /^Send test$/ }))

    expect(await screen.findByText('Dry run complete')).toBeInTheDocument()
    expect(provider.sent[0].replyTo).toBeUndefined()
  })

  it('says how big both parts of the message are', async () => {
    renderDialog(new FakeConnectedProvider())
    expect(await screen.findByText('Current preview, 0.0 KB HTML + 0.0 KB plain text')).toBeInTheDocument()
  })

  it("warns about an address the server's allow-list does not have", async () => {
    renderDialog(new FakeConnectedProvider({ recipientPolicy: 'allow-list' }))

    await screen.findByLabelText('To')
    await userEvent.type(screen.getByLabelText('To'), 'stranger@example.test')

    expect(
      await screen.findByText("stranger@example.test is not in the server's allow-list."),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Send test$/ })).toBeDisabled()
  })

  it('refuses to send without a subject line', async () => {
    renderDialog(new FakeConnectedProvider())

    await screen.findByLabelText('To')
    await userEvent.type(screen.getByLabelText('To'), 'qa@example.test')
    await userEvent.clear(screen.getByLabelText('Subject'))

    expect(await screen.findByText('Add a subject line to send a test.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Send test$/ })).toBeDisabled()
  })

  it('asks for a second click before a live send', async () => {
    const provider = new FakeConnectedProvider({ mode: 'live', messageId: 'ses-1' })
    renderDialog(provider)

    await screen.findByLabelText('To')
    await userEvent.type(screen.getByLabelText('To'), 'ada@example.test, grace@example.test')
    await userEvent.click(screen.getByRole('button', { name: /^Send test$/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This sends a real email to 2 addresses: ada@example.test, grace@example.test.',
    )
    expect(provider.sent).toHaveLength(0)

    await userEvent.click(screen.getByRole('button', { name: 'Confirm send' }))
    expect(await screen.findByText('Test email sent')).toBeInTheDocument()
    expect(provider.sent).toHaveLength(1)
  })

  // Without this, someone could confirm one address, edit the field, and the
  // second click would send to an address they never saw confirmed.
  it('takes the confirmation back when either field is edited', async () => {
    const provider = new FakeConnectedProvider({ mode: 'live', messageId: 'ses-2' })
    renderDialog(provider)

    await screen.findByLabelText('To')
    await userEvent.type(screen.getByLabelText('To'), 'ada@example.test')
    await userEvent.click(screen.getByRole('button', { name: /^Send test$/ }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('To'), ', grace@example.test')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Send test$/ })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: /^Send test$/ }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Subject'), '!')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(provider.sent).toHaveLength(0)

    // Confirming after the edits sends both addresses, the ones just confirmed.
    await userEvent.click(screen.getByRole('button', { name: /^Send test$/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirm send' }))
    expect(await screen.findByText('Test email sent')).toBeInTheDocument()
    expect(provider.sent[0].to).toEqual(['ada@example.test', 'grace@example.test'])
  })

  describe('the [TEST] marker next to the subject', () => {
    it('is shown when the connected server says it adds the prefix', async () => {
      renderDialog(new FakeConnectedProvider({ testSubjectPrefix: true }))
      await screen.findByLabelText('To')
      expect(screen.getByText('[TEST]', { exact: true })).toBeInTheDocument()
    })

    it('is hidden once a connected server says it does not add the prefix', async () => {
      renderDialog(new FakeConnectedProvider({ testSubjectPrefix: false }))
      // Wait for the status first: the marker shows while it is still loading.
      await screen.findByText('studio@example.test')
      expect(screen.queryByText('[TEST]', { exact: true })).toBeNull()
    })

    it('is shown when an older server sends no testSubjectPrefix field', async () => {
      const stubFetch = (async () =>
        new Response(
          JSON.stringify({
            enabled: true,
            provider: 'amazon-ses',
            mode: 'dry-run',
            from: 'studio@example.test',
            allowedRecipients: ['qa@example.test'],
            region: 'us-east-1',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )) as typeof fetch
      renderDialog(new HttpTestEmailProvider('/api/send-test', stubFetch))
      await screen.findByText('studio@example.test')
      expect(screen.getByText('[TEST]', { exact: true })).toBeInTheDocument()
    })

    it('is shown when no server is connected', async () => {
      renderDialog(new NoSendEmailProvider())
      await screen.findByText('Sending is unavailable')
      expect(screen.getByText('[TEST]', { exact: true })).toBeInTheDocument()
    })
  })
})
