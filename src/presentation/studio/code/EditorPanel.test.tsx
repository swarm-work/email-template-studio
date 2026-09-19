// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditorPanel } from './EditorPanel'

// CodeMirror needs a real layout engine, which jsdom does not have. The point
// of this test is the tab machinery around the editors, so each one is stood in
// for by a textarea carrying the same accessible name.
vi.mock('@/presentation/shared/CodeEditor', () => ({
  CodeEditor: ({ value, label }: { value: string; label: string }) => (
    <textarea aria-label={label} defaultValue={value} />
  ),
}))

function renderPanel(activeTab: 'tsx' | 'props' | 'html' | 'text' = 'tsx', onTabChange = vi.fn()) {
  render(
    <EditorPanel
      baseId="test-editor"
      fileName="welcome-verification.email.tsx"
      source="const a = 1"
      onSourceChange={() => {}}
      payloadText="{}"
      onPayloadChange={() => {}}
      html="<p>hi</p>"
      text=""
      activeTab={activeTab}
      onTabChange={onTabChange}
      actions={null}
    />,
  )
  return onTabChange
}

describe('EditorPanel', () => {
  it('keeps every editor mounted and hides the ones that are not showing', () => {
    renderPanel('tsx')

    // All four are in the DOM: switching tabs must not destroy an editor, or
    // its undo history would go with it.
    expect(screen.getByLabelText('Template source for welcome-verification.email.tsx')).toBeInTheDocument()
    expect(screen.getByLabelText('Preview payload JSON')).toBeInTheDocument()
    expect(screen.getByLabelText('Compiled HTML (read only)')).toBeInTheDocument()
    expect(screen.getByLabelText('Plain text (read only)')).toBeInTheDocument()

    const panels = document.querySelectorAll('[role="tabpanel"]')
    expect(panels).toHaveLength(4)
    expect(panels[0]).not.toHaveAttribute('hidden')
    expect(panels[0]).not.toHaveAttribute('inert')
    for (const hiddenPanel of [panels[1], panels[2], panels[3]]) {
      expect(hiddenPanel).toHaveAttribute('hidden')
      expect(hiddenPanel).toHaveAttribute('inert')
    }
  })

  it('names the tabs after the files and marks the generated ones read only', () => {
    renderPanel('props')
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual([
      'template.tsx',
      'preview-props.json',
      'Compiled HTML',
      'Plain text',
    ])
    expect(screen.getByRole('tab', { name: 'preview-props.json' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Compiled HTML' })).toHaveTextContent('Read only')
  })

  it('asks its owner to change tab when one is clicked', async () => {
    const onTabChange = renderPanel('tsx')
    await userEvent.click(screen.getByRole('tab', { name: 'Compiled HTML' }))
    expect(onTabChange).toHaveBeenCalledWith('html')
  })
})
