/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ACTIVITY_EVENTS,
  CONFIRM_AFTER_EXTENSION_MS,
  EXTEND_AT_MOST_EVERY_MS,
  keepStytchSessionFresh,
  RETRY_FAILED_EXTENSION_MS,
} from './stytchKeepAlive'

// Never let the real SDK load: `stytchClient.ts` imports `@stytch/react/b2b` at
// module scope, and this file only exercises the DEFAULT-parameter wiring, not
// the real client, so a null default is all that is needed. The constant is
// required too, or Vitest throws the moment `stytchKeepAlive.ts` reads it off
// this mock.
vi.mock('./stytchClient', () => ({ stytchClient: null, SESSION_IDLE_TIMEOUT_MINUTES: 60 }))

const { isStytchSignOutInProgress } = vi.hoisted(() => ({
  isStytchSignOutInProgress: vi.fn(() => false),
}))
vi.mock('./stytchSignOut', () => ({ isStytchSignOutInProgress }))

type Listener = () => void

/**
 * A `Document` stand-in that records every listener it is given, keyed by
 * event type and capture flag - so `stop()` removing exactly what `start()`
 * added (never more, never less) is something a test can actually check,
 * rather than assumed.
 */
function fakeDoc(initial: 'visible' | 'hidden' = 'hidden') {
  let visibilityState: 'visible' | 'hidden' = initial
  const registered: Array<{ type: string; listener: Listener; options?: AddEventListenerOptions }> = []
  return {
    get visibilityState() {
      return visibilityState
    },
    setVisibility(next: 'visible' | 'hidden') {
      visibilityState = next
    },
    addEventListener: vi.fn((type: string, listener: Listener, options?: AddEventListenerOptions) => {
      registered.push({ type, listener, options })
    }),
    removeEventListener: vi.fn((type: string, listener: Listener, options?: AddEventListenerOptions) => {
      const capture = Boolean(options?.capture)
      const index = registered.findIndex(
        (entry) =>
          entry.type === type && entry.listener === listener && Boolean(entry.options?.capture) === capture,
      )
      if (index !== -1) registered.splice(index, 1)
    }),
    /** Runs every listener currently registered for `type` (there can be more than one - e.g. all three activity types share one handler). */
    fire(type: string) {
      for (const entry of [...registered]) if (entry.type === type) entry.listener()
    },
    /** The distinct event types this doc currently has at least one listener for. */
    listenerTypes(): string[] {
      return [...new Set(registered.map((entry) => entry.type))].sort()
    },
  }
}

/** One recorded `authenticate()` call: its arguments, and when (fake) time it happened. */
interface AuthenticateCall {
  readonly args: readonly [] | readonly [{ readonly session_duration_minutes: number }]
  readonly at: number
}

/** The calls that asked Stytch to extend the session. */
function extensions(calls: readonly AuthenticateCall[]) {
  return calls.filter((call) => call.args.length === 1)
}

/** The calls that only refreshed the JWT (no argument at all - not even `undefined`). */
function plainRefreshes(calls: readonly AuthenticateCall[]) {
  return calls.filter((call) => call.args.length === 0)
}

/**
 * A stand-in for the error `_authenticate` throws on a network failure
 * (`StytchAPIUnreachableError` - see the apiFacts this build was written
 * against). Nothing here branches on the error TYPE, only on whether the call
 * rejected at all, but a recognisable name keeps a genuine test failure
 * readable.
 */
class FakeStytchUnreachableError extends Error {
  constructor() {
    super('network unreachable (fake, for tests)')
    this.name = 'StytchAPIUnreachableError'
  }
}

type AuthMode = 'resolve' | 'reject' | 'hold'

/**
 * A `KeepAliveClient` stand-in.
 *
 * `authenticate` is a PLAIN function, deliberately never `vi.fn`: a Vitest
 * mock attaches its own handler to every promise it returns (to populate
 * `mock.results`), which marks a rejection "handled" for Node's own
 * unhandled-rejection detector whether or not `stytchKeepAlive.ts` itself
 * ever catches it - hiding exactly the bug the rejection tests below exist to
 * catch (this is also why PR #30's own `void client.session.authenticate()`
 * bug survived its first round of tests). Call counts and arguments are
 * tracked by hand instead of through `mock.calls`.
 */
