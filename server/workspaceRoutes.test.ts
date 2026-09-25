/**
 * The workspace routes and the access middleware, end to end through
 * `createApp`. The template routes are used as the "something under a
 * workspace" to prove the middleware guards everything registered beneath it.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from './app.ts'
import type { Authenticator, Identity } from './auth.ts'
import { createDeveloperAuthenticator } from './auth.ts'
import type { SendServerConfig } from './config.ts'
import { InMemoryTemplateStore } from './inMemoryTemplateStore.ts'
import { InMemoryWorkspaceStore } from './inMemoryWorkspaceStore.ts'
import { CTX } from './templateStoreContract.ts'
import { DEFAULT_WORKSPACE, DEFAULT_WORKSPACE_CTX } from './workspaceStore.ts'
import { newWorkspace } from './workspaceStoreContract.ts'
import { apiErrorSchema, STUDIO_API_HEADER } from '../shared/templateContracts.ts'
import {
  memberListResponse,
  memberResponse,
  workspaceListResponse,
  workspaceResponse,
} from '../shared/workspaceContracts.ts'

const config: SendServerConfig = { enabled: false, port: 8787, reason: 'not under test' }
const NOW = Date.UTC(2026, 8, 25, 10, 0, 0)
const HOST = '127.0.0.1:8787'
const JSON_HEADERS = { 'content-type': 'application/json', host: HOST, [STUDIO_API_HEADER]: '1' }
const PLAIN_HEADERS = { host: HOST, [STUDIO_API_HEADER]: '1' }

/** An authenticator that answers with exactly this identity, for the directory cases. */
function identityAuthenticator(identity: Identity): Authenticator {
  return {
    mode: 'stytch',
    async authenticate() {
      return { ok: true, identity }
    },
  }
}

const TEAM_MEMBER: Identity = {
  email: 'person@swarm.work',
  origin: 'directory',
  organization: { id: 'organization-test-1', slug: 'swarm' },
  roles: ['stytch_member'],
}

const OUTSIDER: Identity = { email: 'guest@example.test', origin: 'directory', roles: [] }

/**
 * Two workspaces to start: the default one (organisation `swarm`) and a
 * members-only one called `acme` with one named admin.
 */
async function seededStore() {
  const store = new InMemoryWorkspaceStore([{ input: DEFAULT_WORKSPACE, ctx: DEFAULT_WORKSPACE_CTX }])
  await store.create(newWorkspace('acme', { name: 'ACME' }), CTX)
  await store.putMember('ws_acme', 'owner@acme.test', 'admin', CTX)
  return store
}

async function makeApp(authenticator: Authenticator = createDeveloperAuthenticator('dev@example.test')) {
  const workspaceStore = await seededStore()
  const templateStore = new InMemoryTemplateStore()
  const app = createApp({
    config,
    sender: null,
    authenticator,
    templateStore,
    workspaceStore,
    now: () => NOW,
  })
  return { app, workspaceStore, templateStore }
}

type App = ReturnType<typeof createApp>

function send(
  app: App,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = JSON_HEADERS,
) {
  return app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
}

