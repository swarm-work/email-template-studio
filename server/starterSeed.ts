/**
 * The starter templates as store rows, plus the SQL that seeds them.
 *
 * ONE source of starter rows, used by three callers: `server/node.ts` (to fill
 * its in-memory store), `scripts/generate-seed-migration.mjs` (to write one
 * migration per seed batch) and `seedMigration.test.ts` (which regenerates them
 * and fails if a committed file has drifted).
 *
 * Server layer, but Node-only: it reads files with `node:fs`. Nothing the
 * Worker imports may import this module.
 */
import { readFileSync } from 'node:fs'
import type { NewTemplateInput, TemplateKind, WriteContext } from './templateStore.ts'

/**
 * Where the starters are authored. They live in the app because they are real,
 * type-checked React Email components; this module only reads their text.
 */
const TEMPLATES_DIR = new URL('../src/infrastructure/templates/', import.meta.url)

/** Attribution for rows nobody typed: the seed made them. */
export const SEED_AUTHOR = 'seed'

/** One starter, ready to hand to `TemplateStore.create`. */
export interface StarterSeedEntry {
  readonly input: NewTemplateInput
  readonly ctx: WriteContext
  /** Which seed migration writes this row. */
  readonly batch: number
}

/**
 * One generated migration per batch of starters.
 *
 * Migrations are append-only: `wrangler d1 migrations apply` records 0002 as
 * applied and never runs it again, so a starter added later cannot be squeezed
 * into it. It gets a batch of its own and a file of its own instead, and the
 * drift test regenerates every entry here.
 */
export const SEED_MIGRATIONS: readonly {
  readonly batch: number
  readonly fileName: string
  /** The first line of the generated file, after "-- Migration NNNN: ". */
  readonly title: string
}[] = [
  {
    batch: 2,
    fileName: '0002_seed_starter_templates.sql',
    title: 'the three starter templates that ship with the studio.',
  },
  {
    batch: 3,
    fileName: '0003_seed_visual_starter.sql',
    title: 'the visual starter template (kind visual, edited on the canvas).',
  },
]

/** The fields of `starterCatalog.json` this module uses. */
interface CatalogEntry {
  slug: string
  name: string
  description: string
  category: NewTemplateInput['category']
  status: NewTemplateInput['status']
  tags: string[]
  createdAt: string
  seedBatch: number
  kind: TemplateKind
  sourceFile: string
  documentFile: string
  theme: string
  envelope: { subject: string; preheader: string; replyTo: string }
  samplePayload: unknown
  propsSchema: unknown
}

function readCatalog(): CatalogEntry[] {
  return JSON.parse(readFileSync(new URL('starterCatalog.json', TEMPLATES_DIR), 'utf8')) as CatalogEntry[]
}

/** The text a record stores for JSON data: pretty-printed, trailing newline. */
function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

/**
 * The starters as rows. Every one is `origin: 'starter'`, `created_by: 'seed'`,
 * id `tpl_<slug>` and version 1: the database starts each history at v1, even
 * where the browser fixture still carries an older made-up label like "v3".
 */
export function readStarterSeed(): StarterSeedEntry[] {
  return readCatalog().map((entry) => ({
    batch: entry.seedBatch,
    input: {
      id: `tpl_${entry.slug}`,
      slug: entry.slug,
      name: entry.name,
      description: entry.description,
      category: entry.category,
      status: entry.status,
      tags: entry.tags,
      origin: 'starter',
      version: {
        kind: entry.kind,
        envelope: entry.envelope,
        // Exactly one of the two is filled in; the CHECK in migration 0001
        // refuses a row where that is not true.
        source: entry.kind === 'code' ? readFile(entry.sourceFile) : null,
        document: entry.kind === 'visual' ? readFile(entry.documentFile) : null,
        theme: entry.theme === '' ? 'studio-v1' : entry.theme,
        // Exported HTML and plain text are produced in the browser when a
        // version is saved. A seeded starter has never been through that, so
        // both start empty and fill in on the first save.
        html: '',
        text: '',
        propsSample: prettyJson(entry.samplePayload),
        propsSchema: prettyJson(entry.propsSchema),
        note: 'Seeded starter template.',
      },
    },
    ctx: { by: SEED_AUTHOR, at: entry.createdAt },
  }))
}

/** Reads one file beside the starters. A missing file is a mistake, so it throws. */
function readFile(name: string): string {
  return readFileSync(new URL(name, TEMPLATES_DIR), 'utf8')
}

