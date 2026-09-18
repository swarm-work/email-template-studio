/**
 * The drift test behind the seed migrations: regenerate every one of them in
 * memory and compare with the committed files. Editing a starter template
 * without running `npm run seed:generate` fails here rather than shipping a
 * database whose starters differ from the ones in the repository.
 */
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { InMemoryTemplateStore } from './inMemoryTemplateStore.ts'
import {
  buildSeedMigrations,
  MAX_SEED_STATEMENT_BYTES,
  readStarterSeed,
  SEED_MIGRATIONS,
} from './starterSeed.ts'

const entries = readStarterSeed()
const generated = buildSeedMigrations(entries)

describe('the generated seed migrations', () => {
  it('match what the generator produces today', () => {
    for (const { path, sql } of generated) {
      expect(readFileSync(path, 'utf8'), path.pathname).toBe(sql)
    }
  })

  it('write one file per batch, and every starter lands in one of them', () => {
    expect(generated).toHaveLength(SEED_MIGRATIONS.length)
    const batches = new Set(SEED_MIGRATIONS.map((migration) => migration.batch))
    for (const entry of entries) expect(batches.has(entry.batch)).toBe(true)
  })

  it('seeds the starters as version 1, origin starter, author seed', () => {
    expect(entries.map((entry) => entry.input.slug)).toEqual([
      'welcome-verification',
      'password-reset',
      'team-invitation',
      'product-launch',
    ])
    for (const { input, ctx } of entries) {
      expect(input.id).toBe(`tpl_${input.slug}`)
      expect(input.origin).toBe('starter')
      expect(ctx.by).toBe('seed')
      // Exactly one of the two content columns is filled in; the CHECK in
      // migration 0001 refuses anything else.
      if (input.version.kind === 'code') {
        expect(input.version.source).toContain('import')
        expect(input.version.document).toBeNull()
      } else {
        expect(input.version.source).toBeNull()
        expect(input.version.document).toContain('"container"')
      }
    }
  })

  it('keeps every statement well inside the D1 statement limit', () => {
    for (const { path } of generated) {
      for (const statement of readFileSync(path, 'utf8').split(';\n')) {
        expect(new TextEncoder().encode(statement).length).toBeLessThan(MAX_SEED_STATEMENT_BYTES)
      }
    }
  })

  it('actually apply, in order, on top of migration 0001', () => {
    // Real SQLite, real migration files: a typo in the generated SQL fails here
    // instead of the first time someone runs `npm run db:migrate`.
    const db = new DatabaseSync(':memory:')
    db.exec(readFileSync(new URL('../migrations/0001_create_templates.sql', import.meta.url), 'utf8'))
    for (const { path } of generated) db.exec(readFileSync(path, 'utf8'))

    const rows = db.prepare('SELECT id, slug, origin, current_version FROM templates ORDER BY slug').all()
    expect(rows).toEqual([
      { id: 'tpl_password-reset', slug: 'password-reset', origin: 'starter', current_version: 1 },
      { id: 'tpl_product-launch', slug: 'product-launch', origin: 'starter', current_version: 1 },
      { id: 'tpl_team-invitation', slug: 'team-invitation', origin: 'starter', current_version: 1 },
      {
        id: 'tpl_welcome-verification',
        slug: 'welcome-verification',
        origin: 'starter',
        current_version: 1,
      },
    ])
    const versions = db.prepare('SELECT COUNT(*) AS n FROM template_versions').get()
    expect(versions).toEqual({ n: 4 })
    const visual = db
      .prepare("SELECT kind, theme, source FROM template_versions WHERE template_id = 'tpl_product-launch'")
      .get()
    expect(visual).toEqual({ kind: 'visual', theme: 'studio-v1', source: null })
  })

  it('is the same data the Node runtime seeds its in-memory store with', async () => {
    const store = new InMemoryTemplateStore(readStarterSeed())

    const listed = await store.list()
    expect(listed.map((template) => template.slug).sort()).toEqual([
      'password-reset',
      'product-launch',
      'team-invitation',
      'welcome-verification',
    ])
    expect((await store.get('tpl_welcome-verification'))?.version.source).toContain('React')
    expect((await store.get('tpl_product-launch'))?.version.kind).toBe('visual')
  })
})
