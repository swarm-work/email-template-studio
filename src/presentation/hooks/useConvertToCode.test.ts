// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ConvertToCodeInput, RepositoryResult } from '@/application/repositories/templateRepository'
import type { EmailDocument, EmailTemplate, PreviewPayload, RenderResult, TemplateId } from '@/domain'
import type { TemplateRenderer } from '@/infrastructure/render/renderClient'
import { useConvertToCode } from './useConvertToCode'

/**
 * The order of the conversion is the safety (ADR-28), so it is what these
 * tests check: nothing is written until the generated module has rendered.
 */
const VISUAL_DOCUMENT: EmailDocument = {
  type: 'doc',
  content: [
    {
      type: 'container',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hi ' },
            { type: 'mergeField', attrs: { key: 'firstName' } },
          ],
        },
      ],
    },
  ],
}

const TEMPLATE: EmailTemplate = {
  kind: 'visual',
  metadata: {
    id: 'tpl_test' as TemplateId,
    name: 'Product launch',
    slug: 'product-launch',
    description: '',
    category: 'notification',
    status: 'draft',
    version: { number: 3, label: 'v3', createdAt: '2026-01-01T00:00:00Z' },
    revision: 7,
    tags: [],
    origin: 'user',
    createdBy: 'me',
    createdAt: '2026-01-01T00:00:00Z',
    updatedBy: 'me',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  envelope: { subject: 'Hello', preheader: '', replyTo: '' },
  samplePayloadText: '{"firstName":"Ada"}',
  propsSchemaText: '{}',
  theme: 'studio-v1',
  html: '',
  text: '',
  document: VISUAL_DOCUMENT,
  validateProps: () => ({ ok: true, value: {} }),
}

/** A renderer that answers whatever the test tells it to, and records the call. */
function fakeRenderer(result: RenderResult) {
  const calls: { source: string; props: PreviewPayload }[] = []
  const renderer: TemplateRenderer = {
    render: async (source, props) => {
      calls.push({ source, props })
      return result
    },
    dispose: () => {},
  }
  return { renderer, calls }
}

const RENDERED: RenderResult = {
  ok: true,
  html: '<p>Hi {{firstName}}</p>',
  text: 'Hi {{firstName}}',
  durationMs: 12,
}

interface Overrides {
  readonly document?: EmailDocument
  readonly samplePayloadText?: string
  readonly envelopeDirty?: boolean
}

function setUp(
  render: RenderResult,
  convert: (id: TemplateId, input: ConvertToCodeInput) => Promise<RepositoryResult<EmailTemplate>>,
  overrides: Overrides = {},
) {
  const { renderer, calls } = fakeRenderer(render)
  const converted = vi.fn()
  const conflict = vi.fn()
  const hook = renderHook(() =>
    useConvertToCode({
      template: TEMPLATE,
      document: overrides.document ?? VISUAL_DOCUMENT,
      subject: TEMPLATE.envelope.subject,
      preheader: '',
      envelopeDirty: overrides.envelopeDirty ?? false,
      samplePayloadText: overrides.samplePayloadText ?? TEMPLATE.samplePayloadText,
      expectedRevision: 7,
      renderer,
      convert,
      onConverted: converted,
      onConflict: conflict,
    }),
  )
  return { hook, calls, converted, conflict }
}

/**
 * Opens the dialog and waits for the conversion to be prepared.
 *
 * The generous timeout is for the first call: preparing a conversion imports
 * the editor's theming module, and parsing it the first time costs more than
 * Testing Library's one-second default.
 */
async function prepare(hook: ReturnType<typeof setUp>['hook']) {
  act(() => hook.result.current.openDialog())
  await waitFor(() => expect(hook.result.current.preparation.status).toBe('ready'), { timeout: 10_000 })
}

describe('useConvertToCode', () => {
  it('converts, renders and only then writes', async () => {
    const written: ConvertToCodeInput[] = []
    const convert = async (_id: TemplateId, input: ConvertToCodeInput) => {
      written.push(input)
      return { ok: true, value: TEMPLATE } as RepositoryResult<EmailTemplate>
    }
    const { hook, calls, converted } = setUp(RENDERED, convert)
    await prepare(hook)

    await act(async () => hook.result.current.confirm())
    await waitFor(() => expect(written).toHaveLength(1))

    // The smoke render ran first, with every prop holding its own token, so
    // what was stored still carries the merge field (ADR-26).
    expect(calls).toHaveLength(1)
    expect(calls[0].props).toEqual({ firstName: '{{firstName}}' })
    expect(calls[0].source).toContain('export default function ProductLaunchEmail')
    expect(written[0].html).toBe(RENDERED.ok ? RENDERED.html : '')
    expect(written[0].expectedRevision).toBe(7)
    expect(converted).toHaveBeenCalledTimes(1)
    expect(hook.result.current.open).toBe(false)
  })

  it('writes nothing when the generated module does not render', async () => {
    const convert = vi.fn()
    const failure: RenderResult = { ok: false, error: { kind: 'render', message: 'Rendering failed: x' } }
    const { hook } = setUp(failure, convert)
    await prepare(hook)

    await act(async () => hook.result.current.confirm())
    await waitFor(() => expect(hook.result.current.renderError).toBe('Rendering failed: x'))
    expect(convert).not.toHaveBeenCalled()
    // The dialog stays open, showing the error, and nothing was converted.
    expect(hook.result.current.open).toBe(true)
    expect(hook.result.current.converting).toBe(false)
  })

  it('hands a refused write straight to the conflict dialog', async () => {
    const convert = async () =>
      ({
        ok: false,
        failure: { code: 'version-conflict', message: 'Saved elsewhere.', current: TEMPLATE },
      }) as RepositoryResult<EmailTemplate>
    const { hook, conflict, converted } = setUp(RENDERED, convert)
    await prepare(hook)

    await act(async () => hook.result.current.confirm())
    await waitFor(() => expect(conflict).toHaveBeenCalledTimes(1))
    expect(converted).not.toHaveBeenCalled()
  })

  it('refuses a document it cannot convert, and never renders it', async () => {
    const convert = vi.fn()
    // A block from outside the first set of nodes.
    const blocked: EmailDocument = {
      type: 'doc',
      content: [{ type: 'container', content: [{ type: 'bulletList' }] }],
    }
    const { hook, calls } = setUp(RENDERED, convert, { document: blocked })

    act(() => hook.result.current.openDialog())
    await waitFor(() => expect(hook.result.current.preparation.status).toBe('blocked'))

    act(() => hook.result.current.confirm())
    expect(calls).toHaveLength(0)
    expect(convert).not.toHaveBeenCalled()
  })

  it('stops before converting when the preview payload is not a JSON object', async () => {
    // The server stores the sample payload as an object and would answer 400.
    // Saying so in the dialog beats a round trip that ends in a toast.
    const convert = vi.fn()
    const { hook, calls } = setUp(RENDERED, convert, { samplePayloadText: '{"firstName":' })

    act(() => hook.result.current.openDialog())
    await waitFor(() => expect(hook.result.current.preparation.status).toBe('failed'))
    const { preparation } = hook.result.current
    expect(preparation.status === 'failed' ? preparation.message : '').toContain('Data tab')

    act(() => hook.result.current.confirm())
    expect(calls).toHaveLength(0)
    expect(convert).not.toHaveBeenCalled()
  })

  it('warns that an unsaved subject or preheader is not carried over', async () => {
    // The server writes the SAVED envelope onto the converted version, so the
    // draft's is lost either way — the user is told before, not after.
    const convert = vi.fn()
    const { hook } = setUp(RENDERED, convert, { envelopeDirty: true })
    await prepare(hook)

    const { preparation } = hook.result.current
    const warnings = preparation.status === 'ready' ? preparation.warnings : []
    expect(warnings.join(' ')).toContain('not carried over')
  })
})