function fakeClient(options: { hasSession?: boolean } = {}) {
  let mode: AuthMode = 'resolve'
  const hasSession = options.hasSession ?? true
  const calls: AuthenticateCall[] = []
  const pendingQueue: Array<{ resolve: () => void; reject: (error: Error) => void }> = []
  let maxPending = 0
  let onChangeCallback: ((session: unknown) => void) | undefined
  let unsubscribeCalls = 0

  function authenticate(...args: [] | [{ session_duration_minutes: number }]): Promise<unknown> {
    calls.push({ args, at: Date.now() })
    if (mode === 'reject') return Promise.reject(new FakeStytchUnreachableError())
    if (mode === 'hold') {
      return new Promise((resolve, reject) => {
        pendingQueue.push({ resolve: () => resolve({}), reject })
        maxPending = Math.max(maxPending, pendingQueue.length)
      })
    }
    return Promise.resolve({})
  }

  return {
    client: {
      session: {
        getSync: (): unknown => (hasSession ? {} : null),
        authenticate,
        onChange: (callback: (session: unknown) => void) => {
          onChangeCallback = callback
          return () => {
            unsubscribeCalls += 1
          }
        },
      },
    },
    calls,
    setMode(next: AuthMode) {
      mode = next
    },
    /** Resolves the OLDEST call still waiting, in `'hold'` mode. */
    resolvePending() {
      pendingQueue.shift()?.resolve()
    },
    /** Rejects the OLDEST call still waiting, in `'hold'` mode. */
    rejectPending() {
      pendingQueue.shift()?.reject(new FakeStytchUnreachableError())
    },
    /** The most calls that were ever simultaneously waiting on `'hold'` at once. */
    maxPendingAtOnce: () => maxPending,
    fireOnChange(session: unknown) {
      onChangeCallback?.(session)
    },
    unsubscribeCallCount: () => unsubscribeCalls,
  }
}

