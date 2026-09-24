/**
 * Swarm's logo, straight from the brand kit at https://www.swarm.work/logos.
 *
 * The kit ships one file per background (a black wordmark for light surfaces,
 * a white one for dark), so this renders both and lets the `.dark` class on
 * `<html>` decide which one is visible. That is the same switch the rest of
 * the app uses (see `layout/theme.ts`), so the logo changes with the theme
 * toggle and never flashes the wrong colour on first paint.
 *
 * Two `<img>` tags rather than one inline SVG on purpose: the brand kit's rule
 * is to use its files unchanged, and a stylesheet-driven swap keeps it that
 * way. Only one image is ever displayed, and `display: none` also removes the
 * other from the accessibility tree, so the wrapper carries the one name.
 *
 * Size it with a height class on `className` (`h-5`, `h-7`, ...); the width
 * follows from the file's aspect ratio.
 */
import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** `lockup` is badge + wordmark; `badge` is the compact mark on its own. */
export type SwarmLogoVariant = 'lockup' | 'badge'

interface LogoAsset {
  /** Served from `public/logos/`; see the README there for provenance. */
  readonly onLight: string
  readonly onDark: string
  /** Intrinsic size, so the browser reserves the space before the file loads. */
  readonly width: number
  readonly height: number
}

const ASSETS: Record<SwarmLogoVariant, LogoAsset> = {
  lockup: {
    onLight: '/logos/swarm-lockup-primary-on-light.svg',
    onDark: '/logos/swarm-lockup-primary-on-dark.svg',
    width: 373,
    height: 96,
  },
  badge: {
    onLight: '/logos/swarm-badge-violet.svg',
    onDark: '/logos/swarm-badge-white.svg',
    width: 96,
    height: 96,
  },
}

export interface SwarmLogoProps extends Omit<ComponentProps<'span'>, 'children'> {
  variant?: SwarmLogoVariant
}

export function SwarmLogo({ variant = 'lockup', className, ...props }: SwarmLogoProps) {
  const asset = ASSETS[variant]
  return (
    <span
      role="img"
      aria-label="Swarm"
      className={cn('inline-flex h-6 shrink-0 items-center', className)}
      {...props}
    >
      <img
        src={asset.onLight}
        alt=""
        width={asset.width}
        height={asset.height}
        draggable={false}
        className="h-full w-auto dark:hidden"
      />
      <img
        src={asset.onDark}
        alt=""
        width={asset.width}
        height={asset.height}
        draggable={false}
        className="hidden h-full w-auto dark:block"
      />
    </span>
  )
}
