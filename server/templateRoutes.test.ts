import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.ts'
import {
  createDeveloperAuthenticator,
  createDisabledAuthenticator,
  createPasswordAuthenticator,
  createSessionToken,
  SESSION_COOKIE,
} from './auth.ts'
import type { SendServerConfig } from './config.ts'
import { InMemoryTemplateStore } from './inMemoryTemplateStore.ts'
import { InMemoryWorkspaceStore } from './inMemoryWorkspaceStore.ts'
import type { TemplateStore } from './templateStore.ts'
import { DEFAULT_WORKSPACE, DEFAULT_WORKSPACE_CTX } from './workspaceStore.ts'
import {
  apiErrorSchema,
  MAX_HTML_BYTES,
  MAX_PROPS_BYTES,
  MAX_SOURCE_BYTES,
  MAX_TEXT_BYTES,
  STUDIO_API_HEADER,
  templateDetailSchema,
  templateListResponse,
  versionListResponse,
} from '../shared/templateContracts.ts'

/** Sending is irrelevant here; these tests only exercise the template routes. */
const config: SendServerConfig = { enabled: false, port: 8787, reason: 'not under test' }

const IDENTITY = 'tester@example.test'
const NOW = Date.UTC(2026, 8, 18, 10, 0, 0)

const JSON_HEADERS = {
  'content-type': 'application/json',
  host: '127.0.0.1:8787',
  [STUDIO_API_HEADER]: '1',
}

/** Just the two headers a GET or DELETE needs. */
const PLAIN_HEADERS = { host: '127.0.0.1:8787', [STUDIO_API_HEADER]: '1' }

function makeApp(
  options: {
    store?: TemplateStore | null
    identity?: string
    authenticator?: Parameters<typeof createApp>[0]['authenticator']
  } = {},
) {
  const store = options.store === undefined ? new InMemoryTemplateStore() : options.store
  const app = createApp({
    config,
    sender: null,
    authenticator: options.authenticator ?? createDeveloperAuthenticator(options.identity ?? IDENTITY),
    templateStore: store,
    // Every route here lives under /api/workspaces/swarm-camp; the developer
    // identity is an admin of it, so the tests only see the template rules.
    workspaceStore: new InMemoryWorkspaceStore([{ input: DEFAULT_WORKSPACE, ctx: DEFAULT_WORKSPACE_CTX }]),
    now: () => NOW,
  })
  return { app, store }
}

/** The smallest body `POST /api/templates` accepts. */
function createBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Welcome & verification',
    description: 'Sent after sign-up.',
    category: 'onboarding',
    tags: ['sign-up'],
    initialVersion: versionBody(),
    ...overrides,
  }
}

function versionBody(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'code',
    envelope: { subject: 'Verify your email', preheader: '', replyTo: '' },
    source: 'export default function Email() { return null }\n',
    html: '<p>hi</p>',
    text: 'hi',
    propsSample: '{}',
    propsSchema: '{}',
    note: '',
    ...overrides,
  }
}

function visualVersionBody(overrides: Record<string, unknown> = {}) {
  return versionBody({
    kind: 'visual',
    source: undefined,
    document: { type: 'doc', content: [] },
    theme: 'studio-v1',
    ...overrides,
  })
}

type App = ReturnType<typeof createApp>

