// @vitest-environment jsdom
import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_STUDIO_FEATURES } from '@/domain'
import type { EmailProvider, ProviderStatus } from '@/infrastructure/providers/emailProvider'
import { useSendServerStatus } from './useSendServerStatus'

/** A provider that answers whatever the test hands it, and never sends. */
function providerAnswering(status: () => Promise<ProviderStatus>): EmailProvider {
  return {
    id: 'test',
    label: 'Test',
    getStatus: status,
    send: () => Promise.reject(new Error('not used')),
  }
}

const CONNECTED: ProviderStatus = {
  connected: true,
  features: { visualEditor: false },
  provider: 'ses',
  mode: 'dry-run',
  from: 'studio@swarm.work',
  recipientPolicy: 'any',
  allowedRecipients: [],
  maxRecipientsPerSend: 10,
  region: 'eu-west-1',
}

describe('useSendServerStatus', () => {
  it('starts optimistic and not ready, so nothing flashes read-only', () => {
    const { result } = renderHook(() => useSendServerStatus(providerAnswering(() => new Promise(() => {}))))
    expect(result.current).toEqual({ from: null, features: DEFAULT_STUDIO_FEATURES, ready: false })
  })

  it('reports the From address and the flags the server sent', async () => {
    const { result } = renderHook(() =>
      useSendServerStatus(providerAnswering(() => Promise.resolve(CONNECTED))),
    )
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.from).toBe('studio@swarm.work')
    expect(result.current.features).toEqual({ visualEditor: false })
  })

  it('has no From address when the server is not connected', async () => {
    const provider = providerAnswering(() =>
      Promise.resolve({ connected: false, reason: 'off', features: DEFAULT_STUDIO_FEATURES }),
    )
    const { result } = renderHook(() => useSendServerStatus(provider))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.from).toBeNull()
  })

  it('becomes ready with the defaults when the request rejects', async () => {
    // The canvas waits for `ready`, so a rejection that left it false would
    // park a visual template on the loading skeleton for ever.
    const provider = providerAnswering(() => Promise.reject(new Error('offline')))
    const { result } = renderHook(() => useSendServerStatus(provider))
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.features).toEqual(DEFAULT_STUDIO_FEATURES)
    expect(result.current.from).toBeNull()
  })

  it('does not set state after unmounting', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    let answer: (status: ProviderStatus) => void = () => {}
    const provider = providerAnswering(() => new Promise<ProviderStatus>((resolve) => (answer = resolve)))
    const { unmount } = renderHook(() => useSendServerStatus(provider))
    unmount()
    answer(CONNECTED)
    await Promise.resolve()
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })
})
