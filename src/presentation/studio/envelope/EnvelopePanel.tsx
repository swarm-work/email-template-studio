/**
 * Everything written on the envelope rather than inside the letter: subject,
 * preheader, who a reply goes to, and the metadata that travels with them.
 *
 * Presentation layer. Every edit is dispatched straight into the draft
 * (`edit-envelope`, the reducer in application/studioState.ts); this component
 * keeps no copy of the text, which is why typing here can never disagree with
 * what the preview and the send dialog use.
 */
import { useId, useState } from 'react'
import { Check, HelpCircle, RotateCcw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { listMergeFields } from '@/application/mergeFields'
import { parseRecipientList } from '@/application/parseRecipientList'
import {
  subjectLengthState,
  SUBJECT_LENGTH_LIMIT,
  type TemplateEnvelope,
  type TemplateMetadata,
} from '@/domain'
import type { TemplateMetadataPatch } from '@/application/repositories/templateRepository'
import { MAX_DESCRIPTION_LENGTH } from '@shared/templateContracts'
import { ReasonedButton } from '@/presentation/shared/ReasonedButton'
import { StatusBadge } from '@/presentation/shared/StatusBadge'
import { cn } from '@/lib/utils'
import { EnvelopeField } from './EnvelopeField'
import { describedBy } from './fieldIds'
import { TagsField } from './TagsField'

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
  /**
   * The send server's From identity, or null while it is unknown. Resolved once
   * by the studio and passed in, so this panel and the preview's summary can
   * never show different senders.
   */
  from: string | null
  /**
   * Sends a metadata change (description, tags) straight to the server.
   *
   * Metadata is NOT part of the draft: it has no version of its own, it is
   * PATCHed on its own, and it is what the library card shows. Putting it in
   * the draft would mean a rename only appeared once somebody saved a version.
   */
  onMetadataChange: (patch: TemplateMetadataPatch) => void
}

export function EnvelopePanel({
  envelope,
  metadata,
  dirty,
  onChange,
  onReset,
  from,
  onMetadataChange,
}: EnvelopePanelProps) {
  const headingId = useId()
  const fieldId = useId()
  const [open, setOpen] = useState(true)

  const subjectState = subjectLengthState(envelope.subject)
  // A subject may carry merge fields too, and the person typing one wants to
  // know it was recognised as a field rather than left as literal braces.
  const subjectFields = listMergeFields(envelope.subject)
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
                subjectState === 'too-long'
                  ? 'Most clients truncate subjects past 78 characters.'
                  : subjectFields.length > 0
                    ? `Uses {{${subjectFields[0]}}}`
                    : undefined
              }
            >
              <Input
                id={`${fieldId}-subject`}
                value={envelope.subject}
                onChange={(event) => onChange({ ...envelope, subject: event.target.value })}
                className={FIELD_CLASS}
                aria-describedby={describedBy(`${fieldId}-subject`, {
                  helper: subjectState === 'too-long' || subjectFields.length > 0,
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
                {from ?? '—'}
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
              helper="Only visible in this studio. Never sent."
            >
              <DescriptionField
                // The key resets the field's own copy when the SAVED value
                // changes (our own commit, or somebody else's rename). It never
                // changes while you type, because typing does not commit.
                key={metadata.description}
                id={`${fieldId}-description`}
                value={metadata.description}
                onCommit={(description) => onMetadataChange({ description })}
              />
            </EnvelopeField>

            <EnvelopeField
              id={`${fieldId}-tags`}
              label="Tags"
              className="md:col-span-3 xl:col-span-3"
              helper="Only visible in this studio. Never sent."
            >
              {/* A group rather than a single control: the field holds a chip
                  per tag plus the button that adds one, so there is nothing for
                  a `<label for>` to point at. */}
              <div id={`${fieldId}-tags`} role="group" aria-label="Tags" className="min-w-0 py-1">
                <TagsField tags={metadata.tags} onChange={(tags) => onMetadataChange({ tags })} />
              </div>
            </EnvelopeField>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}

/**
 * The internal description, sent to the server when you leave the field.
 *
 * It keeps its own copy while you type: every keystroke would otherwise be a
 * PATCH, and each PATCH bumps the revision — which would turn a sentence into
 * fifty version conflicts for anyone else with the template open.
 */
function DescriptionField({
  id,
  value,
  onCommit,
}: {
  id: string
  value: string
  onCommit: (value: string) => void
}) {
  const [text, setText] = useState(value)

  return (
    <Input
      id={id}
      value={text}
      maxLength={MAX_DESCRIPTION_LENGTH}
      placeholder="What this template is for"
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        if (text === value) return
        onCommit(text)
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return
        event.currentTarget.blur()
      }}
      className={FIELD_CLASS}
      aria-describedby={describedBy(id, { helper: true })}
    />
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
