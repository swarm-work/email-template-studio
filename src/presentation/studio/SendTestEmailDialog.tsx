import { useEffect, useState } from 'react'
import { Lock, Send } from 'lucide-react'
import { toast } from 'sonner'
import { parseRecipientList, recipientProblem } from '@/application/parseRecipientList'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { PREVIEW_SAMPLE_RECIPIENT, type EmailTemplate } from '@/domain'
import type { EmailProvider, ProviderStatus, SendOutcome } from '@/infrastructure/providers/emailProvider'
import { StatusBadge } from '@/presentation/shared/StatusBadge'

export interface SendTestEmailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  template: EmailTemplate
  provider: EmailProvider
  /** HTML of the last successful render; null means nothing can be sent yet. */
  html: string | null
}

/**
 * Styling for the one field that is still hand-rolled: the recipients box is a
 * `<textarea>` (several addresses, several lines), and shadcn's `textarea`
 * component arrives with the envelope panel in the next phase. The subject is
 * an `<Input>`. These classes match what `<Input>` renders, deliberately.
 */
const FIELD_CLASS =
  'border-input focus-visible:ring-ring/50 w-full rounded-md border bg-transparent px-2 py-1 text-xs shadow-xs outline-none focus-visible:ring-[3px]'

/** 12.5px helper/reason line from the design brief (disabled-with-reason). */
const HINT_CLASS = 'text-[12.5px] leading-[18px]'

/** Helper line under the To field. The cap is the server's, so it and the refusal reason always agree. */
const recipientHint = (max: number) =>
  `Separate multiple addresses with commas or line breaks. Up to ${max} per send; everyone listed can see the other addresses.`

const NO_SUBJECT_REASON = 'Add a subject line to send a test.'

/**
 * Sends one test email through the provider. The action is only enabled when
 * the provider reports it is connected AND there is rendered HTML to send.
 * Recipients are typed by hand; the server decides whether they are acceptable
 * (an allow-list, or any address when SES_ALLOWED_RECIPIENTS is "*").
 *
 * The form lives in its own component so that Radix unmounting the content on
 * close resets all state; every open starts with a fresh status check.
 */
export function SendTestEmailDialog({
  open,
  onOpenChange,
  template,
  provider,
  html,
}: SendTestEmailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Send test email</DialogTitle>
          <DialogDescription>
            Sends the current preview to the addresses you enter, through the send server. The browser never
            holds credentials.
          </DialogDescription>
        </DialogHeader>
        <SendTestEmailForm template={template} provider={provider} html={html} />
      </DialogContent>
    </Dialog>
  )
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; status: ProviderStatus }
  | { kind: 'sending'; status: ProviderStatus }

