/**
 * D1TemplateStore's SQL, run against real SQLite.
 *
 * There is no D1 in Vitest: `@cloudflare/vitest-pool-workers` still peer-requires
 * Vitest 4 and this repo is on 5 (TECH_DEBT). So the contract is run here against
 * Node's built-in SQLite, driven by the ACTUAL migration file, through a tiny
 * adapter that implements the same structural `SqlDatabase` D1 satisfies.
 *
 * What that proves: the SQL is valid, the guarded UPDATE + INSERT ... SELECT pair
 * behaves, the CHECKs and the cascade fire, and the unique indexes bite.
 * What it does NOT prove: anything about D1 itself (network, batch semantics,
 * limits). That is covered by the Playwright suite in phase 7b, which drives the
 * real routes against local D1 - and by the manual probe recorded in
 * docs/DEPLOYMENT.md ("Verified on local D1").
 */
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { D1TemplateStore, isSlugConflict } from './d1TemplateStore.ts'
import type { SqlDatabase, SqlResult, SqlStatement } from './templateStore.ts'
import { codeVersion, CTX, describeTemplateStore, newTemplate } from './templateStoreContract.ts'

const MIGRATION = readFileSync(new URL('../migrations/0001_create_templates.sql', import.meta.url), 'utf8')

/** One prepared statement, bound or not. `bind` returns a new object, like D1's does. */
class NodeSqliteStatement implements SqlStatement {
  readonly #db: DatabaseSync
  readonly #query: string
  readonly #values: unknown[]

  constructor(db: DatabaseSync, query: string, values: unknown[] = []) {
    this.#db = db
    this.#query = query
    this.#values = values
  }

  bind(...values: unknown[]): SqlStatement {
    return new NodeSqliteStatement(this.#db, this.#query, values)
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const row = this.#db.prepare(this.#query).get(...(this.#values as never[]))
    return (row ?? null) as T | null
  }

  async all<T = Record<string, unknown>>(): Promise<SqlResult<T>> {
    const rows = this.#db.prepare(this.#query).all(...(this.#values as never[]))
    return { results: rows as T[], meta: { changes: 0 } }
  }

  async run<T = Record<string, unknown>>(): Promise<SqlResult<T>> {
    const info = this.#db.prepare(this.#query).run(...(this.#values as never[]))
    return { results: [], meta: { changes: Number(info.changes) } }
  }
}

/** `batch` wraps its statements in one transaction, which is what D1 promises. */
class NodeSqliteDatabase implements SqlDatabase {
  readonly #db: DatabaseSync

  constructor() {
    this.#db = new DatabaseSync(':memory:')
    this.#db.exec(MIGRATION)
  }

  prepare(query: string): SqlStatement {
    return new NodeSqliteStatement(this.#db, query)
  }

  async batch<T = Record<string, unknown>>(statements: SqlStatement[]): Promise<SqlResult<T>[]> {
    this.#db.exec('BEGIN')
    try {
      const results: SqlResult<T>[] = []
      for (const statement of statements) results.push(await statement.run<T>())
      this.#db.exec('COMMIT')
      return results
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }
}

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
    await store.addVersion('tpl_welcome', 1, codeVersion({ note: 'second' }), CTX)

    const outcome = await store.addVersion('tpl_welcome', 1, codeVersion({ note: 'stale' }), CTX)

    expect(outcome.status).toBe('conflict')
    expect(await store.listVersions('tpl_welcome')).toHaveLength(2)
    expect((await store.get('tpl_welcome'))?.version.note).toBe('second')
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

    const stored = await store.get('tpl_newsletter')
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
    expect((await store.get('tpl_welcome'))?.tags).toEqual(['sign-up', 'verification'])

    await database.prepare("UPDATE templates SET tags = 'not json' WHERE id = ?").bind('tpl_welcome').run()
    expect((await store.get('tpl_welcome'))?.tags).toEqual([])
  })
})

describe('isSlugConflict', () => {
  it('recognises the slug index and nothing else', () => {
    expect(isSlugConflict(new Error('D1_ERROR: UNIQUE constraint failed: templates.slug'))).toBe(true)
    expect(isSlugConflict(new Error('UNIQUE constraint failed: template_versions.template_id'))).toBe(false)
    expect(isSlugConflict(new Error('no such table: templates'))).toBe(false)
    expect(isSlugConflict('a string, not an Error')).toBe(false)
  })
})
