/**
 * One vocabulary for "what is the preview doing right now".
 *
 * Presentation layer: a mapping from the domain's `RenderStatus` to the words
 * and the badge tone shown for it. It lives on its own because two places say
 * it — the preview workspace's badge and the code rail's thumbnail — and two
 * copies of a label drift apart. The one sentence for "there is no render yet"
 * lives here for the same reason: three copies of it would drift apart too.
 */
import type { AnimatedBadgeStatus } from '@/components/motion/animated-badge'
import type { RenderStatus } from '@/domain'

/**
 * Said wherever a render is missing: the two downloads' disabled reason, the
 * thumbnail's empty card and the plain-text panel before the first render.
 */
export const NOTHING_RENDERED_REASON = 'Nothing rendered yet.'

export interface PreviewStatusPresentation {
  readonly badge: AnimatedBadgeStatus
  readonly label: string
}

/**
 * `stale` means the newest render failed while an older, good one is still on
 * screen — a state of its own, because "Render failed" over a picture that
 * looks fine would be a lie about what you are looking at.
 */
export function previewStatusPresentation(status: RenderStatus, stale: boolean): PreviewStatusPresentation {
  if (stale) return { badge: 'warning', label: 'Showing last good render' }
  switch (status) {
    case 'idle':
      return { badge: 'neutral', label: 'Idle' }
    case 'blocked':
      return { badge: 'warning', label: 'Paused' }
    case 'rendering':
      return { badge: 'loading', label: 'Rendering…' }
    case 'success':
      return { badge: 'success', label: 'Up to date' }
    case 'error':
      return { badge: 'danger', label: 'Render failed' }
  }
}
