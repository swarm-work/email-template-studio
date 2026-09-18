// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { STARTER_TEMPLATES } from '@/infrastructure/templates/registry'
import { toEmailTemplate } from '@/infrastructure/templates/templateMapper'
import { PreviewWorkspace } from './PreviewWorkspace'

const TEMPLATE = toEmailTemplate(STARTER_TEMPLATES[0])
const DOCUMENT = '<!doctype html><html><body><p>Welcome, Ada</p></body></html>'
const TEXT = 'WELCOME, ADA\n\nVerify your address.'

function renderWorkspace() {
  return render(
    <PreviewWorkspace
      template={TEMPLATE}
      envelope={TEMPLATE.envelope}
      from="studio@example.test"
      device="desktop"
      status="success"
      result={{ ok: true, html: '<p>ok</p>', text: TEXT, durationMs: 5 }}
      document={DOCUMENT}
      text={TEXT}
      renderedAt={new Date('2026-01-01T09:00:00Z')}
      onRefresh={vi.fn()}
      onDownloadHtml={vi.fn()}
      onDownloadText={vi.fn()}
      diagnostics={[]}
      onExit={vi.fn()}
    />,
  )
}

describe('PreviewWorkspace', () => {
  it('moves between the two tabs with the arrow keys', async () => {
    renderWorkspace()
    const rendered = screen.getByRole('tab', { name: 'Rendered' })
    const plain = screen.getByRole('tab', { name: 'Plain text' })

    // Only the selected tab is in the tab order, so the arrows are the only
    // keyboard route to the other panel.
    rendered.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(plain).toHaveAttribute('aria-selected', 'true')
    expect(plain).toHaveFocus()
    expect(screen.getByLabelText('Plain text part (read only)')).toHaveTextContent('WELCOME, ADA')

    // ArrowRight wraps back round to the first tab, as the editor's strip does.
    await userEvent.keyboard('{ArrowRight}')
    expect(rendered).toHaveAttribute('aria-selected', 'true')
    expect(rendered).toHaveFocus()

    await userEvent.keyboard('{ArrowLeft}')
    expect(plain).toHaveAttribute('aria-selected', 'true')
  })

  it('names the focusable plain-text box with a role that can carry a name', async () => {
    renderWorkspace()
    await userEvent.click(screen.getByRole('tab', { name: 'Plain text' }))
    // A bare <pre> is generic, and ARIA drops a name on a generic element.
    const box = screen.getByRole('group', { name: 'Plain text part (read only)' })
    expect(box).toHaveAttribute('tabindex', '0')
  })

  it('leaves preview mode when Escape is pressed inside it', async () => {
    const onExit = vi.fn()
    render(
      <PreviewWorkspace
        template={TEMPLATE}
        envelope={TEMPLATE.envelope}
        from={null}
        device="desktop"
        status="idle"
        result={null}
        document={null}
        text={null}
        renderedAt={null}
        onRefresh={vi.fn()}
        onDownloadHtml={vi.fn()}
        onDownloadText={vi.fn()}
        diagnostics={[]}
        onExit={onExit}
      />,
    )
    await userEvent.click(screen.getByRole('tab', { name: 'Rendered' }))
    await userEvent.keyboard('{Escape}')
    expect(onExit).toHaveBeenCalledTimes(1)
  })
})
