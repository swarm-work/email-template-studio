/**
 * "View exported code": what a visual template turns into, read-only.
 *
 * Presentation layer. A visual template has no code MODE — its tabs would all
 * be exports, and a workspace you cannot type in is not a workspace (ADR-24
 * keeps the mounted-and-hidden rule for the two real ones). So the same three
 * views live in a dialog, reached from the overflow menu.
 *
 * Every tab is read-only and says so, and the banner explains where the text
 * comes from, so nobody edits HTML here expecting it to be kept.
 */
import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { EmailDocument } from '@/domain'
import { CodeEditor } from '@/presentation/shared/CodeEditor'
import { EditorTabBar } from '../code/EditorTabBar'
import { VISUAL_EXPORT_TABS, panelId, tabId, type VisualExportTabId } from '../code/editorTabs'

/** Why these three views cannot be typed into (docs/DESIGN.md §4.4). */
export const VISUAL_READ_ONLY_BANNER =
  'This template is edited visually. Switch to Visual to change it, or convert it to a code template.'

const BASE_ID = 'studio-exported-code'

export interface ExportedCodeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** HTML of the last successful export; null before the first one. */
  html: string | null
  /** Plain-text part of that same export. */
  text: string | null
  /** The canvas document, shown as the JSON it is stored as. */
  document: EmailDocument | null
}

export function ExportedCodeDialog({ open, onOpenChange, html, text, document }: ExportedCodeDialogProps) {
  const [tab, setTab] = useState<VisualExportTabId>('html')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Exported code</DialogTitle>
          <DialogDescription>{VISUAL_READ_ONLY_BANNER}</DialogDescription>
        </DialogHeader>

        <div className="bg-card min-w-0 overflow-hidden rounded-lg border">
          <EditorTabBar
            value={tab}
            onChange={setTab}
            baseId={BASE_ID}
            tabs={VISUAL_EXPORT_TABS}
            label="Exported views"
            actions={null}
          />
          {/* Only the chosen view is mounted here: unlike code mode there is no
              undo history to protect, and three CodeMirror instances inside a
              dialog would be three measurements nobody asked for. */}
          <div
            id={panelId(BASE_ID, tab)}
            role="tabpanel"
            aria-labelledby={tabId(BASE_ID, tab)}
            className="flex min-h-0 flex-col"
          >
            {tab === 'html' ? (
              <CodeEditor
                value={html ?? ''}
                language="html"
                label="Exported HTML (read only)"
                readOnly
                className="h-[420px]"
              />
            ) : null}
            {tab === 'text' ? (
              <CodeEditor
                value={text ?? ''}
                language="text"
                label="Plain text (read only)"
                readOnly
                className="h-[420px]"
              />
            ) : null}
            {tab === 'document' ? (
              <CodeEditor
                value={document === null ? '' : `${JSON.stringify(document, null, 2)}\n`}
                language="json"
                label="Canvas document JSON (read only)"
                readOnly
                className="h-[420px]"
              />
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
