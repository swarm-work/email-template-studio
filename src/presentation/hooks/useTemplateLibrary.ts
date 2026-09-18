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
  }
}

export interface UseTemplateLibraryResult {
  readonly state: TemplateLibraryState
  /** Fetches the list again, e.g. from the Retry button. */
  reload(): void
  create(
    input: NewTemplateInput & { readonly initialVersion: VersionInput },
  ): Promise<RepositoryResult<EmailTemplate>>
  saveVersion(
    id: TemplateId,
    expectedRevision: number,
    input: VersionInput,
  ): Promise<RepositoryResult<EmailTemplate>>
  remove(id: TemplateId): Promise<RepositoryResult<void>>
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

  const writes = useMemo(
    () => ({
      async create(input: NewTemplateInput & { readonly initialVersion: VersionInput }) {
        const result = await repository.create(input)
        if (result.ok) setAttempt((count) => count + 1)
        return mapResult(result)
      },
      async saveVersion(id: TemplateId, expectedRevision: number, input: VersionInput) {
        const result = await repository.saveVersion(id, expectedRevision, input)
        if (result.ok) setAttempt((count) => count + 1)
        return mapResult(result)
      },
      async remove(id: TemplateId) {
        const result = await repository.remove(id)
        if (result.ok) setAttempt((count) => count + 1)
        return result
      },
    }),
    [repository],
  )

  return { state, reload, ...writes }
}

/** Gives a returned record its validator, so callers get the same shape as the list. */
function mapResult(result: RepositoryResult<TemplateRecord>): RepositoryResult<EmailTemplate> {
  return result.ok ? { ok: true, value: toEmailTemplate(result.value) } : result
}
