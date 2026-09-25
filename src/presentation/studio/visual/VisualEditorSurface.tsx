/**
 * The one module that touches `@react-email/editor`.
 *
 * Presentation layer. Everything the package exports — the editor, its UI and
 * its stylesheet — is imported HERE and nowhere else, so the whole 2.5 MB of it
 * stays in the chunk `VisualWorkspace` loads with `React.lazy` and a code
 * template never fetches a byte of it (ADR-18, plan §3.10).
 *
 * It owns no template data: the document comes in as a prop and every change
 * goes straight back out through `onDocumentChange`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { JSONContent } from '@tiptap/core'
import { toast } from 'sonner'
import { EmailEditor, type EmailEditorRef } from '@react-email/editor'
import { Inspector } from '@react-email/editor/ui'
import '@react-email/editor/themes/default.css'
import type { EmailDocument } from '@/domain'
import { uploadImage } from '@/infrastructure/providers/uploadImage'
import { studioEditorExtensions } from '@/infrastructure/render/editorExtensions'
import { STUDIO_FONT_STACK, studioTheme } from '@/infrastructure/render/studioTheme'
import type { VisualEditorHandle } from '@/infrastructure/render/visualEmailRenderer'
import { CANVAS_PLACEHOLDER } from './canvas'
import { createDocumentUpdateGuard } from './documentUpdateGuard'
import type { VisualEditorControls } from './editorControls'
import { EmailCanvas } from './EmailCanvas'
import { MergeFieldsPanel, type MergeFieldsData } from './MergeFieldsPanel'
import { NO_SELECTION_REASON, StudioInspector } from './StudioInspector'

/** The email sheet itself: the editor's own container, styled as paper. */
const SHEET_CLASS = 'studio-sheet relative rounded-xl border bg-white'

export interface VisualEditorSurfaceProps {
  /** Remounts the editor for a different template; it is uncontrolled inside. */
  templateId: string
  /** The starting document. Passed ONCE per template and never fed back in. */
  document: EmailDocument
  /** Name of the theme this version was authored with (see studioTheme.ts). */
  theme: string
  /** Part of the export, so the preview hook recomposes when it changes. */
  onDocumentChange: (document: EmailDocument) => void
  /** The editor is live: the preview hook can compose from it now. */
  onEditorReady: (handle: VisualEditorHandle) => void
  onEditorDestroy: () => void
  /** Undo/redo and selection state for the chrome outside this chunk. */
  onControlsChange: (controls: VisualEditorControls | null) => void
  /** Whether the off-canvas rail is showing (below xl); ignored at xl and up. */
  inspectorOpen: boolean
  onCloseInspector: () => void
  /** The props payload card shown under the merge fields on the Data tab. */
  dataPanel: ReactNode
  /** Discovered keys and the sample payload, for the Data tab's panel. */
  mergeFields: MergeFieldsData
}

