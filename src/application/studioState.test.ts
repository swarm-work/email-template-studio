import { describe, expect, it } from 'vitest'
import { templateId, type EmailDocument, type EmailTemplate, type TemplateRecord } from '@/domain'
import {
  createInitialState,
  getDraft,
  isDocumentDirty,
  isEnvelopeDirty,
  isPayloadDirty,
  isSourceDirty,
  isTemplateDirty,
  studioReducer,
  type StudioState,
} from './studioState'

const metadata = {
  id: templateId('t1'),
  name: 'T1',
  slug: 't1',
  description: '',
  category: 'onboarding' as const,
  status: 'ready' as const,
  version: { number: 1, label: 'v1', createdAt: '2026-01-01T00:00:00Z' },
  revision: 4,
  tags: [],
  origin: 'starter' as const,
  createdBy: 'seed',
  createdAt: '2026-01-01T00:00:00Z',
  updatedBy: 'seed',
  updatedAt: '2026-01-01T00:00:00Z',
}

const envelope = { subject: 'Subject', preheader: '', replyTo: '' }

const template: EmailTemplate = {
  kind: 'code',
  metadata,
  envelope,
  source: 'ORIGINAL SOURCE',
  samplePayloadText: '{"a":1}',
  propsSchemaText: '{}',
  validateProps: () => ({ ok: true, value: {} }),
}
const id = template.metadata.id

const document: EmailDocument = {
  type: 'doc',
  content: [{ type: 'container', content: [{ type: 'paragraph' }] }],
}

const visualTemplate: EmailTemplate = {
  kind: 'visual',
  metadata: { ...metadata, id: templateId('v1'), slug: 'v1' },
  envelope,
  document,
  theme: 'studio-v1',
  html: '<p>hi</p>',
  text: 'hi',
  samplePayloadText: '{"a":1}',
  propsSchemaText: '{}',
  validateProps: () => ({ ok: true, value: {} }),
}
const visualId = visualTemplate.metadata.id

function edited(): StudioState {
  let state = createInitialState(id)
  state = studioReducer(state, { type: 'edit-source', id, template, source: 'CHANGED' })
  state = studioReducer(state, { type: 'edit-payload', id, template, payloadText: '{"a":2}' })
  return state
}

describe('studioReducer', () => {
  it('starts clean with the originals', () => {
    const state = createInitialState(id)
    expect(getDraft(state, template)).toEqual({
      baseRevision: 4,
      baseVersionNumber: 1,
      source: 'ORIGINAL SOURCE',
      payloadText: '{"a":1}',
      document: null,
      envelope,
    })
    expect(isTemplateDirty(state, template)).toBe(false)
    expect(state.mode).toBe('code')
  })

  it('tracks edits and dirty flags independently', () => {
    const state = edited()
    expect(getDraft(state, template).source).toBe('CHANGED')
    expect(getDraft(state, template).payloadText).toBe('{"a":2}')
    expect(isSourceDirty(state, template)).toBe(true)
    expect(isPayloadDirty(state, template)).toBe(true)
  })

  it('remembers the revision the draft started from', () => {
    expect(edited().drafts[id].baseRevision).toBe(4)
    expect(edited().drafts[id].baseVersionNumber).toBe(1)
  })

  it('becomes clean again when an edit is typed back to the original', () => {
    let state = edited()
    state = studioReducer(state, { type: 'edit-source', id, template, source: 'ORIGINAL SOURCE' })
    expect(isSourceDirty(state, template)).toBe(false)
    expect(isPayloadDirty(state, template)).toBe(true)
    state = studioReducer(state, { type: 'edit-payload', id, template, payloadText: '{"a":1}' })
    expect(state.drafts).toEqual({})
  })

  it('resets source and payload separately', () => {
    let state = edited()
    state = studioReducer(state, { type: 'reset-source', id })
    expect(getDraft(state, template).source).toBe('ORIGINAL SOURCE')
    expect(getDraft(state, template).payloadText).toBe('{"a":2}')
    state = studioReducer(state, { type: 'reset-payload', id })
    expect(state.drafts).toEqual({})
    expect(getDraft(state, template).payloadText).toBe('{"a":1}')
  })

  it('reset-template drops the draft entirely', () => {
    const state = studioReducer(edited(), { type: 'reset-template', id })
    expect(state.drafts).toEqual({})
    expect(isTemplateDirty(state, template)).toBe(false)
  })

  it('keeps drafts when switching templates', () => {
    let state = edited()
    state = studioReducer(state, { type: 'select-template', id: templateId('t2') })
    expect(state.selectedId).toBe('t2')
    expect(getDraft(state, template).source).toBe('CHANGED')
  })

  it('records device changes', () => {
    const state = studioReducer(createInitialState(id), { type: 'set-device', device: 'mobile' })
    expect(state.device).toBe('mobile')
  })
})

