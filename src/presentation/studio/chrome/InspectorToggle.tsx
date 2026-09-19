/**
 * Shows and hides the inspector rail on screens too narrow to keep it open.
 *
 * Presentation layer. The rail itself is always in the DOM — it slides in and
 * out with CSS (plan §4.2), which is why this is a plain `aria-pressed` toggle
 * pointing at the rail with `aria-controls` rather than a dialog trigger.
 *
 * It disappears at `xl`, where the rail is simply always there and a button
 * that claims to hide it would be lying.
 */
import { PanelRight } from 'lucide-react'
import type { Ref } from 'react'
import { Button } from '@/components/ui/button'
import { INSPECTOR_RAIL_ID } from '../visual/canvas'

export interface InspectorToggleProps {
  open: boolean
  onToggle: () => void
  /** Held by StudioPage so Escape in the rail can put focus back here. */
  ref?: Ref<HTMLButtonElement>
}

export function InspectorToggle({ open, onToggle, ref }: InspectorToggleProps) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="icon-sm"
      className="shrink-0 xl:hidden"
      aria-pressed={open}
      aria-controls={INSPECTOR_RAIL_ID}
      aria-label="Inspector"
      onClick={onToggle}
    >
      <PanelRight aria-hidden="true" />
    </Button>
  )
}
