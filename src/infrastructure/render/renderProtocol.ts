/**
 * Messages exchanged between the main thread and the render worker.
 * Keeping them in one file documents the contract in a single place.
 */
import type { PreviewPayload, RenderResult } from '@/domain'

export interface RenderRequestMessage {
  readonly type: 'render'
  readonly id: number
  readonly source: string
  readonly props: PreviewPayload
}

export interface RenderResponseMessage {
  readonly type: 'result'
  readonly id: number
  /**
   * Both parts of the email at once: `result.html` and `result.text` come from
   * the same render, so nothing downstream can pair one with the other's source
   * (ADR-25). One request, one message, one answer.
   */
  readonly result: RenderResult
}