async function errorOf(response: Response) {
  return apiErrorSchema.parse(await response.json())
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('GET /api/workspaces', () => {
  it('lists every workspace as admin for a server identity (developer mode)', async () => {
    const { app } = await makeApp()
    const response = await send(app, 'GET', '/api/workspaces', undefined, PLAIN_HEADERS)
    expect(response.status).toBe(200)
    const body = workspaceListResponse.parse(await response.json())
    expect(body.workspaces.map((w) => [w.slug, w.role])).toEqual([
      ['acme', 'admin'],
      ['swarm-camp', 'admin'],
    ])
  })

  it('lists only what a directory identity may enter: its organisation, and its named memberships', async () => {
    const { app } = await makeApp(identityAuthenticator(TEAM_MEMBER))
    const body = workspaceListResponse.parse(
      await (await send(app, 'GET', '/api/workspaces', undefined, PLAIN_HEADERS)).json(),
    )
    // In `swarm`, so an admin of the default workspace; not a member of acme.
    expect(body.workspaces.map((w) => [w.slug, w.role])).toEqual([['swarm-camp', 'admin']])
  })

  it('lists nothing for an outsider, and a named editor row for one who was added', async () => {
    const { app, workspaceStore } = await makeApp(identityAuthenticator(OUTSIDER))
    expect(
      workspaceListResponse.parse(
        await (await send(app, 'GET', '/api/workspaces', undefined, PLAIN_HEADERS)).json(),
      ).workspaces,
    ).toEqual([])

    await workspaceStore.putMember('ws_acme', OUTSIDER.email, 'editor', CTX)
    const body = workspaceListResponse.parse(
      await (await send(app, 'GET', '/api/workspaces', undefined, PLAIN_HEADERS)).json(),
    )
    expect(body.workspaces.map((w) => [w.slug, w.role])).toEqual([['acme', 'editor']])
  })

  it('answers 503 when no workspace database is bound', async () => {
    const app = createApp({
      config,
      sender: null,
      authenticator: createDeveloperAuthenticator('dev@example.test'),
    })
    const response = await send(app, 'GET', '/api/workspaces', undefined, PLAIN_HEADERS)
    expect(response.status).toBe(503)
    expect((await errorOf(response)).code).toBe('storage-unavailable')
    // ...and so does everything under a workspace, since it cannot be resolved.
    const templates = await send(app, 'GET', '/api/workspaces/swarm-camp/templates', undefined, PLAIN_HEADERS)
    expect(templates.status).toBe(503)
  })
})

describe('the workspace middleware', () => {
  it('answers 404 for a slug that does not exist and, identically, for one the caller may not enter', async () => {
    const { app } = await makeApp(identityAuthenticator(TEAM_MEMBER))
    const missing = await send(app, 'GET', '/api/workspaces/nope/templates', undefined, PLAIN_HEADERS)
    const forbidden = await send(app, 'GET', '/api/workspaces/acme/templates', undefined, PLAIN_HEADERS)
    expect(missing.status).toBe(404)
    expect(forbidden.status).toBe(404)
    // Byte for byte the same body: nothing distinguishes "not there" from "not yours".
    expect(await forbidden.text()).toBe(await missing.text())
  })

  it('lets an editor read and write templates but not administer the workspace', async () => {
    const { app, workspaceStore } = await makeApp(identityAuthenticator(OUTSIDER))
    await workspaceStore.putMember('ws_acme', OUTSIDER.email, 'editor', CTX)

    const read = await send(app, 'GET', '/api/workspaces/acme', undefined, PLAIN_HEADERS)
    expect(workspaceResponse.parse(await read.json()).workspace.role).toBe('editor')
    expect((await send(app, 'GET', '/api/workspaces/acme/templates', undefined, PLAIN_HEADERS)).status).toBe(
      200,
    )

    const settings = await send(app, 'PATCH', '/api/workspaces/acme', { name: 'x' })
    expect(settings.status).toBe(403)
    expect((await errorOf(settings)).code).toBe('forbidden')
    expect((await send(app, 'GET', '/api/workspaces/acme/members', undefined, PLAIN_HEADERS)).status).toBe(
      403,
    )
  })

  it('keeps a template created in one workspace out of another', async () => {
    const { app } = await makeApp()
    const created = await send(app, 'POST', '/api/workspaces/acme/templates', {
      name: 'Invoice',
      description: '',
      category: 'billing',
      tags: [],
      initialVersion: {
        kind: 'code',
        envelope: { subject: 'Invoice', preheader: '', replyTo: '' },
        source: 'export default function Email() { return null }\n',
        html: '<p>hi</p>',
        text: 'hi',
        propsSample: '{}',
        propsSchema: '{}',
        note: '',
      },
    })
    expect(created.status).toBe(201)
    const { template } = (await created.json()) as { template: { id: string } }

    const there = await send(
      app,
      'GET',
      `/api/workspaces/acme/templates/${template.id}`,
      undefined,
      PLAIN_HEADERS,
    )
    expect(there.status).toBe(200)
    const elsewhere = await send(
      app,
      'GET',
      `/api/workspaces/swarm-camp/templates/${template.id}`,
      undefined,
      PLAIN_HEADERS,
    )
    expect(elsewhere.status).toBe(404)
  })
})

describe('POST /api/workspaces', () => {
  it('derives the slug and the domain, inherits the creator organisation, and names the creator admin', async () => {
    const { app, workspaceStore } = await makeApp(identityAuthenticator(TEAM_MEMBER))
    const response = await send(app, 'POST', '/api/workspaces', {
      name: 'Swarm Work',
      defaultFrom: 'Hello@Swarm.Work',
    })
    expect(response.status).toBe(201)
    const { workspace } = workspaceResponse.parse(await response.json())
    expect(workspace).toMatchObject({
      id: 'ws_swarm-work',
      slug: 'swarm-work',
      name: 'Swarm Work',
      defaultFrom: 'Hello@Swarm.Work',
      allowedFromDomain: 'swarm.work',
      stytchOrganizationSlug: 'swarm',
      sesConfigurationSet: null,
      createdBy: TEAM_MEMBER.email,
      createdAt: new Date(NOW).toISOString(),
      role: 'admin',
    })
    expect(await workspaceStore.listMembers('ws_swarm-work')).toMatchObject([
      { email: TEAM_MEMBER.email, role: 'admin' },
    ])
  })

  it('makes a members-only workspace on an explicit null organisation', async () => {
    const { app } = await makeApp(identityAuthenticator(TEAM_MEMBER))
    const response = await send(app, 'POST', '/api/workspaces', {
      name: 'Private',
      slug: 'private-client',
      defaultFrom: 'hello@client.test',
      allowedFromDomain: 'mail.client.test',
      stytchOrganizationSlug: null,
    })
    const { workspace } = workspaceResponse.parse(await response.json())
    expect(workspace).toMatchObject({
      slug: 'private-client',
      stytchOrganizationSlug: null,
      allowedFromDomain: 'mail.client.test',
    })
  })

  it('refuses a taken slug, an unusable name, an unknown key and a missing studio header', async () => {
    const { app } = await makeApp()
    const taken = await send(app, 'POST', '/api/workspaces', { name: 'ACME', defaultFrom: 'a@acme.test' })
    expect(taken.status).toBe(409)
    expect((await errorOf(taken)).code).toBe('slug-taken')

    const unusable = await send(app, 'POST', '/api/workspaces', { name: '!!!', defaultFrom: 'a@acme.test' })
    expect(unusable.status).toBe(400)

    const unknown = await send(app, 'POST', '/api/workspaces', {
      name: 'X',
      defaultFrom: 'a@x.test',
      tier: 'pro',
    })
    expect(unknown.status).toBe(400)
    // Zod names an unrecognised key in the message, not the path.
    expect((await errorOf(unknown)).issues?.[0]?.message).toContain('tier')

    const noHeader = await send(
      app,
      'POST',
      '/api/workspaces',
      { name: 'X', defaultFrom: 'a@x.test' },
      {
        'content-type': 'application/json',
        host: HOST,
      },
    )
    expect(noHeader.status).toBe(400)
  })
})

describe('PATCH /api/workspaces/:workspace', () => {
  it('changes only what was sent and clears a nullable setting on null', async () => {
    const { app } = await makeApp()
    const first = await send(app, 'PATCH', '/api/workspaces/swarm-camp', {
      sesConfigurationSet: 'studio-swarm-camp',
    })
    expect(workspaceResponse.parse(await first.json()).workspace.sesConfigurationSet).toBe(
      'studio-swarm-camp',
    )

    const second = await send(app, 'PATCH', '/api/workspaces/swarm-camp', {
      name: 'swarm.camp (transactional)',
      sesConfigurationSet: null,
    })
    const { workspace } = workspaceResponse.parse(await second.json())
    expect(workspace).toMatchObject({
      name: 'swarm.camp (transactional)',
      sesConfigurationSet: null,
      defaultFrom: DEFAULT_WORKSPACE.defaultFrom,
      updatedBy: 'dev@example.test',
      updatedAt: new Date(NOW).toISOString(),
    })
  })

  it('refuses a bad domain and the slug (which is the URL)', async () => {
    const { app } = await makeApp()
    expect(
      (await send(app, 'PATCH', '/api/workspaces/swarm-camp', { allowedFromDomain: 'not a domain' })).status,
    ).toBe(400)
    expect((await send(app, 'PATCH', '/api/workspaces/swarm-camp', { slug: 'renamed' })).status).toBe(400)
  })
})

describe('members', () => {
  it('adds, lists, re-roles and removes named members', async () => {
    const { app } = await makeApp()
    const added = await send(app, 'PUT', '/api/workspaces/acme/members/new@acme.test', { role: 'editor' })
    expect(added.status).toBe(200)
    expect(memberResponse.parse(await added.json()).member).toEqual({
      email: 'new@acme.test',
      role: 'editor',
      addedBy: 'dev@example.test',
      addedAt: new Date(NOW).toISOString(),
    })

    await send(app, 'PUT', '/api/workspaces/acme/members/new@acme.test', { role: 'admin' })
    const listed = await send(app, 'GET', '/api/workspaces/acme/members', undefined, PLAIN_HEADERS)
    expect(memberListResponse.parse(await listed.json()).members.map((m) => [m.email, m.role])).toEqual([
      ['new@acme.test', 'admin'],
      ['owner@acme.test', 'admin'],
    ])

    const removed = await send(
      app,
      'DELETE',
      '/api/workspaces/acme/members/new@acme.test',
      undefined,
      PLAIN_HEADERS,
    )
    expect(await removed.json()).toEqual({ status: 'removed', email: 'new@acme.test' })
    const again = await send(
      app,
      'DELETE',
      '/api/workspaces/acme/members/new@acme.test',
      undefined,
      PLAIN_HEADERS,
    )
    expect(again.status).toBe(404)
  })

  it('will not remove or demote the only admin of a members-only workspace', async () => {
    const { app } = await makeApp()
    const removed = await send(
      app,
      'DELETE',
      '/api/workspaces/acme/members/owner@acme.test',
      undefined,
      PLAIN_HEADERS,
    )
    expect(removed.status).toBe(409)
    expect((await errorOf(removed)).code).toBe('last-admin')

    const demoted = await send(app, 'PUT', '/api/workspaces/acme/members/owner@acme.test', { role: 'editor' })
    expect(demoted.status).toBe(409)

    // With an organisation on the workspace every organisation member is an
    // admin already, so the guard steps aside.
    await send(app, 'PATCH', '/api/workspaces/acme', { stytchOrganizationSlug: 'acme' })
    const now = await send(
      app,
      'DELETE',
      '/api/workspaces/acme/members/owner@acme.test',
      undefined,
      PLAIN_HEADERS,
    )
    expect(now.status).toBe(200)
  })

  it('refuses a member that is not an email address, and an unknown role', async () => {
    const { app } = await makeApp()
    expect(
      (await send(app, 'PUT', '/api/workspaces/acme/members/not-an-email', { role: 'admin' })).status,
    ).toBe(400)
    expect((await send(app, 'PUT', '/api/workspaces/acme/members/x@y.test', { role: 'owner' })).status).toBe(
      400,
    )
  })
})
