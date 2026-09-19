/**
 * The "⋯" in the corner of a library card.
 *
 * Presentation layer. It is a SIBLING of the card button rather than a child:
 * a button inside a button is invalid HTML, and browsers resolve it by
 * swallowing the inner one's clicks.
 */
import { MoreHorizontal, SquareArrowOutUpRight, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface TemplateCardMenuProps {
  /** The template's name; it goes into the trigger's accessible name. */
  name: string
  onOpen: () => void
  onDelete: () => void
}

export function TemplateCardMenu({ name, onOpen, onDelete }: TemplateCardMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Named after the template: a grid of twelve cards would otherwise
            have twelve buttons all called "More actions". */}
        <Button variant="ghost" size="icon-sm" aria-label={`More actions for ${name}`}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={onOpen}>
          <SquareArrowOutUpRight aria-hidden="true" />
          Open
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={onDelete}>
          <Trash2 aria-hidden="true" />
          Delete template…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
