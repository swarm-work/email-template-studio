/**
 * The starter templates as plain data, read from `starterCatalog.json`.
 *
 * Infrastructure layer. The JSON is deliberately format-neutral so that THREE
 * things can read the same starters: this module (for the browser registry),
 * `server/starterSeed.ts` (for the Node runtime's in-memory store) and
 * `scripts/generate-seed-migration.mjs` (for migration 0002). Edit the JSON,
 * regenerate with `npm run seed:generate`, and the drift test stays green.
 *
 * It must not import React, Zod or anything from `@/application`.
 */
import type { TemplateCategory, TemplateKind, TemplateStatus, TemplateVersion } from '@/domain'
import catalog from './starterCatalog.json'

/** One starter, exactly as the JSON file spells it. */
export interface StarterCatalogEntry {
  readonly slug: string
  readonly name: string
  readonly description: string
  readonly category: TemplateCategory
  readonly status: TemplateStatus
  readonly tags: readonly string[]
  readonly version: TemplateVersion
  readonly createdAt: string
  /**
   * Which seed migration writes this starter. Migrations are append-only: a
   * starter added later gets a NEW batch and a new file, because editing a
   * migration that has already been applied would never reach a live database.
   */
  readonly seedBatch: number
  readonly kind: TemplateKind
  /** Code starters: the TSX file next to this one. '' for a visual starter. */
  readonly sourceFile: string
  /** Visual starters: the Tiptap JSON file under ./starters. '' for a code starter. */
  readonly documentFile: string
  /** Visual starters: the editor theme the document was authored with. '' for code. */
  readonly theme: string
  readonly envelope: { readonly subject: string; readonly preheader: string; readonly replyTo: string }
  readonly samplePayload: Record<string, unknown>
  /** JSON Schema for the props; `registry.test.ts` checks it against the Zod schema. */
  readonly propsSchema: Record<string, unknown>
}

/**
 * The one cast in this file: TypeScript infers `string` for every value in a
 * JSON import, so `category` and `status` have to be told they are the unions
 * the domain declares. `registry.test.ts` and the CHECKs in migration 0001 are
 * what actually keep the values honest.
 */
export const STARTER_CATALOG = catalog as readonly StarterCatalogEntry[]

/** The text a record stores for JSON data: pretty-printed, with a trailing newline. */
export function prettyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}
