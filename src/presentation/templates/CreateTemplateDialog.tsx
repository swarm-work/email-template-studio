/**
 * "New template": name, slug, kind, and what to start from.
 *
 * Presentation layer. It collects four answers and hands them to the caller as
 * one `NewTemplateInput` with a COMPLETE first version — resolving "start
 * from" into real content is `infrastructure/templates/blankTemplate.ts`'s job,
 * because the repository port always receives a whole version (plan §3.4).
 */
import { useId, useMemo, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type {
  NewTemplateInput,
  RepositoryFailure,
  VersionInput,
} from '@/application/repositories/templateRepository'
import type { EmailTemplate, TemplateId, TemplateKind } from '@/domain'
import { blankVersionInput, versionInputFromRecord } from '@/infrastructure/templates/blankTemplate'
import { ReasonedButton } from '@/presentation/shared/ReasonedButton'
import { MAX_SLUG_LENGTH, SLUG_PATTERN, slugify } from '@shared/templateContracts'

/** What the API says when the slug is already in use, in the studio's words. */
export const SLUG_TAKEN_MESSAGE = 'A template with that name already exists. Try another name.'

/** Nothing has been typed yet, so there is nothing to create. */
const NAME_REQUIRED_REASON = 'Enter a name for the template.'

/** The name is all punctuation or all non-Latin script, so `slugify` had nothing to keep. */
const NO_SLUG_REASON = 'That name has no letters or numbers in it. Type a slug to use instead.'

/**
 * Why the slug cannot be used, or `undefined` when it can.
 *
 * The same rules the API enforces (`slugSchema`), checked here so a hand-edited
 * slug is answered in the field the person is typing in rather than by a 400
 * whose explanation the dialog would have nowhere to put.
 */
function slugReason(slug: string): string | undefined {
  if (slug === '') return NO_SLUG_REASON
  if (slug.length > MAX_SLUG_LENGTH) return `A slug can be at most ${MAX_SLUG_LENGTH} characters.`
  if (!SLUG_PATTERN.test(slug)) return 'Use lower-case letters, numbers and single hyphens.'
  return undefined
}

/** The category a new template gets. There is no field for it; the studio edits it later. */
const DEFAULT_CATEGORY = 'notification' as const

/**
 * Only this `<select>` is native: shadcn has no select-styled native element,
 * and a list of every template in the library is exactly the case a native
 * picker handles best (it scrolls, it filters by typing, it works on a phone).
 */
const SELECT_CLASS =
  'border-border bg-background focus-visible:ring-ring/50 h-9 w-full rounded-md border px-2 text-sm outline-none focus-visible:ring-3'

export interface CreateTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Everything already in the library, for "Start from: Copy of …". */
  templates: readonly EmailTemplate[]
  /**
   * Creates it. Returns the whole failure when the server refused, so this
   * dialog can turn `slug-taken` into a field error, stay open, and pass the
   * server's own sentence on for anything else.
   */
  onCreate: (
    input: NewTemplateInput & { readonly initialVersion: VersionInput },
  ) => Promise<RepositoryFailure | null>
}

/**
 * The dialog shell. The form is a CHILD so that closing the dialog unmounts it
 * and the next open starts from empty fields — a reset that needs no effect and
 * cannot forget a field (a half-filled dialog from ten minutes ago is somebody
 * else's train of thought).
 */
