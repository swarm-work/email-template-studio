/**
 * The sender contract and the dry-run sender.
 *
 * `EmailSender` is deliberately tiny so the HTTP layer can be tested with a
 * fake, and so a dry-run sender can exercise the whole path without AWS.
 * This file is runtime neutral (no `node:*` imports): it runs in Node and in
 * a Cloudflare Worker. The Amazon SES implementation lives in `sesSender.ts`.
 */

export interface TestEmail {
  readonly from: string
  /** One or more recipients, all in the To header of a single message. */
  readonly to: readonly string[]
  readonly subject: string
  readonly html: string
  /**
   * The plain-text alternative part. Absent or empty means the message goes out
   * as HTML only, which is what every send did before phase 6.
   */
  readonly text?: string
  /**
   * Reply-To addresses. Absent means replies go to `from`. Not a recipient: SES
   * delivers nothing here, it only writes the header.
   */
  readonly replyTo?: readonly string[]
}

export interface SendReceipt {
  readonly messageId: string
}

/** Read-only checks run before any send, so misconfiguration is explained up front. */
export interface SenderPreflight {
  readonly ok: boolean
  readonly message: string
  /** True while the SES account is in the sandbox (recipients must be verified). */
  readonly sandbox?: boolean
  /** Verification status of the from identity (address or its domain). */
  readonly identityVerified?: boolean
  readonly dailyQuota?: number
  readonly sentLast24Hours?: number
}

export interface EmailSender {
  readonly mode: 'live' | 'dry-run'
  send(email: TestEmail): Promise<SendReceipt>
  preflight(from: string): Promise<SenderPreflight>
}

/** Logs instead of sending. Used for local rehearsal and end-to-end tests. */
export function createDryRunSender(log: (line: string) => void = console.log): EmailSender {
  let counter = 0
  return {
    mode: 'dry-run',
    async send(email) {
      counter += 1
      // As long as a real SES message id (about 60 characters) and with no
      // line-break opportunity inside it, which is how Firefox and Safari
      // treat a real id (UAX #14 never breaks between a hyphen and a digit).
      // The UI must cope with that shape, so the rehearsal produces it too.
      const messageId = `dry-run-${counter}-${randomHex(26)}`
      // The rehearsal has to show the parts a real send would carry, or a
      // dry run cannot tell you that the reply-to you typed arrived.
      const replyTo = email.replyTo?.length ? ` reply-to ${email.replyTo.join(', ')}` : ''
      const text = ` + ${email.text?.length ?? 0} chars text`
      log(
        `[dry-run] would send "${email.subject}" from ${email.from} to ${email.to.join(', ')}${replyTo} (${email.html.length} chars html${text}) -> ${messageId}`,
      )
      return { messageId }
    },
    async preflight() {
      return { ok: true, message: 'Dry run: no AWS calls are made.' }
    },
  }
}

/** `bytes` random bytes as lowercase hex, using the Web Crypto API (Node 20+ and Workers). */
function randomHex(bytes: number): string {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes))
  return Array.from(buffer, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
