/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { keepStytchSessionFresh } from './stytchKeepAlive'

// Never let the real SDK load: `stytchClient.ts` imports `@stytch/react/b2b` at
// module scope, and this file only exercises the DEFAULT-parameter wiring, not
// the real client, so a null default is all that is needed.
vi.mock('./stytchClient', () => ({ stytchClient: null }))

/** A `Document` stand-in that captures its `visibilitychange` listener. */
function fakeDoc(initial: 'visible' | 'hidden' = 'hidden') {
  let visibilityState: 'visible' | 'hidden' = initial
  let onVisibilityChange: (() => void) | undefined
  return {
    get visibilityState() {
      return visibilityState
    },
    setVisibility(next: 'visible' | 'hidden') {
      visibilityState = next
    },
    addEventListener: vi.fn((event: string, listener: () => void) => {
      if (event === 'visibilitychange') onVisibilityChange = listener
    }),
    removeEventListener: vi.fn((event: string, listener: () => void) => {
      if (event === 'visibilitychange' && listener === onVisibilityChange) onVisibilityChange = undefined
    }),
    /** Simulates the browser firing the event this module listens for. */
    fireVisibilityChange() {
      onVisibilityChange?.()
    },
    hasListener() {
      return onVisibilityChange !== undefined
    },
  }
}

function fakeClient(overrides: { getSync?: () => unknown } = {}) {
  const unsubscribe = vi.fn()
  return {
    unsubscribe,
    client: {
      session: {
        getSync: vi.fn(overrides.getSync ?? (() => ({}))),
        authenticate: vi.fn(async () => ({})),
        onChange: vi.fn((_callback: (session: unknown) => void) => unsubscribe),
      },
    },
  }
}

describe('keepStytchSessionFresh', () => {
  let doc: ReturnType<typeof fakeDoc>

  beforeEach(() => {
    doc = fakeDoc()
  })

  it('is a no-op for a null client', () => {
    const stop = keepStytchSessionFresh(null, doc as unknown as Document)
    expect(doc.addEventListener).not.toHaveBeenCalled()
    expect(() => stop()).not.toThrow()
  })

  it('refreshes once when the tab becomes visible, and a hidden change does nothing', () => {
    const { client } = fakeClient()
    keepStytchSessionFresh(client, doc as unknown as Document)

    doc.setVisibility('visible')
    doc.fireVisibilityChange()
    expect(client.session.authenticate).toHaveBeenCalledTimes(1)
    // No `session_duration_minutes` - this must never extend the session.
    expect(client.session.authenticate).toHaveBeenCalledWith()

    doc.setVisibility('hidden')
    doc.fireVisibilityChange()
    expect(client.session.authenticate).toHaveBeenCalledTimes(1)
  })

  it('does not refresh on becoming visible when there is no cached session', () => {
    const { client } = fakeClient({ getSync: () => null })
    keepStytchSessionFresh(client, doc as unknown as Document)

    doc.setVisibility('visible')
    doc.fireVisibilityChange()
    expect(client.session.authenticate).not.toHaveBeenCalled()
  })

  it('calls onEnded when the SDK reports the session is gone', () => {
    const { client } = fakeClient()
    const onEnded = vi.fn()
    keepStytchSessionFresh(client, doc as unknown as Document, onEnded)

    const onChangeCallback = client.session.onChange.mock.calls[0][0]
    onChangeCallback(null)
    expect(onEnded).toHaveBeenCalledTimes(1)

    // A real session coming through must not be mistaken for the end of one.
    onChangeCallback({})
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it('does nothing when onEnded is not given, even if the session ends', () => {
    const { client } = fakeClient()
    expect(() => {
      keepStytchSessionFresh(client, doc as unknown as Document)
      client.session.onChange.mock.calls[0][0](null)
    }).not.toThrow()
  })

  it('cleans up: removes the listener and unsubscribes on stop', () => {
    const { client, unsubscribe } = fakeClient()
    const stop = keepStytchSessionFresh(client, doc as unknown as Document)
    expect(doc.hasListener()).toBe(true)

    stop()
    expect(doc.hasListener()).toBe(false)
    expect(unsubscribe).toHaveBeenCalledTimes(1)

    // Once stopped, a visibility change must not reach into a torn-down client.
    doc.setVisibility('visible')
    doc.fireVisibilityChange()
    expect(client.session.authenticate).not.toHaveBeenCalled()
  })
})
