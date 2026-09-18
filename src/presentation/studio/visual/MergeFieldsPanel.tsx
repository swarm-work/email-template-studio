/**
 * The inspector's Data tab: every `{{key}}` the template uses, and the sample
 * value that fills it in.
 *
 * Presentation layer, no rules of its own — every decision about what a key is,
 * which ones are missing and how a value is written into the JSON comes from
 * `@/application/mergeFields`. It lives in the visual folder because it rides
 * in the lazy editor chunk, but it does NOT import `@react-email/editor`:
 * inserting a chip is a callback the editor surface hands in.
 *
 * It is also where a visual template finally gets a typeable payload editor:
 * the collapsed JSON section below is bound to the same `draft.payloadText` the
 * code mode's `preview-props.json` tab edits.
 */
import { useId, useState } from 'react'
import { Plus } from 'lucide-react'
import {
  isMergeFieldKey,
  listPayloadKeys,
  missingMergeFields,
  parsePayloadObject,
  readPayloadValue,
  setPayloadValue,
  withMissingKeys,
} from '@/application/mergeFields'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { CodeEditor } from '@/presentation/shared/CodeEditor'
import { ReasonedButton } from '@/presentation/shared/ReasonedButton'
import { StatusBadge } from '@/presentation/shared/StatusBadge'

/** Shown when neither the canvas nor the envelope mentions a merge field yet. */
export const NO_MERGE_FIELDS_MESSAGE =
  'No merge fields yet. Type {{firstName}} in the canvas or add one here.'

/** Why "Fill in missing keys" is not available. */
const NOTHING_MISSING_REASON = 'Every merge field already has a value.'

/**
 * Why nothing here may be edited. Writing a key means re-printing the whole
 * payload, and text that does not parse cannot be re-printed without losing
 * everything in it — so while the JSON is broken the JSON editor below is the
 * only way in.
 */
const BROKEN_JSON_REASON = 'Fix the sample values JSON below first.'

/** Why "Add field" is not available for what is currently typed. */
const INVALID_KEY_REASON =
  'A field name starts with a letter or underscore and may contain letters, digits, underscores and dots.'

/**
 * Everything the panel needs that only `StudioPage` knows. It travels down
 * through `VisualWorkspace` as one object so the two components in between do
 * not grow three props they never read.
 */
export interface MergeFieldsData {
  /** Keys the template uses: canvas chips plus `{{key}}` in subject/preheader. */
  readonly keys: readonly string[]
  /** The draft's sample payload JSON, edited in place by this panel. */
  readonly payloadText: string
  readonly onPayloadChange: (payloadText: string) => void
}

export interface MergeFieldsPanelProps extends MergeFieldsData {
  /** Inserts a chip on the canvas. The editor surface supplies this. */
  onInsert: (key: string) => void
}

