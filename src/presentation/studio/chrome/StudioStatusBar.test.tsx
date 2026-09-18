// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { RenderResult } from '@/domain'
import { STARTER_TEMPLATES } from '@/infrastructure/templates/registry'
import { toEmailTemplate } from '@/infrastructure/templates/templateMapper'
import { GMAIL_CLIPPING_LIMIT_BYTES } from '@/presentation/shared/formatBytes'
import { StudioStatusBar } from './StudioStatusBar'

const TEMPLATE = toEmailTemplate(STARTER_TEMPLATES[0])

function renderBar(html: string | null, result: RenderResult | null) {
  render(
    <TooltipProvider>
      <StudioStatusBar template={TEMPLATE} html={html} result={result} />
    </TooltipProvider>,
  )
  return screen.getByRole('region', { name: 'Studio status' })
}

const ok = (html: string, text = ''): RenderResult => ({ ok: true, html, text, durationMs: 12 })

describe('StudioStatusBar', () => {
  it('measures the render that is showing', () => {
    const bar = renderBar('<p>hello</p>', ok('<p>hello</p>'))
    // The segments are built from several text nodes (dots, dots inside spans),
    // so the strip is asserted as a whole.
    expect(bar).toHaveTextContent('Ready · v3')
    expect(bar).toHaveTextContent('HTML export 12 B')
    // No plain-text part yet: the bar names the step it is waiting for.
    expect(bar).toHaveTextContent('Plain text · next step')
    expect(bar).toHaveTextContent('12 B of 102 KB Gmail limit')
  })

  it('says the plain text is ready once the render produces one', () => {
    const bar = renderBar('<p>hi</p>', ok('<p>hi</p>', 'hi'))
    expect(bar).toHaveTextContent('Plain text ready')
  })

  it('warns when the email is past the size Gmail clips at', () => {
    const big = 'a'.repeat(GMAIL_CLIPPING_LIMIT_BYTES + 1)
    const bar = renderBar(big, ok(big))
    const segment = within(bar).getByText(/over the 102 KB Gmail clipping limit/)
    expect(segment).toHaveClass('bg-warning-muted')
  })

  it('has one live region: the saved sentence, not the numbers', () => {
    const bar = renderBar('<p>hi</p>', ok('<p>hi</p>'))
    const live = bar.querySelectorAll('[aria-live]')
    expect(live).toHaveLength(1)
    expect(live[0]).toHaveTextContent(/^Last saved v3 · /)
  })
})
