/**
 * The `TemplateRepository` port, spoken over the template API (D1 behind it).
 *
 * Infrastructure layer, modelled on `providers/emailProvider.ts`: no React, no
 * DOM, and nothing here throws. Every response is parsed with the schemas in
 * `@shared/templateContracts` — the network is an untrusted boundary — and
 * every failure becomes a `RepositoryFailure` the UI can explain in words.
 */
import type {
  ConvertToCodeInput,
  NewTemplateInput,
  RepositoryFailure,
  RepositoryResult,
  TemplateMetadataPatch,
  TemplateRepository,
  TemplateVersionSummary,
  VersionInput,
} from '@/application/repositories/templateRepository'
import { templateId, type TemplateId, type TemplateRecord } from '@/domain'
import {
  apiErrorSchema,
  deletedResponse,
  STUDIO_API_HEADER,
  templateListResponse,
  templateResponse,
  versionListResponse,
} from '@shared/templateContracts'
import type { z } from 'zod'
import { toTemplateRecord, toVersionBody } from './templateMapper'

/** Where the API lives. Same origin, so the session cookie travels with it. */
const DEFAULT_BASE_URL = '/api/templates'

export interface HttpTemplateRepositoryOptions {
  /** Overridable so tests can point at a stub; production never sets it. */
  readonly baseUrl?: string
  /** Injectable `fetch`, which is how every test drives this adapter. */
  readonly fetchImpl?: typeof fetch
}

/** Builds the adapter the studio runs against when `VITE_DATA_MODE` is 'http'. */
export function createHttpTemplateRepository(
  options: HttpTemplateRepositoryOptions = {},
): TemplateRepository {
  return new HttpTemplateRepository(options)
}

class HttpTemplateRepository implements TemplateRepository {
  readonly #baseUrl: string
  readonly #fetch: typeof fetch

  constructor({ baseUrl = DEFAULT_BASE_URL, fetchImpl }: HttpTemplateRepositoryOptions) {
    this.#baseUrl = baseUrl
    this.#fetch = fetchImpl ?? ((...args) => fetch(...args))
  }

  /**
   * The list, with each template's current version.
   *
   * `GET /api/templates` deliberately carries no content blobs, but the port
   * promises whole records — the studio opens a template straight from the
   * list — so each summary is followed by its detail request. The requests go
   * out together rather than one after another, and the library holds at most
   * a few dozen templates; growing past that is the pagination work in
   * docs/TECH_DEBT.md (#25, #42).
   */
  async list(): Promise<RepositoryResult<readonly TemplateRecord[]>> {
    const summaries = await this.#request(this.#baseUrl, {}, templateListResponse)
    if (!summaries.ok) return summaries
    const details = await Promise.all(
      summaries.value.templates.map((summary) => this.get(templateId(summary.id))),
    )
    const records: TemplateRecord[] = []
    for (const detail of details) {
      // A template deleted between the two requests is not an error: it is
      // simply not in the library any more.
      if (detail.ok) records.push(detail.value)
      else if (detail.failure.code !== 'not-found') return detail
    }
    return { ok: true, value: records }
  }

  async get(id: TemplateId): Promise<RepositoryResult<TemplateRecord>> {
    return this.#template(`${this.#baseUrl}/${encodeURIComponent(id)}`, {})
  }

