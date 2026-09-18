/**
 * Everything written on the envelope rather than inside the letter: subject,
 * preheader, who a reply goes to, and the metadata that travels with them.
 *
 * Presentation layer. Every edit is dispatched straight into the draft
 * (`edit-envelope`, the reducer in application/studioState.ts); this component
 * keeps no copy of the text, which is why typing here can never disagree with
 * what the preview and the send dialog use.
 */
import { useEffect, useId, useState } from 'react'
import { Check, HelpCircle, RotateCcw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { parseRecipientList } from '@/application/parseRecipientList'
import {
  subjectLengthState,
  SUBJECT_LENGTH_LIMIT,
  type TemplateEnvelope,
  type TemplateMetadata,
} from '@/domain'
import type { EmailProvider } from '@/infrastructure/providers/emailProvider'
import { ReasonedButton } from '@/presentation/shared/ReasonedButton'
import { StatusBadge } from '@/presentation/shared/StatusBadge'
import { cn } from '@/lib/utils'
import { EnvelopeField } from './EnvelopeField'
import { describedBy } from './fieldIds'
import { METADATA_READ_ONLY_HELPER, TagsField } from './TagsField'

/** Why "Reset envelope" cannot be pressed; the studio never shows a bare `disabled`. */
const NOTHING_TO_RESET_REASON = 'There are no changes to the envelope to reset.'

const RFC_TOOLTIP =
  'RFC 5322 is the internet standard that defines these header fields. It recommends a subject line of at most 78 characters.'

const FIELD_CLASS =
  'h-9 w-full min-w-0 rounded-md border-0 bg-muted px-2.5 text-sm shadow-none focus-visible:ring-3 focus-visible:ring-ring/50'

export interface EnvelopePanelProps {
  envelope: TemplateEnvelope
  metadata: TemplateMetadata
  /** True when the draft's envelope differs from the saved one. */
  dirty: boolean
  onChange: (envelope: TemplateEnvelope) => void
  onReset: () => void
  /** The send server owns the From identity; it is read from here, never typed. */
  provider: EmailProvider
}

export function EnvelopePanel({
  envelope,
  metadata,
  dirty,
  onChange,
  onReset,
  provider,
}: EnvelopePanelProps) {
  const headingId = useId()
  const fieldId = useId()
  const [open, setOpen] = useState(true)
  const fromIdentity = useFromIdentity(provider)

  const subjectState = subjectLengthState(envelope.subject)
  const replyToError = replyToProblem(envelope.replyTo)

  return (
    <section aria-labelledby={headingId} className="bg-card shrink-0 border-b">
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex min-w-0 flex-wrap items-center gap-2 px-4 py-2">
          <h2 id={headingId} className="text-xs font-medium">
            Envelope &amp; dispatch
          </h2>
          {/* The mock showed "RFC-5322" as a chip; a chip that explains nothing
              is decoration, so the standard is a tooltip instead (4.7). */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="About these fields"
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-full focus-visible:ring-3 focus-visible:outline-none"
              >
                <HelpCircle className="size-3.5" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{RFC_TOOLTIP}</TooltipContent>
          </Tooltip>
          {dirty ? <StatusBadge tone="warning">Modified</StatusBadge> : null}
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <ReasonedButton
              variant="ghost"
              size="sm"
              reason={dirty ? undefined : NOTHING_TO_RESET_REASON}
              onClick={onReset}
            >
              <RotateCcw aria-hidden="true" />
              Reset envelope
            </ReasonedButton>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm">
                {open ? 'Hide details' : 'Show details'}
              </Button>
            </CollapsibleTrigger>
          </div>
        </div>

        <CollapsibleContent>
          <div className="grid grid-cols-1 gap-x-4 gap-y-3 px-4 pb-3 md:grid-cols-6 xl:grid-cols-12">
            <EnvelopeField
              id={`${fieldId}-subject`}
              label="Subject line"
              className="md:col-span-3 xl:col-span-5"
              adornment={<SubjectCounter length={envelope.subject.length} state={subjectState} />}
              helper={
                subjectState === 'too-long' ? 'Most clients truncate subjects past 78 characters.' : undefined
              }
            >
              <Input
                id={`${fieldId}-subject`}
                value={envelope.subject}
                onChange={(event) => onChange({ ...envelope, subject: event.target.value })}
                className={FIELD_CLASS}
                aria-describedby={describedBy(`${fieldId}-subject`, {
                  helper: subjectState === 'too-long',
                })}
              />
            </EnvelopeField>

            <EnvelopeField
              id={`${fieldId}-preheader`}
              label="Preheader text"
              className="md:col-span-3 xl:col-span-4"
              helper="Shown after the subject in the inbox list. Leave empty to use the first line of the email."
            >
              <Textarea
                id={`${fieldId}-preheader`}
                value={envelope.preheader}
                onChange={(event) => onChange({ ...envelope, preheader: event.target.value })}
                rows={2}
                className="bg-muted focus-visible:ring-ring/50 min-h-[38px] w-full min-w-0 resize-y rounded-md border-0 px-2.5 py-2 text-sm shadow-none focus-visible:ring-3"
                aria-describedby={describedBy(`${fieldId}-preheader`, { helper: true })}
              />
            </EnvelopeField>

            <EnvelopeField
              id={`${fieldId}-from`}
              label="From identity"
              className="md:col-span-3 xl:col-span-3"
              helper="Set by the send server."
            >
              {/* `output` is used because it is labelable, but it is a live
                  region by default (role=status). The address arrives from the
                  provider after mount, and plan 4.6 allows exactly three live
                  regions in the studio — this is not one of them. */}
              <output
                id={`${fieldId}-from`}
                aria-live="off"
                className="bg-muted/60 text-muted-foreground flex h-9 w-full min-w-0 items-center truncate rounded-md px-2.5 font-mono text-xs"
              >
                {fromIdentity ?? '—'}
              </output>
            </EnvelopeField>

            <EnvelopeField
              id={`${fieldId}-reply-to`}
              label="Reply-to address"
              className="md:col-span-3 xl:col-span-4"
              error={replyToError}
            >
              <Input
                id={`${fieldId}-reply-to`}
                type="email"
                value={envelope.replyTo}
                placeholder="team@example.com"
                onChange={(event) => onChange({ ...envelope, replyTo: event.target.value })}
                aria-invalid={replyToError !== undefined}
                className={FIELD_CLASS}
                aria-describedby={describedBy(`${fieldId}-reply-to`, { error: replyToError !== undefined })}
              />
            </EnvelopeField>

            <EnvelopeField
              id={`${fieldId}-description`}
              label="Internal description"
              className="md:col-span-3 xl:col-span-5"
              helper={METADATA_READ_ONLY_HELPER}
            >
              <output
                id={`${fieldId}-description`}
                aria-live="off"
                className="text-foreground block min-w-0 py-1 text-sm break-words"
              >
                {metadata.description === '' ? '—' : metadata.description}
              </output>
            </EnvelopeField>

            <EnvelopeField
              id={`${fieldId}-tags`}
              label="Tags"
              className="md:col-span-3 xl:col-span-3"
              helper={METADATA_READ_ONLY_HELPER}
            >
              <output id={`${fieldId}-tags`} aria-live="off" className="block min-w-0 py-1">
                <TagsField tags={metadata.tags} />
              </output>
            </EnvelopeField>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}

/** "54 / 78 chars", with a check once there is a subject and a warning past the limit. */
function SubjectCounter({ length, state }: { length: number; state: ReturnType<typeof subjectLengthState> }) {
  return (
    <span
      // Not a live region: a counter that speaks on every keystroke is noise.
      aria-live="off"
      className={cn(
        'text-muted-foreground flex items-center gap-1 font-mono text-[11px] tabular-nums',
        state === 'too-long' && 'text-warning-foreground',
      )}
    >
      {state === 'ok' ? (
        <Check className="text-success size-3" aria-hidden="true" />
      ) : state === 'too-long' ? (
        <TriangleAlert className="size-3" aria-hidden="true" />
      ) : null}
      {length} / {SUBJECT_LENGTH_LIMIT} chars
    </span>
  )
}

/**
 * The problem with the reply-to address, or undefined when there is none.
 * Empty is valid: it means "replies go to the sender the server is configured
 * with", which is what the domain's '' sentinel says.
 */
function replyToProblem(replyTo: string): string | undefined {
  if (replyTo.trim() === '') return undefined
  const { addresses, invalid } = parseRecipientList(replyTo)
  return invalid.length > 0 || addresses.length !== 1 ? 'Enter a valid email address.' : undefined
}

/** The address the send server sends from, or null while it is not connected. */
function useFromIdentity(provider: EmailProvider): string | null {
  const [from, setFrom] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void provider.getStatus().then((status) => {
      if (!cancelled && status.connected) setFrom(status.from)
    })
    return () => {
      cancelled = true
    }
  }, [provider])

  return from
}
