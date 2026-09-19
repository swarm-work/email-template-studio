/**
 * Writes one seed migration per batch of starter templates. Run it with
 * `npm run seed:generate` after editing a `*.email.tsx` starter, a
 * `*.visual.json` document or `src/infrastructure/templates/starterCatalog.json`.
 *
 * All the work lives in `server/starterSeed.ts` so the drift test can call the
 * same code; Node 22+ runs that TypeScript directly by stripping its types.
 * This file is just the "write it to disk" half.
 */
import { writeFileSync } from 'node:fs'
import { buildSeedMigrations, readStarterSeed } from '../server/starterSeed.ts'

const entries = readStarterSeed()

for (const { path, sql } of buildSeedMigrations(entries)) {
  writeFileSync(path, sql)
  console.log(`Wrote ${path.pathname} (${sql.length} bytes).`)
}

console.log(`${entries.length} starter templates in ${new Set(entries.map((e) => e.batch)).size} batches.`)
