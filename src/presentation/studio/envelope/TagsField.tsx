/**
 * The template's tags, in the envelope panel.
 *
 * Presentation layer. Tags are metadata, not envelope data: they live on the
 * template record and are changed with a PATCH, so every edit here goes
 * straight out as a metadata change rather than into the draft.
 *
 * The rules about what a tag may be (`MAX_TAGS`, `MAX_TAG_LENGTH`) come from
 * the wire contract, so the studio refuses what the API would refuse — with a
 * sentence, before the request.
 */
import { useId, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { MAX_TAG_LENGTH, MAX_TAGS } from '@shared/templateContracts'

export interface TagsFieldProps {
  tags: readonly string[]
  /** The whole new list. `undefined` makes the field read-only. */
  onChange?: (tags: readonly string[]) => void
}

export function TagsField({ tags, onChange }: TagsFieldProps) {
  const inputId = useId()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const full = tags.length >= MAX_TAGS

  function add() {
    const tag = draft.trim().slice(0, MAX_TAG_LENGTH)
    // A duplicate is not an error worth a message: the tag is already there,
    // which is what the person wanted.
    if (tag === '' || tags.includes(tag) || full) {
      setDraft('')
      setOpen(false)
      return
    }
    onChange?.([...tags, tag])
    setDraft('')
    setOpen(false)
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {tags.length === 0 && !onChange ? <span className="text-muted-foreground text-sm">No tags</span> : null}
      {tags.map((tag) => (
        <span
          key={tag}
          className="bg-muted text-muted-foreground flex max-w-full items-center gap-1 rounded-md py-0.5 pr-0.5 pl-1.5 text-[11px]"
        >
          <span className="truncate">{tag}</span>
          {onChange ? (
            <button
              type="button"
              aria-label={`Remove tag ${tag}`}
              onClick={() => onChange(tags.filter((candidate) => candidate !== tag))}
              className="hover:text-foreground focus-visible:ring-ring/50 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          ) : null}
        </span>
      ))}

      {onChange ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[11px]"
              disabled={full}
              // A bare `disabled` would be unexplained, so the reason is on the
              // button itself where a screen reader reads it with the name.
              title={full ? `A template may have at most ${MAX_TAGS} tags.` : undefined}
            >
              <Plus className="size-3" aria-hidden="true" />
              Add tag
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56">
            <div className="flex flex-col gap-2">
              <Label htmlFor={inputId} className="meta-label">
                New tag
              </Label>
              <Input
                id={inputId}
                value={draft}
                maxLength={MAX_TAG_LENGTH}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  // The panel is not a form, but Enter is what everybody presses.
                  event.preventDefault()
                  add()
                }}
              />
              <Button size="sm" onClick={add}>
                Add
              </Button>
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  )
}
