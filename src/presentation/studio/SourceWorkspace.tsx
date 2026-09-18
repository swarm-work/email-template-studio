import { useState } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  fileNameFor,
  type EmailTemplate,
  type RenderErrorKind,
  type RenderResult,
  type RenderStatus,
} from '@/domain'
import { CodeEditor } from '@/presentation/shared/CodeEditor'
import { StatusBadge } from '@/presentation/shared/StatusBadge'

export interface SourceWorkspaceProps {
  template: EmailTemplate
  source: string
  onSourceChange: (source: string) => void
  sourceDirty: boolean
  onReset: () => void
  renderStatus: RenderStatus
  renderResult: RenderResult | null
  /** HTML of the last successful render, shown in the HTML tab. */
  html: string | null
}

export function SourceWorkspace({
  template,
  source,
  onSourceChange,
  sourceDirty,
  onReset,
  renderStatus,
  renderResult,
  html,
}: SourceWorkspaceProps) {
  const [confirmReset, setConfirmReset] = useState(false)
  const fileName = fileNameFor(template.kind, template.metadata.slug)
  const error = renderResult && !renderResult.ok ? renderResult.error : null

  return (
    <section
      aria-labelledby="source-heading"
      className="bg-card flex flex-col overflow-hidden rounded-lg border"
    >
      <Tabs defaultValue="tsx" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <h2 id="source-heading" className="truncate font-mono text-xs font-medium">
              {fileName}
            </h2>
            <StatusBadge tone="neutral" dot={false}>
              React Email · TSX
            </StatusBadge>
            {sourceDirty ? (
              <StatusBadge tone="warning">Modified</StatusBadge>
            ) : (
              <StatusBadge tone="neutral">Original</StatusBadge>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <TabsList variant="line" className="h-7">
              <TabsTrigger value="tsx" className="text-xs">
                TSX
              </TabsTrigger>
              <TabsTrigger value="html" className="text-xs" disabled={html === null}>
                Rendered HTML
              </TabsTrigger>
            </TabsList>
            <Button variant="ghost" size="sm" disabled={!sourceDirty} onClick={() => setConfirmReset(true)}>
              <RotateCcw aria-hidden="true" />
              Reset
            </Button>
          </div>
        </div>

        <TabsContent value="tsx" className="flex min-h-0 flex-1 flex-col">
          <CodeEditor
            value={source}
            onChange={onSourceChange}
            language="tsx"
            label={`Template source for ${fileName}`}
            className="h-[520px]"
          />
        </TabsContent>
        <TabsContent value="html" className="flex min-h-0 flex-1 flex-col">
          <CodeEditor
            value={html ?? ''}
            language="html"
            label="Rendered HTML (read only)"
            readOnly
            className="h-[520px]"
          />
        </TabsContent>

        <div className="bg-editor-chrome text-editor-muted border-editor-border flex items-center gap-3 border-t px-3 py-1.5 font-mono text-[11px]">
          <span>{source.split('\n').length} lines</span>
          <span aria-hidden="true">·</span>
          <span>Imports limited to react and @react-email/components</span>
          <span className="ml-auto hidden sm:inline">Esc then Tab leaves the editor</span>
        </div>
      </Tabs>

      {error ? (
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
      ) : renderStatus === 'success' ? (
        <p className="text-muted-foreground border-t px-3 py-1.5 text-xs">
          Compiled and rendered without errors.
        </p>
      ) : null}

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard local changes to {fileName}?</AlertDialogTitle>
            <AlertDialogDescription>
              This restores the original source. Your edits exist only in this browser session and cannot be
              recovered afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onReset()
                setConfirmReset(false)
              }}
            >
              Reset source
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

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
