/**
 * The HTTP adapter's failure mapping, one recorded response at a time.
 *
 * The contract suite next door proves the happy paths against the real API;
 * this file proves the part an end-to-end test cannot reach comfortably —
 * that every status the API can answer with becomes the right
 * `RepositoryFailure`, and that a body the studio cannot parse is refused
 * rather than trusted.
 */
import { describe, expect, it, vi } from 'vitest'
import { templateId } from '@/domain'
import { STUDIO_API_HEADER } from '@shared/templateContracts'
import { createHttpTemplateRepository } from './httpTemplateRepository'
import { codeVersion } from './templateRepositoryContract'

const ID = templateId('tpl_welcome')

/** A fetch that always answers with this status and body. */
function respondWith(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

/** The error body shape every refusal from the API has (`apiErrorSchema`). */
function apiError(code: string, message = 'Nope.', extras: Record<string, unknown> = {}) {
  return { status: 'error', code, message, ...extras }
}

/** One template as `GET /api/templates/:id` returns it. */
function detail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tpl_welcome',
    slug: 'welcome',
    name: 'Welcome',
    description: '',
    category: 'onboarding',
    status: 'draft',
    tags: [],
    origin: 'user',
    kind: 'code',
    versionNumber: 7,
    revision: 9,
    createdBy: 'seed',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedBy: 'seed',
    updatedAt: '2026-09-02T10:00:00.000Z',
    version: {
      kind: 'code',
      versionNumber: 7,
      createdBy: 'seed',
      createdAt: '2026-09-02T10:00:00.000Z',
      envelope: { subject: 'Hello', preheader: '', replyTo: '' },
      source: 'export default function T() { return null }\n',
      html: '<p>Hello</p>',
      text: 'Hello',
      propsSample: '{}',
      propsSchema: '{}',
      note: '',
    },
    ...overrides,
  }
}