export function VisualEditorSurface({
  templateId,
  document: initialDocument,
  theme,
  onDocumentChange,
  onEditorReady,
  onEditorDestroy,
  onControlsChange,
  inspectorOpen,
  onCloseInspector,
  dataPanel,
  mergeFields,
}: VisualEditorSurfaceProps) {
  // The rail is rendered beside the canvas, but the package renders our
  // children as siblings of the editor container - inside the canvas scroller.
  // So the rail goes through a portal into this slot, which `display: contents`
  // keeps out of the layout entirely.
  const [railSlot, setRailSlot] = useState<HTMLDivElement | null>(null)
  const [handle, setHandle] = useState<EmailEditorRef | null>(null)
  const [hasNodeSelection, setHasNodeSelection] = useState(false)

  // One guard per editor instance; a ref because it is machinery, not something
  // the screen is drawn from. `ready` is the signal it works from: the package
  // normalises the document while the editor is being built, which is strictly
  // before it reports itself ready.
  const guard = useRef(createDocumentUpdateGuard())
  const ready = useRef(false)
  useEffect(() => {
    guard.current = createDocumentUpdateGuard()
    ready.current = false
  }, [templateId])

  const handleReady = useCallback(
    (ref: EmailEditorRef) => {
      ready.current = true
      setHandle(ref)
      onEditorReady(ref)
    },
    [onEditorReady],
  )

  useEffect(() => {
    return () => onEditorDestroy()
  }, [onEditorDestroy])

  const handleUpdate = useCallback(
    (ref: EmailEditorRef) => {
      if (!guard.current.accepts(ready.current)) return
      onDocumentChange(ref.getJSON() as EmailDocument)
    },
    [onDocumentChange],
  )

  // Undo/redo live on the editor, but the buttons are in the sub-header, which
  // is not in this chunk. The editor's transaction event is the one signal that
  // fires for every change, undo included, so the state is read from there.
  const editor = handle?.editor ?? null
  useEffect(() => {
    if (!editor) {
      onControlsChange(null)
      return
    }
    // What was last handed up, so an event that changes nothing hands up
    // nothing. Without this every editor event produced a NEW controls object,
    // the studio re-rendered for it, and a re-render during a layout change
    // (the envelope panel opening or closing above the canvas) made the editor
    // emit again - React stopped the loop with "Maximum update depth exceeded".
    let published: string | null = null
    const publish = () => {
      // Focus is part of the question, not a detail: the package's own
      // breadcrumb reports `Body` for an unfocused editor, and a fresh document
      // already has a cursor in its first block. Without this the two icon
      // buttons would be live from the first frame and would delete a block the
      // rail is not showing.
      const nodeSelected = editor.isFocused && selectedBlock(editor) !== null
      const can = editorExtras(editor.can())
      const canUndo = can.undo()
      const canRedo = can.redo()
      const key = `${canUndo}|${canRedo}|${nodeSelected}`
      if (key === published) return
      published = key
      setHasNodeSelection(nodeSelected)
      onControlsChange({
        canUndo,
        canRedo,
        // Resolved when pressed, not now, so the command runs on the editor's
        // state at that moment rather than on the state this snapshot saw.
        undo: () => void editorExtras(editor.commands).undo(),
        redo: () => void editorExtras(editor.commands).redo(),
        hasNodeSelection: nodeSelected,
      })
    }
    publish()
    editor.on('transaction', publish)
    editor.on('selectionUpdate', publish)
    // Focus changes the answer above, and it does not always come with a
    // transaction, so the two focus events are listened for in their own right.
    editor.on('focus', publish)
    editor.on('blur', publish)
    return () => {
      editor.off('transaction', publish)
      editor.off('selectionUpdate', publish)
      editor.off('focus', publish)
      editor.off('blur', publish)
    }
  }, [editor, onControlsChange])

  // The package's defaults plus the merge-field node. Memoised on the theme
  // because a new array on every render would rebuild the whole editor.
  const themeConfig = studioTheme(theme)
  const extensions = useMemo(
    () => studioEditorExtensions({ theme: themeConfig, placeholder: CANVAS_PLACEHOLDER }),
    [themeConfig],
  )

  /**
   * Puts a chip where the caret is. An editor nobody has clicked into has its
   * selection at the very start, which is almost never where somebody pressing
   * "Insert {{firstName}}" in the rail means; so an unfocused canvas is focused
   * at its END first, which is where they were last typing.
   */
  const insertMergeField = useCallback(
    (key: string) => {
      if (!editor) return
      editor
        .chain()
        .focus(editor.isFocused ? undefined : 'end')
        .insertMergeField(key)
        .run()
    },
    [editor],
  )

  const handleUploadImage = useCallback(async (file: File) => {
    try {
      return await uploadImage(file)
    } catch (error) {
      toast.error(`Couldn't upload ${file.name}.`)
      // Rethrown on purpose: the package removes its temporary image node only
      // when this promise rejects. Swallowing it would leave a placeholder in
      // the document that never becomes a picture.
      throw error
    }
  }, [])

  return (
    <>
      <EmailCanvas>
        <EmailEditor
          // A new template is a new document, and the editor is UNCONTROLLED:
          // the only way to give it different content is to build a new one.
          key={templateId}
          className={SHEET_CLASS}
          content={initialDocument as JSONContent}
          theme={themeConfig}
          placeholder={CANVAS_PLACEHOLDER}
          extensions={extensions}
          onReady={handleReady}
          onUpdate={handleUpdate}
          onUploadImage={handleUploadImage}
        >
          {railSlot === null ? null : (
            <Inspector.Root asChild>
              <StudioInspector
                target={railSlot}
                open={inspectorOpen}
                onClose={onCloseInspector}
                hierarchy={<Inspector.Breadcrumb />}
                styleSections={
                  <>
                    <Inspector.Document />
                    <Inspector.Node />
                    <Inspector.Text />
                  </>
                }
                dataPanel={
                  <div className="flex min-w-0 flex-col gap-4">
                    <MergeFieldsPanel {...mergeFields} onInsert={insertMergeField} />
                    {dataPanel}
                  </div>
                }
                fontFamily={STUDIO_FONT_STACK}
                nodeActionReason={hasNodeSelection ? undefined : NO_SELECTION_REASON}
                onDeleteNode={() => editor && deleteSelectedBlock(editor)}
                onDuplicateNode={() => editor && duplicateSelectedBlock(editor)}
                onInsertImage={() => editor && editorExtras(editor.commands).uploadImage()}
              />
            </Inspector.Root>
          )}
        </EmailEditor>
      </EmailCanvas>
      <div ref={setRailSlot} className="contents" />
    </>
  )
}

