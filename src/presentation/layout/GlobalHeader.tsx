/**
 * The one header bar, rendered once by `AppShell` for every screen.
 *
 * Presentation layer: navigation and status readouts, no rules. Everything it
 * shows is either a prop or a planned item that says so — nothing here invents
 * a number (see the honesty rules in docs/DESIGN.md).
 *
 * Navigation is links, not state: the URL says which screen is open (decision
 * 18 in docs/FEATURE_PLAN.md), so every enabled item is a `NavLink` under the
 * current workspace and the router marks the active one with `aria-current`.
 */
import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { toast } from 'sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SwarmLogo } from '@/presentation/shared/SwarmLogo'
import { cn } from '@/lib/utils'
import { AccountMenu } from './AccountMenu'

/** The product areas that actually have a screen behind them today. */
export type ScreenPage = 'api' | 'templates'
/** Everything the nav lists, including the area that is still planned. */
export type ProductPage = ScreenPage | 'overview'

export interface GlobalHeaderProps {
  /** The workspace the studio is open in: its slug builds the links, its name backs the avatar. */
  workspace: { readonly slug: string; readonly name: string }
  /** The picker that replaces the plain workspace label. Optional so the header renders alone in tests. */
  workspaceSwitcher?: ReactNode
  /** How long the last preview render took in this browser; null before the first one. */
  lastRenderMs: number | null
  /** True only when the send server reports itself connected: then, and only then, this is live. */
  live: boolean
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
 * which is also the path segment under `/w/:slug/`.
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

const NAV_ITEM_CLASS =
  'focus-visible:ring-ring/50 shrink-0 rounded-md px-2.5 py-1 text-sm whitespace-nowrap transition-colors outline-none focus-visible:ring-3'

export function GlobalHeader({
  workspace,
  workspaceSwitcher,
  lastRenderMs,
  live,
  signedInAs,
  onSignOut,
}: GlobalHeaderProps) {
  return (
    <header className="bg-card shrink-0 border-b">
      {/* `flex-wrap` so that below `lg` the nav can drop onto a row of its own
          (see the nav's `order-last w-full`); from `lg` up everything fits on
          the one 48px row. The break was `md` until the workspace switcher
          became visible at every width: at 768px brand + switcher + nav no
          longer fit on one row. */}
      <div className="mx-auto flex min-h-12 max-w-[1440px] min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 max-lg:pt-2 sm:px-6">
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

        <span className="text-border hidden text-lg select-none sm:inline" aria-hidden="true">
          /
        </span>

        {/* The workspace picker (ADR-32), at every width: it is the only route
            to "Workspace settings" and "New workspace". It used to wait for xl
            to leave the nav room; the account menu freed that room, and below
            xl a long name is truncated rather than the picker hidden. The width
            cap sits on the control itself, not on this wrapper: shadcn's Button
            is `shrink-0` and would spill out of a capped wrapper. */}
        <span className="inline-flex min-w-0">
          {workspaceSwitcher ?? (
            <span className="text-muted-foreground max-w-40 truncate font-mono text-xs xl:max-w-56">
              {workspace.name}
            </span>
          )}
        </span>

        {/* The nav never disappears: it is the only route to the API keys
            screen. From `lg` it sits in the row and scrolls sideways inside
            itself if it runs out of room. Below `lg` it moves to its own
            full-width row under the brand (`order-last w-full`) and WRAPS
            rather than scrolling: a scroll strip on a phone hid half of its
            first or last item at the edge with no visible way to reach it. */}
        <nav
          aria-label="Product"
          className="order-last -mx-1 flex w-full min-w-0 [scrollbar-width:none] flex-wrap items-center gap-1 px-1 pb-2 lg:order-none lg:mx-0 lg:ml-4 lg:w-auto lg:flex-1 lg:flex-nowrap lg:overflow-x-auto lg:px-0 lg:pb-0"
        >
          {NAV_ITEMS.map((item) =>
            item.enabled ? (
              <NavLink
                key={item.id}
                to={`/w/${encodeURIComponent(workspace.slug)}/${item.id}`}
                className={({ isActive }) =>
                  cn(
                    NAV_ITEM_CLASS,
                    isActive
                      ? 'bg-muted text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {item.label}
              </NavLink>
            ) : (
              <button
                key={item.id}
                type="button"
                aria-disabled="true"
                aria-describedby={PLANNED_REASON_ID}
                onClick={() => toast.info(`${item.label} is planned for a later milestone.`)}
                className={cn(NAV_ITEM_CLASS, 'text-muted-foreground hover:text-foreground opacity-60')}
              >
                {item.label}
              </button>
            ),
          )}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {/* 2xl, not xl: when the theme toggle joined this cluster in phase 9,
              at 1440 the ACTIVE page's label was clipped to "Temp" in the
              README's own screenshots. The toggle has since moved into the
              account menu, but the workspace switcher now shows at every width,
              so the room is still spoken for. The latency pill is the one thing
              here that is information rather than navigation, so it is the one
              that waits. */}
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

          {/* One menu for the person: name, dark mode, sign out. It replaced
              the three-way theme toggle, the bare avatar and the Sign out
              button that used to sit here side by side (ADR-29 update). */}
          <AccountMenu signedInAs={signedInAs} workspaceName={workspace.name} onSignOut={onSignOut} />
          <span id={PLANNED_REASON_ID} className="sr-only">
            {PLANNED_REASON}
          </span>
        </div>
      </div>
    </header>
  )
}