function SendTestEmailForm({
  template,
  provider,
  html,
}: Pick<SendTestEmailDialogProps, 'template' | 'provider' | 'html'>) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [recipientsText, setRecipientsText] = useState('')
  const [subjectText, setSubjectText] = useState(template.envelope.subject)
  /** Which template the subject above was seeded from, so a switch can re-seed it. */
  const [seededFrom, setSeededFrom] = useState(template.metadata.id)
  /** True once a live send has been asked for and is waiting for a second click. */
  const [confirming, setConfirming] = useState(false)
  const [outcome, setOutcome] = useState<SendOutcome | null>(null)

  // Selecting another template while the dialog is open re-seeds the subject.
  // Adjusting state during render (rather than in an effect) is React's own
  // recommendation for "a prop changed, reset some state".
  if (seededFrom !== template.metadata.id) {
    setSeededFrom(template.metadata.id)
    setSubjectText(template.envelope.subject)
    setConfirming(false)
  }

  useEffect(() => {
    let cancelled = false
    void provider.getStatus().then((status) => {
      if (cancelled) return
      setPhase({ kind: 'ready', status })
    })
    return () => {
      cancelled = true
    }
  }, [provider])

  const status = phase.kind === 'loading' ? null : phase.status
  const connected = status?.connected === true
  const senderKnownUnverified = status?.connected === true && status.preflight?.identityVerified === false

  // Only compare against the allow-list when the server actually has one.
  const list = parseRecipientList(
    recipientsText,
    status?.connected === true && status.recipientPolicy === 'allow-list'
      ? status.allowedRecipients
      : undefined,
  )
  // 10 only stands in until the status arrives; the field is disabled until then anyway.
  const maxRecipients = status?.connected === true ? status.maxRecipientsPerSend : 10
  const recipientReason = recipientProblem(list, maxRecipients)
  const subjectReason = subjectText.trim() === '' ? NO_SUBJECT_REASON : null
  const problem = recipientReason ?? subjectReason

  const canSend =
    connected && !senderKnownUnverified && html !== null && problem === null && phase.kind === 'ready'
  const htmlKilobytes = html === null ? null : (new TextEncoder().encode(html).length / 1024).toFixed(1)
  // A live send costs real deliverability, so it takes a second, explicit click.
  const needsConfirmation = status?.connected === true && status.mode === 'live'

  async function send() {
    if (!canSend || !status?.connected || html === null) return
    setConfirming(false)
    setPhase({ kind: 'sending', status })
    const result = await provider.send({
      to: [...list.addresses],
      subject: subjectText.trim(),
      html,
      templateId: template.metadata.id,
    })
    setOutcome(result)
    setPhase({ kind: 'ready', status })
    // Toasts survive closing the dialog, so a failure is never silently lost.
    if (result.status === 'sent') {
      toast.success(
        result.mode === 'dry-run'
          ? `Dry run complete (${result.messageId}). Nothing was sent.`
          : result.to.length === 1
            ? `Test email sent to ${result.to[0]}.`
            : `Test email sent to ${result.to.length} addresses.`,
      )
    } else {
      toast.error(result.message)
    }
  }

  return (
    <>
      {phase.kind === 'loading' ? (
        <p className="text-muted-foreground text-xs" role="status">
          Checking the send server…
        </p>
      ) : status && !status.connected ? (
        <Alert>
          <Lock aria-hidden="true" />
          <AlertTitle>Sending is unavailable</AlertTitle>
          <AlertDescription>{status.reason}</AlertDescription>
        </Alert>
      ) : null}

      {/* `minmax(0,1fr)` lets the value column shrink below its content's
          min-content width; a plain `1fr` (= minmax(auto,1fr)) would let a
          long email or the full-width field widen the track past the dialog. */}
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 text-xs">
        <dt className="meta-label self-start pt-1.5">
          <label htmlFor="send-test-recipient">To</label>
        </dt>
        <dd>
          {status?.connected ? (
            <>
              <textarea
                id="send-test-recipient"
                rows={2}
                spellCheck={false}
                autoComplete="off"
                placeholder="ada@example.com, grace@example.com"
                aria-describedby="send-test-recipient-hint"
                className={`${FIELD_CLASS} font-mono`}
                value={recipientsText}
                onChange={(event) => {
                  setRecipientsText(event.target.value)
                  setConfirming(false)
                }}
                disabled={phase.kind === 'sending'}
              />
              <p
                id="send-test-recipient-hint"
                className={`${HINT_CLASS} ${recipientReason ? 'text-warning-foreground' : 'text-muted-foreground'} mt-1.5`}
              >
                {recipientReason ?? recipientHint(maxRecipients)}
              </p>
            </>
          ) : (
            <span className="text-muted-foreground font-mono break-all">
              {PREVIEW_SAMPLE_RECIPIENT.address}
            </span>
          )}
        </dd>
        <dt className="meta-label">From</dt>
        <dd className="font-mono break-all">
          {status?.connected ? (
            status.from
          ) : (
            <span className="text-muted-foreground font-sans">Set by the send server.</span>
          )}
        </dd>
        <dt className="meta-label self-start pt-1.5">
          <label htmlFor="send-test-subject">Subject</label>
        </dt>
        <dd>
          <div className="flex items-center gap-2">
            {/* The server adds this prefix whatever is typed here. */}
            <span className="text-muted-foreground font-mono">[TEST]</span>
            <Input
              id="send-test-subject"
              type="text"
              maxLength={200}
              autoComplete="off"
              aria-describedby={subjectReason ? 'send-test-subject-hint' : undefined}
              className="h-7 px-2 py-1 text-xs md:text-xs"
              value={subjectText}
              onChange={(event) => {
                setSubjectText(event.target.value)
                setConfirming(false)
              }}
              disabled={phase.kind === 'sending'}
            />
          </div>
          {subjectReason ? (
            <p id="send-test-subject-hint" className={`${HINT_CLASS} text-warning-foreground mt-1.5`}>
              {subjectReason}
            </p>
          ) : null}
        </dd>
        <dt className="meta-label">Body</dt>
        <dd className={html === null ? 'text-danger-foreground' : ''}>
          {html === null
            ? 'No rendered HTML yet. Fix the template or payload first.'
            : `Current preview, ${htmlKilobytes} KB of HTML`}
        </dd>
        <dt className="meta-label">Provider</dt>
        <dd className="flex flex-wrap items-center gap-2">
          {provider.label}
          {status?.connected ? (
            <>
              <StatusBadge tone="success">Connected</StatusBadge>
              {status.mode === 'dry-run' ? (
                <StatusBadge tone="warning">Dry run</StatusBadge>
              ) : (
                <StatusBadge tone="info">Live</StatusBadge>
              )}
              <span className="text-muted-foreground font-mono">{status.region}</span>
            </>
          ) : (
            <StatusBadge tone="neutral">Not connected</StatusBadge>
          )}
        </dd>
      </dl>

      {status?.connected && status.preflight ? (
        <p
          role="status"
          className={
            status.preflight.ok ? 'text-muted-foreground text-xs' : 'text-warning-foreground text-xs'
          }
        >
          {status.preflight.message}
        </p>
      ) : null}

      {confirming ? (
        <p role="alert" className="text-warning-foreground text-xs">
          This sends a real email to {list.addresses.length}{' '}
          {list.addresses.length === 1 ? 'address' : 'addresses'}: {list.addresses.join(', ')}.
        </p>
      ) : null}

      {outcome ? (
        outcome.status === 'sent' ? (
          <Alert role="status">
            <Send aria-hidden="true" />
            <AlertTitle>{outcome.mode === 'dry-run' ? 'Dry run complete' : 'Test email sent'}</AlertTitle>
            {/* SES message ids are ~60 unbreakable characters: `break-all` wraps
                them, and `min-w-0` stops them widening the dialog's grid column. */}
            <AlertDescription className="min-w-0">
              Message id <span className="font-mono break-all">{outcome.messageId}</span> · to{' '}
              <span className="font-mono break-all">{outcome.to.join(', ')}</span>
              {outcome.mode === 'dry-run' ? '. Nothing left the server.' : '.'}
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive" role="alert">
            <AlertTitle>Not sent</AlertTitle>
            <AlertDescription>{outcome.message}</AlertDescription>
          </Alert>
        )
      ) : null}

      <DialogFooter className="items-center">
        <span className="text-muted-foreground mr-auto text-[11px]">
          {!connected
            ? 'See docs/SENDING.md to enable.'
            : status?.connected && status.mode === 'live'
              ? 'Live sending, rate limited to 5 sends per minute.'
              : 'Dry run. Nothing leaves the server.'}
        </span>
        {confirming ? (
          <Button variant="outline" size="sm" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        ) : (
          <DialogClose asChild>
            <Button variant="outline" size="sm">
              Close
            </Button>
          </DialogClose>
        )}
        <Button
          size="sm"
          disabled={!canSend}
          aria-disabled={!canSend}
          onClick={() => {
            if (needsConfirmation && !confirming) setConfirming(true)
            else void send()
          }}
        >
          {phase.kind === 'sending' ? 'Sending…' : confirming ? 'Confirm send' : 'Send test'}
          {!connected && phase.kind !== 'loading' ? (
            <StatusBadge tone="neutral" dot={false} className="ml-1 h-4">
              Unavailable
            </StatusBadge>
          ) : null}
        </Button>
      </DialogFooter>
    </>
  )
}
