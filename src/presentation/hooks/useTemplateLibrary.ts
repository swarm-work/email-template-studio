/**
 * React wiring for the template repository.
 *
 * Presentation layer: it holds no rules of its own. It calls the repository,
 * turns the four things that can happen into one `state` value, and maps the
 * records it gets back into `EmailTemplate`s through the infrastructure mapper.
 * Anything that decides *what* a template is belongs in domain/application.
 */
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react'
import type { EmailTemplate, TemplateId, TemplateRecord } from '@/domain'
import type {
  NewTemplateInput,
  RepositoryFailure,
  RepositoryResult,
  TemplateMetadataPatch,
  TemplateRepository,
  VersionInput,
} from '@/application/repositories/templateRepository'
import { toEmailTemplate } from '@/infrastructure/templates/templateMapper'

/**
 * The four states a list can be in. Making "no templates" its own state (rather
 * than `ready` with an empty array) is what lets the route render the empty
 * screen without every caller remembering to check `length === 0`.
 */
export type TemplateLibraryState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly failure: RepositoryFailure }
  | { readonly kind: 'empty' }
  | { readonly kind: 'ready'; readonly templates: readonly EmailTemplate[] }

type LibraryAction =
  | { readonly type: 'loading' }
  | { readonly type: 'loaded'; readonly templates: readonly EmailTemplate[] }
  | { readonly type: 'failed'; readonly failure: RepositoryFailure }
  /** A write answered with the whole record; the list takes it straight away. */
  | { readonly type: 'replaced'; readonly template: EmailTemplate }

function reducer(state: TemplateLibraryState, action: LibraryAction): TemplateLibraryState {
  switch (action.type) {
    case 'loading':
      // Only the FIRST load shows the skeleton. A refetch (after a save, say)
      // keeps whatever is on screen and swaps it when the new list lands: going
      // back through `loading` would unmount the editor — CodeMirror, its undo
      // history and the preview iframe with it — for one frame on every write.
      return state.kind === 'loading' || state.kind === 'error' ? { kind: 'loading' } : state
    case 'loaded':
      return action.templates.length === 0
        ? { kind: 'empty' }
        : { kind: 'ready', templates: action.templates }
    case 'failed':
      return { kind: 'error', failure: action.failure }
    case 'replaced': {
      // The record the server just answered with is newer than anything a list
      // request could still be carrying, so it is applied the moment it lands.
      // Waiting for the refetch instead left a window in which the screen
      // showed the OLD revision: the badge still said "Unsaved changes", the
      // status bar still said the previous version, and the next metadata PATCH
      // went out quoting a revision the server had already moved past.
      if (state.kind === 'empty') return { kind: 'ready', templates: [action.template] }
      if (state.kind !== 'ready') return state
      const id = action.template.metadata.id
      const known = state.templates.some((template) => template.metadata.id === id)
      const templates = known
        ? state.templates.map((template) => (template.metadata.id === id ? action.template : template))
        : // A brand-new template goes to the front, which is where the list's
          // newest-first order will put it when the refetch lands.
          [action.template, ...state.templates]
      return { kind: 'ready', templates }
    }
  }
}

/**
 * The four writes, as one value.
 *
 * They are grouped because the library screen and the studio screen each need
 * some of them and neither needs the list state: handing one object down is a
 * lot less noise than four callbacks on every component between here and there.
 * The identity is stable (a `useMemo` on the repository), so passing it as a
 * prop does not re-render anything.
 */
export interface TemplateWrites {
  create(
    input: NewTemplateInput & { readonly initialVersion: VersionInput },
  ): Promise<RepositoryResult<EmailTemplate>>
  saveVersion(
    id: TemplateId,
    expectedRevision: number,
    input: VersionInput,
  ): Promise<RepositoryResult<EmailTemplate>>
  /** Metadata only: name, slug, description, category, status, tags. No new version. */
  updateMetadata(
    id: TemplateId,
    expectedRevision: number,
    patch: TemplateMetadataPatch,
  ): Promise<RepositoryResult<EmailTemplate>>
  remove(id: TemplateId): Promise<RepositoryResult<void>>
}

export interface UseTemplateLibraryResult extends TemplateWrites {
  readonly state: TemplateLibraryState
  /** Fetches the list again, e.g. from the Retry button. */
  reload(): void
  /** The four writes as one value, for handing to a screen. */
  readonly writes: TemplateWrites
}

export function useTemplateLibrary(repository: TemplateRepository): UseTemplateLibraryResult {
  const [state, dispatch] = useReducer(reducer, { kind: 'loading' })
  // Bumping this re-runs the effect below; that is all "reload" means.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    // The repository has no `signal` parameter (an in-memory one has nothing to
    // cancel), so the controller is used as a plain "is this answer still
    // wanted?" flag: it stops a slow list from overwriting a newer one, and
    // stops React warning about a state update after unmount.
    const controller = new AbortController()
    // A no-op unless there is nothing to show yet; see the reducer.
    dispatch({ type: 'loading' })
    void repository.list().then((result) => {
      if (controller.signal.aborted) return
      if (result.ok) dispatch({ type: 'loaded', templates: result.value.map(toEmailTemplate) })
      else dispatch({ type: 'failed', failure: result.failure })
    })
    return () => controller.abort()
  }, [repository, attempt])

  const reload = useCallback(() => setAttempt((count) => count + 1), [])

  // Every write that answers with a record patches the list with it before the
  // caller is told it worked, so the screen and the server never disagree about
  // which revision is current. A create or a delete ALSO refetches, because
  // those change which templates exist and in what order; a save or a metadata
  // patch does not, and a refetch there would be 1 + N requests (TECH_DEBT #42)
  // to learn what the answer already told us.
  const writes = useMemo<TemplateWrites>(
    () => ({
      async create(input: NewTemplateInput & { readonly initialVersion: VersionInput }) {
        const result = await repository.create(input)
        const mapped = mapResult(result)
        if (mapped.ok) {
          dispatch({ type: 'replaced', template: mapped.value })
          setAttempt((count) => count + 1)
        }
        return mapped
      },
      async saveVersion(id: TemplateId, expectedRevision: number, input: VersionInput) {
        const mapped = mapResult(await repository.saveVersion(id, expectedRevision, input))
        if (mapped.ok) dispatch({ type: 'replaced', template: mapped.value })
        return mapped
      },
      async updateMetadata(id: TemplateId, expectedRevision: number, patch: TemplateMetadataPatch) {
        const mapped = mapResult(await repository.updateMetadata(id, expectedRevision, patch))
        if (mapped.ok) dispatch({ type: 'replaced', template: mapped.value })
        return mapped
      },
      async remove(id: TemplateId) {
        const result = await repository.remove(id)
        if (result.ok) setAttempt((count) => count + 1)
        return result
      },
    }),
    [repository],
  )

  return { state, reload, writes, ...writes }
}

/** Gives a returned record its validator, so callers get the same shape as the list. */
function mapResult(result: RepositoryResult<TemplateRecord>): RepositoryResult<EmailTemplate> {
  return result.ok ? { ok: true, value: toEmailTemplate(result.value) } : result
}
