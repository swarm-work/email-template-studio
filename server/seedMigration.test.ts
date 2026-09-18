/**
 * The drift test behind migration 0002: regenerate the seed SQL in memory and
 * compare it with the committed file. Editing a starter template without
 * running `npm run seed:generate` fails here rather than shipping a database
 * whose starters differ from the ones in the repository.
 */
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { InMemoryTemplateStore } from './inMemoryTemplateStore.ts'
import {
  buildSeedMigrationSql,
  MAX_SEED_STATEMENT_BYTES,
  readStarterSeed,
  SEED_MIGRATION_PATH,
} from './starterSeed.ts'

const committed = readFileSync(SEED_MIGRATION_PATH, 'utf8')
const entries = readStarterSeed()

describe('migrations/0002_seed_starter_templates.sql', () => {
  it('matches what the generator produces today', () => {
    expect(buildSeedMigrationSql(entries)).toBe(committed)
  })

  it('seeds the three starters as version 1, origin starter, author seed', () => {
    expect(entries.map((entry) => entry.input.slug)).toEqual([
      'welcome-verification',
      'password-reset',
      'team-invitation',
    ])
    for (const { input, ctx } of entries) {
      expect(input.id).toBe(`tpl_${input.slug}`)
      expect(input.origin).toBe('starter')
      expect(input.version.kind).toBe('code')
      expect(input.version.source).toContain('import')
      expect(ctx.by).toBe('seed')
    }
  })

  it('keeps every statement well inside the D1 statement limit', () => {
    for (const statement of committed.split(';\n')) {
      expect(new TextEncoder().encode(statement).length).toBeLessThan(MAX_SEED_STATEMENT_BYTES)
    }
  })

  it('actually applies on top of migration 0001', () => {
    // Real SQLite, real migration files: a typo in the generated SQL fails here
    // instead of the first time someone runs `npm run db:migrate`.
    const db = new DatabaseSync(':memory:')
    db.exec(readFileSync(new URL('../migrations/0001_create_templates.sql', import.meta.url), 'utf8'))
    db.exec(committed)

    const rows = db.prepare('SELECT id, slug, origin, current_version FROM templates ORDER BY slug').all()
    expect(rows).toEqual([
      { id: 'tpl_password-reset', slug: 'password-reset', origin: 'starter', current_version: 1 },
      { id: 'tpl_team-invitation', slug: 'team-invitation', origin: 'starter', current_version: 1 },
      {
        id: 'tpl_welcome-verification',
        slug: 'welcome-verification',
        origin: 'starter',
        current_version: 1,
      },
    ])
    const versions = db.prepare('SELECT COUNT(*) AS n FROM template_versions').get()
    expect(versions).toEqual({ n: 3 })
  })

  it('is the same data the Node runtime seeds its in-memory store with', async () => {
    const store = new InMemoryTemplateStore(readStarterSeed())

    const listed = await store.list()
    expect(listed.map((template) => template.slug).sort()).toEqual([
      'password-reset',
      'team-invitation',
      'welcome-verification',
    ])
    expect((await store.get('tpl_welcome-verification'))?.version.source).toContain('React')
  })
})
