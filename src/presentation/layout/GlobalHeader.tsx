/**
 * The one header bar, rendered once by `AppShell` for every screen.
 *
 * Presentation layer: navigation and status readouts, no rules. Everything it
 * shows is either a prop or a planned item that says so — nothing here invents
 * a number (see the honesty rules in docs/DESIGN.md).
 */
import { ExternalLink, Mail } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { StatusBadge } from '@/presentation/shared/StatusBadge'
import { cn } from '@/lib/utils'
import { ThemeToggle } from './ThemeToggle'

/** The product areas that actually have a screen behind them today. */
export type ScreenPage = 'api' | 'templates'
/** Everything the nav lists, including the areas that are still planned. */
export type ProductPage = ScreenPage | 'overview' | 'domains'

export interface GlobalHeaderProps {
  workspace: string
  environment: string
  /** How long the last preview render took in this browser; null before the first one. */
  lastRenderMs: number | null
  /** True only when the send server reports itself connected: then, and only then, this is live. */
  live: boolean
  activePage: ScreenPage
  /** Only ever called with a page that has a screen; the planned items say so instead. */
  onNavigate: (page: ScreenPage) => void
  /**
   * The signed-in person's email, when the API names one. Left undefined under
   * the shared password, where there is no person to name - the audit trail
   * says `shared-password` and the avatar keeps standing for the workspace.
   */
  signedInAs?: string
  /**
   * Ends the session. Rendered only when given, so the control cannot appear in
   * a mode that has nothing to sign out of.
   */
  onSignOut?: () => void
}

/**
 * The nav, in order. The `enabled: true` branch narrows `id` to a `ScreenPage`,
 * so a planned item can never be handed to `onNavigate` by accident.
 */
type NavItem =
  | { readonly id: ScreenPage; readonly label: string; readonly enabled: true }
  | { readonly id: ProductPage; readonly label: string; readonly enabled: false }

const NAV_ITEMS: readonly NavItem[] = [
  { id: 'overview', label: 'Overview & Logs', enabled: false },
  { id: 'domains', label: 'Domains', enabled: false },
  { id: 'api', label: 'API Keys & Webhooks', enabled: true },
  { id: 'templates', label: 'Template Studio', enabled: true },
]

/**
 * Controls that are `aria-disabled` have to say why: a screen reader is told
 * "unavailable" and would otherwise get no explanation at all. One sentence,
 * one element, pointed at by every planned control (see plan §4.6).
 */
const PLANNED_REASON = 'Planned for a later milestone.'
const PLANNED_REASON_ID = 'header-planned-reason'

/** The render pill explains itself: it is a browser measurement, not a service level. */
const LATENCY_TOOLTIP = 'Time of the last preview render in this browser.'

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

export function GlobalHeader({
  workspace,
  environment,
  lastRenderMs,
  live,
  activePage,
  onNavigate,
  signedInAs,
  onSignOut,
}: GlobalHeaderProps) {
  return (
    <header className="bg-card shrink-0 border-b">
      <div className="mx-auto flex h-12 max-w-[1440px] min-w-0 items-center gap-3 px-6">
        <a
          href="/"
          className="focus-visible:ring-ring/50 flex shrink-0 items-center gap-2 rounded-md outline-none focus-visible:ring-3"
        >
          <span className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-md">
            <Mail className="size-3.5" aria-hidden="true" />
          </span>
          <span className="text-sm font-semibold tracking-tight">Email Template Studio</span>
        </a>

        <span className="text-border hidden text-lg select-none xl:inline" aria-hidden="true">
          /
        </span>

        {/* A static label, not a picker: there is exactly one workspace. Below xl
            the nav needs the room, and the avatar still names the workspace. */}
        <span className="text-muted-foreground hidden truncate font-mono text-xs xl:inline">{workspace}</span>

        <span className="hidden sm:inline-flex">
          <StatusBadge tone="neutral">{environment}</StatusBadge>
        </span>

        {/* From md the nav is a scroll strip rather than disappearing: there is
            no other route to the API keys screen, so dropping it below lg would
            leave the app single-screen on a small laptop. */}
        <nav
          aria-label="Product"
          className="ml-4 hidden min-w-0 flex-1 [scrollbar-width:none] items-center gap-1 overflow-x-auto md:flex"
        >
          {NAV_ITEMS.map((item) => {
            const active = item.id === activePage
            return (
              <button
                key={item.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                aria-disabled={item.enabled ? undefined : true}
                aria-describedby={item.enabled ? undefined : PLANNED_REASON_ID}
                onClick={() => {
                  if (item.enabled) {
                    onNavigate(item.id)
                    return
                  }
                  toast.info(`${item.label} is planned for a later milestone.`)
                }}
                className={cn(
                  'focus-visible:ring-ring/50 shrink-0 rounded-md px-2.5 py-1 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3',
                  active
                    ? 'bg-muted text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                  !item.enabled && 'opacity-60',
                )}
              >
                {item.label}
              </button>
            )
          })}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {/* 2xl, not xl: the theme toggle joined this cluster in phase 9, and at
              1440 the three of them together took the width the nav needs — the
              ACTIVE page's label was clipped to "Temp" in the README's own
              screenshots. The latency pill is the one thing here that is
              information rather than navigation, so it is the one that waits. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="text-muted-foreground focus-visible:ring-ring/50 hidden h-7 items-center gap-1.5 rounded-md border px-2 font-mono text-[11px] tabular-nums outline-none focus-visible:ring-3 2xl:inline-flex"
              >
                {live ? 'LIVE' : 'Local'} · render worker {lastRenderMs === null ? '—' : `${lastRenderMs} ms`}
              </span>
            </TooltipTrigger>
            <TooltipContent>{LATENCY_TOOLTIP}</TooltipContent>
          </Tooltip>

          <ThemeToggle />

          <Button asChild variant="ghost" size="sm">
            <a href="https://react.email/docs" target="_blank" rel="noreferrer">
              Docs
              <ExternalLink aria-hidden="true" />
            </a>
          </Button>

          <Button
            variant="ghost"
            size="sm"
            className="hidden xl:inline-flex"
            aria-disabled="true"
            aria-describedby={PLANNED_REASON_ID}
            onClick={() => toast.info('Feedback is planned for a later milestone.')}
          >
            Feedback
          </Button>

          {/* A bare <span> is `role=generic`, which does not take a name, so the
              avatar is an image as far as assistive technology is concerned.
              Once a real person is signed in the avatar names THEM rather than
              the workspace - that naming is the whole point of the work in
              ADR-31, and it is what the send log and D1's created_by column
              record too. */}
          <span
            role="img"
            aria-label={signedInAs ? `Signed in as ${signedInAs}` : `Signed in to ${workspace}`}
            title={signedInAs}
            className="bg-muted text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-medium"
          >
            {initialsOf(signedInAs ?? workspace)}
          </span>

          {onSignOut ? (
            <Button variant="ghost" size="sm" className="hidden lg:inline-flex" onClick={onSignOut}>
              Sign out
            </Button>
          ) : null}

          <span id={PLANNED_REASON_ID} className="sr-only">
            {PLANNED_REASON}
          </span>
        </div>
      </div>
    </header>
  )
}
