import { describe, expect, it } from 'vitest'
import { conversionPayload } from '@/application/visual/documentToTsx'
import { convertFixture, GOLDENS } from '@/application/visual/__fixtures__/goldens'
import { compileTemplate } from './compileTemplate'
import { evaluateTemplate } from './evaluateTemplate'
import { renderTemplate, TEMPLATE_MODULES } from './renderTemplate'

/**
 * The guarantee: everything the converter emits really is a template this
 * studio can compile and render.
 *
 * The converter is pure and knows nothing about sucrase or React Email, so
 * without this test "it looks like valid TSX" would be an opinion. Here every
 * golden goes through the SAME three steps the render worker runs — compile,
 * evaluate, render — with a payload built from its own props (ADR-28).
 */
describe('a converted template', () => {
  for (const golden of GOLDENS) {
    it(`compiles, evaluates and renders: ${golden.name}`, async () => {
      const converted = convertFixture(golden.name, golden.document, golden.resolveStyle)
      expect(converted.ok).toBe(true)
      if (!converted.ok) return

      const compiled = compileTemplate(converted.source)
      expect(compiled.ok, compiled.ok ? '' : compiled.error.message).toBe(true)
      if (!compiled.ok) return

      // The allow-list is the studio's hard boundary: a converted template that
      // imported anything else would be refused here rather than in production.
      const evaluated = evaluateTemplate(compiled.code, TEMPLATE_MODULES)
      expect(evaluated.ok, evaluated.ok ? '' : evaluated.error.message).toBe(true)

      const payload = conversionPayload(converted.props)
      const result = await renderTemplate(converted.source, payload)
      expect(result.ok, result.ok ? '' : result.error.message).toBe(true)
      if (!result.ok) return

      expect(result.html).toContain(golden.expectedText)
      expect(result.text.length).toBeGreaterThan(0)
    })
  }

  it('renders the preheader as the email’s preview line', async () => {
    const converted = convertFixture('marks', GOLDENS[0].document)
    expect(converted.ok).toBe(true)
    if (!converted.ok) return
    const result = await renderTemplate(converted.source, conversionPayload(converted.props))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.html).toContain('A preheader for marks')
  })
})
