/**
 * A small status badge whose icon and label roll in when the state changes.
 *
 * Presentation layer, no business rules. Originally vendored from beUI
 * (beui.dev/components/motion/animated-badge, MIT) on `motion/react`; phase 6
 * reimplemented the same component on CSS keyframes so that the `motion`
 * dependency (~45 KB gzip) left the eagerly loaded main chunk (ADR-4,
 * docs/TECH_DEBT.md #30). The exported API and the status vocabulary are
 * unchanged, so every caller and test kept working.
 *
 * Motion mechanics: a state change gives the inner span a new React `key`, so
 * React replaces the element and the browser runs the `badge-roll` animation on
 * the new one (`src/index.css`). There is no exit animation — CSS cannot animate
 * an element that is already gone — which is the one deliberate difference from
 * the `motion` version. `prefers-reduced-motion` is honoured in the stylesheet,
 * so no hook has to ask.
 */
import { AlertTriangle, Check, Circle, Info, LoaderCircle, X, type LucideIcon } from 'lucide-react'
import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type AnimatedBadgeStatus = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'loading'

export type AnimatedBadgeSize = 'sm' | 'md'

export interface AnimatedBadgeProps extends Omit<ComponentPropsWithoutRef<'span'>, 'children'> {
  status?: AnimatedBadgeStatus
  size?: AnimatedBadgeSize
  children?: ReactNode
  icon?: ReactNode
  showIcon?: boolean
  pulse?: boolean
  /** What counts as "a different message"; changing it replays the roll. */
  contentKey?: string | number
}

const STATUS_CLASS: Record<AnimatedBadgeStatus, string> = {
  neutral: 'border-border bg-muted text-muted-foreground',
  info: 'border-info/30 bg-info-muted text-info-foreground',
  success: 'border-success/30 bg-success-muted text-success-foreground',
  warning: 'border-warning/40 bg-warning-muted text-warning-foreground',
  danger: 'border-danger/30 bg-danger-muted text-danger-foreground',
  loading: 'border-info/30 bg-info-muted text-info-foreground',
}

const SIZE_CLASS: Record<AnimatedBadgeSize, string> = {
  sm: 'h-5 gap-1.5 px-1.5 text-[11px]',
  md: 'h-7 gap-2 px-2.5 text-xs',
}

const ICON_CLASS: Record<AnimatedBadgeSize, string> = {
  sm: 'h-3 w-3',
  md: 'h-3.5 w-3.5',
}

const ICONS: Record<AnimatedBadgeStatus, LucideIcon> = {
  neutral: Circle,
  info: Info,
  success: Check,
  warning: AlertTriangle,
  danger: X,
  loading: LoaderCircle,
}

export function AnimatedBadge({
  status = 'neutral',
  size = 'md',
  children,
  icon,
  showIcon = true,
  pulse = status === 'loading',
  contentKey,
  className,
  ...rest
}: AnimatedBadgeProps) {
  const Icon = ICONS[status]
  const resolvedContentKey =
    contentKey ?? (typeof children === 'string' || typeof children === 'number' ? children : status)

  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center overflow-hidden rounded-md border font-medium whitespace-nowrap tabular-nums',
        'transition-colors duration-300',
        STATUS_CLASS[status],
        SIZE_CLASS[size],
        className,
      )}
      {...rest}
    >
      {pulse ? <span aria-hidden className="badge-pulse absolute inset-0 rounded-full bg-current" /> : null}
      {showIcon ? (
        <span className="relative z-10 inline-flex items-center justify-center overflow-hidden">
          <span key={status} aria-hidden data-badge-icon className="badge-roll inline-flex">
            {status === 'loading' && !icon ? (
              <Icon className={cn(ICON_CLASS[size], 'animate-spin motion-reduce:animate-none')} />
            ) : (
              (icon ?? <Icon className={ICON_CLASS[size]} />)
            )}
          </span>
        </span>
      ) : null}
      {children != null ? (
        <span className="relative z-10 inline-flex overflow-hidden">
          <span key={resolvedContentKey} data-badge-label className="badge-roll inline-block">
            {children}
          </span>
        </span>
      ) : null}
    </span>
  )
}