describe('HttpTemplateRepository', () => {
  it('sends the studio header and the session cookie on a mutation', async () => {
    const fetchImpl = respondWith(201, { template: detail() })
    const repository = createHttpTemplateRepository({ fetchImpl })

    await repository.saveVersion(ID, 9, codeVersion())

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/templates/tpl_welcome/versions')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('same-origin')
    const headers = init.headers as Record<string, string>
    expect(headers[STUDIO_API_HEADER]).toBe('1')
    expect(headers['content-type']).toBe('application/json')
  })

  it('renames the studio’s fields to the wire’s on the way out', async () => {
    const fetchImpl = respondWith(201, { template: detail() })
    const repository = createHttpTemplateRepository({ fetchImpl })

    await repository.saveVersion(ID, 9, codeVersion({ samplePayloadText: '{"a":1}' }))

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(String(init.body))
    expect(body.expectedRevision).toBe(9)
    expect(body.version.propsSample).toBe('{"a":1}')
    expect(body.version.propsSchema).toBe('{}')
    // `note` is optional in the studio and required on the wire.
    expect(body.version.note).toBe('')
  })

  it('maps a network failure to unreachable rather than throwing', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const repository = createHttpTemplateRepository({ fetchImpl })

    const result = await repository.get(ID)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.code).toBe('unreachable')
  })

  it.each([
    [400, 'bad-request', 'invalid'],
    [401, 'unauthenticated', 'unauthenticated'],
    [403, 'forbidden', 'forbidden'],
    // The Host/Origin middleware's own refusal is still just "you may not".
    [403, 'forbidden-origin', 'forbidden'],
    [404, 'not-found', 'not-found'],
    [409, 'slug-taken', 'slug-taken'],
    [413, 'payload-too-large', 'payload-too-large'],
    [415, 'unsupported-media-type', 'invalid'],
    [503, 'storage-unavailable', 'storage-unavailable'],
    [500, 'unexpected', 'unexpected'],
  ])('maps HTTP %i (%s) to %s', async (status, code, expected) => {
    const repository = createHttpTemplateRepository({ fetchImpl: respondWith(status, apiError(code)) })

    const result = await repository.create({
      name: 'Welcome',
      kind: 'code',
      description: '',
      category: 'onboarding',
      initialVersion: codeVersion(),
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.code).toBe(expected)
  })

  it('parses the server copy out of a 409 conflict', async () => {
    const body = apiError('conflict', 'This template has moved on to revision 9.', {
      template: detail(),
    })
    const repository = createHttpTemplateRepository({ fetchImpl: respondWith(409, body) })

    const result = await repository.saveVersion(ID, 4, codeVersion())

    expect(result.ok).toBe(false)
    if (result.ok || result.failure.code !== 'version-conflict') throw new Error('expected a conflict')
    expect(result.failure.current.metadata.revision).toBe(9)
    expect(result.failure.current.metadata.version.label).toBe('v7')
  })

  it('refuses a 409 that carries no template, because there is nothing to offer', async () => {
    const repository = createHttpTemplateRepository({ fetchImpl: respondWith(409, apiError('conflict')) })

    const result = await repository.saveVersion(ID, 4, codeVersion())

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.code).toBe('unexpected')
  })

  it('reads a 422 as "not this kind" on save and "not visual" on convert', async () => {
    const save = createHttpTemplateRepository({ fetchImpl: respondWith(422, apiError('not-visual')) })
    const saved = await save.saveVersion(ID, 9, codeVersion())
    expect(saved.ok).toBe(false)
    if (!saved.ok) expect(saved.failure.code).toBe('invalid')

    const convert = createHttpTemplateRepository({ fetchImpl: respondWith(422, apiError('not-visual')) })
    const converted = await convert.convertToCode(ID, {
      expectedRevision: 9,
      source: '',
      html: '',
      text: '',
      samplePayloadText: '{}',
      propsSchemaText: '{}',
    })
    expect(converted.ok).toBe(false)
    if (!converted.ok) expect(converted.failure.code).toBe('not-visual')
  })

  it('refuses a malformed success body instead of trusting it', async () => {
    const repository = createHttpTemplateRepository({
      // A 200 whose template is missing half its fields: exactly what a proxy
      // or a half-deployed API would serve.
      fetchImpl: respondWith(200, { template: { id: 'tpl_welcome' } }),
    })

    const result = await repository.get(ID)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.code).toBe('unexpected')
  })

  it('refuses a body that is not JSON at all', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>502</html>', { status: 200 }))
    const repository = createHttpTemplateRepository({ fetchImpl })

    const result = await repository.list()

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.code).toBe('unexpected')
  })

  it('fills the library list out with one detail request per template', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === '/api/templates') {
        return new Response(JSON.stringify({ templates: [summaryOf(detail())] }), { status: 200 })
      }
      return new Response(JSON.stringify({ template: detail() }), { status: 200 })
    })
    const repository = createHttpTemplateRepository({ fetchImpl })

    const result = await repository.list()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toHaveLength(1)
    expect(result.value[0].kind).toBe('code')
    // The summary carries no blobs, so the record can only come from the detail.
    if (result.value[0].kind === 'code') expect(result.value[0].source).toContain('export default')
  })

  it('drops a template that was deleted between the list and its detail', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/templates') {
        return new Response(JSON.stringify({ templates: [summaryOf(detail())] }), { status: 200 })
      }
      return new Response(JSON.stringify(apiError('not-found')), { status: 404 })
    })
    const repository = createHttpTemplateRepository({ fetchImpl })

    const result = await repository.list()

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toHaveLength(0)
  })

  it('leaves a patch’s untouched fields out of the request', async () => {
    const fetchImpl = respondWith(200, { template: detail() })
    const repository = createHttpTemplateRepository({ fetchImpl })

    await repository.updateMetadata(ID, 9, { status: 'ready', name: undefined })

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ expectedRevision: 9, status: 'ready' })
  })
})

/** The same template without its version, which is what the list route returns. */
function summaryOf(record: Record<string, unknown>) {
  const { version: _version, ...summary } = record
  return summary
}
