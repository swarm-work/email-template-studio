/**
 * The mail-client header above the preview: Subject, Preheader, From, To.
 *
 * Presentation layer, read only. Every value comes from somewhere specific and
 * nothing is invented: subject and preheader from the draft envelope, From from
 * the send server's status (it is not template data, and the studio resolves it
 * once for both this and the envelope panel), To from the fixed preview sample
 * recipient in the domain. Editing happens in the envelope panel.
 */
import { PREVIEW_SAMPLE_RECIPIENT, type TemplateEnvelope } from '@/domain'

export interface EnvelopeSummaryProps {
  /** The draft envelope: what the reader is editing right now. */
  envelope: TemplateEnvelope
  /** The saved template's subject, used while the draft's is empty. */
  fallbackSubject: string
  /** The send server's From identity, or null while it is unknown. */
  from: string | null
}

export function EnvelopeSummary({ envelope, fallbackSubject, from }: EnvelopeSummaryProps) {
  const subject = envelope.subject.trim() === '' ? fallbackSubject : envelope.subject

  return (
    <div className="grid gap-x-6 gap-y-1 border-b px-4 py-3 sm:grid-cols-[auto_1fr]">
      <span className="meta-label self-center">Subject</span>
      <span className="min-w-0 text-sm font-medium break-words">{subject}</span>

      <span className="meta-label self-center">Preheader</span>
      <span className="text-muted-foreground min-w-0 text-xs break-words">
        {envelope.preheader.trim() === '' ? 'No preheader text.' : envelope.preheader}
      </span>

      <span className="meta-label self-center">From</span>
      {/* The sender belongs to the send server, not to the template. */}
      <span className="text-muted-foreground min-w-0 text-xs break-words">
        {from === null ? '— Set by the send server.' : <span className="font-mono">{from}</span>}
      </span>

      <span className="meta-label self-center">To</span>
      <span className="text-muted-foreground min-w-0 text-xs break-words">
        {PREVIEW_SAMPLE_RECIPIENT.name}{' '}
        <span className="font-mono">&lt;{PREVIEW_SAMPLE_RECIPIENT.address}&gt;</span>
      </span>
    </div>
  )
}
