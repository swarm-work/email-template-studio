/**
 * What the preview pipeline has to say about the current source: the failure,
 * or one line confirming it compiled.
 *
 * Presentation layer. The markup and every string here are carried over from
 * the old SourceWorkspace unchanged — the end-to-end tests assert on them, and
 * more importantly people have learnt what they mean.
 */
import { AlertTriangle } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { RenderErrorKind, RenderResult, RenderStatus } from '@/domain'

export interface RenderErrorBannerProps {
  status: RenderStatus
  /** The last finished render, success or failure. */
  result: RenderResult | null
}

export function RenderErrorBanner({ status, result }: RenderErrorBannerProps) {
  const error = result && !result.ok ? result.error : null

  if (error) {
    return (
      <div
        role="alert"
        className="border-danger/30 bg-danger-muted text-danger-foreground flex flex-col gap-1 border-t px-3 py-2 text-xs"
      >
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {stageLabel(error.kind)}
              {error.line ? (
                <span className="font-mono font-normal">
                  {' '}
                  · line {error.line}
                  {error.column ? `:${error.column}` : ''}
                </span>
              ) : null}
            </p>
            <p className="break-words">{error.message}</p>
            {error.detail ? (
              <Collapsible>
                <CollapsibleTrigger className="mt-1 underline underline-offset-2">
                  Show details
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-white/60 p-2 font-mono text-[11px] whitespace-pre-wrap">
                    {error.detail}
                  </pre>
                </CollapsibleContent>
              </Collapsible>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <p className="text-muted-foreground border-t px-3 py-1.5 text-xs">
        Compiled and rendered without errors.
      </p>
    )
  }

  return null
}

/**
 * Which stage of the pipeline the failure came from, in words. Kept verbatim
 * from the deleted `SourceWorkspace` (the e2e suite asserts these strings) and
 * module-private: only the banner above renders it.
 */
function stageLabel(kind: RenderErrorKind): string {
  switch (kind) {
    case 'forbidden-import':
      return 'Import not allowed'
    case 'compile':
      return 'Compile error'
    case 'evaluate':
      return 'Module error'
    case 'render':
      return 'Render error'
    case 'timeout':
      return 'Render stopped'
    case 'worker':
      return 'Preview worker'
    case 'compose':
      return 'Export error'
    case 'editor-load':
      return 'Editor not loaded'
  }
}