describe('keepStytchSessionFresh', () => {
  let doc: ReturnType<typeof fakeDoc>

  beforeEach(() => {
    doc = fakeDoc()
    isStytchSignOutInProgress.mockReturnValue(false)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is a no-op for a null client', () => {
    const stop = keepStytchSessionFresh(null, doc as unknown as Document)
    expect(doc.addEventListener).not.toHaveBeenCalled()
    expect(() => stop()).not.toThrow()
  })

  it('listens for pointerdown, keydown and wheel in the capture phase, passively - and nothing else', () => {
    const { client } = fakeClient()
    keepStytchSessionFresh(client, doc as unknown as Document)

    for (const type of ACTIVITY_EVENTS) {
      expect(doc.addEventListener).toHaveBeenCalledWith(type, expect.any(Function), {
        capture: true,
        passive: true,
      })
    }
    // No options at all: a visibility refresh is not gated on capture or
    // passive-ness, it just needs to hear the event.
    expect(doc.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(doc.listenerTypes()).toEqual(['keydown', 'pointerdown', 'visibilitychange', 'wheel'])

    for (const neverListened of ['pointermove', 'mousemove', 'scroll']) {
      expect(doc.listenerTypes()).not.toContain(neverListened)
    }
  })

  it('never extends an untouched tab, even after hours - and waking it up only ever does a plain refresh', async () => {
    const { client, calls } = fakeClient()
    keepStytchSessionFresh(client, doc as unknown as Document)

    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000)
    expect(calls).toHaveLength(0)

    doc.setVisibility('visible')
    doc.fire('visibilitychange')
    await vi.advanceTimersByTimeAsync(0)

    expect(calls).toHaveLength(1)
    expect(calls[0]?.args).toEqual([])
    expect(extensions(calls)).toHaveLength(0)
  })

  it.each(ACTIVITY_EVENTS)(
    'extends to 60 minutes from now on the first "%s" after the studio opens',
    async (type) => {
      const { client, calls } = fakeClient()
      keepStytchSessionFresh(client, doc as unknown as Document)

      doc.fire(type)
      await vi.advanceTimersByTimeAsync(0)

      expect(extensions(calls)).toHaveLength(1)
      expect(calls[0]?.args).toEqual([{ session_duration_minutes: 60 }])
    },
  )

  it('extends at most once every five minutes while the member keeps working', async () => {
    const startedAt = Date.now()
    const { client, calls } = fakeClient()
    keepStytchSessionFresh(client, doc as unknown as Document)

    const totalMs = 16 * 60_000
    const stepMs = 30_000
    for (let elapsed = 0; elapsed < totalMs; elapsed += stepMs) {
      doc.fire('keydown')
      await vi.advanceTimersByTimeAsync(stepMs)
    }

    expect(extensions(calls).map((call) => call.at - startedAt)).toEqual([
      0,
      EXTEND_AT_MOST_EVERY_MS,
      2 * EXTEND_AT_MOST_EVERY_MS,
      3 * EXTEND_AT_MOST_EVERY_MS,
    ])
  })

  it('credits the last burst of work with one trailing extension, then stops', async () => {
    const { client, calls } = fakeClient()
    keepStytchSessionFresh(client, doc as unknown as Document)

    doc.fire('pointerdown') // t = 0: the leading extension
    await vi.advanceTimersByTimeAsync(60_000) // t = 1:00
    doc.fire('pointerdown') // credited once the throttle clears

    await vi.advanceTimersByTimeAsync(EXTEND_AT_MOST_EVERY_MS - 60_000 - 1) // t = 4:59.999
    expect(extensions(calls)).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1) // t = 5:00
    expect(extensions(calls)).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(3 * 60 * 60 * 1000) // no more input, ever
    expect(extensions(calls)).toHaveLength(2)
  })

  it('never starts a second authenticate() call while one is already in flight', async () => {
    const { client, calls, setMode, resolvePending } = fakeClient()
    setMode('hold')
    keepStytchSessionFresh(client, doc as unknown as Document)

    doc.fire('pointerdown') // t = 0: the extension goes out and hangs
    doc.fire('keydown')
    doc.fire('keydown')
    doc.fire('keydown')
    expect(calls).toHaveLength(1)

    // Let this call, and whatever it triggers next (its confirm refresh),
    // settle on their own - this test is about the FIRST call never
    // overlapping a second one, not about holding every call forever.
    setMode('resolve')
    resolvePending()
    await vi.advanceTimersByTimeAsync(0)
    expect(extensions(calls)).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(EXTEND_AT_MOST_EVERY_MS) // t = 5:00
    expect(extensions(calls)).toHaveLength(2) // the 3 keydowns above were not lost
  })

  it('confirms each extension with one plain refresh ten seconds later, then stays quiet with no more input', async () => {
    const { client, calls } = fakeClient()
    keepStytchSessionFresh(client, doc as unknown as Document)

    doc.fire('pointerdown')
    await vi.advanceTimersByTimeAsync(0) // let the extension resolve and arm its confirm timer

    await vi.advanceTimersByTimeAsync(CONFIRM_AFTER_EXTENSION_MS - 1)
    expect(plainRefreshes(calls)).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1)
    expect(plainRefreshes(calls)).toHaveLength(1)
    expect(calls.at(-1)?.args).toEqual([])

    await vi.advanceTimersByTimeAsync(60 * 60_000) // an hour, untouched
    expect(calls).toHaveLength(2) // the one extension, and its one confirm - nothing more
  })

  it('retries a failed extension after a minute with no fresh input needed, and never leaves the rejection unhandled', async () => {
    const { client, calls, setMode } = fakeClient()
    setMode('reject')
    keepStytchSessionFresh(client, doc as unknown as Document)

    // Node's own `process` (this test runs under Vitest in Node, jsdom or
    // not). Typed by hand because `src/`'s tsconfig carries no Node types.
    const nodeProcess = (
      globalThis as unknown as {
        process: {
          on(event: 'unhandledRejection', listener: (reason: unknown) => void): void
          off(event: 'unhandledRejection', listener: (reason: unknown) => void): void
        }
      }
    ).process
    const unhandled = vi.fn()
    nodeProcess.on('unhandledRejection', unhandled)
    try {
      doc.fire('pointerdown') // t = 0: the attempt that will fail
      await vi.advanceTimersByTimeAsync(0)
      expect(extensions(calls)).toHaveLength(1)

      await vi.advanceTimersByTimeAsync(10_000) // t = 0:10
      doc.fire('pointerdown')
      await vi.advanceTimersByTimeAsync(20_000) // t = 0:30
      doc.fire('pointerdown')
      expect(extensions(calls)).toHaveLength(1) // still just the one failed attempt

      setMode('resolve')
      await vi.advanceTimersByTimeAsync(RETRY_FAILED_EXTENSION_MS - 30_000) // t = 1:00
      expect(extensions(calls)).toHaveLength(2) // the retry, no fresh input required

      await vi.advanceTimersByTimeAsync(CONFIRM_AFTER_EXTENSION_MS)
      expect(plainRefreshes(calls)).toHaveLength(1) // its confirm

      // Node reports an unhandled rejection once the microtask queue drains,
      // which every `advanceTimersByTimeAsync` above already did.
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      nodeProcess.off('unhandledRejection', unhandled)
    }
  })

  it('swallows a rejected visibility refresh with no unhandled rejection, and never retries it by itself', async () => {
    const { client, calls, setMode } = fakeClient()
    setMode('reject')
    keepStytchSessionFresh(client, doc as unknown as Document)

    const nodeProcess = (
      globalThis as unknown as {
        process: {
          on(event: 'unhandledRejection', listener: (reason: unknown) => void): void
          off(event: 'unhandledRejection', listener: (reason: unknown) => void): void
        }
      }
    ).process
    const unhandled = vi.fn()
    nodeProcess.on('unhandledRejection', unhandled)
    try {
      doc.setVisibility('visible')
      doc.fire('visibilitychange')
      await vi.advanceTimersByTimeAsync(0)

      expect(calls).toHaveLength(1)
      expect(calls[0]?.args).toEqual([])
      expect(extensions(calls)).toHaveLength(0)

      await vi.advanceTimersByTimeAsync(60 * 60_000)
      expect(calls).toHaveLength(1) // never retried by itself

      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      nodeProcess.off('unhandledRejection', unhandled)
    }
  })

  it('extends right after a pending visibility refresh settles, never while it is still in flight', async () => {
    const { client, calls, setMode, resolvePending, maxPendingAtOnce } = fakeClient()
    setMode('hold')
    keepStytchSessionFresh(client, doc as unknown as Document)

    doc.setVisibility('visible')
    doc.fire('visibilitychange') // the refresh goes out and hangs
    expect(calls).toHaveLength(1)

    doc.fire('pointerdown') // input arrives while it is still in flight
    expect(calls).toHaveLength(1)

    setMode('resolve')
    resolvePending()
    await vi.advanceTimersByTimeAsync(0)

    expect(extensions(calls)).toHaveLength(1)
    expect(maxPendingAtOnce()).toBe(1) // never more than one call in flight at once
  })

  it('adds no refresh when the tab becomes visible while an extension is already in flight', () => {
    const { client, calls, setMode } = fakeClient()
    setMode('hold')
    keepStytchSessionFresh(client, doc as unknown as Document)

    doc.fire('pointerdown') // the extension goes out and hangs
    expect(calls).toHaveLength(1)

    doc.setVisibility('visible')
    doc.fire('visibilitychange')
    expect(calls).toHaveLength(1)
  })

  it('does not extend, or refresh on becoming visible, when the SDK holds no cached session', async () => {
    const { client, calls } = fakeClient({ hasSession: false })
    keepStytchSessionFresh(client, doc as unknown as Document)

    doc.fire('pointerdown')
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(calls).toHaveLength(0)

    doc.setVisibility('visible')
    doc.fire('visibilitychange')
    expect(calls).toHaveLength(0)
  })

  it('calls onEnded when the SDK reports the session is gone', () => {
    const { client, fireOnChange } = fakeClient()
    const onEnded = vi.fn()
    keepStytchSessionFresh(client, doc as unknown as Document, onEnded)

    fireOnChange(null)
    expect(onEnded).toHaveBeenCalledTimes(1)

    // A real session coming through must not be mistaken for the end of one.
    fireOnChange({})
    expect(onEnded).toHaveBeenCalledTimes(1)
  })

  it("does not call onEnded while the member's own sign-out is in progress", () => {
    // `revoke({ forceClear: true })` (stytchSignOut.ts) clears the local
    // session - firing this exact callback with `null` - before that
    // function's own reload runs. Calling `onEnded` here too would only flash
    // the sign-in screen's lazy chunk in the instant before that reload.
    isStytchSignOutInProgress.mockReturnValue(true)
    const { client, fireOnChange } = fakeClient()
    const onEnded = vi.fn()
    keepStytchSessionFresh(client, doc as unknown as Document, onEnded)

    fireOnChange(null)
    expect(onEnded).not.toHaveBeenCalled()
  })

  it("does not extend the session while the member's own sign-out is in progress", async () => {
    // Not just an onEnded concern: extending a session that is about to be
    // revoked anyway would be a wasted call at best, and a confusing one to
    // read in the network log while debugging a sign-out.
    isStytchSignOutInProgress.mockReturnValue(true)
    const { client, calls } = fakeClient()
    keepStytchSessionFresh(client, doc as unknown as Document)

    doc.fire('pointerdown')
    await vi.advanceTimersByTimeAsync(0)
    expect(extensions(calls)).toHaveLength(0)
  })

  it('does nothing when onEnded is not given, even if the session ends', () => {
    const { client, fireOnChange } = fakeClient()
    expect(() => {
      keepStytchSessionFresh(client, doc as unknown as Document)
      fireOnChange(null)
    }).not.toThrow()
  })

  it('cleans up everything on stop, even with a trailing extend timer pending', async () => {
    const { client, calls, unsubscribeCallCount } = fakeClient()
    const stop = keepStytchSessionFresh(client, doc as unknown as Document)

    doc.fire('pointerdown') // t = 0: the leading extension
    await vi.advanceTimersByTimeAsync(60_000) // t = 1:00
    doc.fire('pointerdown') // arms the trailing extend timer for t = 5:00

    stop()

    expect(doc.listenerTypes()).toEqual([])
    expect(unsubscribeCallCount()).toBe(1)
    expect(vi.getTimerCount()).toBe(0)

    // Once stopped, neither kind of event should reach into the torn-down
    // client - the extension's own confirm refresh (10s earlier) already
    // happened on its own and is not what this checks.
    const callsBeforeStop = calls.length
    doc.fire('pointerdown')
    doc.setVisibility('visible')
    doc.fire('visibilitychange')
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toHaveLength(callsBeforeStop)

    stop() // calling it twice is harmless
    expect(unsubscribeCallCount()).toBe(1)
  })

  it('schedules nothing when a call settles after stop', async () => {
    const { client, calls, setMode, resolvePending } = fakeClient()
    setMode('hold')
    const stop = keepStytchSessionFresh(client, doc as unknown as Document)

    doc.fire('pointerdown') // the extension goes out and hangs
    stop()
    resolvePending()
    await vi.advanceTimersByTimeAsync(0)

    expect(vi.getTimerCount()).toBe(0) // no confirm timer armed after the fact

    await vi.advanceTimersByTimeAsync(60 * 60_000)
    expect(calls).toHaveLength(1) // nothing further was ever called
  })

  it('leaves exactly one live instance across a StrictMode-style start/stop/start', () => {
    const { client, calls } = fakeClient()
    const stopA = keepStytchSessionFresh(client, doc as unknown as Document)
    stopA()
    keepStytchSessionFresh(client, doc as unknown as Document)

    doc.fire('pointerdown')
    expect(extensions(calls)).toHaveLength(1) // not 2 - A's listeners are really gone
    expect(doc.listenerTypes()).toEqual(['keydown', 'pointerdown', 'visibilitychange', 'wheel'])
  })
})
