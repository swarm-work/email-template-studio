/**
 * The one header bar, rendered once by `AppShell` for every screen.
 *
 * Presentation layer: navigation and status readouts, no rules. Everything it
 * shows is either a prop or a planned item that says so — nothing here invents
 * a number (see the honesty rules in docs/DESIGN.md).
 */
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SwarmLogo } from '@/presentation/shared/SwarmLogo'
import { cn } from '@/lib/utils'
import { ThemeToggle } from './ThemeToggle'

/** The product areas that actually have a screen behind them today. */
export type ScreenPage = 'api' | 'templates'
/** Everything the nav lists, including the area that is still planned. */
export type ProductPage = ScreenPage | 'overview'

export interface GlobalHeaderProps {
  workspace: string
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

// Domains, Docs and Feedback used to be here too. Two were placeholders that
// only said "planned" and Docs sent people to react.email's documentation,
// not ours; the owner asked for all three to go. Overview stays as the one
// planned item because it is the next screen on the roadmap.
const NAV_ITEMS: readonly NavItem[] = [
  { id: 'overview', label: 'Overview & Logs', enabled: false },
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
  lastRenderMs,
  live,
  activePage,
  onNavigate,
  signedInAs,
  onSignOut,
}: GlobalHeaderProps) {
  return (
    <header className="bg-card shrink-0 border-b">
      {/* `flex-wrap` so that below `md` the nav can drop onto a row of its own
          (see the nav's `order-last w-full`); from `md` up everything fits on
          the one 48px row, as before. */}
      <div className="mx-auto flex min-h-12 max-w-[1440px] min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 max-md:pt-2 sm:px-6">
        {/* Swarm's own lockup (badge + wordmark) from the brand kit, then the
            product name. The link reads "Swarm Email Template Studio" to a
            screen reader; below sm only the logo fits. */}
        <a
          href="/"
          className="focus-visible:ring-ring/50 flex shrink-0 items-center gap-2.5 rounded-md outline-none focus-visible:ring-3"
        >
          <SwarmLogo className="h-5" />
          <span className="hidden text-sm font-semibold tracking-tight sm:inline">Email Template Studio</span>
        </a>

        <span className="text-border hidden text-lg select-none xl:inline" aria-hidden="true">
          /
        </span>

        {/* A static label, not a picker: there is exactly one workspace. Below xl
            the nav needs the room, and the avatar still names the workspace. */}
        <span className="text-muted-foreground hidden truncate font-mono text-xs xl:inline">{workspace}</span>

        {/* The nav never disappears: it is the only route to the API keys
            screen. From `md` it sits in the row and scrolls sideways inside
            itself if it runs out of room. Below `md` it moves to its own
            full-width row under the brand (`order-last w-full`) and WRAPS
            rather than scrolling: a scroll strip on a phone hid half of its
            first or last item at the edge with no visible way to reach it. */}
        <nav
          aria-label="Product"
          className="order-last -mx-1 flex w-full min-w-0 [scrollbar-width:none] flex-wrap items-center gap-1 px-1 pb-2 md:order-none md:mx-0 md:ml-4 md:w-auto md:flex-1 md:flex-nowrap md:overflow-x-auto md:px-0 md:pb-0"
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
