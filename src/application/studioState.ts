/**
 * Studio state: which template is selected, per-template drafts, device, mode.
 *
 * Implemented as a pure reducer so that every state transition is a plain
 * function we can unit test. React wiring lives in useStudio.ts. Application
 * layer: no React, no DOM, no Zod.
 *
 * Drafts are stored PER TEMPLATE. Switching templates therefore never
 * discards edits; they are simply waiting under the other card.
 */
import {
  templateDocument,
  templateSource,
  type EmailDocument,
  type EmailTemplate,
  type PreviewDevice,
  type StudioMode,
  type TemplateEnvelope,
  type TemplateId,
  type TemplateKind,
  type TemplateRecord,
} from '@/domain'
import { clampMode, defaultMode } from './studioModes'

/**
 * Unsaved edits to one template.
 *
 * Two sentinels keep the reducer free of template lookups: text fields use ''
 * and object fields use null to mean "unchanged, show the saved value".
 */
export interface TemplateDraft {
  /** The template revision this draft started from. 0 = unknown (an older stored payload). */
  readonly baseRevision: number
  /** The version number the draft started from; used for the conflict banner's wording. */
  readonly baseVersionNumber: number
  readonly source: string
  readonly payloadText: string
  readonly document: EmailDocument | null
  readonly envelope: TemplateEnvelope | null
}

/**
 * The same fields with the sentinels already resolved: what the editors show.
 * `document` is still nullable, because a code template simply has none.
 */
export interface ResolvedDraft {
  readonly baseRevision: number
  readonly baseVersionNumber: number
  readonly source: string
  readonly payloadText: string
  readonly document: EmailDocument | null
  readonly envelope: TemplateEnvelope
}

export interface StudioState {
  readonly selectedId: TemplateId
  /** Only templates that have been edited have an entry here. */
  readonly drafts: Readonly<Record<string, TemplateDraft>>
  readonly device: PreviewDevice
  /** Which workspace is showing; always one the selected template's kind offers. */
  readonly mode: StudioMode
}

export type StudioAction =
  /** `kind` is optional so that selecting an unknown id simply leaves the mode alone. */
  | { readonly type: 'select-template'; readonly id: TemplateId; readonly kind?: TemplateKind }
  | {
      readonly type: 'edit-source'
      readonly id: TemplateId
      readonly source: string
      readonly template: EmailTemplate
    }
  | {
      readonly type: 'edit-payload'
      readonly id: TemplateId
      readonly payloadText: string
      readonly template: EmailTemplate
    }
  | {
      readonly type: 'edit-document'
      readonly id: TemplateId
      readonly document: EmailDocument
      readonly template: EmailTemplate
    }
  | {
      readonly type: 'edit-envelope'
      readonly id: TemplateId
      readonly envelope: TemplateEnvelope
      readonly template: EmailTemplate
    }
  | { readonly type: 'reset-source'; readonly id: TemplateId }
  | { readonly type: 'reset-payload'; readonly id: TemplateId }
  | { readonly type: 'reset-document'; readonly id: TemplateId }
  | { readonly type: 'reset-envelope'; readonly id: TemplateId }
  | { readonly type: 'reset-template'; readonly id: TemplateId }
  | { readonly type: 'set-device'; readonly device: PreviewDevice }
  | { readonly type: 'set-mode'; readonly mode: StudioMode; readonly kind: TemplateKind }
  /** The server accepted a save: the draft is rebased onto the version it wrote. */
  | { readonly type: 'template-saved'; readonly record: TemplateRecord }
  /**
   * The server accepted a METADATA change. It moved the revision without
   * writing a version, so `expectedRevision` says which revision it was made
   * against — see the reducer for why that matters.
   */
  | {
      readonly type: 'metadata-saved'
      readonly record: TemplateRecord
      readonly expectedRevision: number
    }
  /** A new template exists: select it and open its own editor. */
  | { readonly type: 'template-created'; readonly record: TemplateRecord }

