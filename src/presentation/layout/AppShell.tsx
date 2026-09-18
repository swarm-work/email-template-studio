/**
 * The frame every screen sits in: skip link, header, main, footer.
 *
 * Presentation layer: layout only, no rules. It is rendered once, by `App.tsx`,
 * so the header keeps its state (and its DOM node) while the screen inside
 * changes — a header that remounts on every navigation loses focus and flickers.
 *
 * `density` picks between the two page shapes the studio needs:
 * - 'page': the document scrolls, the way a normal web page does.
 * - 'app': the shell is exactly one viewport tall from `lg` up and every
 *   scrollbar is internal, which is what a full-height editor needs.
 */
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type ShellDensity = 'page' | 'app'

export interface AppShellProps {
  density?: ShellDensity
  header: ReactNode
  footer: ReactNode
  children: ReactNode
}

export function AppShell({ density = 'page', header, footer, children }: AppShellProps) {
  return (
    <div
      className={cn('flex min-h-dvh flex-col', density === 'app' && 'lg:h-dvh lg:min-h-0 lg:overflow-hidden')}
    >
      {/* Visible only once focused: the first Tab on the page jumps past the
          header straight into the editor. */}
      <a
        href="#main"
        className="bg-card focus-visible:ring-ring/50 sr-only rounded-md border px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus-visible:ring-3"
      >
        Skip to editor
      </a>
      {header}
      <main id="main" className="flex min-h-0 flex-1 flex-col">
        {children}
      </main>
      {footer}
    </div>
  )
}