/** D1 refuses a statement over 100 KB; stay well under it so a longer starter is caught early. */
export const MAX_SEED_STATEMENT_BYTES = 90_000

/** SQL string literal: the only character that needs escaping is the quote, doubled. */
function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/** A column that is genuinely absent is NULL, not an empty string: the CHECK on
 * template_versions distinguishes the two. */
function sqlOrNull(value: string | null): string {
  return value === null ? 'NULL' : sqlText(value)
}

/** Where one generated migration goes, and which rows belong in it. */
export interface SeedMigrationFile {
  readonly path: URL
  readonly sql: string
}

/** Every seed migration, regenerated from the catalog. One file per batch. */
export function buildSeedMigrations(entries: readonly StarterSeedEntry[]): SeedMigrationFile[] {
  return SEED_MIGRATIONS.map((migration) => ({
    path: new URL(`../migrations/${migration.fileName}`, import.meta.url),
    sql: buildSeedMigrationSql(
      entries.filter((entry) => entry.batch === migration.batch),
      migration,
    ),
  }))
}

/**
 * Builds one seed migration. Plain INSERTs rather than anything clever, because
 * a migration is read far more often than it is written, and
 * `wrangler d1 migrations apply` runs it as-is.
 */
export function buildSeedMigrationSql(
  entries: readonly StarterSeedEntry[],
  migration: (typeof SEED_MIGRATIONS)[number] = SEED_MIGRATIONS[0],
): string {
  const number = String(migration.batch).padStart(4, '0')
  const lines = [
    `-- Migration ${number}: ${migration.title}`,
    '--',
    '-- GENERATED FILE - do not edit by hand. Regenerate with `npm run seed:generate`',
    '-- after changing a *.email.tsx starter or starterCatalog.json; the drift test in',
    '-- server/seedMigration.test.ts fails when this file and its sources disagree.',
    '--',
    "-- Starters are real, editable rows: origin 'starter', created_by 'seed', ids",
    '-- tpl_<slug>, history starting at version 1.',
    '',
  ]

  for (const { input, ctx } of entries) {
    const version = input.version
    const templateInsert = [
      'INSERT INTO templates (id, slug, name, description, category, status, tags, origin,',
      '  current_version, revision, created_by, created_at, updated_by, updated_at)',
      `VALUES (${sqlText(input.id)}, ${sqlText(input.slug)}, ${sqlText(input.name)},`,
      `  ${sqlText(input.description)}, ${sqlText(input.category)}, ${sqlText(input.status)},`,
      `  ${sqlText(JSON.stringify([...input.tags]))}, ${sqlText(input.origin)},`,
      `  1, 1, ${sqlText(ctx.by)}, ${sqlText(ctx.at)}, ${sqlText(ctx.by)}, ${sqlText(ctx.at)});`,
    ].join('\n')

    const versionInsert = [
      'INSERT INTO template_versions (id, template_id, version_number, kind, subject, preheader,',
      '  reply_to, source, document, theme, html, plain_text, props_sample, props_schema, note,',
      '  created_by, created_at)',
      `VALUES (${sqlText(`${input.id}_v1`)}, ${sqlText(input.id)}, 1, ${sqlText(version.kind)},`,
      `  ${sqlText(version.envelope.subject)}, ${sqlText(version.envelope.preheader)},`,
      `  ${sqlText(version.envelope.replyTo)}, ${sqlOrNull(version.source)}, ${sqlOrNull(version.document)},`,
      `  ${sqlText(version.theme)}, ${sqlText(version.html)}, ${sqlText(version.text)},`,
      `  ${sqlText(version.propsSample)}, ${sqlText(version.propsSchema)}, ${sqlText(version.note)},`,
      `  ${sqlText(ctx.by)}, ${sqlText(ctx.at)});`,
    ].join('\n')

    for (const statement of [templateInsert, versionInsert]) {
      const bytes = new TextEncoder().encode(statement).length
      if (bytes > MAX_SEED_STATEMENT_BYTES) {
        throw new Error(
          `The seed statement for ${input.slug} is ${bytes} bytes, over the ${MAX_SEED_STATEMENT_BYTES} byte budget.`,
        )
      }
    }

    lines.push(`-- ${input.name}`, templateInsert, '', versionInsert, '')
  }

  return `${lines.join('\n').trimEnd()}\n`
}

/** Where the FIRST generated migration lives. Kept for callers that want just it. */
export const SEED_MIGRATION_PATH = new URL(`../migrations/${SEED_MIGRATIONS[0].fileName}`, import.meta.url)
