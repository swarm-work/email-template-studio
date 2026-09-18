/**
 * React wiring for the studio reducer + session persistence.
 * All state transitions live in application/studioState.ts; this hook only
 * connects them to React and to the browser session store.
 */
import { useEffect, useMemo, useReducer, useRef } from 'react'
import type {
  EmailDocument,
  EmailTemplate,
  PreviewDevice,
  StudioMode,
  TemplateEnvelope,
  TemplateId,
} from '@/domain'
import {
  createInitialState,
  getDraft,
  isDocumentDirty,
  isEnvelopeDirty,
  isPayloadDirty,
  isSourceDirty,
  isTemplateDirty,
  studioReducer,
  type ResolvedDraft,
  type StudioState,
} from '@/application/studioState'
import { clampMode } from '@/application/studioModes'
import type { PersistedStudioState, StudioSessionStore } from '@/infrastructure/session/sessionStore'

/**
 * Writing to sessionStorage means stringifying the whole state, which is too
 * much work for every keystroke. Half a second of typing is never lost, because
 * the pending state is also written when the page is hidden or the page unmounts.
 */
const SAVE_DEBOUNCE_MS = 500

export interface UseStudioOptions {
  readonly templates: readonly EmailTemplate[]
  readonly store: StudioSessionStore
}

export interface StudioActions {
  selectTemplate(id: TemplateId): void
  updateSource(source: string): void
  updatePayload(payloadText: string): void
  updateDocument(document: EmailDocument): void
  updateEnvelope(envelope: TemplateEnvelope): void
  resetSource(): void
  resetPayload(): void
  resetDocument(): void
  resetEnvelope(): void
  resetTemplate(): void
  setDevice(device: PreviewDevice): void
  setMode(mode: StudioMode): void
}

export interface UseStudioResult {
  readonly state: StudioState
  readonly template: EmailTemplate
  readonly draft: ResolvedDraft
  readonly sourceDirty: boolean
  readonly payloadDirty: boolean
  readonly documentDirty: boolean
  readonly envelopeDirty: boolean
  /** Ids of every template that currently has local edits. */
  readonly dirtyTemplateIds: ReadonlySet<TemplateId>
  readonly actions: StudioActions
}

export function useStudio({ templates, store }: UseStudioOptions): UseStudioResult {
  const [state, dispatch] = useReducer(studioReducer, undefined, () => hydrate(store.load(), templates))

  useDebouncedSave(state, store)

  const template = useMemo(
    () => templates.find((candidate) => candidate.metadata.id === state.selectedId) ?? templates[0],
    [templates, state.selectedId],
  )
  const id = template.metadata.id

  const actions = useMemo<StudioActions>(
    () => ({
      selectTemplate: (next) => {
        const target = templates.find((candidate) => candidate.metadata.id === next)
        dispatch({ type: 'select-template', id: next, kind: target?.kind })
      },
      updateSource: (source) => dispatch({ type: 'edit-source', id, template, source }),
      updatePayload: (payloadText) => dispatch({ type: 'edit-payload', id, template, payloadText }),
      updateDocument: (document) => dispatch({ type: 'edit-document', id, template, document }),
      updateEnvelope: (envelope) => dispatch({ type: 'edit-envelope', id, template, envelope }),
      resetSource: () => dispatch({ type: 'reset-source', id }),
      resetPayload: () => dispatch({ type: 'reset-payload', id }),
      resetDocument: () => dispatch({ type: 'reset-document', id }),
      resetEnvelope: () => dispatch({ type: 'reset-envelope', id }),
      resetTemplate: () => dispatch({ type: 'reset-template', id }),
      setDevice: (device) => dispatch({ type: 'set-device', device }),
      setMode: (mode) => dispatch({ type: 'set-mode', mode, kind: template.kind }),
    }),
    [id, template, templates],
  )

  const dirtyTemplateIds = useMemo(
    () =>
      new Set(
        templates
          .filter((candidate) => isTemplateDirty(state, candidate))
          .map((candidate) => candidate.metadata.id),
      ),
    [templates, state],
  )

  return {
    state,
    template,
    draft: getDraft(state, template),
    sourceDirty: isSourceDirty(state, template),
    payloadDirty: isPayloadDirty(state, template),
    documentDirty: isDocumentDirty(state, template),
    envelopeDirty: isEnvelopeDirty(state, template),
    dirtyTemplateIds,
    actions,
  }
}

/**
 * Saves `state` half a second after the last change, and immediately when the
 * page goes away (`pagehide` covers closing the tab and the bfcache) or this
 * hook unmounts, so no edit is lost inside the debounce window.
 */
function useDebouncedSave(state: StudioState, store: StudioSessionStore): void {
  /** The state that is waiting to be written, or null when nothing is pending. */
  const pending = useRef<StudioState | null>(null)

  useEffect(() => {
    pending.current = state
    const timer = setTimeout(() => {
      // A `pagehide` in the meantime already wrote this state.
      if (pending.current === null) return
      pending.current = null
      store.save(state)
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [state, store])

  useEffect(() => {
    const flush = () => {
      if (pending.current === null) return
      const snapshot = pending.current
      pending.current = null
      store.save(snapshot)
    }
    if (typeof window === 'undefined') return flush
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [store])
}

/** Rebuilds state from storage, dropping anything that refers to unknown templates. */
export function hydrate(
  persisted: PersistedStudioState | null,
  templates: readonly EmailTemplate[],
): StudioState {
  const fallback = createInitialState(templates[0].metadata.id, templates[0].kind)
  if (!persisted) return fallback
  const known = new Map(templates.map((template) => [template.metadata.id as string, template]))
  const selected = known.has(persisted.selectedId)
    ? (persisted.selectedId as TemplateId)
    : fallback.selectedId
  const selectedTemplate = known.get(selected) ?? templates[0]
  return {
    selectedId: selected,
    drafts: Object.fromEntries(Object.entries(persisted.drafts).filter(([key]) => known.has(key))),
    device: persisted.device,
    // A stored mode can belong to the other kind of template (or to a template
    // that has since been converted), so it is clamped on the way in.
    mode: clampMode(selectedTemplate.kind, persisted.mode),
  }
}
