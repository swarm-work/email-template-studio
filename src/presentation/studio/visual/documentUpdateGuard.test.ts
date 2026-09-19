import { describe, expect, it } from 'vitest'
import { createDocumentUpdateGuard } from './documentUpdateGuard'

describe('createDocumentUpdateGuard', () => {
  it('drops the first update that arrives before the editor is ready', () => {
    const guard = createDocumentUpdateGuard()
    // This is the editor package normalising the document as it is built.
    // Letting it through would mark an untouched template "Unsaved changes".
    expect(guard.accepts(false)).toBe(false)
  })

  it('accepts the first update once the editor is ready', () => {
    const guard = createDocumentUpdateGuard()
    expect(guard.accepts(true)).toBe(true)
  })

  it('accepts an UNFOCUSED edit made from the inspector rail', () => {
    const guard = createDocumentUpdateGuard()
    // `Inspector.Document` writes through `setGlobalContent`, which does not
    // focus the canvas. Before this was keyed off readiness rather than focus,
    // the very first document-level change was silently swallowed.
    expect(guard.accepts(true)).toBe(true)
    expect(guard.accepts(true)).toBe(true)
  })

  it('only ever drops ONE update, so a real edit is never swallowed', () => {
    const guard = createDocumentUpdateGuard()
    expect(guard.accepts(false)).toBe(false)
    expect(guard.accepts(false)).toBe(true)
    expect(guard.accepts(false)).toBe(true)
  })

  it('gives each editor its own guard', () => {
    const first = createDocumentUpdateGuard()
    const second = createDocumentUpdateGuard()
    expect(first.accepts(false)).toBe(false)
    expect(first.accepts(false)).toBe(true)
    // Switching template builds a new editor, which loads its document again.
    expect(second.accepts(false)).toBe(false)
  })
})
