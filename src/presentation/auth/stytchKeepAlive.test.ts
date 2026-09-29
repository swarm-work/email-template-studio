/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { keepStytchSessionFresh } from './stytchKeepAlive'

// Never let the real SDK load: `stytchClient.ts` imports `@stytch/react/b2b` at
// module scope, and this file only exercises the DEFAULT-parameter wiring, not
// the real client, so a null default is all that is needed.
vi.mock('./stytchClient', () => ({ stytchClient: null }))

const { isStytchSignOutInProgress } = vi.hoisted(() => ({
  isStytchSignOutInProgress: vi.fn(() => false),
}))
vi.mock('./stytchSignOut', () => ({ isStytchSignOutInProgress }))

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

function fakeClient(
  overrides: {
    getSync?: () => { readonly last_accessed_at?: unknown } | null
    authenticate?: () => Promise<unknown>
  } = {},
) {
  const unsubscribe = vi.fn()
  return {
    unsubscribe,
    client: {
      session: {
        getSync: vi.fn(overrides.getSync ?? (() => ({}))),
        authenticate: vi.fn(overrides.authenticate ?? (async () => ({}))),
        onChange: vi.fn((_callback: (session: unknown) => void) => unsubscribe),
      },
    },
  }
}

/** A controllable clock, injected as `keepStytchSessionFresh`'s `now` parameter. */
function fakeClock(start = 0) {
  let value = start
  return {
    now: () => value,
    advance(ms: number) {
      value += ms
    },
  }
}

/** Longer than `MIN_HIDDEN_MS_TO_REFRESH` and `MIN_MS_SINCE_LAST_REFRESH` (both 2 minutes). */
const LONG_ENOUGH_MS = 3 * 60 * 1000

describe('keepStytchSessionFresh', () => {
  let doc: ReturnType<typeof fakeDoc>

  beforeEach(() => {
    doc = fakeDoc()
    isStytchSignOutInProgress.mockReturnValue(false)
  })

  it('is a no-op for a null client', () => {
    const stop = keepStytchSessionFresh(null, doc as unknown as Document)
    expect(doc.addEventListener).not.toHaveBeenCalled()
    expect(() => stop()).not.toThrow()
  })

  it('refreshes once when the tab becomes visible after being hidden long enough, and a hidden change does nothing', () => {
    const { client } = fakeClient()
    const clock = fakeClock()
    keepStytchSessionFresh(client, doc as unknown as Document, undefined, clock.now)

    // `doc` starts hidden (fakeDoc's default), so the keep-alive already seeded
    // `hiddenSince` from this moment when it was constructed above.
    clock.advance(LONG_ENOUGH_MS)
    doc.setVisibility('visible')
    doc.fireVisibilityChange()
    expect(client.session.authenticate).toHaveBeenCalledTimes(1)
    // No `session_duration_minutes` - this must never extend the session.
    expect(client.session.authenticate).toHaveBeenCalledWith()

    doc.setVisibility('hidden')
    doc.fireVisibilityChange()
    expect(client.session.authenticate).toHaveBeenCalledTimes(1)
  })

  it('does not refresh when the tab was hidden only briefly (under the two-minute threshold)', () => {
    const { client } = fakeClient()
    const clock = fakeClock()
    keepStytchSessionFresh(client, doc as unknown as Document, undefined, clock.now)

    clock.advance(30_000)
    doc.setVisibility('visible')
    doc.fireVisibilityChange()
    expect(client.session.authenticate).not.toHaveBeenCalled()
  })

  it('does not refresh on becoming visible when there is no cached session, even after a long sleep', () => {
    const { client } = fakeClient({ getSync: () => null })
    const clock = fakeClock()
    keepStytchSessionFresh(client, doc as unknown as Document, undefined, clock.now)

    clock.advance(LONG_ENOUGH_MS)
    doc.setVisibility('visible')
    doc.fireVisibilityChange()
    expect(client.session.authenticate).not.toHaveBeenCalled()
  })

  it('does not refresh when the session was accessed recently, even after a long-enough sleep', () => {
    // Read from the SDK's own `last_accessed_at`, not from a call this module
    // made itself - so it also sees the SDK's OWN three-minute interval having
    // landed while the tab was hidden, not only a refresh this module started.
    const clock = fakeClock()
    const { client } = fakeClient({
      getSync: () => ({ last_accessed_at: new Date(clock.now() - 30_000).toISOString() }),
    })
    keepStytchSessionFresh(client, doc as unknown as Document, undefined, clock.now)

    clock.advance(LONG_ENOUGH_MS)
    doc.setVisibility('visible')
    doc.fireVisibilityChange()
    expect(client.session.authenticate).not.toHaveBeenCalled()
  })

  it('refreshes when both the hidden duration and the time since the last access clear their thresholds', () => {
    const clock = fakeClock()
    const { client } = fakeClient({
      getSync: () => ({ last_accessed_at: new Date(clock.now() - 10 * 60 * 1000).toISOString() }),
    })
    keepStytchSessionFresh(client, doc as unknown as Document, undefined, clock.now)

    clock.advance(LONG_ENOUGH_MS)
    doc.setVisibility('visible')
    doc.fireVisibilityChange()
    expect(client.session.authenticate).toHaveBeenCalledTimes(1)
  })

  it('refreshes anyway when the session carries no last_accessed_at at all (an older SDK shape)', () => {
    const { client } = fakeClient({ getSync: () => ({}) })
    const clock = fakeClock()
    keepStytchSessionFresh(client, doc as unknown as Document, undefined, clock.now)

    clock.advance(LONG_ENOUGH_MS)
    doc.setVisibility('visible')
    doc.fireVisibilityChange()
    expect(client.session.authenticate).toHaveBeenCalledTimes(1)
  })

  it('swallows a rejected authenticate() call instead of leaving it an unhandled rejection', async () => {
    const clock = fakeClock()
    const { client } = fakeClient({
      authenticate: vi.fn(async () => {
        throw new Error('network down')
      }),
    })
    keepStytchSessionFresh(client, doc as unknown as Document, undefined, clock.now)

    clock.advance(LONG_ENOUGH_MS)
    doc.setVisibility('visible')
    doc.fireVisibilityChange()
    expect(client.session.authenticate).toHaveBeenCalledTimes(1)

    // If the rejection were not caught inside the module, it would surface
    // here as an unhandled promise rejection and fail this test.
    await new Promise((resolve) => setTimeout(resolve, 0))
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

  it("does not call onEnded while the member's own sign-out is in progress", () => {
    // `revoke({ forceClear: true })` (stytchSignOut.ts) clears the local
    // session - firing this exact callback with `null` - before that
    // function's own reload runs. Calling `onEnded` here too would only flash
    // the sign-in screen's lazy chunk in the instant before that reload.
    isStytchSignOutInProgress.mockReturnValue(true)
    const { client } = fakeClient()
    const onEnded = vi.fn()
    keepStytchSessionFresh(client, doc as unknown as Document, onEnded)

    client.session.onChange.mock.calls[0][0](null)
    expect(onEnded).not.toHaveBeenCalled()
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