  async create(
    input: NewTemplateInput & { readonly initialVersion: VersionInput },
  ): Promise<RepositoryResult<TemplateRecord>> {
    return this.#template(this.#baseUrl, {
      method: 'POST',
      body: {
        name: input.name,
        ...(input.slug === undefined ? {} : { slug: input.slug }),
        description: input.description,
        category: input.category,
        tags: input.tags ?? [],
        initialVersion: toVersionBody(input.initialVersion),
      },
    })
  }

  async saveVersion(
    id: TemplateId,
    expectedRevision: number,
    input: VersionInput,
  ): Promise<RepositoryResult<TemplateRecord>> {
    return this.#template(`${this.#baseUrl}/${encodeURIComponent(id)}/versions`, {
      method: 'POST',
      body: { expectedRevision, version: toVersionBody(input) },
      // The API answers 422 here when the new version is of the other kind.
      // For a SAVE that is simply a version this template cannot accept, so
      // the port calls it 'invalid'; 'not-visual' is reserved for the one
      // question it answers — "can this template be converted?".
      unprocessable: 'invalid',
    })
  }

  async updateMetadata(
    id: TemplateId,
    expectedRevision: number,
    patch: TemplateMetadataPatch,
  ): Promise<RepositoryResult<TemplateRecord>> {
    // The request body is a `strictObject`, so a key the caller left out must
    // not travel as `undefined` — `JSON.stringify` drops those, but spreading
    // an explicit `undefined` through would still send `tags: null` for some
    // shapes. Building the object from defined entries keeps the wire minimal.
    return this.#template(`${this.#baseUrl}/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { expectedRevision, ...definedOnly(patch) },
    })
  }

  async remove(id: TemplateId): Promise<RepositoryResult<void>> {
    // DELETE carries no body, so it declares no content type; the studio header
    // alone is what the server checks (server/http.ts).
    const result = await this.#request(
      `${this.#baseUrl}/${encodeURIComponent(id)}`,
      { method: 'DELETE', omitContentType: true },
      deletedResponse,
    )
    return result.ok ? { ok: true, value: undefined } : result
  }

  async listVersions(id: TemplateId): Promise<RepositoryResult<readonly TemplateVersionSummary[]>> {
    const result = await this.#request(
      `${this.#baseUrl}/${encodeURIComponent(id)}/versions`,
      {},
      versionListResponse,
    )
    return result.ok ? { ok: true, value: result.value.versions } : result
  }

  async convertToCode(id: TemplateId, input: ConvertToCodeInput): Promise<RepositoryResult<TemplateRecord>> {
    return this.#template(`${this.#baseUrl}/${encodeURIComponent(id)}/convert`, {
      method: 'POST',
      body: {
        expectedRevision: input.expectedRevision,
        source: input.source,
        html: input.html,
        text: input.text,
        propsSample: input.samplePayloadText,
        propsSchema: input.propsSchemaText,
        note: input.note ?? '',
      },
    })
  }

  /** The six calls that answer with one template, in one place. */
  async #template(url: string, init: RequestOptions): Promise<RepositoryResult<TemplateRecord>> {
    const result = await this.#request(url, init, templateResponse)
    return result.ok ? { ok: true, value: toTemplateRecord(result.value.template) } : result
  }

  /**
   * One request, start to finish: send it, decide whether it succeeded, and
   * parse the body with the schema the caller named. The only place in this
   * file that touches `fetch`, and the only place a failure is built.
   */
  async #request<T>(
    url: string,
    { method = 'GET', body, omitContentType = false, unprocessable = 'not-visual' }: RequestOptions,
    schema: z.ZodType<T>,
  ): Promise<RepositoryResult<T>> {
    let response: Response
    try {
      response = await this.#fetch(url, {
        method,
        // Same-origin API behind the same gate as the page, so the session
        // cookie has to travel; `omit` would make every call a 401.
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          // Cross-site pages cannot set a custom header without a preflight the
          // API never answers, so this is the CSRF guard (shared/templateContracts.ts).
          ...(method === 'GET' ? {} : { [STUDIO_API_HEADER]: '1' }),
          ...(omitContentType || body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      return failure('unreachable', UNREACHABLE_MESSAGE)
    }

    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) return { ok: false, failure: failureFor(response.status, payload, unprocessable) }

    const parsed = schema.safeParse(payload)
    if (!parsed.success) return failure('unexpected', UNEXPECTED_BODY_MESSAGE)
    return { ok: true, value: parsed.data }
  }
}

/** What a caller of `#request` gets to choose. */
interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  /** Serialised as JSON; absent means no body and no content type. */
  readonly body?: unknown
  /** DELETE has nothing to declare a type for, and the server checks none. */
  readonly omitContentType?: boolean
  /** What a 422 means for THIS call. Defaults to 'not-visual' (the convert route). */
  readonly unprocessable?: 'not-visual' | 'invalid'
}

export const UNREACHABLE_MESSAGE =
  'The studio could not reach the template API. Check your connection and try again.'

const UNEXPECTED_BODY_MESSAGE = 'The template API answered with something this studio does not understand.'

/**
 * HTTP status + error body -> the failure the UI explains.
 *
 * The status is the primary signal, because it is there even when the body is
 * missing or unreadable (a proxy's HTML error page, say). The `code` inside the
 * body then separates the two meanings a 409 can have.
 */
function failureFor(
  status: number,
  payload: unknown,
  unprocessable: 'not-visual' | 'invalid',
): RepositoryFailure {
  const parsed = apiErrorSchema.safeParse(payload)
  const error = parsed.success ? parsed.data : null
  const message = error?.message ?? `The template API answered with HTTP ${status}.`

  switch (status) {
    case 400:
    case 415:
      return { code: 'invalid', message }
    case 401:
      return { code: 'unauthenticated', message }
    // `forbidden-origin` is the Host/Origin middleware's own refusal; from the
    // studio's point of view it is the same "you may not do that".
    case 403:
      return { code: 'forbidden', message }
    case 404:
      return { code: 'not-found', message }
    case 409: {
      if (error?.code === 'slug-taken') return { code: 'slug-taken', message }
      // The server's copy travels with a 409 so the conflict dialog can offer
      // "discard mine and load v8" without a second request. Without it there
      // is nothing to offer, so this is an unexpected answer, not a conflict.
      if (error?.code === 'conflict' && error.template) {
        return { code: 'version-conflict', message, current: toTemplateRecord(error.template) }
      }
      return { code: 'unexpected', message }
    }
    case 413:
      return { code: 'payload-too-large', message }
    case 422:
      return { code: unprocessable, message }
    case 503:
      return { code: 'storage-unavailable', message }
    default:
      return { code: 'unexpected', message }
  }
}

/** Drops the keys a patch left out, so a `strictObject` never sees `undefined`. */
function definedOnly(patch: TemplateMetadataPatch): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) if (value !== undefined) result[key] = value
  return result
}

/** The one-liner every "this went wrong" path returns. */
function failure(
  code: Exclude<RepositoryFailure['code'], 'version-conflict'>,
  message: string,
): { readonly ok: false; readonly failure: RepositoryFailure } {
  return { ok: false, failure: { code, message } }
}