/**
 * Commands Tiptap declares by AUGMENTING its command types from packages this
 * app never imports: `undo`/`redo` from `@tiptap/extensions`, and `uploadImage`
 * from the editor's own image extension (which only exists once `onUploadImage`
 * is passed). TypeScript cannot see the augmentations, though the editor
 * definitely has the commands, so one narrow cast in one place says so out loud
 * rather than sprinkling `any` around.
 */
interface EditorExtraCommands {
  undo(): boolean
  redo(): boolean
  /** Opens a file picker and runs the package's own upload flow. */
  uploadImage(): boolean
}

function editorExtras(commands: unknown): EditorExtraCommands {
  return commands as EditorExtraCommands
}

type LiveEditor = NonNullable<EmailEditorRef['editor']>

/**
 * A ProseMirror selection that has picked a whole node rather than a range of
 * text. Described structurally so this file does not have to depend on
 * `@tiptap/pm` just to ask one question.
 */
interface NodeSelectionLike {
  readonly node?: { toJSON(): JSONContent }
  readonly from: number
  readonly to: number
}

/** Where one block starts and ends, and what it is. */
interface SelectedBlock {
  readonly from: number
  readonly to: number
  readonly json: JSONContent
}

/**
 * The block the inspector's Duplicate and Delete buttons act on.
 *
 * Clicking into a heading gives a TEXT selection, not a node selection, so
 * "delete the selection" would delete the few characters under the caret. What
 * people mean by Delete in the rail is "this block" — the same block the
 * breadcrumb's last crumb names — so the cursor's innermost real block is what
 * is looked up here.
 *
 * The wrappers are skipped deliberately: deleting the container or the body
 * would empty the whole email from a button labelled "Delete block".
 */
const WRAPPER_NODES = new Set(['doc', 'body', 'container', 'globalContent'])

function selectedBlock(editor: LiveEditor): SelectedBlock | null {
  const selection = editor.state.selection as unknown as NodeSelectionLike
  if (selection.node) {
    return { from: selection.from, to: selection.to, json: selection.node.toJSON() }
  }
  const { $from } = editor.state.selection
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (!node.isBlock || WRAPPER_NODES.has(node.type.name)) continue
    return { from: $from.before(depth), to: $from.after(depth), json: node.toJSON() as JSONContent }
  }
  return null
}

/** Inserts a copy of the selected block straight after it. */
function duplicateSelectedBlock(editor: LiveEditor): void {
  const block = selectedBlock(editor)
  if (!block) return
  editor.chain().focus().insertContentAt(block.to, block.json).run()
}

function deleteSelectedBlock(editor: LiveEditor): void {
  const block = selectedBlock(editor)
  if (!block) return
  editor.chain().focus().deleteRange({ from: block.from, to: block.to }).run()
}
