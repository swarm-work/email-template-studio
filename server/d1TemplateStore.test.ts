/**
 * D1TemplateStore's SQL, run against real SQLite through `server/testSqlite.ts`
 * (the ACTUAL migration files on `node:sqlite`; see that module for what this
 * does and does not prove).
 */
import { describe, expect, it } from 'vitest'
import { D1TemplateStore, isSlugConflict } from './d1TemplateStore.ts'
import { NodeSqliteDatabase } from './testSqlite.ts'
import { codeVersion, CTX, describeTemplateStore, newTemplate, WS } from './templateStoreContract.ts'

describeTemplateStore('D1 SQL on node:sqlite', () => new D1TemplateStore(new NodeSqliteDatabase()))

describe('D1TemplateStore SQL details', () => {
  it('writes no version row when a stale save happens to be exactly one revision behind', async () => {
    // The nasty case: expectedRevision 1 while the row is at 2. The guarded
    // UPDATE matches nothing, but the INSERT ... SELECT's `revision = ? + 1`
    // clause DOES match - only its NOT EXISTS guard stops it inserting a
    // duplicate version number (which would abort the batch instead of
    // answering 409).
    const store = new D1TemplateStore(new NodeSqliteDatabase())
    await store.create(newTemplate('welcome'), CTX)
    await store.addVersion(WS, 'tpl_welcome', 1, codeVersion({ note: 'second' }), CTX)

    const outcome = await store.addVersion(WS, 'tpl_welcome', 1, codeVersion({ note: 'stale' }), CTX)

    expect(outcome.status).toBe('conflict')
    expect(await store.listVersions(WS, 'tpl_welcome')).toHaveLength(2)
    expect((await store.get(WS, 'tpl_welcome'))?.version.note).toBe('second')
  })

  it('stores a visual document as JSON text and gives it back unchanged', async () => {
    const store = new D1TemplateStore(new NodeSqliteDatabase())
    const document = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] })
    await store.create(
      newTemplate('newsletter', {
        version: {
          ...codeVersion(),
          kind: 'visual',
          source: null,
          document,
          theme: 'studio-v1',
        },
      }),
      CTX,
    )

    const stored = await store.get(WS, 'tpl_newsletter')
    expect(stored?.kind).toBe('visual')
    expect(stored?.version.document).toBe(document)
    expect(stored?.version.source).toBeNull()
  })

  it('lets the database refuse a version that has neither source nor document', async () => {
    const store = new D1TemplateStore(new NodeSqliteDatabase())
    // The CHECK in migration 0001 is the backstop behind the Zod contract.
    await expect(
      store.create(newTemplate('broken', { version: codeVersion({ source: null }) }), CTX),
    ).rejects.toThrow(/CHECK constraint failed/i)
  })

  it('reads tags back as an array and survives unreadable tag text', async () => {
    const database = new NodeSqliteDatabase()
    const store = new D1TemplateStore(database)
    await store.create(newTemplate('welcome', { tags: ['sign-up', 'verification'] }), CTX)
    expect((await store.get(WS, 'tpl_welcome'))?.tags).toEqual(['sign-up', 'verification'])

    await database.prepare("UPDATE templates SET tags = 'not json' WHERE id = ?").bind('tpl_welcome').run()
    expect((await store.get(WS, 'tpl_welcome'))?.tags).toEqual([])
  })

  it('puts the starters in the default workspace when the seeds run after 0004', async () => {
    // The seed migrations predate the column; migration 0004's DEFAULT is what
    // gives every existing row a home. This is the one place that is checked.
    const store = new D1TemplateStore(new NodeSqliteDatabase({ includeSeeds: true }))
    const starters = await store.list('ws_swarm-camp')
    expect(starters.map((template) => template.slug).sort()).toEqual([
      'password-reset',
      'product-launch',
      'team-invitation',
      'welcome-verification',
    ])
    expect(await store.list(WS)).toEqual([])
  })
})

describe('isSlugConflict', () => {
  it('recognises the slug index and nothing else', () => {
    // The message SQLite writes for the composite index of migration 0004.
    expect(
      isSlugConflict(new Error('D1_ERROR: UNIQUE constraint failed: templates.workspace_id, templates.slug')),
    ).toBe(true)
    expect(isSlugConflict(new Error('UNIQUE constraint failed: template_versions.template_id'))).toBe(false)
    expect(isSlugConflict(new Error('UNIQUE constraint failed: workspaces.slug'))).toBe(false)
    expect(isSlugConflict(new Error('no such table: templates'))).toBe(false)
    expect(isSlugConflict('a string, not an Error')).toBe(false)
  })
})