export function MergeFieldsPanel({ keys, payloadText, onPayloadChange, onInsert }: MergeFieldsPanelProps) {
  const headingId = useId()
  const addFieldId = useId()
  const [newKey, setNewKey] = useState('')

  // `null` means the text is not a JSON object: broken, or mid-edit in the
  // section below. Every write path is switched off while it is.
  const payload = parsePayloadObject(payloadText)
  const editable = payload !== null

  const payloadKeys = listPayloadKeys(payloadText)
  // Rows are everything either side knows about: what the document uses, then
  // anything left in the JSON, so a key nobody removed is visible rather than
  // silently gone.
  const rows = [...keys, ...payloadKeys.filter((key) => !keys.includes(key))]
  // The application layer's rule, not a second one: an empty string IS a value,
  // so the panel, the "Fill in missing keys" button and the diagnostics row all
  // count the same keys as unfilled.
  const missing = missingMergeFields(keys, payload ?? {})
  const canAdd = isMergeFieldKey(newKey)

  function addField() {
    if (!canAdd || !editable) return
    onInsert(newKey)
    onPayloadChange(setPayloadValue(payloadText, newKey, ''))
    setNewKey('')
  }

  /** The first thing that stops a control working, so one reason is shown. */
  function blockedBy(reason: string | undefined): string | undefined {
    return editable ? reason : BROKEN_JSON_REASON
  }

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <h3 id={headingId} className="text-xs font-medium">
          Merge fields
        </h3>
        <StatusBadge tone="neutral" dot={false}>
          {keys.length} in document
        </StatusBadge>
        <div className="ml-auto shrink-0">
          <ReasonedButton
            variant="ghost"
            size="xs"
            reason={blockedBy(missing.length === 0 ? NOTHING_MISSING_REASON : undefined)}
            onClick={() => onPayloadChange(withMissingKeys(payloadText, missing))}
          >
            Fill in missing keys
          </ReasonedButton>
        </div>
      </div>

      {editable ? null : (
        // Rows below show nothing while the text cannot be read, so the panel
        // says why rather than looking empty.
        <p className="text-warning-foreground text-[12.5px] leading-[18px]">
          The sample values are not valid JSON, so these fields are read-only. {BROKEN_JSON_REASON}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-[12.5px] leading-[18px]">{NO_MERGE_FIELDS_MESSAGE}</p>
      ) : (
        <ul role="list" className="flex min-w-0 flex-col gap-2">
          {rows.map((key) => (
            <MergeFieldRow
              key={key}
              fieldKey={key}
              value={readPayloadValue(payloadText, key)}
              inDocument={keys.includes(key)}
              missing={missing.includes(key)}
              editable={editable}
              onValueChange={(value) => onPayloadChange(setPayloadValue(payloadText, key, value))}
              onInsert={() => onInsert(key)}
            />
          ))}
        </ul>
      )}

      <div className="flex min-w-0 items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={addFieldId} className="meta-label">
            Add field
          </label>
          <Input
            id={addFieldId}
            value={newKey}
            spellCheck={false}
            autoComplete="off"
            placeholder="firstName"
            className="mt-1 h-8 font-mono text-xs md:text-xs"
            onChange={(event) => setNewKey(event.target.value)}
            onKeyDown={(event) => {
              // Enter is the obvious way to finish typing a name; the form this
              // field is not in would otherwise submit nothing at all.
              if (event.key !== 'Enter') return
              event.preventDefault()
              addField()
            }}
          />
        </div>
        <ReasonedButton
          variant="outline"
          size="sm"
          reason={blockedBy(canAdd ? undefined : INVALID_KEY_REASON)}
          onClick={addField}
        >
          <Plus aria-hidden="true" />
          Add field
        </ReasonedButton>
      </div>

      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="xs" className="w-full justify-start">
            Sample values (JSON)
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="studio-editor mt-2 h-[180px] overflow-hidden rounded-md border">
            <CodeEditor
              value={payloadText}
              onChange={onPayloadChange}
              language="json"
              label="Preview payload JSON"
            />
          </div>
          <p className="text-muted-foreground mt-2 text-[11px]">
            Values used by the preview and by test sends. They are never sent to real recipients.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </section>
  )
}

interface MergeFieldRowProps {
  fieldKey: string
  value: string
  inDocument: boolean
  /** No usable value in the payload, by `missingMergeFields`' rule. */
  missing: boolean
  /** False while the payload JSON does not parse; the input is then read-only. */
  editable: boolean
  onValueChange: (value: string) => void
  onInsert: () => void
}

/** One key: its token, its sample value, where it is used, and Insert. */
function MergeFieldRow({
  fieldKey,
  value,
  inDocument,
  missing,
  editable,
  onValueChange,
  onInsert,
}: MergeFieldRowProps) {
  const inputId = useId()

  return (
    <li className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-2">
        <label htmlFor={inputId} className="bg-muted min-w-0 truncate rounded px-1 font-mono text-[11px]">
          {`{{${fieldKey}}}`}
        </label>
        {/* Two chips, never both: a key is either unused or unfilled. */}
        {!inDocument ? <StatusBadge tone="neutral">Unused</StatusBadge> : null}
        {inDocument && missing ? <StatusBadge tone="warning">Not in payload</StatusBadge> : null}
        <div className="ml-auto shrink-0">
          <Button variant="ghost" size="icon-sm" aria-label={`Insert {{${fieldKey}}}`} onClick={onInsert}>
            <Plus aria-hidden="true" />
          </Button>
        </div>
      </div>
      <Input
        id={inputId}
        value={value}
        spellCheck={false}
        autoComplete="off"
        placeholder="Sample value"
        readOnly={!editable}
        className="h-8 text-xs md:text-xs"
        onChange={(event) => onValueChange(event.target.value)}
      />
    </li>
  )
}
