/**
 * "← Templates  <name>" at the left of the studio sub-header, and the pencil
 * that renames the template.
 *
 * Presentation layer: no rules. It is both the page's heading and its way back
 * to the library, which is why the back control is a real button rather than a
 * link: the app has no router yet, so navigation is a callback (see
 * TemplatesRoute). Leaving with unsaved edits needs no confirmation here - the
 * route keeps the draft and says so in a toast - so this only calls back.
 *
 * Renaming happens IN PLACE rather than in a dialog: it is one short field, and
 * a modal for one field is a lot of ceremony for a typo.
 */
import { useRef, useState } from 'react'
import { ArrowLeft, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MAX_NAME_LENGTH } from '@shared/templateContracts'

export interface TemplateBreadcrumbProps {
  name: string
  onBackToLibrary: () => void
  /** Sends the new name. Called only when it actually changed. */
  onRename: (name: string) => void
}

export function TemplateBreadcrumb({ name, onBackToLibrary, onRename }: TemplateBreadcrumbProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const pencilRef = useRef<HTMLButtonElement>(null)

  /** Opens the field on whatever the name is right now. */
  function startEditing() {
    setDraft(name)
    setEditing(true)
  }

  /** Leaves the field and puts focus back where it came from. */
  function close() {
    setEditing(false)
    pencilRef.current?.focus({ preventScroll: true })
  }

  function commit() {
    const next = draft.trim()
    if (next !== '' && next !== name) onRename(next)
    close()
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      {/* The way back to the library. It used to be a quiet grey word in a
          breadcrumb, which nobody recognised as a control, so it is now a real
          button with an arrow and an outline. Its accessible name says what it
          does ("Back to templates") while the visible word stays short; the
          visible "Templates" is part of that name, so voice control users can
          still say "click Templates". Below `sm` only the arrow shows, because
          the template's name needs the room more than the word does. */}
      <Button
        variant="outline"
        size="sm"
        aria-label="Back to templates"
        className="shrink-0 max-sm:px-2"
        onClick={onBackToLibrary}
      >
        <ArrowLeft aria-hidden="true" />
        <span className="hidden sm:inline">Templates</span>
      </Button>

      {editing ? (
        <Input
          autoFocus
          value={draft}
          maxLength={MAX_NAME_LENGTH}
          aria-label="Template name"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit()
            }
            // Escape abandons the edit; the name in the record is untouched.
            if (event.key === 'Escape') {
              setDraft(name)
              close()
            }
          }}
          className="h-7 w-[22ch] text-sm font-semibold"
        />
      ) : (
        <h1 className="max-w-[14ch] truncate text-sm font-semibold sm:max-w-[28ch] lg:max-w-none">{name}</h1>
      )}

      <Button
        ref={pencilRef}
        variant="ghost"
        size="icon-xs"
        aria-label="Rename template"
        className="text-muted-foreground shrink-0"
        onClick={startEditing}
      >
        <Pencil aria-hidden="true" />
      </Button>
    </div>
  )
}
