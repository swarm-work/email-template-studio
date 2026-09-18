/**
 * Code mode: the editors, the strips around them and the right rail.
 *
 * Presentation layer, composition plus the few pieces of state that belong to
 * the chrome itself (which reset is being confirmed). Everything about the
 * template lives in the draft; nothing is copied into local state here.
 */
import { useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
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
import { Braces, Copy, RotateCcw } from 'lucide-react'
import type { DiagnosticItem, EmailTemplate, RenderResult, RenderStatus, ValidationResult } from '@/domain'
import { fileNameFor } from '@/domain'
import { CodeStatusStrip } from './CodeStatusStrip'
import { CompileInfoStrip } from './CompileInfoStrip'
import { EditorPanel } from './EditorPanel'
import type { EditorTabId } from './editorTabs'
import { PrimitivesRow } from './PrimitivesRow'
import { PropsPayloadCard } from './PropsPayloadCard'
import { NOTHING_TO_RESET_REASON, READ_ONLY_FORMAT_REASON, READ_ONLY_RESET_REASON } from './reasons'
import { RenderErrorBanner } from './RenderErrorBanner'
import { RenderReportCard } from './RenderReportCard'
import { ShortcutsCard } from './ShortcutsCard'
import { DiagnosticsPanel } from '../DiagnosticsPanel'
import type { CodeEditorHandle } from '@/presentation/shared/CodeEditor'
import { ReasonedButton } from '@/presentation/shared/ReasonedButton'

export interface CodeWorkspaceProps {
  template: EmailTemplate
  source: string
  onSourceChange: (source: string) => void
  sourceDirty: boolean
  onResetSource: () => void
  payloadText: string
  onPayloadChange: (text: string) => void
  validation: ValidationResult
  payloadDirty: boolean
  onResetPayload: () => void
  /** HTML of the last successful render; null before the first one. */
  html: string | null
  /** Plain-text part of that same render; null before the first one. */
  text: string | null
  renderStatus: RenderStatus
  renderResult: RenderResult | null
  /** Durations of the last twelve successful renders, oldest first. */
  renderHistory: readonly number[]
  activeTab: EditorTabId
  onActiveTabChange: (tab: EditorTabId) => void
  /** Formats one tab's text; the same function ⌘⇧F calls. */
  onFormat: (tab: EditorTabId) => void
  diagnostics: readonly DiagnosticItem[]
  /** The live preview card for the right rail; null while preview mode has it. */
  previewThumbnail?: ReactNode
  /** False while preview mode is showing: the editors are hidden, not unmounted. */
  active?: boolean
}

export function CodeWorkspace({
  template,
  source,
  onSourceChange,
  sourceDirty,
  onResetSource,
  payloadText,
  onPayloadChange,
  validation,
  payloadDirty,
  onResetPayload,
  html,
  text: renderedText,
  renderStatus,
  renderResult,
  renderHistory,
  activeTab,
  onActiveTabChange,
  onFormat,
  diagnostics,
  previewThumbnail,
  active = true,
}: CodeWorkspaceProps) {
  const tsxEditorRef = useRef<CodeEditorHandle>(null)
  const [confirmReset, setConfirmReset] = useState<'tsx' | 'props' | null>(null)

  const fileName = fileNameFor(template.kind, template.metadata.slug)
  // The plain-text part of the last GOOD render, so the tab keeps showing
  // something real while a newer edit fails to compile — exactly like the HTML.
  const text = renderedText ?? ''
  const durationMs = renderResult?.ok ? renderResult.durationMs : null
  const content = contentFor(activeTab, { source, payloadText, html, text })
  const readOnlyTab = activeTab === 'html' || activeTab === 'text'
  const tabDirty = activeTab === 'tsx' ? sourceDirty : activeTab === 'props' ? payloadDirty : false

  async function copyActiveTab() {
    try {
      await navigator.clipboard.writeText(content)
      toast.success('Copied to the clipboard.')
    } catch {
      // Clipboard access can be refused (permissions, an insecure origin);
      // saying so is better than a button that silently does nothing.
      toast.error('The browser would not let the studio copy this.')
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <CompileInfoStrip propsValid={validation.ok} />

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="bg-card overflow-hidden rounded-lg border">
            <PrimitivesRow
              enabled={activeTab === 'tsx'}
              onInsert={(snippet) => tsxEditorRef.current?.insertAtCursor(snippet)}
            />
          </div>

          <EditorPanel
            baseId="studio-code-editor"
            fileName={fileName}
            source={source}
            onSourceChange={onSourceChange}
            payloadText={payloadText}
            onPayloadChange={onPayloadChange}
            html={html}
            text={text}
            activeTab={activeTab}
            onTabChange={onActiveTabChange}
            tsxEditorRef={tsxEditorRef}
            visible={active}
            actions={
              <>
                <ReasonedButton
                  variant="ghost"
                  size="xs"
                  reason={readOnlyTab ? READ_ONLY_FORMAT_REASON : undefined}
                  onClick={() => onFormat(activeTab)}
                >
                  <Braces aria-hidden="true" />
                  Format
                </ReasonedButton>
                <ReasonedButton variant="ghost" size="xs" onClick={() => void copyActiveTab()}>
                  <Copy aria-hidden="true" />
                  Copy
                </ReasonedButton>
                <ReasonedButton
                  variant="ghost"
                  size="xs"
                  reason={
                    readOnlyTab ? READ_ONLY_RESET_REASON : tabDirty ? undefined : NOTHING_TO_RESET_REASON
                  }
                  onClick={() => setConfirmReset(activeTab === 'props' ? 'props' : 'tsx')}
                >
                  <RotateCcw aria-hidden="true" />
                  Reset
                </ReasonedButton>
              </>
            }
            footer={
              <>
                <CodeStatusStrip content={content} status={renderStatus} durationMs={durationMs} />
                <RenderErrorBanner status={renderStatus} result={renderResult} />
              </>
            }
          />
        </div>

        <aside className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-1">
          <PropsPayloadCard
            validation={validation}
            payloadDirty={payloadDirty}
            onFormat={() => onFormat('props')}
            onReset={() => setConfirmReset('props')}
          />
          {previewThumbnail}
          <RenderReportCard
            html={html}
            text={text}
            propsCount={validation.ok ? Object.keys(validation.value).length : null}
            durationMs={durationMs}
            history={renderHistory}
          />
          <DiagnosticsPanel items={diagnostics} />
          <ShortcutsCard />
        </aside>
      </div>

      <AlertDialog open={confirmReset === 'tsx'} onOpenChange={(open) => !open && setConfirmReset(null)}>
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
                onResetSource()
                setConfirmReset(null)
              }}
            >
              Reset source
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmReset === 'props'} onOpenChange={(open) => !open && setConfirmReset(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset the preview payload?</AlertDialogTitle>
            <AlertDialogDescription>
              This restores the template's sample data and discards your edits.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onResetPayload()
                setConfirmReset(null)
              }}
            >
              Reset payload
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** The text behind one tab, used by Copy and by the status strip's counts. */
function contentFor(
  tab: EditorTabId,
  parts: { source: string; payloadText: string; html: string | null; text: string },
): string {
  switch (tab) {
    case 'tsx':
      return parts.source
    case 'props':
      return parts.payloadText
    case 'html':
      return parts.html ?? ''
    case 'text':
      return parts.text
  }
}
