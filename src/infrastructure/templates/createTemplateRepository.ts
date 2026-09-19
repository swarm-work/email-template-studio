/**
 * Picks the template store the app runs against.
 *
 * Infrastructure layer: the composition root asks for "a repository" and this
 * module decides which adapter that is, from the build-time variable
 * `VITE_DATA_MODE`. No React, no DOM. 'http' (the D1-backed API) is the
 * default; 'memory' is the escape hatch for tests and for running the studio
 * with no database at all — its templates are gone on reload.
 */
import type { TemplateRepository } from '@/application/repositories/templateRepository'
import { createHttpTemplateRepository } from './httpTemplateRepository'
import { createInMemoryTemplateRepository } from './inMemoryTemplateRepository'

/** Where templates live. Set with `VITE_DATA_MODE` at build time. */
export type DataMode = 'memory' | 'http'

/** Builds the repository for `mode`, defaulting to what the build was configured with. */
export function createTemplateRepository(
  mode: string | undefined = import.meta.env.VITE_DATA_MODE,
): TemplateRepository {
  // Anything other than the literal 'memory' is the real API: an unset or
  // mistyped variable must not silently drop the studio into a store whose
  // saves disappear on reload.
  return mode === 'memory' ? createInMemoryTemplateRepository() : createHttpTemplateRepository()
}
