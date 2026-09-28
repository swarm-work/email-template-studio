/**
 * Which workspace `/` should open: the one last visited in this browser, if
 * it is still one the person may enter, else the first in the list.
 *
 * `localStorage` on purpose, not `sessionStorage`: this is a convenience that
 * should survive closing the tab. Every access is wrapped, because storage can
 * be absent or throw (private windows, blocked site data).
 */
import type { Workspace } from '@/domain'

const KEY = 'email-template-studio:last-workspace'

export function rememberWorkspace(slug: string): void {
  try {
    window.localStorage.setItem(KEY, slug)
  } catch {
    // Nothing to do: the redirect just falls back to the first workspace.
  }
}

export function pickHomeWorkspace(workspaces: readonly Workspace[]): Workspace | null {
  let remembered: string | null = null
  try {
    remembered = window.localStorage.getItem(KEY)
  } catch {
    remembered = null
  }
  return workspaces.find((workspace) => workspace.slug === remembered) ?? workspaces[0] ?? null
}
