// @vitest-environment jsdom
import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { STARTER_TEMPLATES } from '@/infrastructure/templates/registry'
import type { VisualEditorHandle } from '@/infrastructure/render/visualEmailRenderer'
import { VisualEditorSurface } from './VisualEditorSurface'

const found = STARTER_TEMPLATES.find((template) => template.kind === 'visual')
if (found?.kind !== 'visual') throw new Error('no visual starter to mount')
/** The shipped visual starter, narrowed once so the tests below can read its document. */
const VISUAL_STARTER = found

function renderSurface(
  overrides: {
    onEditorReady?: (handle: VisualEditorHandle) => void
    mergeFieldKeys?: readonly string[]
  } = {},
) {
  return render(
    // StrictMode, because the app runs in it: React mounts every effect twice,
    // and an editor that registers a plugin without cleaning it up shows here.
    <StrictMode>
      <TooltipProvider>
        <div className="flex">
          <VisualEditorSurface
            templateId="tpl_product-launch"
            document={VISUAL_STARTER.document}
            theme={VISUAL_STARTER.theme}
            onDocumentChange={() => {}}
            onEditorReady={overrides.onEditorReady ?? (() => {})}
            onEditorDestroy={() => {}}
            onControlsChange={() => {}}
            inspectorOpen={false}
            onCloseInspector={() => {}}
            dataPanel={<p>Props payload</p>}
            mergeFields={{
              keys: overrides.mergeFieldKeys ?? [],
              payloadText: '{}',
              onPayloadChange: () => {},
            }}
          />
        </div>
      </TooltipProvider>
    </StrictMode>,
  )
}

describe('VisualEditorSurface', () => {
  it('mounts the canvas and the inspector without a single console message', async () => {
    // The end-to-end suite fails the whole run on any console error, so the
    // quiet mount is a promise this test keeps rather than a nicety.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    let handle: VisualEditorHandle | null = null
    const { container } = renderSurface({
      onEditorReady: (ready) => {
        handle = ready
      },
    })

    await waitFor(() => expect(container.querySelector('.tiptap')).not.toBeNull())
    await waitFor(() => expect(handle).not.toBeNull())

    // The starter's own words, proving the document was parsed and not just an
    // empty editor that happened to mount.
    expect(container.querySelector('.tiptap')?.textContent).toContain('Next-Gen Edge APIs')
    // The sheet IS the editor's container, which is what the bubble menu is
    // positioned against (see EmailCanvas).
    expect(container.querySelector('.studio-sheet')).not.toBeNull()

    expect(error).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
  })

  it('draws the inspector rail beside the canvas, with both tabs', async () => {
    renderSurface()

    const rail = await screen.findByRole('region', { name: 'Inspector' })
    expect(rail).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Style' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Data' })).toBeInTheDocument()
    // Our own header above the library's sections.
    expect(screen.getByText('Hierarchy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Insert image' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Duplicate block' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete block' })).toBeInTheDocument()
  })

  it('will not delete a block before one has been selected', async () => {
    // A fresh document already has a cursor in its first block, and the
    // package's breadcrumb reports `Body` until the canvas is focused. The two
    // node buttons follow the breadcrumb rather than the cursor, so they stay
    // disabled - with a reason - until somebody has clicked into the email.
    renderSurface()

    const remove = await screen.findByRole('button', { name: 'Delete block' })
    await waitFor(() => expect(remove).toHaveAttribute('aria-disabled', 'true'))
    expect(screen.getAllByText('Select a block on the canvas to edit it.').length).toBeGreaterThan(0)
  })

  it('names the canvas and says the email is shown at actual size', async () => {
    renderSurface()

    expect(await screen.findByRole('region', { name: 'Email canvas' })).toBeInTheDocument()
    expect(screen.getByText('600 px canvas · 100%')).toBeInTheDocument()
  })
})
