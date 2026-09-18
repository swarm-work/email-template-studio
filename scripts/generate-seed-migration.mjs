/**
 * Writes `migrations/0002_seed_starter_templates.sql` from the starter
 * templates. Run it with `npm run seed:generate` after editing a
 * `*.email.tsx` starter or `src/infrastructure/templates/starterCatalog.json`.
 *
 * All the work lives in `server/starterSeed.ts` so the drift test can call the
 * same code; Node 22+ runs that TypeScript directly by stripping its types.
 * This file is just the "write it to disk" half.
 */
import { writeFileSync } from 'node:fs'
import { buildSeedMigrationSql, readStarterSeed, SEED_MIGRATION_PATH } from '../server/starterSeed.ts'

const entries = readStarterSeed()
const sql = buildSeedMigrationSql(entries)
writeFileSync(SEED_MIGRATION_PATH, sql)

console.log(
  `Wrote ${SEED_MIGRATION_PATH.pathname} with ${entries.length} starter templates (${sql.length} bytes).`,
)
