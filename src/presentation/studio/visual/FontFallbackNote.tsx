/**
 * "Client-safe typography": what the email's font stack does in a mail client
 * that has never heard of it.
 *
 * Presentation layer. The sentence and the variant both come from
 * `fontFallback.ts`, so the note cannot keep reassuring people after the theme
 * changed underneath it.
 */
import { CircleAlert, CircleCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { fontFallbackFor, fontFallbackSentence } from './fontFallback'

export interface FontFallbackNoteProps {
  /** The CSS font stack the email is exported with (see studioTheme.ts). */
  family: string
}

export function FontFallbackNote({ family }: FontFallbackNoteProps) {
  const fallback = fontFallbackFor(family)
  const known = fallback.kind === 'known'
  const Icon = known ? CircleCheck : CircleAlert

  return (
    <div
      className={cn(
        'flex gap-2 rounded-md border p-2.5 text-[11px]',
        known
          ? 'border-success/30 bg-success-muted text-success-foreground'
          : 'border-warning/30 bg-warning-muted text-warning-foreground',
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-medium">Client-safe typography</p>
        <p className="mt-0.5">{fontFallbackSentence(fallback)}</p>
      </div>
    </div>
  )
}
