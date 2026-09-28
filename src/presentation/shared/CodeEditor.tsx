/**
 * Thin wrapper around CodeMirror 6 (via @uiw/react-codemirror).
 *
 * Why CodeMirror over Monaco: ~10x smaller, no worker plumbing in Vite,
 * good keyboard accessibility (Escape then Tab leaves the editor), and TSX +
 * JSON support out of the box. See docs/DECISIONS.md.
 *
 * Presentation layer: no rules about what the text means.
 */
import { useEffect, useMemo, useRef } from 'react'
import CodeMirror, { EditorView, type Extension } from '@uiw/react-codemirror'
import { javascript } from '@codemirror/lang-javascript'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { html } from '@codemirror/lang-html'
import { linter, lintGutter } from '@codemirror/lint'
import { oneDark } from '@codemirror/theme-one-dark'
import { cn } from '@/lib/utils'

export type EditorLanguage = 'tsx' | 'json' | 'html' | 'text'

const languageExtensions: Record<EditorLanguage, () => Extension[]> = {
  tsx: () => [javascript({ jsx: true, typescript: true })],
  // jsonParseLinter underlines the exact character where JSON.parse fails.
  json: () => [json(), linter(jsonParseLinter()), lintGutter()],
  html: () => [html()],
  // Plain text has no grammar; CodeMirror's defaults are all it needs.
  text: () => [],
}

export interface CodeEditorProps {
  value: string
  onChange?: (value: string) => void
  language: EditorLanguage
  /** Accessible name announced by screen readers. */
  label: string
  readOnly?: boolean
  className?: string
  /**
   * Bump this when the editor becomes visible again after being hidden.
   * CodeMirror measures itself on creation; inside a `hidden` panel every
   * measurement is zero, which is what leaves the line-number gutter collapsed
   * until something forces a re-measure.
   */
  refreshKey?: string | number
  /** Called once with the CodeMirror view, for callers that need it. */
  onCreateEditor?: (view: EditorView) => void
}

export function CodeEditor({
  value,
  onChange,
  language,
  label,
  readOnly = false,
  className,
  refreshKey,
  onCreateEditor,
}: CodeEditorProps) {
  const viewRef = useRef<EditorView | null>(null)

  const extensions = useMemo<Extension[]>(
    () => [
      ...languageExtensions[language](),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': label }),
    ],
    [language, label],
  )

  useEffect(() => {
    // A no-op on first mount; what matters is the run after a tab switch.
    viewRef.current?.requestMeasure()
  }, [refreshKey])

  return (
    <div className={cn('studio-editor bg-editor h-full min-h-0', className)}>
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={oneDark}
        readOnly={readOnly}
        editable={!readOnly}
        height="100%"
        indentWithTab
        onCreateEditor={(view) => {
          viewRef.current = view
          onCreateEditor?.(view)
        }}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: !readOnly,
          highlightActiveLineGutter: !readOnly,
          autocompletion: false,
          tabSize: 2,
        }}
      />
    </div>
  )
}
