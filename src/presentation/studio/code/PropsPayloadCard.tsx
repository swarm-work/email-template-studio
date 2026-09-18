/**
 * The props payload card in the studio's right rail.
 *
 * Presentation layer. The JSON itself is edited in the `preview-props.json`
 * tab; this card is the report on it — is it valid, what is wrong, and the two
 * actions that fix it. Validation is `application/parsePreviewPayload.ts`.
 */
import { useId } from 'react'
import { Braces, RotateCcw } from 'lucide-react'
import { AnimatedBadge } from '@/components/motion/animated-badge'
import type { ValidationResult } from '@/domain'
import { ReasonedButton } from '@/presentation/shared/ReasonedButton'
import { StatusBadge } from '@/presentation/shared/StatusBadge'
import { INVALID_JSON_FORMAT_REASON, NOTHING_TO_RESET_REASON } from './reasons'

export interface PropsPayloadCardProps {
  validation: ValidationResult
  payloadDirty: boolean
  onFormat: () => void
  onReset: () => void
}

export function PropsPayloadCard({ validation, payloadDirty, onFormat, onReset }: PropsPayloadCardProps) {
  const headingId = useId()
  const canFormat = validation.ok || validation.kind === 'schema' || validation.kind === 'not-an-object'

  return (
    <section aria-labelledby={headingId} className="bg-card overflow-hidden rounded-lg border">
      <div className="flex min-w-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <h2 id={headingId} className="text-xs font-medium">
          Props payload
        </h2>
        {/* beUI animated badge: the icon/label roll communicates the validation state change. */}
        <AnimatedBadge
          size="sm"
          status={validation.ok ? 'success' : 'danger'}
          contentKey={validation.ok ? 'valid' : validation.kind}
          role="status"
        >
          {validation.ok ? 'JSON valid' : validation.kind === 'schema' ? 'Schema invalid' : 'Invalid JSON'}
        </AnimatedBadge>
        {payloadDirty ? <StatusBadge tone="warning">Modified</StatusBadge> : null}
        {/* The same two actions sit in the editor's tab strip one column over,
            so they use the same component and the same sentences: a bare
            `disabled` here would be an unexplained grey button next to a
            focusable one that says why (docs/DESIGN.md). */}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ReasonedButton
            variant="ghost"
            size="xs"
            reason={canFormat ? undefined : INVALID_JSON_FORMAT_REASON}
            onClick={onFormat}
          >
            <Braces aria-hidden="true" />
            Format
          </ReasonedButton>
          <ReasonedButton
            variant="ghost"
            size="xs"
            reason={payloadDirty ? undefined : NOTHING_TO_RESET_REASON}
            onClick={onReset}
          >
            <RotateCcw aria-hidden="true" />
            Reset
          </ReasonedButton>
        </div>
      </div>

      <div className="px-3 py-2 text-xs" aria-live="polite">
        {validation.ok ? (
          <p className="text-muted-foreground">
            {Object.keys(validation.value).length} props validated. The preview updates after a short pause.
          </p>
        ) : (
          <ul role="list" className="space-y-1">
            {validation.issues.map((issue, index) => (
              <li key={`${issue.path}-${index}`} className="text-danger-foreground flex gap-2">
                <span className="bg-danger-muted rounded px-1 font-mono">{issue.path}</span>
                <span className="min-w-0 break-words">
                  {issue.message}
                  {issue.line ? (
                    <span className="text-muted-foreground font-mono">
                      {' '}
                      (line {issue.line}
                      {issue.column ? `:${issue.column}` : ''})
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-muted-foreground border-t px-3 py-2 text-[11px]">
        Values used by the preview and by test sends. They are never sent to real recipients.
      </p>
    </section>
  )
}
