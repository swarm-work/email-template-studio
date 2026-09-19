/**
 * A postage-stamp copy of the preview, in the code rail.
 *
 * Presentation layer. It shows the SAME document string the preview workspace
 * shows (built once in `StudioPage`, ADR-25), so glancing at it costs no render
 * and `Render time` never changes because you looked.
 *
 * It is decoration for the mouse and the eye only: `aria-hidden`, untabbable
 * and click-through, with a real button over it for everyone else. Must not
 * render anything a keyboard user could reach but not use.
 */
import { useRef } from 'react'
import { Maximize2 } from 'lucide-react'
import { AnimatedBadge } from '@/components/motion/animated-badge'
import { Button } from '@/components/ui/button'
import type { RenderStatus } from '@/domain'
import { useScaledFrame } from '@/presentation/hooks/useScaledFrame'
import { NOTHING_RENDERED_REASON, previewStatusPresentation } from '../preview/previewStatus'

/** The width the email is rendered at before it is scaled down: the desktop preview's own. */
const FRAME_WIDTH = 680

export interface PreviewThumbnailProps {
  /** The full preview document (HTML + CSP meta); null before the first render. */
  document: string | null
  status: RenderStatus
  /** True when the newest render failed but an older, good one is on screen. */
  stale: boolean
  /** Switches the studio to preview mode: the accessible route to the same picture. */
  onOpenPreview: () => void
}

export function PreviewThumbnail({ document, status, stale, onOpenPreview }: PreviewThumbnailProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const scale = useScaledFrame(boxRef, FRAME_WIDTH)
  const { badge, label } = previewStatusPresentation(status, stale)

  return (
    <section
      aria-labelledby="preview-thumbnail-heading"
      className="bg-card overflow-hidden rounded-lg border"
    >
      <div className="flex min-w-0 items-center gap-2 border-b px-3 py-2">
        <h2 id="preview-thumbnail-heading" className="shrink-0 text-xs font-medium">
          Live preview
        </h2>
        <span className="ml-auto shrink-0">
          <AnimatedBadge size="sm" status={badge} contentKey={label}>
            {label}
          </AnimatedBadge>
        </span>
      </div>

      {/* Fixed height + `overflow-hidden`: a scaled element still takes up its
          UNSCALED space in the flow, so the inner wrapper is taken out of the
          flow with `absolute` and this box decides how tall the card is. */}
      <div ref={boxRef} className="dot-grid relative h-[280px] overflow-hidden">
        {document === null ? (
          <p className="text-muted-foreground absolute inset-0 flex items-center justify-center text-xs">
            {NOTHING_RENDERED_REASON}
          </p>
        ) : (
          <div
            className="absolute top-0 left-0 origin-top-left"
            style={{ width: FRAME_WIDTH, transform: `scale(${scale})` }}
          >
            <iframe
              // Hidden from assistive technology and from the pointer: the
              // button below is the one way in, so nobody can land inside a
              // preview they cannot scroll or read here.
              aria-hidden="true"
              tabIndex={-1}
              title=""
              sandbox=""
              srcDoc={document}
              className="pointer-events-none h-[900px] w-full border-0 bg-white"
            />
          </div>
        )}

        <div className="absolute inset-x-0 bottom-0 flex justify-center p-2">
          <Button variant="outline" size="xs" onClick={onOpenPreview}>
            <Maximize2 aria-hidden="true" />
            Open full preview
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground border-t px-3 py-1.5 text-[11px]">
        Scaled to {Math.round(scale * 100)}% of {FRAME_WIDTH} px. ⌘P opens the full preview.
      </p>
    </section>
  )
}
