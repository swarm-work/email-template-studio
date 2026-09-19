/**
 * What fills the workspace while the editor chunk is downloading.
 *
 * Presentation layer. It is the shape of the finished screen — a sheet on the
 * dotted stage with a rail beside it — so the layout does not jump when the
 * real editor arrives. The editor chunk is fetched only for visual templates
 * (ADR-18; its measured size is written down once, in docs/TECH_DEBT.md #33),
 * so this is on screen for a moment on a slow connection and never again
 * afterwards.
 */
import { Skeleton } from '@/components/ui/skeleton'

export function VisualEditorSkeleton() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1" data-testid="visual-editor-skeleton">
      <div className="dot-grid relative min-h-0 min-w-0 flex-1 overflow-hidden">
        <div className="mx-auto w-full max-w-[648px] px-6 py-10">
          <div className="bg-card space-y-3 rounded-xl border p-6">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-10 w-4/5" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-9 w-48" />
          </div>
        </div>
      </div>
      <div className="bg-card hidden w-[360px] shrink-0 flex-col gap-3 border-l px-4 py-3 xl:flex">
        <Skeleton className="h-8 w-full" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      {/* One sentence for anyone who cannot see the grey blocks. */}
      <p role="status" className="sr-only">
        Loading the visual editor.
      </p>
    </div>
  )
}
