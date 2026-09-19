import { describe, expect, it } from 'vitest'
import { templateSource } from '@/domain'
import { STARTER_TEMPLATES } from '@/infrastructure/templates/registry'
import { renderTemplate } from './renderTemplate'

/**
 * Only the CODE starters go through this pipeline. A visual starter has no TSX
 * at all; it is composed in the browser from the editor (see
 * infrastructure/render/visualEmailRenderer.ts).
 */
const CODE_STARTERS = STARTER_TEMPLATES.filter((template) => template.kind === 'code')

describe('renderTemplate', () => {
  it.each(CODE_STARTERS.map((t) => [t.metadata.name, t] as const))(
    'renders the "%s" sample template',
    async (_name, template) => {
      const props = JSON.parse(template.samplePayloadText) as Record<string, unknown>
      const result = await renderTemplate(templateSource(template), props)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.html).toContain('<!DOCTYPE html')
      expect(result.html).toContain('<body')
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    },
  )

  it('interpolates props into the HTML', async () => {
    const template = STARTER_TEMPLATES[0]
    const result = await renderTemplate(templateSource(template), {
      recipientName: 'Zed Zephyr',
      verificationUrl: 'https://example.test/verify',
      expiresInHours: 12,
      productName: 'TestProduct',
      supportEmail: 'help@example.test',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // React separates adjacent text nodes with `<!-- -->` markers; strip them before asserting on text.
    const text = result.html.replace(/<!--\s*-->/g, '')
    expect(text).toContain('Zed Zephyr')
    expect(text).toContain('https://example.test/verify')
    expect(text).toContain('expires in 12 hours')
  })

  it('renders a plain-text part next to the HTML', async () => {
    const template = STARTER_TEMPLATES[0]
    const props = JSON.parse(template.samplePayloadText) as Record<string, unknown>
    const result = await renderTemplate(templateSource(template), props)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The words of the template are there (the heading is upper-cased by its style)...
    expect(result.text).toMatch(/welcome, ada/i)
    expect(result.text).toContain('app.meridian.example/verify')
    // ...and no markup is: this is the alternative part, not a second copy of the HTML.
    expect(result.text).not.toContain('<')
    expect(result.text).not.toMatch(/<\/?[a-z]/i)
  })

  it('supports both default and namespace React imports', async () => {
    const source = `
      import React from 'react'
      import { Html, Text } from '@react-email/components'
      export default function T({ name }: { name: string }) {
        return React.createElement(Html, null, React.createElement(Text, null, 'Hi ' + name))
      }`
    const result = await renderTemplate(source, { name: 'Ada' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.html).toContain('Hi Ada')
  })

  it('reports errors thrown while rendering as `render` errors', async () => {
    const source = `export default function T(): never { throw new Error('exploded during render') }`
    const result = await renderTemplate(source, {})
    expect(result).toMatchObject({ ok: false, error: { kind: 'render' } })
    if (result.ok) return
    expect(result.error.message).toContain('exploded during render')
  })

  it('reports forbidden imports without executing anything', async () => {
    const result = await renderTemplate(`import fs from 'node:fs'\nexport default () => null`, {})
    expect(result).toMatchObject({ ok: false, error: { kind: 'forbidden-import' } })
  })
})
