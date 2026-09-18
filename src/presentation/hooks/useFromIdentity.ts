/**
 * The From address the send server is configured with, or null.
 *
 * Presentation layer: React wiring around one `EmailProvider.getStatus()` call.
 * The sender is NOT template data (docs/ARCHITECTURE.md): the studio shows what
 * the server says, and shows nothing while it is disconnected. `StudioPage`
 * calls it ONCE and passes the address down to the envelope panel and the
 * preview's summary; two callers would mean two requests that can answer
 * differently, and the address on screen would depend on which view you look at.
 */
import { useEffect, useState } from 'react'
import type { EmailProvider } from '@/infrastructure/providers/emailProvider'

export function useFromIdentity(provider: EmailProvider): string | null {
  const [from, setFrom] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void provider.getStatus().then((status) => {
      if (!cancelled && status.connected) setFrom(status.from)
    })
    return () => {
      cancelled = true
    }
  }, [provider])

  return from
}
