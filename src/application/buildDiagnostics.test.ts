import { describe, expect, it } from 'vitest'
import { isRealCheck } from '@/domain'
import { buildDiagnostics } from './buildDiagnostics'

const ok = { ok: true as const, value: {} }

describe('buildDiagnostics', () => {
  it('reports all-green after a successful render', () => {
    const items = buildDiagnostics({
      validation: ok,
      renderStatus: 'success',
      renderResult: { ok: true, html: '<html></html>', text: '', durationMs: 42 },
      kind: 'code',
      contentDirty: false,
      payloadDirty: false,
    })
    const byId = Object.fromEntries(items.map((item) => [item.id, item]))
    expect(byId.template?.state).toBe('pass')
    expect(byId.payload?.state).toBe('pass')
    expect(byId.render?.state).toBe('pass')
    expect(byId.render?.detail).toContain('42 ms')
    expect(byId.html?.state).toBe('pass')
  })

  it('never claims unimplemented checks are real', () => {
    const items = buildDiagnostics({
      validation: ok,
      renderStatus: 'idle',
      renderResult: null,
      kind: 'code',
      contentDirty: false,
      payloadDirty: false,
    })
    const fake = items.filter((item) => ['links', 'spf-dkim-dmarc', 'spam-score'].includes(item.id))
    expect(fake).toHaveLength(3)
    for (const item of fake) expect(isRealCheck(item.state)).toBe(false)
  })

  it('marks the payload invalid and the render paused when validation fails', () => {
    const items = buildDiagnostics({
      validation: { ok: false, kind: 'schema', issues: [{ path: 'recipientName', message: 'Required' }] },
      renderStatus: 'blocked',
      renderResult: null,
      kind: 'code',
      contentDirty: false,
      payloadDirty: true,
    })
    const byId = Object.fromEntries(items.map((item) => [item.id, item]))
    expect(byId.payload?.state).toBe('error')
    expect(byId.payload?.detail).toContain('recipientName')
    expect(byId.render?.state).toBe('warning')
  })

  it('attributes compile errors to the template source', () => {
    const items = buildDiagnostics({
      validation: ok,
      renderStatus: 'error',
      renderResult: {
        ok: false,
        error: { kind: 'compile', message: 'Syntax error: Unexpected token', line: 3 },
      },
      kind: 'code',
      contentDirty: true,
      payloadDirty: false,
    })
    const byId = Object.fromEntries(items.map((item) => [item.id, item]))
    expect(byId.template?.state).toBe('error')
    expect(byId.render?.state).toBe('error')
  })

  it('warns when the HTML is large enough to be clipped', () => {
    const items = buildDiagnostics({
      validation: ok,
      renderStatus: 'success',
      renderResult: { ok: true, html: 'x'.repeat(120 * 1024), text: '', durationMs: 1 },
      kind: 'code',
      contentDirty: false,
      payloadDirty: false,
    })
    expect(items.find((item) => item.id === 'html')?.state).toBe('warning')
  })

  it('talks about the canvas document, not a source, for a visual template', () => {
    // A visual template has no source and nothing compiles: what ran is the
    // export. Saying "Compiles. Matches the original file." after somebody
    // typed on the canvas would be wrong twice over.
    const items = buildDiagnostics({
      validation: ok,
      renderStatus: 'success',
      renderResult: { ok: true, html: '<html></html>', text: '', durationMs: 7 },
      kind: 'visual',
      contentDirty: true,
      payloadDirty: false,
    })
    const template = items.find((item) => item.id === 'template')
    expect(template?.label).toBe('Canvas document')
    expect(template?.detail).toBe('Exports. Contains unsaved local edits.')
  })

  it('attributes a compose failure to the canvas document', () => {
    const items = buildDiagnostics({
      validation: ok,
      renderStatus: 'error',
      renderResult: { ok: false, error: { kind: 'compose', message: 'Could not export the canvas.' } },
      kind: 'visual',
      contentDirty: false,
      payloadDirty: false,
    })
    const template = items.find((item) => item.id === 'template')
    expect(template?.state).toBe('error')
    expect(template?.detail).toBe('Could not export the canvas.')
  })
})
