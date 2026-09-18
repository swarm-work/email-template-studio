/**
 * The template's tags, shown in the envelope panel.
 *
 * Presentation layer. Tags are metadata, not envelope data: they live on the
 * template record and are changed with a PATCH, which the studio cannot send
 * until phase 7b. Until then they are read-only and say so, rather than
 * offering an edit that would be silently thrown away.
 *
 * It renders plain spans (no list) so the caller can put it inside an
 * `<output>`, which is what makes the field's `<label for>` legal.
 */

/** Why the chips cannot be edited yet. Shared with the description field. */
export const METADATA_READ_ONLY_HELPER = 'Editable once templates can be saved.'

export interface TagsFieldProps {
  tags: readonly string[]
}

export function TagsField({ tags }: TagsFieldProps) {
  if (tags.length === 0) return <span className="text-muted-foreground text-sm">No tags</span>
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <span
          key={tag}
          className="bg-muted text-muted-foreground max-w-full truncate rounded-md px-1.5 py-0.5 text-[11px]"
        >
          {tag}
        </span>
      ))}
    </span>
  )
}
