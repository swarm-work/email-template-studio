import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Identity } from './auth.ts'
import { D1WorkspaceStore, isWorkspaceSlugConflict } from './d1WorkspaceStore.ts'
import { InMemoryWorkspaceStore } from './inMemoryWorkspaceStore.ts'
import { NodeSqliteDatabase } from './testSqlite.ts'
import { CTX } from './templateStoreContract.ts'
import { roleAllows, roleFor } from './workspaceAccess.ts'
import { DEFAULT_WORKSPACE, DEFAULT_WORKSPACE_CTX } from './workspaceStore.ts'
import type { StoredWorkspace } from './workspaceStore.ts'
import { describeWorkspaceStore, newWorkspace } from './workspaceStoreContract.ts'

/** The in-memory store starts where migration 0004 leaves D1: one default workspace. */
const seeded = () => new InMemoryWorkspaceStore([{ input: DEFAULT_WORKSPACE, ctx: DEFAULT_WORKSPACE_CTX }])

describeWorkspaceStore('in-memory', seeded)
describeWorkspaceStore('D1 SQL on node:sqlite', () => new D1WorkspaceStore(new NodeSqliteDatabase()))

describe('the default workspace', () => {
  it('is the row migration 0004 inserts', async () => {
    // The migration is the truth for D1; the constant is the truth for the
    // in-memory store. Reading the row back through the D1 store proves the
    // two agree, column by column, without parsing SQL by hand.
    const fromMigration = await new D1WorkspaceStore(new NodeSqliteDatabase()).getBySlug(
      DEFAULT_WORKSPACE.slug,
    )
    const fromConstant = new InMemoryWorkspaceStore([
      { input: DEFAULT_WORKSPACE, ctx: DEFAULT_WORKSPACE_CTX },
    ])
    expect(fromMigration).toEqual(await fromConstant.getBySlug(DEFAULT_WORKSPACE.slug))
  })

  it('owns every template the seed migrations create', () => {
    const migration = readFileSync(
      new URL('../migrations/0004_create_workspaces.sql', import.meta.url),
      'utf8',
    )
    expect(migration).toContain(`DEFAULT '${DEFAULT_WORKSPACE.id}'`)
  })

  it('removes a workspace member row when the workspace goes (ON DELETE CASCADE)', async () => {
    const database = new NodeSqliteDatabase()
    const store = new D1WorkspaceStore(database)
    await store.create(newWorkspace('acme'), CTX)
    await store.putMember('ws_acme', 'a@x.test', 'admin', CTX)
    await database.prepare('DELETE FROM workspaces WHERE id = ?').bind('ws_acme').run()
    expect(await store.membershipsOf('a@x.test')).toEqual([])
  })
})

describe('isWorkspaceSlugConflict', () => {
  it('recognises the workspace slug index and nothing else', () => {
    expect(isWorkspaceSlugConflict(new Error('D1_ERROR: UNIQUE constraint failed: workspaces.slug'))).toBe(
      true,
    )
    expect(
      isWorkspaceSlugConflict(new Error('UNIQUE constraint failed: templates.workspace_id, templates.slug')),
    ).toBe(false)
    expect(isWorkspaceSlugConflict('no such table')).toBe(false)
  })
})

describe('roleFor', () => {
  const workspace: StoredWorkspace = {
    ...DEFAULT_WORKSPACE,
    createdBy: 'x',
    createdAt: 'x',
    updatedBy: 'x',
    updatedAt: 'x',
  }
  const person = (overrides: Partial<Identity> = {}): Identity => ({
    email: 'person@swarm.work',
    origin: 'directory',
    roles: [],
    ...overrides,
  })
  const member = (role: 'admin' | 'editor') => ({
    workspaceId: workspace.id,
    email: 'person@swarm.work',
    role,
    addedBy: 'x',
    addedAt: 'x',
  })

  it('lets a named member row decide, even for someone the organisation would admit as admin', () => {
    const inOrg = person({ organization: { id: 'organization-test-1', slug: 'swarm' } })
    expect(roleFor(workspace, member('editor'), inOrg)).toBe('editor')
    expect(roleFor(workspace, member('admin'), person())).toBe('admin')
  })

  it('admits a server identity (developer mode, shared password) everywhere as an admin', () => {
    const developer = person({ email: 'developer@localhost', origin: 'server' })
    expect(roleFor(workspace, null, developer)).toBe('admin')
    expect(roleFor({ ...workspace, stytchOrganizationSlug: null }, null, developer)).toBe('admin')
  })

  it('admits members of the workspace organisation as admins, and nobody else', () => {
    const inOrg = person({ organization: { id: 'organization-test-1', slug: 'swarm' } })
    const otherOrg = person({ organization: { id: 'organization-test-2', slug: 'acme' } })
    expect(roleFor(workspace, null, inOrg)).toBe('admin')
    expect(roleFor(workspace, null, otherOrg)).toBeNull()
    expect(roleFor(workspace, null, person())).toBeNull()
    // A workspace with no organisation admits nobody through this rule, whoever they are.
    expect(roleFor({ ...workspace, stytchOrganizationSlug: null }, null, inOrg)).toBeNull()
  })

  it('orders the roles: admin covers editor, editor does not cover admin', () => {
    expect(roleAllows('admin', 'admin')).toBe(true)
    expect(roleAllows('admin', 'editor')).toBe(true)
    expect(roleAllows('editor', 'editor')).toBe(true)
    expect(roleAllows('editor', 'admin')).toBe(false)
  })
})
