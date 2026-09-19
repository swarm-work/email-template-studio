// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { RepositoryResult } from '@/application/repositories/templateRepository'
import { templateId, type EmailTemplate, type TemplateRecord } from '@/domain'
import { SAVE_FAILED_MESSAGE, useTemplateSave } from './useTemplateSave'

const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const metadata = {
  id: templateId('t1'),
  name: 'T1',
  slug: 't1',
  description: '',
  category: 'onboarding' as const,
  status: 'draft' as const,
  version: { number: 2, label: 'v2', createdAt: '2026-01-01T00:00:00Z' },
  revision: 6,
  tags: [],
  origin: 'starter' as const,
  createdBy: 'seed',
  createdAt: '2026-01-01T00:00:00Z',
  updatedBy: 'seed',
  updatedAt: '2026-01-01T00:00:00Z',
}

const saved: EmailTemplate = {
  kind: 'code',
  metadata,
  envelope: { subject: 'Subject', preheader: '', replyTo: '' },
  source: 'SOURCE',
  samplePayloadText: '{}',
  propsSchemaText: '{}',
  validateProps: () => ({ ok: true, value: {} }),
}

/** The server's copy, as a refused save carries it. */
const serverCopy: TemplateRecord = {
  kind: 'code',
  metadata: { ...metadata, revision: 9, version: { number: 4, label: 'v4', createdAt: metadata.createdAt } },
  envelope: saved.envelope,
  source: 'THEIRS',
  samplePayloadText: '{}',
  propsSchemaText: '{}',
}

const ok: RepositoryResult<EmailTemplate> = { ok: true, value: saved }

beforeEach(() => {
  toast.mockClear()
  toast.error.mockClear()
})

describe('useTemplateSave', () => {
  it('sends the current base revision and reports what the server wrote', async () => {
    const send = vi.fn(async () => ok)
    const onSaved = vi.fn()
    const { result } = renderHook(() => useTemplateSave({ send, baseRevision: 6, onSaved }))

    act(() => result.current.save())
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved))
    expect(send).toHaveBeenCalledWith(6)
    expect(result.current.saving).toBe(false)
  })

  it('ignores a second save while one is in flight, so a held-down ⌘S writes one version', async () => {
    let release = () => {}
    const send = vi.fn(
      () => new Promise<RepositoryResult<EmailTemplate>>((resolve) => (release = () => resolve(ok))),
    )
    const { result } = renderHook(() => useTemplateSave({ send, baseRevision: 6, onSaved: vi.fn() }))

    act(() => result.current.save())
    act(() => result.current.save())
    act(() => result.current.save())
    expect(send).toHaveBeenCalledTimes(1)

    await act(async () => {
      release()
    })
    await waitFor(() => expect(result.current.saving).toBe(false))
    // Once the first one is done, saving again is allowed.
    act(() => result.current.save())
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('sends the LATEST base revision when Retry is pressed, not the one that failed', async () => {
    const send = vi
      .fn<(revision: number) => Promise<RepositoryResult<EmailTemplate>>>()
      .mockResolvedValueOnce({ ok: false, failure: { code: 'unreachable', message: 'No network.' } })
      .mockResolvedValue(ok)
    const { result, rerender } = renderHook(
      ({ baseRevision }) => useTemplateSave({ send, baseRevision, onSaved: vi.fn() }),
      { initialProps: { baseRevision: 6 } },
    )

    act(() => result.current.save())
    await waitFor(() => expect(toast.error).toHaveBeenCalled())
    const [message, options] = toast.error.mock.calls[0] as [string, { action: { onClick: () => void } }]
    expect(message).toBe(SAVE_FAILED_MESSAGE)

    // The draft moved on between the failure and the retry.
    rerender({ baseRevision: 8 })
    act(() => options.action.onClick())
    await waitFor(() => expect(send).toHaveBeenLastCalledWith(8))
  })

  it('keeps the server’s copy for the dialog on a conflict, and says nothing in a toast', async () => {
    const send = vi.fn(async (): Promise<RepositoryResult<EmailTemplate>> => {
      return { ok: false, failure: { code: 'version-conflict', message: 'Refused.', current: serverCopy } }
    })
    const { result } = renderHook(() => useTemplateSave({ send, baseRevision: 6, onSaved: vi.fn() }))

    act(() => result.current.save())
    await waitFor(() => expect(result.current.conflict).toBe(serverCopy))
    // The dialog is the whole message; a toast underneath it would be noise.
    expect(toast.error).not.toHaveBeenCalled()

    act(() => result.current.dismissConflict())
    expect(result.current.conflict).toBeNull()
  })

  it('clears the in-flight flag even if the port breaks its promise and throws', async () => {
    const send = vi
      .fn<(revision: number) => Promise<RepositoryResult<EmailTemplate>>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(ok)
    const { result } = renderHook(() => useTemplateSave({ send, baseRevision: 6, onSaved: vi.fn() }))

    act(() => result.current.save())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(SAVE_FAILED_MESSAGE, expect.anything()))
    await waitFor(() => expect(result.current.saving).toBe(false))

    // Without the `finally` the button would be dead for the life of the screen.
    act(() => result.current.save())
    expect(send).toHaveBeenCalledTimes(2)
  })
})
