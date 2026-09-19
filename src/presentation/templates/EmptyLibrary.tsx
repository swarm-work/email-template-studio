/**
 * What the library shows when there is nothing in it yet.
 *
 * Presentation layer: a dashed panel and two lines of copy, nothing else. The
 * "New template" button lives in the library header above this panel
 * (TemplateLibraryPage), so it is there whether or not the library is empty.
 */
import { FilePlus2 } from 'lucide-react'

export function EmptyLibrary() {
  return (
    <div className="bg-card flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-16 text-center">
      <span className="text-muted-foreground bg-muted flex size-9 items-center justify-center rounded-md">
        <FilePlus2 className="size-4" aria-hidden="true" />
      </span>
      <p className="text-sm font-medium">No templates yet</p>
      <p className="text-muted-foreground max-w-sm text-sm">Create a template to start authoring email.</p>
    </div>
  )
}
