/**
 * The workspace picker in the header: the current name, a menu of every
 * workspace the person may enter, a link to the settings and "New workspace".
 *
 * Presentation layer. Switching is navigation: the URL is the state (decision
 * 18 in docs/FEATURE_PLAN.md), so this component only builds links.
 */
import { Check, ChevronsUpDown, Plus, Settings } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Workspace } from '@/domain'
import { NewWorkspaceDialog } from './NewWorkspaceDialog'
import { useWorkspace } from './WorkspaceContext'

/** `/w/<slug>/templates`: where a workspace opens. */
export function workspaceHome(workspace: Pick<Workspace, 'slug'>): string {
  return `/w/${encodeURIComponent(workspace.slug)}/templates`
}

export function WorkspaceSwitcher() {
  const { workspace, workspaces, repository, replace } = useWorkspace()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground max-w-56 min-w-0 gap-1 px-2 font-mono text-xs"
            aria-label={`Workspace: ${workspace.name}`}
          >
            <span className="truncate">{workspace.name}</span>
            <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {workspaces.map((candidate) => {
            const current = candidate.slug === workspace.slug
            return (
              <DropdownMenuItem key={candidate.slug} asChild>
                <Link to={workspaceHome(candidate)} aria-current={current ? 'true' : undefined}>
                  <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
                  <span className="text-muted-foreground font-mono text-[11px]">{candidate.role}</span>
                  {current ? <Check aria-hidden="true" className="size-4" /> : null}
                </Link>
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to={`/w/${encodeURIComponent(workspace.slug)}/settings`}>
              <Settings aria-hidden="true" />
              Workspace settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            New workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <NewWorkspaceDialog
        open={creating}
        onOpenChange={setCreating}
        repository={repository}
        onCreated={(created) => {
          // Into the list at once, then straight into the new workspace.
          replace(created)
          void navigate(workspaceHome(created))
        }}
      />
    </>
  )
}
