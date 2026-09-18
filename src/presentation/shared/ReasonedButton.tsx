/**
 * A control that is visibly there but cannot be used yet, and always says why.
 *
 * Presentation layer: no rules, only the disabled-with-reason pattern the whole
 * studio uses (docs/DESIGN.md). A bare `disabled` attribute removes the button
 * from the tab order, so a keyboard user can never reach the tooltip that
 * explains it. Instead the button stays focusable, carries `aria-disabled`, is
 * described by an always-present sr-only sentence, and answers a click with a
 * toast of the same sentence.
 */
import { useId, type ComponentProps } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export interface ReasonedButtonProps extends ComponentProps<typeof Button> {
  /** Why the control cannot be used. `undefined` means it works normally. */
  reason?: string
}

export function ReasonedButton({ reason, onClick, children, ...props }: ReasonedButtonProps) {
  const reasonId = useId()

  if (reason === undefined) {
    return (
      <Button onClick={onClick} {...props}>
        {children}
      </Button>
    )
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            {...props}
            aria-disabled="true"
            aria-describedby={reasonId}
            onClick={(event) => {
              // The click is answered, not swallowed: people who cannot see the
              // tooltip (touch, keyboard) still learn why nothing happened.
              event.preventDefault()
              toast(reason)
            }}
          >
            {children}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
      {/* The tooltip is only in the DOM while it is open, so the reason also
          lives here, where a screen reader can always reach it. */}
      <span id={reasonId} className="sr-only">
        {reason}
      </span>
    </>
  )
}

export interface ReasonedMenuItemProps extends ComponentProps<typeof DropdownMenuItem> {
  /** Why the item cannot be used. `undefined` means it works normally. */
  reason?: string
  /** Id of an sr-only element holding `reason`; menus have to keep it outside the item. */
  reasonId?: string
}

/**
 * The same pattern for a dropdown item. The reason lives outside the menu (see
 * `reasonId`) because anything inside a menu item becomes part of its name.
 */
export function ReasonedMenuItem({ reason, reasonId, onSelect, children, ...props }: ReasonedMenuItemProps) {
  if (reason === undefined) {
    return (
      <DropdownMenuItem onSelect={onSelect} {...props}>
        {children}
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenuItem
      {...props}
      // Radix's own `disabled` would take the item out of the menu's focus
      // order, so the state is expressed with ARIA and the select is answered.
      aria-disabled="true"
      aria-describedby={reasonId}
      onSelect={(event) => {
        event.preventDefault()
        toast(reason)
      }}
      className="opacity-60"
    >
      {children}
    </DropdownMenuItem>
  )
}
