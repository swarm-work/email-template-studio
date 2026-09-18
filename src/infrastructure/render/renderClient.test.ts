/**
 * What the renderer does when the worker misbehaves.
 *
 * Infrastructure layer test, node environment: `WorkerTemplateRenderer` takes an
 * injectable `createWorker`, so a fake stands in for the real Web Worker and no
 * DOM is needed. The rendering itself is covered by `renderTemplate.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { WorkerTemplateRenderer } from './renderClient'

/** The smallest thing the renderer will talk to, plus a way to make it crash. */
class FakeWorker {
  readonly listeners = new Map<string, (event: unknown) => void>()

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, listener)
  }
  removeEventListener(type: string): void {
    this.listeners.delete(type)
  }
  postMessage(): void {}
  terminate(): void {}

  /** Fires the `error` event a worker that cannot boot would fire. */
  crash(): void {
    this.listeners.get('error')?.({ message: 'boot failed' })
  }
}

function fakeWorkers() {
  const created: FakeWorker[] = []
  const renderer = new WorkerTemplateRenderer(() => {
    const worker = new FakeWorker()
    created.push(worker)
    return worker as unknown as Worker
  })
  return { renderer, created }
}

describe('WorkerTemplateRenderer crash recovery', () => {
  it('starts a replacement after a crash, so the next render is not charged for the boot', () => {
    const { renderer, created } = fakeWorkers()
    renderer.warmUp()
    expect(created).toHaveLength(1)

    created[0].crash()
    expect(created).toHaveLength(2)
  })

  it('stops respawning a worker that keeps crashing instead of looping on the bundle', () => {
    const { renderer, created } = fakeWorkers()
    renderer.warmUp()

    // Every replacement dies the way a missing or broken worker chunk would.
    for (let attempt = 0; attempt < 10; attempt += 1) created[created.length - 1].crash()

    // One warm-up plus the bounded number of crash restarts, and no more.
    expect(created).toHaveLength(3)
  })
})
