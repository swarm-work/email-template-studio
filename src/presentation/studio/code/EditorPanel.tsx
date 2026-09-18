/**
 * The code editor region: four views of one template, one of them showing.
 *
 * Presentation layer. All four CodeMirror editors stay mounted and the inactive
 * ones are `hidden` + `inert`, so switching tabs never destroys an editor —
 * which is what would throw away its undo history. The cost is that a hidden
 * editor measures itself as zero pixels wide, so `refreshKey` asks the visible
 * one to measure again whenever the tab changes.
 */
import type { ReactNode, Ref } from 'react'
import { CodeEditor, type CodeEditorHandle } from '@/presentation/shared/CodeEditor'
import { EditorTabBar } from './EditorTabBar'
import { panelId, tabId, type EditorTabId } from './editorTabs'

export interface EditorPanelProps {
  /** The template's real file name, e.g. "welcome-verification.email.tsx". */
  fileName: string
  source: string
  onSourceChange: (source: string) => void
  payloadText: string
  onPayloadChange: (text: string) => void
  /** HTML of the last successful render; null before the first one. */
  html: string | null
  /** Plain-text part of the last successful render; '' until the worker renders it. */
  text: string
  activeTab: EditorTabId
  onTabChange: (tab: EditorTabId) => void
  /** Format / Copy / Reset, drawn at the right of the tab strip. */
  actions: ReactNode
  /** Status strip and render-error banner, drawn under the editors. */
  footer?: ReactNode
  /** Lets the primitives row insert into the TSX editor. */
  tsxEditorRef?: Ref<CodeEditorHandle>
  baseId: string
}

export function EditorPanel({
  fileName,
  source,
  onSourceChange,
  payloadText,
  onPayloadChange,
  html,
  text,
  activeTab,
  onTabChange,
  actions,
  footer,
  tsxEditorRef,
  baseId,
}: EditorPanelProps) {
  return (
    <section
      aria-labelledby={`${baseId}-heading`}
      className="bg-card flex min-w-0 flex-col overflow-hidden rounded-lg border"
    >
      <h2 id={`${baseId}-heading`} className="sr-only">
        Code editor
      </h2>
      <EditorTabBar value={activeTab} onChange={onTabChange} baseId={baseId} actions={actions} />

      <TabPanel baseId={baseId} tab="tsx" activeTab={activeTab}>
        <CodeEditor
          ref={tsxEditorRef}
          value={source}
          onChange={onSourceChange}
          language="tsx"
          label={`Template source for ${fileName}`}
          className="h-[420px]"
          refreshKey={activeTab}
        />
      </TabPanel>
      <TabPanel baseId={baseId} tab="props" activeTab={activeTab}>
        <CodeEditor
          value={payloadText}
          onChange={onPayloadChange}
          language="json"
          label="Preview payload JSON"
          className="h-[420px]"
          refreshKey={activeTab}
        />
      </TabPanel>
      <TabPanel baseId={baseId} tab="html" activeTab={activeTab}>
        <CodeEditor
          value={html ?? ''}
          language="html"
          label="Compiled HTML (read only)"
          readOnly
          className="h-[420px]"
          refreshKey={activeTab}
        />
      </TabPanel>
      <TabPanel baseId={baseId} tab="text" activeTab={activeTab}>
        <CodeEditor
          value={text}
          language="text"
          label="Plain text (read only)"
          readOnly
          className="h-[420px]"
          refreshKey={activeTab}
        />
      </TabPanel>

      {footer}
    </section>
  )
}

function TabPanel({
  baseId,
  tab,
  activeTab,
  children,
}: {
  baseId: string
  tab: EditorTabId
  activeTab: EditorTabId
  children: ReactNode
}) {
  const active = tab === activeTab
  return (
    <div
      id={panelId(baseId, tab)}
      role="tabpanel"
      aria-labelledby={tabId(baseId, tab)}
      hidden={!active}
      // `inert` takes the hidden editor out of the tab order and out of the
      // accessibility tree; `hidden` alone would leave CodeMirror focusable.
      inert={!active}
      className="flex min-h-0 flex-col"
    >
      {children}
    </div>
  )
}
