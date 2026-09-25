/**
 * Picks the workspace repository the app runs against, from the same
 * `VITE_DATA_MODE` switch as `createTemplateRepository`.
 */
import type { WorkspaceRepository } from '@/application/repositories/workspaceRepository'
import { createHttpWorkspaceRepository } from './httpWorkspaceRepository'
import { createInMemoryWorkspaceRepository } from './inMemoryWorkspaceRepository'

export function createWorkspaceRepository(
  mode: string | undefined = import.meta.env.VITE_DATA_MODE,
): WorkspaceRepository {
  return mode === 'memory' ? createInMemoryWorkspaceRepository() : createHttpWorkspaceRepository()
}
