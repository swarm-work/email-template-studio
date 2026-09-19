/**
 * Main-thread client for the render worker.
 *
 * Responsibilities:
 * - create the worker (warmed up at start-up; its boot counts against the timeout)
 * - give every request an id and resolve the matching promise
 * - enforce a timeout: terminate the worker and report a `timeout` error
 * - recover from a timeout or a crash by starting a replacement straight away
 */
import type { PreviewPayload, RenderResult } from '@/domain'
import type { RenderRequestMessage, RenderResponseMessage } from './renderProtocol'

export interface RenderOptions {
  /** How long a single render may take before the worker is killed. */
  readonly timeoutMs?: number
}

export const DEFAULT_RENDER_TIMEOUT_MS = 5000

/**
 * How many crashes in a row may be answered by starting a replacement worker
 * before we give up and wait for the next render. Two is enough to survive a
 * one-off crash without turning a worker that can never boot into a loop.
 */
const MAX_CRASH_RESTARTS = 2

interface PendingRequest {
  readonly resolve: (result: RenderResult) => void
  readonly timer: ReturnType<typeof setTimeout>
}

export interface TemplateRenderer {
  render(source: string, props: PreviewPayload, options?: RenderOptions): Promise<RenderResult>
  /**
   * Starts the worker before anything needs rendering. Optional, and safe to
   * call more than once: a renderer with nothing to warm can leave it out.
   */
  warmUp?(): void
  dispose(): void
}

export class WorkerTemplateRenderer implements TemplateRenderer {
  private worker: Worker | null = null
  private nextId = 1
  /** Crashes since a worker last answered; see `handleError`. */
  private crashRestarts = 0
  private readonly pending = new Map<number, PendingRequest>()
  private readonly createWorker: () => Worker

  /** `createWorker` is injectable so tests can supply a fake worker. */
  constructor(createWorker: () => Worker = createRenderWorker) {
    this.createWorker = createWorker
  }

  render(source: string, props: PreviewPayload, options: RenderOptions = {}): Promise<RenderResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS
    const worker = this.ensureWorker()
    const id = this.nextId++

    return new Promise<RenderResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.restart('The preview worker was restarted after a timeout.')
        // Start the replacement now: the next render should not be charged for
        // booting a worker on top of its own time budget.
        this.warmUp()
        resolve({
          ok: false,
          error: {
            kind: 'timeout',
            message: `Rendering was stopped after ${timeoutMs / 1000}s. Check the template for infinite loops or very large output.`,
          },
        })
      }, timeoutMs)

      this.pending.set(id, { resolve, timer })
      const request: RenderRequestMessage = { type: 'render', id, source, props }
      worker.postMessage(request)
    })
  }

  /**
   * Boots the worker ahead of the first render.
   *
   * The worker bundle is megabytes of compiler and React Email, and fetching
   * and parsing it happens INSIDE the render timeout — so on a cold, slow
   * machine the very first preview could be killed at 5 s and wrongly reported
   * as an infinite loop. The studio now opens on the library, which means that
   * first render no longer overlaps with page load, so the app asks for the
   * worker as soon as it starts instead of waiting for a template to be opened.
   */
  warmUp(): void {
    this.ensureWorker()
  }

  dispose(): void {
    this.restart('The preview renderer was disposed.')
  }

  private ensureWorker(): Worker {
    if (this.worker === null) {
      this.worker = this.createWorker()
      this.worker.addEventListener('message', this.handleMessage)
      this.worker.addEventListener('error', this.handleError)
    }
    return this.worker
  }

  private readonly handleMessage = (event: MessageEvent<RenderResponseMessage>): void => {
    if (event.data?.type !== 'result') return
    const entry = this.pending.get(event.data.id)
    if (!entry) return
    // This worker booted and answered, so the crash budget is whole again.
    this.crashRestarts = 0
    clearTimeout(entry.timer)
    this.pending.delete(event.data.id)
    entry.resolve(event.data.result)
  }

  private readonly handleError = (event: ErrorEvent): void => {
    this.crashRestarts += 1
    this.restart(
      event.message ? `The preview worker crashed: ${event.message}` : 'The preview worker crashed.',
    )
    // A worker that cannot start at all (a missing chunk after a bad deploy, a
    // blocked module worker) fires `error` on its replacement too, so warming
    // up unconditionally would refetch a multi-megabyte bundle in a hot loop.
    // After a couple of tries we stop, and the next `render()` creates one
    // lazily — which puts the retry rate back in the user's hands.
    if (this.crashRestarts <= MAX_CRASH_RESTARTS) this.warmUp()
  }

  /** Terminates the worker and fails every in-flight request with a `worker` error. */
  private restart(reason: string): void {
    this.worker?.removeEventListener('message', this.handleMessage)
    this.worker?.removeEventListener('error', this.handleError)
    this.worker?.terminate()
    this.worker = null
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer)
      entry.resolve({ ok: false, error: { kind: 'worker', message: reason } })
    }
    this.pending.clear()
  }
}

function createRenderWorker(): Worker {
  // Vite recognises this pattern and bundles the worker as its own chunk.
  return new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' })
}
