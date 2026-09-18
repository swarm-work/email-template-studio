/**
 * The storage port for uploaded images, plus an in-memory implementation.
 *
 * Server layer, runtime-neutral: the types are STRUCTURAL, so Cloudflare's
 * `R2Bucket` satisfies `ObjectStore` without this file importing anything from
 * Cloudflare. Imports nothing at all.
 */

/** What `get` hands back: the bytes plus the content type they were stored with. */
export interface StoredObject {
  readonly body: ReadableStream | ArrayBuffer
  readonly httpMetadata?: { readonly contentType?: string }
}

/**
 * The slice of R2 this app uses. `put` takes the whole body in memory, which is
 * fine because uploads are capped at 2 MB (MAX_UPLOAD_BYTES).
 */
export interface ObjectStore {
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>
  get(key: string): Promise<StoredObject | null>
}

/** An ObjectStore backed by a Map, for tests and for any runtime without R2. */
export class InMemoryObjectStore implements ObjectStore {
  readonly #objects = new Map<string, { body: ArrayBuffer; contentType?: string }>()

  async put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown> {
    this.#objects.set(key, { body: value, contentType: options?.httpMetadata?.contentType })
    return undefined
  }

  async get(key: string): Promise<StoredObject | null> {
    const object = this.#objects.get(key)
    if (!object) return null
    return { body: object.body, httpMetadata: { contentType: object.contentType } }
  }

  /** Test helper: how many objects are stored. */
  get size(): number {
    return this.#objects.size
  }
}