export function createInitialState(selectedId: TemplateId, kind: TemplateKind = 'code'): StudioState {
  return { selectedId, drafts: {}, device: 'desktop', mode: defaultMode(kind) }
}

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case 'select-template': {
      const mode = action.kind ? clampMode(action.kind, state.mode) : state.mode
      if (state.selectedId === action.id && state.mode === mode) return state
      return { ...state, selectedId: action.id, mode }
    }

    case 'edit-source': {
      const current = getDraft(state, action.template)
      return withDraft(state, action.id, action.template, { ...current, source: action.source })
    }

    case 'edit-payload': {
      const current = getDraft(state, action.template)
      return withDraft(state, action.id, action.template, { ...current, payloadText: action.payloadText })
    }

    case 'edit-document': {
      // The visual editor fires one `onUpdate` on load for content that is not
      // container-rooted; swallowing that first event is the editor surface's
      // job (phase 5), not the reducer's — it cannot tell a load from a person
      // typing. See the plan's §3.3 and its risk table.
      const current = getDraft(state, action.template)
      return withDraft(state, action.id, action.template, { ...current, document: action.document })
    }

    case 'edit-envelope': {
      const current = getDraft(state, action.template)
      return withDraft(state, action.id, action.template, { ...current, envelope: action.envelope })
    }

    case 'reset-source':
      return clearDraftField(state, action.id, { source: '' })

    case 'reset-payload':
      return clearDraftField(state, action.id, { payloadText: '' })

    case 'reset-document':
      return clearDraftField(state, action.id, { document: null })

    case 'reset-envelope':
      return clearDraftField(state, action.id, { envelope: null })

    case 'reset-template':
      return removeDraft(state, action.id)

    case 'set-device':
      return state.device === action.device ? state : { ...state, device: action.device }

    case 'set-mode': {
      const mode = clampMode(action.kind, action.mode)
      return state.mode === mode ? state : { ...state, mode }
    }

    case 'template-saved': {
      // The draft is REBASED, not dropped. What was just saved is exactly what
      // the draft holds, so dropping it here would make the editors fall back
      // to the OLD record for the moment it takes the library to refetch — the
      // canvas would blink and CodeMirror would lose the cursor. Once the new
      // record arrives, every field compares equal to it and the "Unsaved
      // changes" badge goes quiet on its own (see `isTemplateDirty`).
      const draft = state.drafts[action.record.metadata.id]
      if (!draft) return state
      const rebased: TemplateDraft = {
        ...draft,
        baseRevision: action.record.metadata.revision,
        baseVersionNumber: action.record.metadata.version.number,
      }
      return { ...state, drafts: { ...state.drafts, [action.record.metadata.id]: rebased } }
    }

    case 'metadata-saved': {
      // A metadata PATCH moves the revision but says NOTHING about the content
      // the draft is based on, so it may only rebase a draft that was still in
      // step with the server. If the draft had already fallen behind — somebody
      // else saved a version while this one was being typed — rebasing here
      // would quietly erase that fact: the banner would go away and the next
      // save would be accepted, overwriting their version with edits made
      // against an older one. In that case the draft is left exactly as it is,
      // so the conflict is still there to be resolved.
      // `baseVersionNumber` never moves either way: no version was written.
      const draft = state.drafts[action.record.metadata.id]
      if (!draft || draft.baseRevision !== action.expectedRevision) return state
      const rebased: TemplateDraft = { ...draft, baseRevision: action.record.metadata.revision }
      return { ...state, drafts: { ...state.drafts, [action.record.metadata.id]: rebased } }
    }

    case 'template-created': {
      const { metadata, kind } = action.record
      return { ...state, selectedId: metadata.id, mode: defaultMode(kind) }
    }
  }
}

/**
 * Stores a draft, or removes it when it equals the saved template so that the
 * "modified" indicator disappears as soon as the user undoes their change.
 *
 * Note: the reset actions store the '' / null sentinels; getDraft() maps them
 * back to the saved values. This keeps the reducer free of template lookups.
 */