export function CreateTemplateDialog({ open, onOpenChange, templates, onCreate }: CreateTemplateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New template</DialogTitle>
          <DialogDescription>
            A template is created as a draft at version 1. You can rename it, describe it and tag it once it
            is open.
          </DialogDescription>
        </DialogHeader>
        <CreateTemplateForm templates={templates} onCreate={onCreate} onCancel={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function CreateTemplateForm({
  templates,
  onCreate,
  onCancel,
}: {
  templates: readonly EmailTemplate[]
  onCreate: CreateTemplateDialogProps['onCreate']
  onCancel: () => void
}) {
  const fieldId = useId()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  // Once the slug has been typed into by hand it stops following the name:
  // silently rewriting somebody's slug as they keep typing the name is worse
  // than asking them to finish the job.
  const [slugEdited, setSlugEdited] = useState(false)
  const [kind, setKind] = useState<TemplateKind>('visual')
  const [startFrom, setStartFrom] = useState<TemplateId | ''>('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const source = useMemo(
    () => templates.find((template) => template.metadata.id === startFrom) ?? null,
    [templates, startFrom],
  )
  // A copy is always the same kind as what it copies; offering the choice would
  // be offering a conversion, which is its own (one-way) feature.
  const effectiveKind = source?.kind ?? kind
  const effectiveSlug = slugEdited ? slug : slugify(name)
  const slugProblem = slugReason(effectiveSlug)
  // The slug only shows its own error once it has been typed into: while it is
  // still following the name, "that is not a slug" is about a field nobody has
  // touched, and the submit button's reason says the same thing more kindly.
  const slugError = slugEdited ? slugProblem : undefined
  const submitReason = busy
    ? 'The template is being created.'
    : name.trim() === ''
      ? NAME_REQUIRED_REASON
      : slugProblem

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitReason !== undefined) return
    setBusy(true)
    setNameError(null)
    const failure = await onCreate({
      name: name.trim(),
      slug: effectiveSlug,
      kind: effectiveKind,
      description: '',
      category: DEFAULT_CATEGORY,
      tags: [],
      initialVersion: source ? versionInputFromRecord(source) : blankVersionInput(effectiveKind),
    })
    setBusy(false)
    if (failure === null) return
    if (failure.code === 'slug-taken') {
      setNameError(SLUG_TAKEN_MESSAGE)
      return
    }
    // Everything else is the server's own sentence: it is the only place that
    // knows which field it disliked and why.
    toast.error('The template could not be created.', { description: failure.message })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${fieldId}-name`}>Name</Label>
        <Input
          id={`${fieldId}-name`}
          value={name}
          autoFocus
          onChange={(event) => {
            setName(event.target.value)
            setNameError(null)
          }}
          aria-invalid={nameError !== null}
          aria-describedby={nameError === null ? undefined : `${fieldId}-name-error`}
        />
        {nameError === null ? null : (
          <p id={`${fieldId}-name-error`} className="text-destructive text-xs">
            {nameError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${fieldId}-slug`}>Slug</Label>
        <Input
          id={`${fieldId}-slug`}
          value={effectiveSlug}
          onChange={(event) => {
            setSlugEdited(true)
            setSlug(event.target.value)
          }}
          className="font-mono"
          aria-invalid={slugError !== undefined}
          aria-describedby={slugError === undefined ? `${fieldId}-slug-help` : `${fieldId}-slug-error`}
        />
        {slugError !== undefined ? (
          <p id={`${fieldId}-slug-error`} className="text-destructive text-xs">
            {slugError}
          </p>
        ) : (
          <p id={`${fieldId}-slug-help`} className="text-muted-foreground text-xs">
            Used in the API. It cannot be changed after the first publish.
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-1.5" disabled={source !== null}>
        <legend className="mb-1.5 text-sm font-medium">Kind</legend>
        <RadioGroup
          value={effectiveKind}
          onValueChange={(value) => setKind(value as TemplateKind)}
          className="gap-2"
        >
          <KindOption id={`${fieldId}-visual`} value="visual" label="Visual" detail="edit on a canvas" />
          <KindOption id={`${fieldId}-code`} value="code" label="Code" detail="edit React Email TSX" />
        </RadioGroup>
        {source === null ? null : (
          <p className="text-muted-foreground text-xs">A copy keeps the kind of the template it came from.</p>
        )}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${fieldId}-start`}>Start from</Label>
        <select
          id={`${fieldId}-start`}
          value={startFrom}
          onChange={(event) => setStartFrom(event.target.value as TemplateId | '')}
          className={SELECT_CLASS}
        >
          <option value="">Blank</option>
          {templates.map((template) => (
            <option key={template.metadata.id} value={template.metadata.id}>
              Copy of {template.metadata.name}
            </option>
          ))}
        </select>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        {/* Disabled-with-reason, never a bare `disabled`: the reason is the
            only way to learn that the name produced no usable slug. */}
        <ReasonedButton type="submit" reason={submitReason}>
          {busy ? 'Creating…' : 'Create template'}
        </ReasonedButton>
      </DialogFooter>
    </form>
  )
}

/** One radio with its explanation, so both options read the same way. */
function KindOption({
  id,
  value,
  label,
  detail,
}: {
  id: string
  value: TemplateKind
  label: string
  detail: string
}) {
  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem id={id} value={value} />
      <Label htmlFor={id} className="font-normal">
        {label} <span className="text-muted-foreground">— {detail}</span>
      </Label>
    </div>
  )
}
