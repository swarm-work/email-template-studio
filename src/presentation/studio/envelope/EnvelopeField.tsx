/**
 * One labelled field in the envelope panel.
 *
 * Presentation layer: layout and wiring only, no validation. It owns the two
 * ids a field needs so the control can point at them:
 * `<id>-helper` for the hint under the control and `<id>-error` for a problem.
 * Callers pass `aria-describedby={describedBy(id, …)}` (from `fieldIds.ts`) on
 * their own control, which keeps this component free of cloneElement magic.
 */
import type { ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface EnvelopeFieldProps {
  /** Id of the control inside; the label points at it with htmlFor. */
  id: string
  label: string
  /** Small right-aligned note next to the label, e.g. the subject counter. */
  adornment?: ReactNode
  /** Always-visible hint under the control. */
  helper?: ReactNode
  /** Validation message. Replaces the helper's tone, never the helper itself. */
  error?: string
  className?: string
  children: ReactNode
}

export function EnvelopeField({
  id,
  label,
  adornment,
  helper,
  error,
  className,
  children,
}: EnvelopeFieldProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex min-w-0 items-center gap-2">
        <Label htmlFor={id} className="meta-label">
          {label}
        </Label>
        {adornment ? <span className="ml-auto shrink-0">{adornment}</span> : null}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-danger-foreground text-[11px]">
          {error}
        </p>
      ) : null}
      {helper ? (
        <p id={`${id}-helper`} className="text-muted-foreground text-[11px]">
          {helper}
        </p>
      ) : null}
    </div>
  )
}
