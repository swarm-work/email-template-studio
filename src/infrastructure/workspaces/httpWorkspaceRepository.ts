/**
 * The `WorkspaceRepository` port, spoken over `/api/workspaces`.
 *
 * Infrastructure layer, modelled on `httpTemplateRepository.ts`: no React, no
 * DOM, nothing throws. Every response is parsed with the schemas in
 * `@shared/workspaceContracts` and every failure becomes a `RepositoryFailure`
 * the UI can put into a sentence.
 */
import type { RepositoryFailure, RepositoryResult } from '@/application/repositories/templateRepository'
import type {
  NewWorkspaceInput,
  WorkspacePatch,
  WorkspaceRepository,
} from '@/application/repositories/workspaceRepository'
import type { Workspace, WorkspaceMember, WorkspaceRole } from '@/domain'
import { apiErrorSchema, STUDIO_API_HEADER } from '@shared/templateContracts'
import {
  memberListResponse,
  memberRemovedResponse,
  memberResponse,
  WORKSPACES_API_PATH,
  workspaceApiPath,
  workspaceListResponse,
  workspaceResponse,
} from '@shared/workspaceContracts'
import type { z } from 'zod'

export interface HttpWorkspaceRepositoryOptions {
  /** Injectable `fetch`, which is how every test drives this adapter. */
  readonly fetchImpl?: typeof fetch
}

export function createHttpWorkspaceRepository(
  options: HttpWorkspaceRepositoryOptions = {},
): WorkspaceRepository {
  return new HttpWorkspaceRepository(options)
}

class HttpWorkspaceRepository implements WorkspaceRepository {
  readonly #fetch: typeof fetch

  constructor({ fetchImpl }: HttpWorkspaceRepositoryOptions) {
    this.#fetch = fetchImpl ?? ((...args) => fetch(...args))
  }

  async list(): Promise<RepositoryResult<readonly Workspace[]>> {
    const result = await this.#request(WORKSPACES_API_PATH, {}, workspaceListResponse)
    return result.ok ? { ok: true, value: result.value.workspaces } : result
  }

  async create(input: NewWorkspaceInput): Promise<RepositoryResult<Workspace>> {
    const result = await this.#request(
      WORKSPACES_API_PATH,
      {
        method: 'POST',
        body: {
          name: input.name,
          ...(input.slug === undefined ? {} : { slug: input.slug }),
          defaultFrom: input.defaultFrom,
        },
      },
      workspaceResponse,
    )
    return result.ok ? { ok: true, value: result.value.workspace } : result
  }

  async update(slug: string, patch: WorkspacePatch): Promise<RepositoryResult<Workspace>> {
    // A `strictObject` on the server: keys the caller left out must not travel
    // as `undefined` (JSON drops them, but the explicit-null cases must stay).
    const body: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(patch)) if (value !== undefined) body[key] = value
    const result = await this.#request(workspaceApiPath(slug), { method: 'PATCH', body }, workspaceResponse)
    return result.ok ? { ok: true, value: result.value.workspace } : result
  }

  async listMembers(slug: string): Promise<RepositoryResult<readonly WorkspaceMember[]>> {
    const result = await this.#request(workspaceApiPath(slug, '/members'), {}, memberListResponse)
    return result.ok ? { ok: true, value: result.value.members } : result
  }

  async putMember(
    slug: string,
    email: string,
    role: WorkspaceRole,
  ): Promise<RepositoryResult<WorkspaceMember>> {
    const result = await this.#request(
      workspaceApiPath(slug, `/members/${encodeURIComponent(email)}`),
      { method: 'PUT', body: { role } },
      memberResponse,
    )
    return result.ok ? { ok: true, value: result.value.member } : result
  }

  async removeMember(slug: string, email: string): Promise<RepositoryResult<void>> {
    const result = await this.#request(
      workspaceApiPath(slug, `/members/${encodeURIComponent(email)}`),
      { method: 'DELETE', omitContentType: true },
      memberRemovedResponse,
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  /** One request, start to finish; the only place that touches `fetch` or builds a failure. */
  async #request<T>(
    url: string,
    { method = 'GET', body, omitContentType = false }: RequestOptions,
    schema: z.ZodType<T>,
  ): Promise<RepositoryResult<T>> {
    let response: Response
    try {
      response = await this.#fetch(url, {
        method,
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          ...(method === 'GET' ? {} : { [STUDIO_API_HEADER]: '1' }),
          ...(omitContentType || body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      return failure(
        'unreachable',
        'The studio could not reach the workspace API. Check your connection and try again.',
      )
    }

    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) return { ok: false, failure: failureFor(response.status, payload) }

    const parsed = schema.safeParse(payload)
    if (!parsed.success) {
      return failure(
        'unexpected',
        'The workspace API answered with something this studio does not understand.',
      )
    }
    return { ok: true, value: parsed.data }
  }
}

interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  readonly body?: unknown
  readonly omitContentType?: boolean
}

/**
 * HTTP status + error body -> the failure the UI explains. `last-admin` is a
 * 409 too, and travels as `invalid` with the server's own sentence, because
 * that is what it is to the person on the settings page: something they typed
 * that cannot be done as typed.
 */
function failureFor(status: number, payload: unknown): RepositoryFailure {
  const parsed = apiErrorSchema.safeParse(payload)
  const error = parsed.success ? parsed.data : null
  const message = error?.message ?? `The workspace API answered with HTTP ${status}.`
  switch (status) {
    case 400:
    case 415:
      return { code: 'invalid', message }
    case 401:
      return { code: 'unauthenticated', message }
    case 403:
      return { code: 'forbidden', message }
    case 404:
      return { code: 'not-found', message }
    case 409:
      return error?.code === 'slug-taken' ? { code: 'slug-taken', message } : { code: 'invalid', message }
    case 503:
      return { code: 'storage-unavailable', message }
    default:
      return { code: 'unexpected', message }
  }
}

function failure(
  code: Exclude<RepositoryFailure['code'], 'version-conflict'>,
  message: string,
): { readonly ok: false; readonly failure: RepositoryFailure } {
  return { ok: false, failure: { code, message } }
}
