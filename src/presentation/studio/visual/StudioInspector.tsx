/**
 * The 360 px rail to the right of the canvas: what the selected block looks
 * like (Style) and what data fills it in (Data).
 *
 * Presentation layer, chrome only. The panels that read and write the document
 * come from `@react-email/editor`'s own Inspector and are handed in as
 * `hierarchy` / `styleSections`, so this file never imports the editor package
 * and the library's grouping is kept rather than forked (ADR-18).
 *
 * It renders through a PORTAL: the package renders our children as SIBLINGS of
 * the editor container, but the rail belongs beside the canvas, not inside the
 * scroller with it. A portal moves the DOM without leaving the React tree, so
 * the Inspector still sees the editor's context.
 */
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { createPortal } from 'react-dom'
import { Copy, ImagePlus, Trash2 } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { ReasonedButton } from '@/presentation/shared/ReasonedButton'
import { FontFallbackNote } from './FontFallbackNote'
import { InspectorFooterShortcuts } from './InspectorFooterShortcuts'
import { INSPECTOR_RAIL_ID } from './canvas'

/** Shown by the delete / duplicate buttons when nothing is selected on the canvas. */
export const NO_SELECTION_REASON = 'Select a block on the canvas to edit it.'

export interface StudioInspectorProps {
  /** Where the rail is drawn: an element beside the canvas (see VisualEditorSurface). */
  target: HTMLElement
  /** Below xl the rail slides in and out; at xl and up it is simply always there. */
  open: boolean
  onClose: () => void
  /** `Inspector.Breadcrumb` — the Document › Body › Heading trail. */
  hierarchy: ReactNode
  /** `Inspector.Document` / `.Node` / `.Text`, whichever the selection calls for. */
  styleSections: ReactNode
  /** The Data tab's contents: `MergeFieldsPanel` above the props payload card. */
  dataPanel: ReactNode
  /** The font stack the email exports with, for the client-safe note. */
  fontFamily: string
  onDeleteNode: () => void
  onDuplicateNode: () => void
  /**
   * Opens a file picker and uploads the chosen image. This is the studio's
   * discoverable route to a picture: the package's slash menu ships no Image
   * item and cannot be given one without replacing the whole menu, so without
   * this button the only ways in would be paste and drag-and-drop.
   */
  onInsertImage: () => void
  /** Why the two node buttons cannot be used; `undefined` means they can. */
  nodeActionReason?: string
  /** Supplied by `Inspector.Root asChild`, which owns the rail's focus scope. */
  ref?: Ref<HTMLElement>
  tabIndex?: number
}

export function StudioInspector({
  target,
  open,
  onClose,
  hierarchy,
  styleSections,
  dataPanel,
  fontFamily,
  onDeleteNode,
  onDuplicateNode,
  onInsertImage,
  nodeActionReason,
  ref,
  tabIndex,
}: StudioInspectorProps) {
  const railRef = useRef<HTMLElement | null>(null)

  // Opening the rail on a narrow screen moves focus into it, so the next Tab
  // continues inside the panel that just appeared rather than back at the top
  // of the page. Escape puts focus back on the toggle (the toggle does that;
  // see StudioPage). There is no focus TRAP: the rail is a panel, not a dialog.
  useEffect(() => {
    if (open) railRef.current?.focus({ preventScroll: true })
  }, [open])

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Escape' || !open) return
    // Stopped here so Escape closing the rail does not also leave preview mode.
    event.stopPropagation()
    onClose()
  }

  const rail = (
    <>
      {/* The backdrop only exists while the rail is over the canvas. It is a
          sibling inside the workspace, so it dims the canvas and not the
          sub-header people need to close the rail from. */}
      <div
        hidden={!open}
        onClick={onClose}
        aria-hidden="true"
        className="bg-foreground/20 absolute inset-0 z-10 xl:hidden"
      />
      <aside
        id={INSPECTOR_RAIL_ID}
        ref={(node) => {
          railRef.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        tabIndex={tabIndex}
        data-open={open}
        onKeyDown={onKeyDown}
        // Explicitly a region, like every other named area of the studio, so
        // one Playwright helper and one screen-reader gesture find them all.
        role="region"
        aria-label="Inspector"
        className={cn(
          'bg-card z-20 flex w-[360px] shrink-0 flex-col border-l focus-visible:outline-none',
          'max-xl:absolute max-xl:inset-y-0 max-xl:right-0 max-xl:w-[min(360px,88vw)]',
          'max-xl:translate-x-full max-xl:shadow-lg max-xl:transition-transform max-xl:duration-200',
          'motion-reduce:transition-none max-xl:data-[open=true]:translate-x-0',
        )}
      >
        <Tabs defaultValue="style" className="flex min-h-0 flex-1 flex-col gap-0">
          <TabsList className="mx-4 mt-3 shrink-0">
            <TabsTrigger value="style">Style</TabsTrigger>
            <TabsTrigger value="data">Data</TabsTrigger>
          </TabsList>

          <TabsContent
            value="style"
            className="studio-inspector min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
          >
            <div className="flex min-w-0 items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="meta-label">Hierarchy</p>
                <div className="mt-1 min-w-0">{hierarchy}</div>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <ReasonedButton
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Insert image"
                  onClick={onInsertImage}
                >
                  <ImagePlus aria-hidden="true" />
                </ReasonedButton>
                <ReasonedButton
                  variant="ghost"
                  size="icon-sm"
                  reason={nodeActionReason}
                  aria-label="Duplicate block"
                  onClick={onDuplicateNode}
                >
                  <Copy aria-hidden="true" />
                </ReasonedButton>
                <ReasonedButton
                  variant="ghost"
                  size="icon-sm"
                  reason={nodeActionReason}
                  aria-label="Delete block"
                  onClick={onDeleteNode}
                >
                  <Trash2 aria-hidden="true" />
                </ReasonedButton>
              </div>
            </div>

            {styleSections}

            <div className="mt-3">
              <FontFallbackNote family={fontFamily} />
            </div>
          </TabsContent>

          <TabsContent value="data" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
            {dataPanel}
          </TabsContent>
        </Tabs>

        <InspectorFooterShortcuts />
      </aside>
    </>
  )

  return createPortal(rail, target)
}
