/**
 * Keeps a member's Stytch session alive while they are actually using the
 * studio, and lets it end about an hour after they stop.
 *
 * Two different jobs live here, and it matters that they stay separate:
 *
 * - REFRESH: importing this module - not calling anything in it - is what
 *   starts the JWT refresh: `stytchClient.ts`'s constructor already calls
 *   `performBackgroundRefresh()` immediately when the `stytch_session` cookie
 *   exists (`StytchB2BClient.mjs`), and its `SessionManager` then re-runs that
 *   every three minutes on its own (`SessionManager.mjs`'s
 *   `REFRESH_INTERVAL_MS`). A tab's timers do not fire while it is suspended
 *   (mobile Safari backgrounding, laptop sleep), so a long-asleep tab can wake
 *   up with a JWT older than the SDK thinks it is - `onVisible` below catches
 *   that case with a plain refresh, no different from what the SDK's own
 *   timer would have done if it had been running.
 * - EXTEND: a plain refresh never changes when the session itself expires -
 *   see `SESSION_IDLE_TIMEOUT_MINUTES`'s own comment on `stytchClient.ts`. So
 *   after the member's first real click, key press or scroll, this module
 *   calls `authenticate({ session_duration_minutes: SESSION_IDLE_TIMEOUT_MINUTES })`,
 *   which resets the session's expiry to that many minutes from now
 *   (`stytchClient.ts` explains why the SDK's own `keepSessionAlive` option is
 *   not used for this instead). It does this AT MOST once every
 *   `EXTEND_AT_MOST_EVERY_MS`, so a session stays alive for as long as the
 *   member keeps working and ends 55-65 minutes after their last input -
 *   never merely because a tab was left open and untouched.
 *
 * `PasswordGate.tsx` reaches this file through a dynamic `import()`, only once
 * the gate is open in Stytch mode - never in developer, password or Access
 * mode, and never before the gate has actually opened. That keeps this out of
 * the first download exactly like `stytchSignOut.ts` (see
 * `scripts/check-worker-bundle.mjs`), even though, unlike that file, nothing
 * here names the SDK package directly - it only imports `stytchClient.ts`.
 */
import { SESSION_IDLE_TIMEOUT_MINUTES, stytchClient as defaultClient } from './stytchClient'
import { isStytchSignOutInProgress } from './stytchSignOut'

/** The parts of the Stytch client this module actually touches. */
interface KeepAliveClient {
  readonly session: {
    getSync(): unknown
    /** Called with no argument for a plain refresh, or a duration to extend the session. */
    authenticate(options?: { readonly session_duration_minutes: number }): Promise<unknown>
    onChange(callback: (session: unknown) => void): () => void
  }
}

/**
 * What counts as "the member is using the studio". Capture-phase and passive:
 *
 * - `capture: true` means this module sees the event before anything inside
 *   the studio (the editor, a Radix menu, ProseMirror) can hide it by calling
 *   `stopPropagation()`. Missing input would mean crediting a member with LESS
 *   activity than they actually did - exactly the failure this module exists
 *   to avoid.
 * - `passive: true` means the browser never waits on this listener before it
 *   scrolls, so watching for activity never costs a frame of jank.
 *
 * Deliberately NOT `pointermove`, `mousemove` or `scroll`: they fire far too
 * often to be a useful "the member is here" signal (a mouse resting near the
 * window edge, a scrollbar being dragged past) and hovering something is not
 * the same as using it.
 */
export const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel'] as const

/** Capture-phase and passive - see `ACTIVITY_EVENTS`'s own comment for why. */
const LISTENER_OPTIONS: AddEventListenerOptions = { capture: true, passive: true }

/**
 * How often an extension is allowed to go out, at most, per tab.
 *
 * The leading call happens on the member's first input and extends right
 * away; a trailing call credits whatever they did in the final stretch before
 * they stop. Together those give the 55-65 minute bound described in the
 * module comment - N minutes of slack in either direction, in exchange for at
 * most one extra network call every N minutes from an actively used tab. See
 * docs/STYTCH_LOG.md decision 1 for why N is 5.
 */
export const EXTEND_AT_MOST_EVERY_MS = 5 * 60_000

/**
 * How long to wait before trying an extension again after one fails (a
 * network blip, most likely). The member's input is not lost while this
 * waits - `usedSinceExtension` below stays `true` until an extension actually
 * succeeds, so the very next attempt (this timer, or the member's next
 * keystroke) tries again automatically.
 */
export const RETRY_FAILED_EXTENSION_MS = 60_000

/**
 * A plain refresh, sent this long after every successful extension.
 *
 * Stytch's own background refresh (the SDK's independent three-minute timer)
 * can race this module's extension: if Stytch answers that OTHER refresh
 * before this module's extension call, but the answer arrives after it, the
 * SDK writes the OLDER `expires_at` back into both session cookies - it only
 * guards on which session id the response is for, not which request went out
 * first or last (`SubscriptionService.mjs`). This confirm refresh, sent a
 * few seconds later, asks again and overwrites the cookies with whatever
 * Stytch now actually has on file, closing that window.
 */
export const CONFIRM_AFTER_EXTENSION_MS = 10_000

