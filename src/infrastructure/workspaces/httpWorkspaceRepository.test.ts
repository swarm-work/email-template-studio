import { describe, expect, it, vi } from 'vitest'
import { createHttpWorkspaceRepository } from './httpWorkspaceRepository'
import { MEMORY_WORKSPACE } from './inMemoryWorkspaceRepository'

const { role: _role, ...WORKSPACE_ROW } = MEMORY_WORKSPACE
const DTO = { ...WORKSPACE_ROW, role: 'admin' as const }

function fetchReturning(status: number, body: unknown) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )
}

describe('HttpWorkspaceRepository', () => {
  it('lists the workspaces the API answers with, parsed', async () => {
    const fetchImpl = fetchReturning(200, { workspaces: [DTO] })
    const result = await createHttpWorkspaceRepository({ fetchImpl }).list()
    expect(result).toEqual({ ok: true, value: [DTO] })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/workspaces')
    expect(init.credentials).toBe('same-origin')
  })

  it('creates through POST with the studio header, sending only the fields given', async () => {
    const fetchImpl = fetchReturning(201, { workspace: DTO })
    await createHttpWorkspaceRepository({ fetchImpl }).create({
      name: 'swarm.camp',
      defaultFrom: 'a@swarm.camp',
    })
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['x-studio-request']).toBe('1')
    expect(JSON.parse(init.body as string)).toEqual({ name: 'swarm.camp', defaultFrom: 'a@swarm.camp' })
  })

  it('keeps an explicit null in a PATCH and drops undefined', async () => {
    const fetchImpl = fetchReturning(200, { workspace: DTO })
    await createHttpWorkspaceRepository({ fetchImpl }).update('swarm-camp', {
      sesConfigurationSet: null,
      name: undefined,
    })
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/workspaces/swarm-camp')
    expect(JSON.parse(init.body as string)).toEqual({ sesConfigurationSet: null })
  })

  it('maps the statuses onto failures, keeping the server sentence', async () => {
    const repository = (status: number, body: unknown) =>
      createHttpWorkspaceRepository({ fetchImpl: fetchReturning(status, body) })
    expect(
      await repository(404, {
        status: 'error',
        code: 'not-found',
        message: 'No workspace with that slug.',
      }).list(),
    ).toEqual({
      ok: false,
      failure: { code: 'not-found', message: 'No workspace with that slug.' },
    })
    expect(
      (
        await repository(409, { status: 'error', code: 'slug-taken', message: 'taken' }).create({
          name: 'x',
          defaultFrom: 'a@b.co',
        })
      ).ok,
    ).toBe(false)
    const lastAdmin = await repository(409, {
      status: 'error',
      code: 'last-admin',
      message: 'only admin',
    }).removeMember('acme', 'a@b.co')
    expect(lastAdmin).toEqual({ ok: false, failure: { code: 'invalid', message: 'only admin' } })
    expect((await repository(200, { nonsense: true }).list()).ok).toBe(false)
  })

  it('answers unreachable when fetch itself fails', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const result = await createHttpWorkspaceRepository({ fetchImpl }).list()
    expect(result.ok === false && result.failure.code).toBe('unreachable')
  })

  it('encodes the member address into the path', async () => {
    const fetchImpl = fetchReturning(200, { status: 'removed', email: 'a+b@x.test' })
    await createHttpWorkspaceRepository({ fetchImpl }).removeMember('acme', 'a+b@x.test')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/workspaces/acme/members/a%2Bb%40x.test')
    expect(init.method).toBe('DELETE')
  })
})
