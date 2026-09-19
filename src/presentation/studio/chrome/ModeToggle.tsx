/**
 * Visual · Code · Preview, the studio's workspace switcher.
 *
 * Presentation layer: which modes exist for a template is
 * `application/studioModes.ts`; this only draws them.
 *
 * Deliberately three plain buttons in a labelled group instead of a Radix
 * ToggleGroup: a mode that is not available yet has to stay focusable and
 * explain itself, and ToggleGroup can only express a bare `disabled`.
 */
import { Code2, Eye, MousePointerClick } from 'lucide-react'
import type { StudioMode } from '@/domain'
import { ReasonedButton } from '@/presentation/shared/ReasonedButton'

const MODE_LABELS: Readonly<Record<StudioMode, string>> = {
  visual: 'Visual',
  code: 'Code',
  preview: 'Preview',
}

const MODE_ICONS = {
  visual: MousePointerClick,
  code: Code2,
  preview: Eye,
} as const

export interface ModeToggleProps {
  /** The modes this template's kind offers, in display order. */
  modes: readonly StudioMode[]
  value: StudioMode
  onChange: (mode: StudioMode) => void
  /** Why a mode cannot be entered yet; `undefined` means it can. */
  reasonFor: (mode: StudioMode) => string | undefined
}

export function ModeToggle({ modes, value, onChange, reasonFor }: ModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Editing mode"
      className="bg-muted flex shrink-0 items-center rounded-lg p-0.5"
    >
      {modes.map((mode) => {
        const Icon = MODE_ICONS[mode]
        const active = mode === value
        return (
          <ReasonedButton
            key={mode}
            variant="ghost"
            size="sm"
            reason={reasonFor(mode)}
            aria-pressed={active}
            className={active ? 'bg-card shadow-xs' : 'text-muted-foreground'}
            onClick={() => onChange(mode)}
          >
            <Icon aria-hidden="true" />
            {MODE_LABELS[mode]}
          </ReasonedButton>
        )
      })}
    </div>
  )
}
