import { describe, expect, it } from 'vitest'
import * as prettier from 'prettier'
import type { EmailDocument } from '@/domain'
import { conversionPayload, documentToTsx } from './documentToTsx'
import { convertFixture, GOLDENS, STUB_STYLE_RESOLVER } from './__fixtures__/goldens'
import headingsDocument from './__fixtures__/headings.document.json'
import mergeFieldsDocument from './__fixtures__/merge-fields.document.json'
import unsupportedDocument from './__fixtures__/unsupported.document.json'

/** Mirrors .prettierrc; the same duplication (and reason) as `formatSource.ts`. */
const PRETTIER_OPTIONS = {
  parser: 'typescript',
  semi: false,
  singleQuote: true,
  printWidth: 110,
  trailingComma: 'all',
} as const

describe('documentToTsx', () => {
  for (const golden of GOLDENS) {
    it(`converts the ${golden.name} fixture to its golden module`, () => {
      const result = convertFixture(golden.name, golden.document, golden.resolveStyle)
      expect(result.ok, JSON.stringify(result.ok ? [] : result.reasons)).toBe(true)
      if (!result.ok) return
      expect(result.source).toBe(golden.source)
    })
  }

  // The output is committed to a repository where `prettier --check` is a gate,
  // so the printer has to agree with prettier rather than merely look tidy.
  for (const golden of GOLDENS) {
    it(`prints the ${golden.name} fixture the way prettier would`, async () => {
      expect(await prettier.format(golden.source, PRETTIER_OPTIONS)).toBe(golden.source)
    })
  }

  it('refuses a node it has no React Email equivalent for, and says where it is', () => {
    const result = convertFixture('unsupported', unsupportedDocument)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons).toHaveLength(1)
    expect(result.reasons[0].node).toBe('bulletList')
    expect(result.reasons[0].path).toBe('doc > container[0] > bulletList[1]')
    expect(result.reasons[0].message).toContain('cannot be converted')
  })

  it('refuses an unknown text style rather than dropping it', () => {
    const document = paragraphWith({
      type: 'text',
      text: 'highlighted',
      marks: [{ type: 'highlight', attrs: { color: 'yellow' } }],
    })
    const result = documentToTsx(document, baseOptions())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons[0].node).toBe('highlight')
  })

  it('refuses a heading level React Email cannot render', () => {
    const document: EmailDocument = {
      type: 'doc',
      content: [
        {
          type: 'container',
          content: [{ type: 'heading', attrs: { level: 7 }, content: [{ type: 'text', text: 'Deep' }] }],
        },
      ],
    }
    const result = documentToTsx(document, baseOptions())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons[0].node).toBe('heading')
  })

  it('names a prop after the merge field it came from, and keeps the two in step', () => {
    const result = convertFixture('merge-fields', mergeFieldsDocument)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.propKeys).toEqual([
      'userFirstName',
      'recipientName',
      'invoiceTotal',
      'invoiceId',
      'portalUrl',
    ])
    // The smoke render before the save uses this: every prop holds the token it
    // came from, so the HTML that comes back is still substitutable (ADR-26).
    expect(conversionPayload(result.props)).toEqual({
      userFirstName: '{{user.first_name}}',
      recipientName: '{{recipientName}}',
      invoiceTotal: '{{invoice.total}}',
      invoiceId: '{{invoice.id}}',
      portalUrl: '{{portalUrl}}',
    })
  })

  it('gives two keys that would share a name a number rather than one prop', () => {
    const document = paragraphWith(
      { type: 'mergeField', attrs: { key: 'user.name' } },
      { type: 'text', text: ' / ' },
      { type: 'mergeField', attrs: { key: 'userName' } },
    )
    const result = documentToTsx(document, baseOptions())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.propKeys).toEqual(['userName', 'userName2'])
  })

  it('renames a merge field that would collide with the module’s own styles object', () => {
    // `{{styles}}` is a legal merge field, and a prop named `styles` would
    // shadow the `const styles` the printer emits — every `style={styles.text}`
    // would then read a property off a string and silently render unstyled.
    const document = paragraphWith({ type: 'mergeField', attrs: { key: 'styles' } })
    const result = documentToTsx(document, baseOptions())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.propKeys).toEqual(['styles2'])
  })

  it('renames a merge field that would collide with a JavaScript keyword', () => {
    const document = paragraphWith({ type: 'mergeField', attrs: { key: 'class' } })
    const result = documentToTsx(document, baseOptions())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.propKeys).toEqual(['classValue'])
    expect(result.source).toContain('export default function Fixture({ classValue }: FixtureProps) {')
  })

  it('warns about what it could only convert loosely, without blocking', () => {
    const document: EmailDocument = {
      type: 'doc',
      content: [
        {
          type: 'container',
          content: [
            { type: 'image', attrs: { src: 'https://example.com/a.png', alignment: 'center' } },
            { type: 'paragraph' },
          ],
        },
      ],
    }
    const result = documentToTsx(document, baseOptions())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.warnings).toHaveLength(3)
    expect(result.warnings.join(' ')).toContain('alternative text')
    expect(result.warnings.join(' ')).toContain('alignment')
    // The visual export drops a trailing empty paragraph, so the conversion
    // does too — and says so, because the canvas still shows the blank line.
    expect(result.warnings.join(' ')).toContain('trailing empty paragraph')
  })

  it('refuses a block that sits outside the body rather than dropping it', () => {
    // A document rooted in a `body` node keeps everything inside it, so a
    // sibling would simply vanish. Vanishing is what ADR-28 forbids.
    const document: EmailDocument = {
      type: 'doc',
      content: [
        { type: 'body', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Inside' }] }] },
        { type: 'container', content: [] },
      ],
    }
    const result = documentToTsx(document, baseOptions())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons[0].node).toBe('container')
    expect(result.reasons[0].path).toBe('doc > container[1]')
  })

  it('names the body in the path of a refusal inside it', () => {
    const document: EmailDocument = {
      type: 'doc',
      content: [{ type: 'body', content: [{ type: 'bulletList', content: [] }] }],
    }
    const result = documentToTsx(document, baseOptions())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reasons[0].path).toBe('doc > body[0] > bulletList[0]')
  })

  it('merges the theme, the node’s own style and its alignment in that order', () => {
    const document: EmailDocument = {
      type: 'doc',
      content: [
        {
          type: 'container',
          content: [
            {
              type: 'paragraph',
              attrs: { style: 'text-align: right', alignment: 'center' },
              content: [{ type: 'text', text: 'Aligned' }],
            },
          ],
        },
      ],
    }
    const result = documentToTsx(document, { ...baseOptions(), resolveStyle: STUB_STYLE_RESOLVER })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The theme says left, the style attribute says right, the alignment says
    // centre — and the alignment is applied last, so centre is what ships.
    expect(result.source).toContain("textAlign: 'center'")
  })

  it('ignores an alignment the editor itself would not export', () => {
    // `justify` is offered by the canvas and then dropped by its own
    // serializer, so converting it would justify an email that was not.
    const document: EmailDocument = {
      type: 'doc',
      content: [
        {
          type: 'container',
          content: [
            { type: 'paragraph', attrs: { alignment: 'justify' }, content: [{ type: 'text', text: 'X' }] },
          ],
        },
      ],
    }
    const result = documentToTsx(document, baseOptions())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source).not.toContain('textAlign')
  })

  it('leaves the <Preview> element out when there is no preheader', () => {
    const result = convertFixture('headings', headingsDocument)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.source).not.toContain('<Preview>')
    expect(result.source).not.toContain('Preview,')
  })

  it('imports only React and React Email, which is what the studio allows', () => {
    for (const golden of GOLDENS) {
      const imports = [...golden.source.matchAll(/from '([^']+)'/g)].map((match) => match[1])
      expect(new Set(imports)).toEqual(new Set(['react', '@react-email/components']))
    }
  })
})

/** A document holding one paragraph with the given inline content. */
function paragraphWith(...content: EmailDocument[]): EmailDocument {
  return { type: 'doc', content: [{ type: 'container', content: [{ type: 'paragraph', content }] }] }
}

function baseOptions() {
  return { componentName: 'Fixture', propsInterfaceName: 'FixtureProps', subject: 'Test', preheader: '' }
}
