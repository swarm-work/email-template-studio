// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { templateId, type EmailTemplate } from '@/domain'
import { STARTER_TEMPLATES } from '@/infrastructure/templates/registry'
import { toEmailTemplate } from '@/infrastructure/templates/templateMapper'
import { useSavedExport } from './useSavedExport'

/**
 * A visual template with an export on it. Every shipped starter has `html: ''`
 * (the studio composes on open), so the branch the rollback switch actually
 * depends on needs a fixture of its own.
 */
function visualTemplate(html: string, text: string): EmailTemplate {
  return toEmailTemplate({
    metadata: {
      ...STARTER_TEMPLATES[0].metadata,
      id: templateId('tpl_saved-export'),
      name: 'Saved export',
      slug: 'saved-export',
    },
    envelope: STARTER_TEMPLATES[0].envelope,
    samplePayloadText: STARTER_TEMPLATES[0].samplePayloadText,
    propsSchemaText: STARTER_TEMPLATES[0].propsSchemaText,
    kind: 'visual',
    document: { type: 'doc', content: [] },
    theme: 'studio-v1',
    html,
    text,
  })
}

describe('useSavedExport', () => {
  it('shows the export stored with the version', () => {
    const { result } = renderHook(() => useSavedExport(visualTemplate('<p>Saved</p>', 'Saved')))
    expect(result.current.status).toBe('success')
    expect(result.current.html).toBe('<p>Saved</p>')
    expect(result.current.text).toBe('Saved')
    expect(result.current.result).toEqual({ ok: true, html: '<p>Saved</p>', text: 'Saved', durationMs: 0 })
  })

  it('reports no render time, because nothing was rendered', () => {
    // `renderedAt` is what feeds the sparkline and the toolbar's "Rendered at"
    // line. Reading the record is not a measurement, so there is nothing to
    // quote and the history stays empty.
    const { result } = renderHook(() => useSavedExport(visualTemplate('<p>Saved</p>', 'Saved')))
    expect(result.current.renderedAt).toBeNull()
    expect(result.current.result?.ok === true && result.current.result.durationMs).toBe(0)
  })

  it('says nothing has been rendered when the version has no export yet', () => {
    // Every seeded starter is in exactly this state until its first save.
    const { result } = renderHook(() => useSavedExport(visualTemplate('', '')))
    expect(result.current.status).toBe('idle')
    expect(result.current.html).toBeNull()
    expect(result.current.text).toBeNull()
  })

  it('has nothing to offer for a code template', () => {
    const { result } = renderHook(() => useSavedExport(toEmailTemplate(STARTER_TEMPLATES[0])))
    expect(result.current.status).toBe('idle')
    expect(result.current.html).toBeNull()
  })

  it('refresh is a no-op rather than a missing function', () => {
    const { result } = renderHook(() => useSavedExport(visualTemplate('<p>Saved</p>', 'Saved')))
    expect(() => result.current.refresh()).not.toThrow()
  })
})
