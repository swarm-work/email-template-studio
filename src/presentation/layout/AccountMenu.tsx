/**
 * The avatar at the right of the global header, and the one menu it opens:
 * who is signed in, a dark-mode switch and, when there is a session to end,
 * Sign out.
 *
 * Presentation layer: no rules of its own. What a stored theme means and what
 * the operating system resolves it to live in `theme.ts`; `useTheme` applies it.
 *
 * It themes the APP. The email keeps its own light palette: `.studio-sheet`
 * and the preview document both pin `color-scheme: light` (docs/DECISIONS.md
 * ADR-29).
 */
import { LogOut } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useTheme } from '@/presentation/hooks/useTheme'
import { cn } from '@/lib/utils'

export interface AccountMenuProps {
  /** The signed-in person's email, when the API names one. */
  signedInAs?: string
  /** Stands in for the person when nobody is named, as the avatar always has. */
  workspaceName: string
  /** Ends the session. The item exists only when this is given (Stytch mode). */
  onSignOut?: () => void
}

/**
 * First letters of the first two words, e.g. "meridian-platform" → "MP".
 *
 * Also takes an email address, because the avatar names the signed-in person
 * once there is one: the domain is dropped and dots count as separators, so
 * "jericho.delrosario@swarm.work" reads "JD" rather than "J".
 */
function initialsOf(name: string): string {
  const base = name.includes('@') ? name.slice(0, name.indexOf('@')) : name
  const words = base.split(/[\s\-_.]+/).filter(Boolean)
  return (
    words
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

export function AccountMenu({ signedInAs, workspaceName, onSignOut }: AccountMenuProps) {
  const { resolved, setPreference } = useTheme()
  const dark = resolved === 'dark'
  // Once a real person is signed in the avatar names THEM rather than the
  // workspace - that naming is the whole point of ADR-31, and it is what the
  // send log and D1's created_by column record too.
  const name = signedInAs ?? workspaceName

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={signedInAs ? `Signed in as ${signedInAs}` : `Signed in to ${workspaceName}`}
        title={signedInAs}
        className="bg-muted text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-medium outline-none focus-visible:ring-3"
      >
        {initialsOf(name)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-xs font-normal">
            {signedInAs ? 'Signed in as' : 'Workspace'}
          </span>
          <span className="truncate font-mono text-xs">{name}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* A switch to the eye, a `menuitemcheckbox` to assistive technology:
            ARIA only allows menu items inside a menu, and a checkbox item is
            the menu's own on/off control (it is what Radix's CheckboxItem
            renders; that one draws a tick, so this draws a track instead).
            Flipping it keeps the menu open so the change can be seen. */}
        <DropdownMenuItem
          role="menuitemcheckbox"
          aria-checked={dark}
          onSelect={(event) => {
            event.preventDefault()
            setPreference(dark ? 'light' : 'dark')
          }}
          className="justify-between"
        >
          Dark mode
          <span
            aria-hidden="true"
            data-state={dark ? 'checked' : 'unchecked'}
            className={cn(
              'inline-flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors',
              dark ? 'bg-primary' : 'bg-input',
            )}
          >
            <span
              className={cn(
                'bg-background size-3 rounded-full shadow-sm transition-transform',
                dark && 'translate-x-3',
              )}
            />
          </span>
        </DropdownMenuItem>

        {onSignOut ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onSignOut}>
              <LogOut aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
