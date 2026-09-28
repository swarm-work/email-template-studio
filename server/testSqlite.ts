/**
 * Real SQLite for the store tests, driven by the ACTUAL migration files.
 *
 * There is no D1 in Vitest: `@cloudflare/vitest-pool-workers` still peer-requires
 * Vitest 4 and this repo is on 5 (TECH_DEBT). So every D1 store is tested here
 * against Node's built-in SQLite, through a tiny adapter that implements the
 * same structural `SqlDatabase` that D1 satisfies.
 *
 * What that proves: the SQL is valid against the real schema, the guarded
 * writes behave, the CHECKs and cascades fire, and the unique indexes bite.
 * What it does NOT prove: anything about D1 itself (network, batch semantics,
 * limits). The Playwright suite drives the real routes against local D1.
 *
 * Test-only, Node-only: nothing the Worker imports may import this module.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import type { SqlDatabase, SqlResult, SqlStatement } from './templateStore.ts'

const MIGRATIONS_DIR = new URL('../migrations/', import.meta.url)

/** Every migration file, in the order wrangler applies them. */
export function listMigrations(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

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

export interface TestDatabaseOptions {
  /**
   * Whether the generated seed migrations (the starter templates) run too.
   * Off by default: a contract suite wants an empty library to start from.
   */
  readonly includeSeeds?: boolean
}

/**
 * An in-memory SQLite database with the migrations applied. `batch` wraps its
 * statements in one transaction, which is what D1 promises.
 */
export class NodeSqliteDatabase implements SqlDatabase {
  readonly #db: DatabaseSync

  constructor({ includeSeeds = false }: TestDatabaseOptions = {}) {
    this.#db = new DatabaseSync(':memory:')
    // D1 enforces foreign keys; so must the schema under test.
    this.#db.exec('PRAGMA foreign_keys = ON')
    for (const name of listMigrations()) {
      if (!includeSeeds && name.includes('seed')) continue
      this.#db.exec(readFileSync(new URL(name, MIGRATIONS_DIR), 'utf8'))
    }
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
