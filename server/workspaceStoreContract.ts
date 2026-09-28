/**
 * One Vitest suite every WorkspaceStore implementation has to pass. Same idea
 * as templateStoreContract.ts: the contract is written once, and each adapter's
 * test file calls `describeWorkspaceStore(name, factory)`.
 */
import { describe, expect, it } from 'vitest'
import type { NewWorkspaceInput, WorkspaceStore } from './workspaceStore.ts'
import { CTX, LATER_CTX } from './templateStoreContract.ts'

/** A whole new workspace; `slug` doubles as the id suffix so cases stay readable. */
export function newWorkspace(slug: string, overrides: Partial<NewWorkspaceInput> = {}): NewWorkspaceInput {
  return {
    id: `ws_${slug}`,
    slug,
    name: slug,
    stytchOrganizationSlug: null,
    defaultFrom: `hello@${slug}.test`,
    allowedFromDomain: `${slug}.test`,
    sesConfigurationSet: null,
    ...overrides,
  }
}

function expectSaved(outcome: Awaited<ReturnType<WorkspaceStore['create']>>) {
  expect(outcome.status).toBe('saved')
  if (outcome.status !== 'saved') throw new Error('unreachable')
  return outcome.workspace
}

export function describeWorkspaceStore(name: string, makeStore: () => WorkspaceStore): void {
  describe(`WorkspaceStore contract: ${name}`, () => {
    it('creates a workspace and finds it by id and by slug', async () => {
      const store = makeStore()
      const created = expectSaved(
        await store.create(newWorkspace('acme', { stytchOrganizationSlug: 'acme' }), CTX),
      )

      expect(created).toMatchObject({
        id: 'ws_acme',
        slug: 'acme',
        stytchOrganizationSlug: 'acme',
        sesConfigurationSet: null,
        createdBy: CTX.by,
        updatedAt: CTX.at,
      })
      expect(await store.get('ws_acme')).toEqual(created)
      expect(await store.getBySlug('acme')).toEqual(created)
      expect(await store.get('ws_missing')).toBeNull()
      expect(await store.getBySlug('missing')).toBeNull()
    })

    it('lists workspaces by name, case-insensitively, with the default workspace among them', async () => {
      // Every store starts from migration 0004's state: the default workspace
      // is already there (the in-memory factory seeds it). 'swarm.camp' sorts
      // between 'Alpha' and 'Zeta' only if case is ignored, which SQLite does
      // not do by default - hence the COLLATE NOCASE in the D1 store.
      const store = makeStore()
      await store.create(newWorkspace('zeta', { name: 'Zeta' }), CTX)
      await store.create(newWorkspace('alpha', { name: 'Alpha' }), CTX)
      expect((await store.list()).map((workspace) => workspace.slug)).toEqual(['alpha', 'swarm-camp', 'zeta'])
    })

    it('refuses a slug another workspace already holds, and a duplicate id outright', async () => {
      const store = makeStore()
      await store.create(newWorkspace('acme'), CTX)
      expect((await store.create(newWorkspace('acme', { id: 'ws_other' }), CTX)).status).toBe('slug-taken')
      await expect(store.create(newWorkspace('different', { id: 'ws_acme' }), CTX)).rejects.toThrow()
    })

    it('updates the settings that were sent, clears a nullable one on null, and leaves the rest', async () => {
      const store = makeStore()
      await store.create(
        newWorkspace('acme', { stytchOrganizationSlug: 'acme', sesConfigurationSet: 'studio-acme' }),
        CTX,
      )

      const outcome = await store.update(
        'ws_acme',
        { name: 'ACME Inc', sesConfigurationSet: null, defaultFrom: 'noreply@acme.test' },
        LATER_CTX,
      )
      const updated = expectSaved(outcome)
      expect(updated).toMatchObject({
        name: 'ACME Inc',
        sesConfigurationSet: null,
        defaultFrom: 'noreply@acme.test',
        // Untouched: not in the patch.
        stytchOrganizationSlug: 'acme',
        allowedFromDomain: 'acme.test',
        createdBy: CTX.by,
        updatedBy: LATER_CTX.by,
        updatedAt: LATER_CTX.at,
      })
      expect((await store.update('ws_missing', { name: 'x' }, CTX)).status).toBe('not-found')
    })

    it('adds, re-roles, lists and removes named members', async () => {
      const store = makeStore()
      await store.create(newWorkspace('acme'), CTX)
      await store.create(newWorkspace('beta'), CTX)

      expect(await store.putMember('ws_acme', 'b@x.test', 'editor', CTX)).toEqual({
        workspaceId: 'ws_acme',
        email: 'b@x.test',
        role: 'editor',
        addedBy: CTX.by,
        addedAt: CTX.at,
      })
      await store.putMember('ws_acme', 'a@x.test', 'admin', CTX)
      await store.putMember('ws_beta', 'b@x.test', 'admin', CTX)
      // A second put for the same person is a role change, not a second row.
      await store.putMember('ws_acme', 'b@x.test', 'admin', LATER_CTX)

      expect((await store.listMembers('ws_acme')).map((m) => [m.email, m.role, m.addedBy])).toEqual([
        ['a@x.test', 'admin', CTX.by],
        ['b@x.test', 'admin', LATER_CTX.by],
      ])
      expect((await store.membershipsOf('b@x.test')).map((m) => m.workspaceId)).toEqual([
        'ws_acme',
        'ws_beta',
      ])

      expect(await store.removeMember('ws_acme', 'b@x.test')).toBe('deleted')
      expect(await store.removeMember('ws_acme', 'b@x.test')).toBe('not-found')
      expect((await store.listMembers('ws_acme')).map((m) => m.email)).toEqual(['a@x.test'])
    })

    it('will not add a member to a workspace that does not exist', async () => {
      const store = makeStore()
      expect(await store.putMember('ws_missing', 'a@x.test', 'admin', CTX)).toBeNull()
      expect(await store.membershipsOf('a@x.test')).toEqual([])
    })
  })
}
