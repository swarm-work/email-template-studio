/**
 * Picks the template store the app runs against.
 *
 * Infrastructure layer: the composition root asks for "a repository" and this
 * module decides which adapter that is, from the build-time variable
 * `VITE_DATA_MODE`. No React, no DOM. Today only 'memory' exists; 'http' (the
 * D1-backed API) arrives in phase 7b, so asking for it now warns and falls back
 * rather than leaving the studio with no templates at all.
 */
import type { TemplateRepository } from '@/application/repositories/templateRepository'
import { createInMemoryTemplateRepository } from './inMemoryTemplateRepository'

/** Where templates live. Set with `VITE_DATA_MODE` at build time. */
export type DataMode = 'memory' | 'http'

/** Builds the repository for `mode`, defaulting to what the build was configured with. */
export function createTemplateRepository(
  mode: string | undefined = import.meta.env.VITE_DATA_MODE,
): TemplateRepository {
  if (mode === 'http') {
    console.warn(
      'VITE_DATA_MODE=http is not implemented yet (phase 7b). Falling back to the in-memory repository.',
    )
  }
  return createInMemoryTemplateRepository()
}