describe('studioReducer: envelope and document', () => {
  it('tracks envelope edits and forgets them when typed back', () => {
    let state = createInitialState(id)
    state = studioReducer(state, {
      type: 'edit-envelope',
      id,
      template,
      envelope: { ...envelope, subject: 'New subject' },
    })
    expect(isEnvelopeDirty(state, template)).toBe(true)
    expect(getDraft(state, template).envelope.subject).toBe('New subject')
    state = studioReducer(state, { type: 'edit-envelope', id, template, envelope: { ...envelope } })
    expect(state.drafts).toEqual({})
  })

  it('reset-envelope puts the saved envelope back', () => {
    let state = studioReducer(createInitialState(id), {
      type: 'edit-envelope',
      id,
      template,
      envelope: { ...envelope, preheader: 'Peek' },
    })
    state = studioReducer(state, { type: 'reset-envelope', id })
    expect(isEnvelopeDirty(state, template)).toBe(false)
    expect(getDraft(state, template).envelope).toEqual(envelope)
  })

  it('compares documents by value, so a re-serialised document is not a change', () => {
    const reordered: EmailDocument = {
      content: [{ content: [{ type: 'paragraph' }], type: 'container' }],
      type: 'doc',
    }
    const state = studioReducer(createInitialState(visualId, 'visual'), {
      type: 'edit-document',
      id: visualId,
      template: visualTemplate,
      document: reordered,
    })
    expect(state.drafts).toEqual({})
    expect(isDocumentDirty(state, visualTemplate)).toBe(false)
  })

  it('tracks a real document change and resets it', () => {
    const changed: EmailDocument = { type: 'doc', content: [{ type: 'heading' }] }
    let state = studioReducer(createInitialState(visualId, 'visual'), {
      type: 'edit-document',
      id: visualId,
      template: visualTemplate,
      document: changed,
    })
    expect(isDocumentDirty(state, visualTemplate)).toBe(true)
    expect(isTemplateDirty(state, visualTemplate)).toBe(true)
    state = studioReducer(state, { type: 'reset-document', id: visualId })
    expect(state.drafts).toEqual({})
    expect(getDraft(state, visualTemplate).document).toEqual(document)
  })
})

describe('studioReducer: modes', () => {
  it('opens a visual template on the canvas and a code template in the editor', () => {
    expect(createInitialState(id, 'code').mode).toBe('code')
    expect(createInitialState(visualId, 'visual').mode).toBe('visual')
  })

  it('clamps a mode the kind does not offer', () => {
    const state = studioReducer(createInitialState(id), { type: 'set-mode', mode: 'visual', kind: 'code' })
    expect(state.mode).toBe('code')
  })

  it('keeps a mode the kind does offer', () => {
    const state = studioReducer(createInitialState(id), { type: 'set-mode', mode: 'preview', kind: 'code' })
    expect(state.mode).toBe('preview')
  })

  it('clamps the mode when selecting a template of the other kind', () => {
    let state = studioReducer(createInitialState(visualId, 'visual'), {
      type: 'set-mode',
      mode: 'visual',
      kind: 'visual',
    })
    state = studioReducer(state, { type: 'select-template', id, kind: 'code' })
    expect(state.mode).toBe('code')
  })
})

describe('studioReducer: saved and created', () => {
  const record: TemplateRecord = {
    kind: 'code',
    metadata: { ...metadata, revision: 5 },
    envelope,
    source: 'CHANGED',
    samplePayloadText: '{"a":2}',
    propsSchemaText: '{}',
  }

  it('template-saved rebases the draft onto the version that was just written', () => {
    // Keeping the draft is what stops the editors flashing the OLD content
    // while the library refetches; it stops counting as "modified" as soon as
    // the new record lands, because every field then compares equal to it.
    const state = studioReducer(edited(), { type: 'template-saved', record })
    expect(state.drafts[id].baseRevision).toBe(5)
    expect(state.drafts[id].baseVersionNumber).toBe(record.metadata.version.number)
    expect(state.drafts[id].source).toBe(edited().drafts[id].source)
  })

  it('template-saved leaves a template with no draft alone', () => {
    const state = createInitialState(id)
    expect(studioReducer(state, { type: 'template-saved', record })).toBe(state)
  })

  it('metadata-saved moves the draft on when it was still in step with the server', () => {
    // A rename bumps the revision without writing a version. The draft was
    // based on revision 4, which is what the PATCH was made against, so the
    // next save has to quote the revision the PATCH produced.
    const state = studioReducer(edited(), {
      type: 'metadata-saved',
      record,
      expectedRevision: 4,
    })
    expect(state.drafts[id].baseRevision).toBe(5)
    // No version was written, so the number the conflict wording uses is untouched.
    expect(state.drafts[id].baseVersionNumber).toBe(1)
    expect(state.drafts[id].source).toBe('CHANGED')
  })

  it('metadata-saved leaves a draft that had ALREADY fallen behind alone', () => {
    // Somebody else saved a version first, so this draft is based on a revision
    // the server has moved past. Rebasing it here would hide that: the banner
    // would go quiet and the next save would silently overwrite their version.
    const before = edited()
    const behind = studioReducer(before, { type: 'metadata-saved', record, expectedRevision: 9 })
    expect(behind).toBe(before)
    expect(behind.drafts[id].baseRevision).toBe(4)
  })

  it('metadata-saved leaves a template with no draft alone', () => {
    const state = createInitialState(id)
    expect(studioReducer(state, { type: 'metadata-saved', record, expectedRevision: 4 })).toBe(state)
  })

  it('template-converted drops the draft and opens the code editor', () => {
    // The one write that does NOT rebase: the draft holds a visual document,
    // and after the conversion there is no visual template for it to describe
    // (ADR-28). Keeping it would put the canvas back on the next render.
    const state = studioReducer(edited(), { type: 'template-converted', record })
    expect(state.drafts[id]).toBeUndefined()
    expect(state.mode).toBe('code')
  })

  it('template-converted leaves a template with no draft alone, but still switches mode', () => {
    const before = { ...createInitialState(id), mode: 'visual' as const }
    expect(studioReducer(before, { type: 'template-converted', record }).mode).toBe('code')
  })

  it('template-created selects the new template in its own editor', () => {
    const created: TemplateRecord = {
      ...record,
      kind: 'visual',
      metadata: { ...metadata, id: templateId('new') },
      document,
      theme: 'studio-v1',
      html: '',
      text: '',
    }
    const state = studioReducer(createInitialState(id), { type: 'template-created', record: created })
    expect(state.selectedId).toBe('new')
    expect(state.mode).toBe('visual')
  })
})