/**
 * Starts the keep-alive and returns a cleanup function.
 *
 * `client` and `doc` are overridable for tests only; every real caller leaves
 * them at their defaults, which is what makes `client` the same instance
 * `StytchSignIn.tsx` and `stytchSignOut.ts` use (see `stytchClient.ts`'s
 * module comment on why a second instance would be worse than none).
 *
 * `onEnded`, if given, fires once the session is really gone (signed out
 * elsewhere, or an hour without use) - not on every refresh - so the gate can
 * show sign-in again instead of leaving a dead session parked behind an open
 * studio. It does NOT fire while the member's own sign-out
 * (`stytchSignOut.ts`) is still revoking: that call is already reloading the
 * page once it finishes, so firing here too would only flash the sign-in
 * screen's lazy chunk in the instant before that reload happens anyway.
 *
 * All of this module's state lives in this function's closure, not at module
 * scope, so starting, stopping and starting again (React's StrictMode in
 * development, or a real remount) never leaks a listener or a timer from the
 * previous instance into the next one.
 */
export function keepStytchSessionFresh(
  client: KeepAliveClient | null = defaultClient,
  doc: Document = document,
  onEnded?: () => void,
): () => void {
  if (!client) return () => undefined

  const { session } = client
  let stopped = false
  // True while an `authenticate()` call from THIS module is in flight. Every
  // call this module makes - a plain refresh or an extension - sets this, so
  // the two can never overlap: an extension due while a refresh is pending
  // waits for it to settle, and a refresh due while an extension is pending
  // is simply skipped (there is nothing for it to add once the extension's
  // own confirm refresh runs).
  let busy = false
  // Set by real input, cleared once an extension actually succeeds for it.
  let usedSinceExtension = false
  let lastExtensionAt = Number.NEGATIVE_INFINITY
  let retryAt = Number.NEGATIVE_INFINITY
  let extendTimer: number | undefined
  let confirmTimer: number | undefined

  /**
   * Runs `request`, turns a rejection into `false` instead of letting it
   * surface as an unhandled rejection, then lets `after` react to whether it
   * succeeded. Also re-checks `maybeExtend` once `busy` clears, so input that
   * arrived while this call was in flight is not lost.
   */
  const settle = (request: Promise<unknown>, after: (ok: boolean) => void) => {
    busy = true
    void request
      .then(
        () => true,
        () => false,
      )
      .then((ok) => {
        busy = false
        if (stopped) return
        after(ok)
        maybeExtend()
      })
  }

  /** A plain JWT refresh - used on waking up and to confirm an extension. Never extends the session. */
  const refresh = () => {
    if (stopped || busy || !session.getSync()) return
    settle(session.authenticate(), () => undefined)
  }

  /**
   * Sends an extension if the member has done something since the last one
   * and the throttle has cleared; otherwise arms a timer for whichever
   * deadline (the throttle, or a failed attempt's retry) is later, so a tab
   * that stops receiving input still tries again on its own.
   */
  function maybeExtend(): void {
    if (stopped || busy || !usedSinceExtension) return
    // A session about to be revoked is not worth extending - the call would
    // either race the revoke for nothing, or read as a confusing extra entry
    // in the network log while debugging a sign-out.
    if (isStytchSignOutInProgress()) return

    const now = Date.now()
    const dueAt = Math.max(lastExtensionAt + EXTEND_AT_MOST_EVERY_MS, retryAt)
    if (now < dueAt) {
      if (extendTimer === undefined) {
        extendTimer = window.setTimeout(() => {
          extendTimer = undefined
          maybeExtend()
        }, dueAt - now)
      }
      return
    }

    // No live session to extend - `onEnded` (via `onChange` below) is what
    // owns telling the caller that.
    if (!session.getSync()) return

    window.clearTimeout(extendTimer)
    extendTimer = undefined
    usedSinceExtension = false
    settle(session.authenticate({ session_duration_minutes: SESSION_IDLE_TIMEOUT_MINUTES }), (ok) => {
      if (ok) {
        lastExtensionAt = now
        window.clearTimeout(confirmTimer)
        confirmTimer = window.setTimeout(() => {
          confirmTimer = undefined
          refresh()
        }, CONFIRM_AFTER_EXTENSION_MS)
      } else {
        // Credit the input again so the very next attempt - this retry, or
        // the member's next keystroke, whichever comes first - picks it up.
        usedSinceExtension = true
        retryAt = Date.now() + RETRY_FAILED_EXTENSION_MS
      }
    })
  }

  const onActivity = () => {
    usedSinceExtension = true
    maybeExtend()
  }

  // Becoming visible is NOT use: alt-tabbing back to a studio tab, or
  // restoring a minimised window, must never by itself extend a session -
  // only the member's first real click or key press after that does. This
  // keeps its `onVisible` job from before this module could extend anything
  // at all: a plain refresh, nothing more.
  const onVisible = () => {
    if (doc.visibilityState === 'visible') refresh()
  }

  for (const type of ACTIVITY_EVENTS) doc.addEventListener(type, onActivity, LISTENER_OPTIONS)
  doc.addEventListener('visibilitychange', onVisible)

  const unsubscribe = session.onChange((current) => {
    if (!current && !isStytchSignOutInProgress()) onEnded?.()
  })

  return () => {
    if (stopped) return
    stopped = true
    for (const type of ACTIVITY_EVENTS) doc.removeEventListener(type, onActivity, LISTENER_OPTIONS)
    doc.removeEventListener('visibilitychange', onVisible)
    window.clearTimeout(extendTimer)
    window.clearTimeout(confirmTimer)
    unsubscribe()
  }
}
