/**
 * The two things the studio has to ask the send server before it can draw
 * itself: which address email is sent from, and which features are switched on.
 *
 * Presentation layer: React wiring around one `EmailProvider.getStatus()` call.
 * The sender is NOT template data (docs/ARCHITECTURE.md), and the feature flags
 * are not build-time constants (docs/DEPLOYMENT.md) — both belong to the
 * server. `StudioPage` calls this ONCE and passes the answers down: two callers
 * would mean two requests that can answer differently, and what you saw would
 * depend on which panel you looked at.
 */
import { useEffect, useState } from 'react'
import { DEFAULT_STUDIO_FEATURES, type StudioFeatures } from '@/domain'
import type { EmailProvider } from '@/infrastructure/providers/emailProvider'

export interface SendServerStatus {
  /** The configured From address, or null while the server is unreachable. */
  readonly from: string | null
  readonly features: StudioFeatures
  /**
   * False until the server has answered. Anything that is EXPENSIVE to undo —
   * downloading the 2.5 MB editor, say — waits for this; anything cheap just
   * uses the optimistic defaults below.
   */
  readonly ready: boolean
}

/**
 * Features start at "everything on" rather than "everything off": the studio
 * would otherwise flash a read-only banner on every load, and the flag exists
 * to switch something off deliberately, not by accident of timing.
 */
const INITIAL: SendServerStatus = { from: null, features: DEFAULT_STUDIO_FEATURES, ready: false }

export function useSendServerStatus(provider: EmailProvider): SendServerStatus {
  const [status, setStatus] = useState<SendServerStatus>(INITIAL)

  useEffect(() => {
    let cancelled = false
    void provider
      .getStatus()
      .then((result) => {
        if (cancelled) return
        setStatus({ from: result.connected ? result.from : null, features: result.features, ready: true })
      })
      // A provider that REJECTS must not leave `ready` false for ever: the
      // canvas waits on it, so a visual template would sit on the loading
      // skeleton with nothing on screen to explain it. Degrading to the
      // optimistic defaults shows the editor and lets it report its own
      // failure, which is a far better answer than a permanent skeleton.
      .catch(() => {
        if (cancelled) return
        setStatus({ from: null, features: DEFAULT_STUDIO_FEATURES, ready: true })
      })
    return () => {
      cancelled = true
    }
  }, [provider])

  return status
}