function send(
  app: App,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = JSON_HEADERS,
) {
  return app.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** Parses the `{ template }` body every write and detail route answers with. */
async function detailOf(response: Response) {
  const body = (await response.json()) as { template: unknown }
  return templateDetailSchema.parse(body.template)
}

/** Creates one template and returns the detail body the API answered with. */
async function createTemplate(app: App, overrides: Record<string, unknown> = {}) {
  const response = await send(app, 'POST', '/api/workspaces/swarm-camp/templates', createBody(overrides))
  expect(response.status).toBe(201)
  const body = (await response.json()) as { template: { id: string; revision: number } }
  return body.template
}

describe('template routes', () => {
  beforeEach(() => {
    // Every write logs one audit line; the tests assert on it, so keep it quiet.
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  describe('GET /api/templates', () => {
    it('lists nothing when the database is empty', async () => {
      const { app } = makeApp()
      const response = await app.request('/api/workspaces/swarm-camp/templates', { headers: PLAIN_HEADERS })

      expect(response.status).toBe(200)
      expect(templateListResponse.parse(await response.json()).templates).toEqual([])
    })

    it('lists newest-updated first, without the content blobs', async () => {
      const { app, store } = makeApp()
      await store!.create(
        {
          id: 'tpl_old',
          workspaceId: DEFAULT_WORKSPACE.id,
          slug: 'old',
          name: 'Old',
          description: '',
          category: 'notification',
          status: 'draft',
          tags: [],
          origin: 'starter',
          version: {
            kind: 'code',
            envelope: { subject: '', preheader: '', replyTo: '' },
            source: 'x',
            document: null,
            theme: 'studio-v1',
            html: '',
            text: '',
            propsSample: '{}',
            propsSchema: '{}',
            note: '',
          },
        },
        { by: 'seed', at: '2020-01-01T00:00:00.000Z' },
      )
      await createTemplate(app)

      const response = await app.request('/api/workspaces/swarm-camp/templates', { headers: PLAIN_HEADERS })
      const { templates } = templateListResponse.parse(await response.json())
      expect(templates.map((template) => template.slug)).toEqual(['welcome-verification', 'old'])
      expect(templates[0]).not.toHaveProperty('version')
    })
  })

  describe('GET /api/templates/:id', () => {
    it('returns the detail with a weak ETag naming the revision', async () => {
      const { app } = makeApp()
      const created = await createTemplate(app)

      const response = await app.request(`/api/workspaces/swarm-camp/templates/${created.id}`, {
        headers: PLAIN_HEADERS,
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('etag')).toBe('W/"1"')

      const parsed = await detailOf(response)
      expect(parsed.version.kind).toBe('code')
      expect(parsed.versionNumber).toBe(1)
      expect(parsed.revision).toBe(1)
    })

    it('answers 404 for an unknown id', async () => {
      const { app } = makeApp()
      const response = await app.request('/api/workspaces/swarm-camp/templates/tpl_missing', {
        headers: PLAIN_HEADERS,
      })

      expect(response.status).toBe(404)
      expect(apiErrorSchema.parse(await response.json()).code).toBe('not-found')
    })

    it('gives a visual template its document back as an object', async () => {
      const { app } = makeApp()
      const created = await createTemplate(app, {
        name: 'Newsletter',
        initialVersion: visualVersionBody(),
      })

      const response = await app.request(`/api/workspaces/swarm-camp/templates/${created.id}`, {
        headers: PLAIN_HEADERS,
      })
      const parsed = await detailOf(response)
      expect(parsed.version.kind).toBe('visual')
      if (parsed.version.kind !== 'visual') throw new Error('unreachable')
      expect(parsed.version.document).toEqual({ type: 'doc', content: [] })
      expect(parsed.version.theme).toBe('studio-v1')
    })
  })

  describe('POST /api/templates', () => {
    it('creates version 1 and stamps the caller on it', async () => {
      const { app } = makeApp()
      const response = await send(app, 'POST', '/api/workspaces/swarm-camp/templates', createBody())

      expect(response.status).toBe(201)
      const parsed = await detailOf(response)
      expect(parsed.slug).toBe('welcome-verification')
      expect(parsed.origin).toBe('user')
      expect(parsed.status).toBe('draft')
      expect(parsed.versionNumber).toBe(1)
      expect(parsed.createdBy).toBe(IDENTITY)
      expect(parsed.createdAt).toBe(new Date(NOW).toISOString())
      expect(parsed.version.createdBy).toBe(IDENTITY)
    })

    it('logs one audit line naming the verb, the id, the version and the caller', async () => {
      const logged: string[] = []
      vi.spyOn(console, 'log').mockImplementation((line: unknown) => void logged.push(String(line)))
      const { app } = makeApp()
      const created = await createTemplate(app)

      expect(logged).toEqual([`[templates] created ${created.id} v1 by ${IDENTITY}`])
    })

    it('refuses a slug another template already holds', async () => {
      const { app } = makeApp()
      await createTemplate(app)

      const response = await send(app, 'POST', '/api/workspaces/swarm-camp/templates', createBody())
      expect(response.status).toBe(409)
      expect(apiErrorSchema.parse(await response.json()).code).toBe('slug-taken')
    })

    it('refuses a name that produces no usable slug', async () => {
      const { app } = makeApp()
      const response = await send(
        app,
        'POST',
        '/api/workspaces/swarm-camp/templates',
        createBody({ name: '///' }),
      )

      expect(response.status).toBe(400)
      expect(apiErrorSchema.parse(await response.json()).code).toBe('bad-request')
    })

    it('reports which field failed validation', async () => {
      const { app } = makeApp()
      const response = await send(
        app,
        'POST',
        '/api/workspaces/swarm-camp/templates',
        createBody({ category: 'nonsense' }),
      )

      expect(response.status).toBe(400)
      const error = apiErrorSchema.parse(await response.json())
      expect(error.issues?.map((issue) => issue.path)).toContain('category')
    })
  })

  describe('POST /api/templates/:id/versions', () => {
    it('appends version 2 and moves the revision with it', async () => {
      const { app } = makeApp()
      const created = await createTemplate(app)

      const response = await send(
        app,
        'POST',
        `/api/workspaces/swarm-camp/templates/${created.id}/versions`,
        {
          expectedRevision: created.revision,
          version: versionBody({ note: 'tweaked the copy' }),
        },
      )

      expect(response.status).toBe(201)
      const parsed = await detailOf(response)
      expect(parsed.versionNumber).toBe(2)
      expect(parsed.revision).toBe(2)
      expect(parsed.version.note).toBe('tweaked the copy')
    })

    it('answers 409 with the server copy when the revision is stale', async () => {
      const { app } = makeApp()
      const created = await createTemplate(app)
      await send(app, 'POST', `/api/workspaces/swarm-camp/templates/${created.id}/versions`, {
        expectedRevision: 1,
        version: versionBody({ note: 'first save' }),
      })

      const response = await send(
        app,
        'POST',
        `/api/workspaces/swarm-camp/templates/${created.id}/versions`,
        {
          expectedRevision: 1,
          version: versionBody({ note: 'stale save' }),
        },
      )

      expect(response.status).toBe(409)
      const error = apiErrorSchema.parse(await response.json())
      expect(error.code).toBe('conflict')
      expect(error.message).toContain('revision 2')
      expect(error.template?.revision).toBe(2)
      expect(error.template?.versionNumber).toBe(2)
      expect(error.template?.version.note).toBe('first save')
    })

    it('answers 404 for an unknown template', async () => {
      const { app } = makeApp()
      const response = await send(app, 'POST', '/api/workspaces/swarm-camp/templates/tpl_missing/versions', {
        expectedRevision: 1,
        version: versionBody(),
      })

      expect(response.status).toBe(404)
    })

    it('refuses a visual body on a code template: converting is one way', async () => {
      const { app } = makeApp()
      const created = await createTemplate(app)

      const response = await send(
        app,
        'POST',
        `/api/workspaces/swarm-camp/templates/${created.id}/versions`,
        {
          expectedRevision: created.revision,
          version: visualVersionBody(),
        },
      )

      expect(response.status).toBe(422)
      expect(apiErrorSchema.parse(await response.json()).code).toBe('not-visual')
      // Nothing was written: the template is still the code template it was.
      const after = await app.request(`/api/workspaces/swarm-camp/templates/${created.id}`, {
        headers: PLAIN_HEADERS,
      })
      expect((await detailOf(after)).versionNumber).toBe(1)
    })

    it('still accepts a visual body on a visual template', async () => {
      const { app } = makeApp()
      const created = await createTemplate(app, { initialVersion: visualVersionBody() })

      const response = await send(
        app,
        'POST',
        `/api/workspaces/swarm-camp/templates/${created.id}/versions`,
        {
          expectedRevision: created.revision,
          version: visualVersionBody({ note: 'second draft' }),
        },
      )

      expect(response.status).toBe(201)
      expect((await detailOf(response)).version.kind).toBe('visual')
    })
  })

  describe('PATCH /api/templates/:id', () => {
    it('changes metadata, bumps the revision and adds no version', async () => {
      const { app } = makeApp()
      const created = await createTemplate(app)

      const response = await send(app, 'PATCH', `/api/workspaces/swarm-camp/templates/${created.id}`, {
        expectedRevision: created.revision,
        status: 'ready',
        tags: ['sign-up', 'verification'],
      })

      expect(response.status).toBe(200)
      const parsed = await detailOf(response)
      expect(parsed.status).toBe('ready')
      expect(parsed.tags).toEqual(['sign-up', 'verification'])
      expect(parsed.revision).toBe(2)
      expect(parsed.versionNumber).toBe(1)
    })

    it('answers 409 conflict for a stale revision', async () => {
      const { app } = makeApp()
      const created = await createTemplate(app)
      await send(app, 'PATCH', `/api/workspaces/swarm-camp/templates/${created.id}`, {
        expectedRevision: 1,
        status: 'ready',
      })

      const response = await send(app, 'PATCH', `/api/workspaces/swarm-camp/templates/${created.id}`, {
        expectedRevision: 1,
        status: 'deprecated',
      })
      expect(response.status).toBe(409)
      expect(apiErrorSchema.parse(await response.json()).code).toBe('conflict')
    })

    it('answers 409 slug-taken when the new slug belongs to someone else', async () => {
      const { app } = makeApp()
      await createTemplate(app)
      const second = await createTemplate(app, { name: 'Password reset' })

      const response = await send(app, 'PATCH', `/api/workspaces/swarm-camp/templates/${second.id}`, {
        expectedRevision: second.revision,
        slug: 'welcome-verification',
      })
      expect(response.status).toBe(409)
      expect(apiErrorSchema.parse(await response.json()).code).toBe('slug-taken')
    })

    it('answers 404 for an unknown template', async () => {
      const { app } = makeApp()
      const response = await send(app, 'PATCH', '/api/workspaces/swarm-camp/templates/tpl_missing', {
        expectedRevision: 1,
        status: 'ready',
      })
      expect(response.status).toBe(404)
    })
  })

  describe('DELETE /api/templates/:id', () => {
    it('deletes the template and says so', async () => {
      const { app } = makeApp()
      const created = await createTemplate(app)

      const response = await send(
        app,
        'DELETE',
        `/api/workspaces/swarm-camp/templates/${created.id}`,
        undefined,
        PLAIN_HEADERS,
      )
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ status: 'deleted', id: created.id })

      const after = await app.request(`/api/workspaces/swarm-camp/templates/${created.id}`, {
        headers: PLAIN_HEADERS,
      })
      expect(after.status).toBe(404)
    })

    it('answers 404 for an unknown template', async () => {
      const { app } = makeApp()
      const response = await send(
        app,
        'DELETE',
        '/api/workspaces/swarm-camp/templates/tpl_missing',
        undefined,
        PLAIN_HEADERS,
      )
      expect(response.status).toBe(404)
    })
  })

  describe('GET /api/templates/:id/versions', () => {
    it('lists the history newest first', async () => {
      const { app } = makeApp()
      const created = await createTemplate(app)
      await send(app, 'POST', `/api/workspaces/swarm-camp/templates/${created.id}/versions`, {
        expectedRevision: 1,
        version: versionBody({ note: 'second' }),
      })

      const response = await app.request(`/api/workspaces/swarm-camp/templates/${created.id}/versions`, {
        headers: PLAIN_HEADERS,
      })
      expect(response.status).toBe(200)
      const { versions } = versionListResponse.parse(await response.json())
      expect(versions.map((version) => version.versionNumber)).toEqual([2, 1])
      expect(versions[0].note).toBe('second')
    })

    it('answers 404 for an unknown template', async () => {
      const { app } = makeApp()
      const response = await app.request('/api/workspaces/swarm-camp/templates/tpl_missing/versions', {
        headers: PLAIN_HEADERS,
      })
      expect(response.status).toBe(404)
    })
  })

  describe('POST /api/templates/:id/convert', () => {
    const convertBody = (expectedRevision: number) => ({
      expectedRevision,
      source: 'export default function Email() { return null }\n',
      html: '<p>converted</p>',
      text: 'converted',
      propsSample: '{}',
      propsSchema: '{}',
      note: 'converted from the visual editor',
    })

    it('adds a code version to a visual template and keeps its envelope', async () => {
      const { app } = makeApp()
      const created = await createTemplate(app, {
        name: 'Newsletter',
        initialVersion: visualVersionBody({
          envelope: { subject: 'Your monthly update', preheader: 'Inside', replyTo: '' },
        }),
      })

      const response = await send(
        app,
        'POST',
        `/api/workspaces/swarm-camp/templates/${created.id}/convert`,
        convertBody(created.revision),
      )

      expect(response.status).toBe(201)
      const parsed = await detailOf(response)
      expect(parsed.kind).toBe('code')
      expect(parsed.versionNumber).toBe(2)
      expect(parsed.version.envelope.subject).toBe('Your monthly update')
    })

    it('answers 422 when the template is not visual', async () => {
      const { app } = makeApp()
      const created = await createTemplate(app)

      const response = await send(
        app,
        'POST',
        `/api/workspaces/swarm-camp/templates/${created.id}/convert`,
        convertBody(created.revision),
      )
      expect(response.status).toBe(422)
      expect(apiErrorSchema.parse(await response.json()).code).toBe('not-visual')
    })

    it('answers 404 for an unknown template', async () => {
      const { app } = makeApp()
      const response = await send(
        app,
        'POST',
        '/api/workspaces/swarm-camp/templates/tpl_missing/convert',
        convertBody(1),
      )
      expect(response.status).toBe(404)
    })

    it('answers 409 for a stale revision', async () => {
      const { app } = makeApp()
      const created = await createTemplate(app, {
        name: 'Newsletter',
        initialVersion: visualVersionBody(),
      })
      await send(app, 'POST', `/api/workspaces/swarm-camp/templates/${created.id}/versions`, {
        expectedRevision: 1,
        version: visualVersionBody(),
      })

      const response = await send(
        app,
        'POST',
        `/api/workspaces/swarm-camp/templates/${created.id}/convert`,
        convertBody(1),
      )
      expect(response.status).toBe(409)
    })
  })

  describe('the guards every route shares', () => {
    it('refuses an unauthenticated caller with 401', async () => {
      const { app } = makeApp({
        authenticator: createDisabledAuthenticator('No authenticator is configured.'),
      })

      const list = await app.request('/api/workspaces/swarm-camp/templates', { headers: PLAIN_HEADERS })
      expect(list.status).toBe(401)
      const create = await send(app, 'POST', '/api/workspaces/swarm-camp/templates', createBody())
      expect(create.status).toBe(401)
    })

    it('refuses a cross-site Origin with 403 before anything else', async () => {
      const { app } = makeApp()
      const response = await send(app, 'POST', '/api/workspaces/swarm-camp/templates', createBody(), {
        ...JSON_HEADERS,
        origin: 'https://evil.example',
      })

      expect(response.status).toBe(403)
      // The 403 body is an API error like every other: 7b parses it.
      expect(apiErrorSchema.parse(await response.json()).code).toBe('forbidden-origin')
    })

    it('refuses a mutation without the JSON content type (415)', async () => {
      const { app } = makeApp()
      const response = await send(app, 'POST', '/api/workspaces/swarm-camp/templates', createBody(), {
        host: '127.0.0.1:8787',
        'content-type': 'text/plain',
        [STUDIO_API_HEADER]: '1',
      })

      expect(response.status).toBe(415)
      expect(apiErrorSchema.parse(await response.json()).code).toBe('unsupported-media-type')
    })

    it(`refuses a mutation without the ${STUDIO_API_HEADER} header (400)`, async () => {
      const { app } = makeApp()
      const response = await send(app, 'POST', '/api/workspaces/swarm-camp/templates', createBody(), {
        host: '127.0.0.1:8787',
        'content-type': 'application/json',
      })

      expect(response.status).toBe(400)
      expect(apiErrorSchema.parse(await response.json()).message).toContain(STUDIO_API_HEADER)
    })

    it('refuses a body that is not JSON at all (400)', async () => {
      const { app } = makeApp()
      const response = await send(app, 'POST', '/api/workspaces/swarm-camp/templates', 'not json')

      expect(response.status).toBe(400)
    })

    it('refuses an unknown key instead of dropping it (400)', async () => {
      const { app } = makeApp()
      const created = await createTemplate(app)

      // A typo must not "succeed", change nothing and still bump the revision.
      const response = await send(app, 'PATCH', `/api/workspaces/swarm-camp/templates/${created.id}`, {
        expectedRevision: created.revision,
        tittle: 'Renamed',
      })

      expect(response.status).toBe(400)
      const error = apiErrorSchema.parse(await response.json())
      // Zod reports an unrecognised key on the object itself, so the key is in
      // the message rather than in the path.
      expect(error.issues?.some((issue) => issue.message.includes('tittle'))).toBe(true)
      const after = await app.request(`/api/workspaces/swarm-camp/templates/${created.id}`, {
        headers: PLAIN_HEADERS,
      })
      expect((await detailOf(after)).revision).toBe(1)
    })

    it.each(['propsSample', 'propsSchema'])('refuses a %s that is not JSON (400)', async (field) => {
      const { app } = makeApp()
      const response = await send(
        app,
        'POST',
        '/api/workspaces/swarm-camp/templates',
        createBody({ initialVersion: versionBody({ [field]: 'not json' }) }),
      )

      expect(response.status).toBe(400)
      const error = apiErrorSchema.parse(await response.json())
      expect(error.issues?.some((issue) => issue.path.includes(field))).toBe(true)
    })

    it('turns an exception from the store into a 500 the browser can parse', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      // Anything a store can throw - a D1 outage, an unreadable row - has to
      // come back as an API error, not as Hono's plain-text 500.
      const failing = {
        list: () => Promise.reject(new Error('D1_ERROR: network')),
      } as unknown as TemplateStore
      const { app } = makeApp({ store: failing })

      const response = await app.request('/api/workspaces/swarm-camp/templates', { headers: PLAIN_HEADERS })

      expect(response.status).toBe(500)
      const error = apiErrorSchema.parse(await response.json())
      expect(error.code).toBe('unexpected')
      // The database's own words never reach the browser.
      expect(error.message).not.toContain('D1_ERROR')
    })

    it('answers 503 on every template route when no store is bound', async () => {
      const { app } = makeApp({ store: null })

      expect(
        (await app.request('/api/workspaces/swarm-camp/templates', { headers: PLAIN_HEADERS })).status,
      ).toBe(503)
      expect(
        (await app.request('/api/workspaces/swarm-camp/templates/tpl_x', { headers: PLAIN_HEADERS })).status,
      ).toBe(503)
      expect(
        (await app.request('/api/workspaces/swarm-camp/templates/tpl_x/versions', { headers: PLAIN_HEADERS }))
          .status,
      ).toBe(503)
      expect((await send(app, 'POST', '/api/workspaces/swarm-camp/templates', createBody())).status).toBe(503)
      expect(
        (
          await send(app, 'POST', '/api/workspaces/swarm-camp/templates/tpl_x/versions', {
            expectedRevision: 1,
          })
        ).status,
      ).toBe(503)
      expect(
        (await send(app, 'PATCH', '/api/workspaces/swarm-camp/templates/tpl_x', { expectedRevision: 1 }))
          .status,
      ).toBe(503)
      expect(
        (await send(app, 'DELETE', '/api/workspaces/swarm-camp/templates/tpl_x', undefined, PLAIN_HEADERS))
          .status,
      ).toBe(503)
      expect(
        (
          await send(app, 'POST', '/api/workspaces/swarm-camp/templates/tpl_x/convert', {
            expectedRevision: 1,
          })
        ).status,
      ).toBe(503)

      const body = apiErrorSchema.parse(
        await (await app.request('/api/workspaces/swarm-camp/templates', { headers: PLAIN_HEADERS })).json(),
      )
      expect(body.code).toBe('storage-unavailable')
    })

    it('records "shared-password" as the author under the password gate', async () => {
      const password = 'correct-horse-battery-staple'
      const now = () => NOW
      const store = new InMemoryTemplateStore()
      const app = createApp({
        config,
        sender: null,
        authenticator: createPasswordAuthenticator(password, { now }),
        passwordGate: { password },
        templateStore: store,
        // The shared-password identity is a 'server' one: an admin everywhere.
        workspaceStore: new InMemoryWorkspaceStore([
          { input: DEFAULT_WORKSPACE, ctx: DEFAULT_WORKSPACE_CTX },
        ]),
        now,
      })
      const token = await createSessionToken(password, Math.floor(NOW / 1000))

      const response = await app.request('/api/workspaces/swarm-camp/templates', {
        method: 'POST',
        headers: { ...JSON_HEADERS, cookie: `${SESSION_COOKIE}=${token}` },
        body: JSON.stringify(createBody()),
      })

      expect(response.status).toBe(201)
      // The password gate cannot name a person, so the audit columns say so
      // rather than pretending to know who it was.
      expect((await detailOf(response)).createdBy).toBe('shared-password')
    })
  })

  describe('size caps, enforced in bytes before any storage call', () => {
    /** One string of `bytes` ASCII characters, which is `bytes` bytes. */
    const filler = (bytes: number) => 'x'.repeat(bytes)

    it.each([
      ['html', MAX_HTML_BYTES],
      ['text', MAX_TEXT_BYTES],
      ['source', MAX_SOURCE_BYTES],
      ['propsSample', MAX_PROPS_BYTES],
      ['propsSchema', MAX_PROPS_BYTES],
    ])('answers 413 naming %s', async (field, limit) => {
      const { app } = makeApp()
      const response = await send(
        app,
        'POST',
        '/api/workspaces/swarm-camp/templates',
        createBody({ initialVersion: versionBody({ [field]: filler(limit + 1) }) }),
      )

      expect(response.status).toBe(413)
      const error = apiErrorSchema.parse(await response.json())
      expect(error.code).toBe('payload-too-large')
      expect(error.message).toContain(field)
    })

    it('answers 413 for an oversized visual document', async () => {
      const { app } = makeApp()
      const response = await send(
        app,
        'POST',
        '/api/workspaces/swarm-camp/templates',
        createBody({
          initialVersion: visualVersionBody({
            document: { type: 'doc', padding: filler(300_000) },
          }),
        }),
      )

      expect(response.status).toBe(413)
      expect(apiErrorSchema.parse(await response.json()).message).toContain('document')
    })

    it('applies the same caps to a saved version', async () => {
      const { app } = makeApp()
      const created = await createTemplate(app)

      const response = await send(
        app,
        'POST',
        `/api/workspaces/swarm-camp/templates/${created.id}/versions`,
        {
          expectedRevision: created.revision,
          version: versionBody({ html: filler(MAX_HTML_BYTES + 1) }),
        },
      )
      expect(response.status).toBe(413)
    })

    it('applies the same caps to a conversion', async () => {
      const { app } = makeApp()
      const created = await createTemplate(app, {
        name: 'Newsletter',
        initialVersion: visualVersionBody(),
      })

      const response = await send(app, 'POST', `/api/workspaces/swarm-camp/templates/${created.id}/convert`, {
        expectedRevision: created.revision,
        source: filler(MAX_SOURCE_BYTES + 1),
        html: '<p>x</p>',
        text: 'x',
        propsSample: '{}',
        propsSchema: '{}',
        note: '',
      })
      expect(response.status).toBe(413)
    })
  })
})