function withDraft(
  state: StudioState,
  id: TemplateId,
  template: EmailTemplate,
  draft: TemplateDraft,
): StudioState {
  const savedDocument = templateDocument(template)
  const normalized: TemplateDraft = {
    baseRevision: draft.baseRevision,
    baseVersionNumber: draft.baseVersionNumber,
    source: draft.source === templateSource(template) ? '' : draft.source,
    payloadText: draft.payloadText === template.samplePayloadText ? '' : draft.payloadText,
    // Documents are compared by value: the editor hands us a fresh object on
    // every keystroke, so identity would always say "modified".
    document:
      draft.document !== null && stableStringify(draft.document) === stableStringify(savedDocument)
        ? null
        : draft.document,
    envelope:
      draft.envelope !== null && sameEnvelope(draft.envelope, template.envelope) ? null : draft.envelope,
  }
  if (isEmptyDraft(normalized)) return removeDraft(state, id)
  return { ...state, drafts: { ...state.drafts, [id]: normalized } }
}

/** Puts one field back to its sentinel; a no-op when the template has no draft. */
function clearDraftField(state: StudioState, id: TemplateId, patch: Partial<TemplateDraft>): StudioState {
  const draft = state.drafts[id]
  if (!draft) return state
  const next: TemplateDraft = { ...draft, ...patch }
  if (isEmptyDraft(next)) return removeDraft(state, id)
  return { ...state, drafts: { ...state.drafts, [id]: next } }
}

function isEmptyDraft(draft: TemplateDraft): boolean {
  return draft.source === '' && draft.payloadText === '' && draft.document === null && draft.envelope === null
}

function removeDraft(state: StudioState, id: TemplateId): StudioState {
  if (!(id in state.drafts)) return state
  const drafts = { ...state.drafts }
  delete drafts[id]
  return { ...state, drafts }
}

function sameEnvelope(a: TemplateEnvelope, b: TemplateEnvelope): boolean {
  return a.subject === b.subject && a.preheader === b.preheader && a.replyTo === b.replyTo
}

/**
 * JSON with object keys sorted, so two documents that differ only in key order
 * compare equal. Arrays keep their order, which matters: they are the content.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
  return `{${entries.join(',')}}`
}

/** What the editors should show: the draft where there is one, else the saved template. */
export function getDraft(state: StudioState, template: EmailTemplate): ResolvedDraft {
  const draft = state.drafts[template.metadata.id]
  return {
    baseRevision: draft ? draft.baseRevision : template.metadata.revision,
    baseVersionNumber: draft ? draft.baseVersionNumber : template.metadata.version.number,
    source: draft && draft.source !== '' ? draft.source : templateSource(template),
    payloadText: draft && draft.payloadText !== '' ? draft.payloadText : template.samplePayloadText,
    document: draft && draft.document !== null ? draft.document : templateDocument(template),
    envelope: draft && draft.envelope !== null ? draft.envelope : template.envelope,
  }
}

export function isSourceDirty(state: StudioState, template: EmailTemplate): boolean {
  const draft = state.drafts[template.metadata.id]
  return Boolean(draft && draft.source !== '' && draft.source !== templateSource(template))
}

export function isPayloadDirty(state: StudioState, template: EmailTemplate): boolean {
  const draft = state.drafts[template.metadata.id]
  return Boolean(draft && draft.payloadText !== '' && draft.payloadText !== template.samplePayloadText)
}

export function isDocumentDirty(state: StudioState, template: EmailTemplate): boolean {
  const draft = state.drafts[template.metadata.id]
  if (!draft || draft.document === null) return false
  return stableStringify(draft.document) !== stableStringify(templateDocument(template))
}

export function isEnvelopeDirty(state: StudioState, template: EmailTemplate): boolean {
  const draft = state.drafts[template.metadata.id]
  if (!draft || draft.envelope === null) return false
  return !sameEnvelope(draft.envelope, template.envelope)
}

/** True when anything at all is unsaved: source, payload, document or envelope. */
export function isTemplateDirty(state: StudioState, template: EmailTemplate): boolean {
  return (
    isSourceDirty(state, template) ||
    isPayloadDirty(state, template) ||
    isDocumentDirty(state, template) ||
    isEnvelopeDirty(state, template)
  )
}
