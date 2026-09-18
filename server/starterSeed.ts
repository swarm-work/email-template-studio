/**
 * The starter templates as store rows, plus the SQL that seeds them.
 *
 * ONE source of starter rows, used by three callers: `server/node.ts` (to fill
 * its in-memory store), `scripts/generate-seed-migration.mjs` (to write
 * `migrations/0002_seed_starter_templates.sql`) and `seedMigration.test.ts`
 * (which regenerates the SQL and fails if the committed file has drifted).
 *
 * Server layer, but Node-only: it reads files with `node:fs`. Nothing the
 * Worker imports may import this module.
 */
import { readFileSync } from 'node:fs'
import type { NewTemplateInput, WriteContext } from './templateStore.ts'

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
}

/** The fields of `starterCatalog.json` this module uses. */
interface CatalogEntry {
  slug: string
  name: string
  description: string
  category: NewTemplateInput['category']
  status: NewTemplateInput['status']
  tags: string[]
  createdAt: string
  sourceFile: string
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
        kind: 'code',
        envelope: entry.envelope,
        source: readFileSync(new URL(entry.sourceFile, TEMPLATES_DIR), 'utf8'),
        document: null,
        theme: 'studio-v1',
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

/** D1 refuses a statement over 100 KB; stay well under it so a longer starter is caught early. */
export const MAX_SEED_STATEMENT_BYTES = 90_000

/** SQL string literal: the only character that needs escaping is the quote, doubled. */
function sqlText(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * Builds `migrations/0002_seed_starter_templates.sql`. Plain INSERTs rather
 * than anything clever, because a migration is read far more often than it is
 * written, and `wrangler d1 migrations apply` runs it as-is.
 */
export function buildSeedMigrationSql(entries: readonly StarterSeedEntry[]): string {
  const lines = [
    '-- Migration 0002: the three starter templates that ship with the studio.',
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
      `  ${sqlText(version.envelope.replyTo)}, ${sqlText(version.source ?? '')}, NULL,`,
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

/** Where the generated migration lives, so the script and the test agree on one path. */
export const SEED_MIGRATION_PATH = new URL('../migrations/0002_seed_starter_templates.sql', import.meta.url)
