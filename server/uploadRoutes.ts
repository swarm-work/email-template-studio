/**
 * Image uploads for visual templates: `POST /api/uploads` and `GET /media/:key`.
 *
 * Server layer: Hono + the ObjectStore port, no R2 and no Node APIs. The editor
 * only offers its image node when an upload handler exists, and an email client
 * cannot render a `data:` URL, so images have to become real hosted files.
 *
 * `GET /media/:key` is registered OUTSIDE the `/api/*` auth middleware on
 * purpose: an image in a sent email is fetched by a stranger's mail client,
 * which has no session. The key is an unguessable uuid, and nothing secret is
 * ever uploaded here.
 */
import type { Context, Hono } from 'hono'
import type { Identity } from './auth.ts'
import { apiError } from './http.ts'
import type { ObjectStore } from './objectStore.ts'
import { STUDIO_API_HEADER } from '../shared/templateContracts.ts'
import {
  MAX_UPLOAD_BYTES,
  MEDIA_PATH_PREFIX,
  UPLOAD_CONTENT_TYPES,
  UPLOAD_FIELD_NAME,
  UPLOAD_KEY_PATTERN,
} from '../shared/templateContracts.ts'

type StudioEnv = { Variables: { identity: Identity } }
type UploadApp = Hono<StudioEnv>
type RouteContext = Context<StudioEnv>

export interface UploadRouteDependencies {
  /** `null` (or absent) means no bucket is bound, and uploads answer 503. */
  readonly objectStore?: ObjectStore | null
  /** Injectable key factory, so tests get predictable object keys. */
  readonly newAssetId?: () => string
  /**
   * How many uploads a minute this isolate accepts. Absent means unlimited,
   * which is what the Node adapter and most tests want; `createApp` always
   * supplies one.
   */
  readonly limiter?: { tryAcquire(): boolean }
}

/**
 * The first bytes of each format we accept. A browser will happily label a
 * renamed .exe as `image/png`, so the declared type is only a hint: what is
 * actually stored has to start with one of these signatures.
 */
/**
 * How much bigger than the image itself a multipart body may be: the boundary
 * lines, the headers of the part and any other small fields. Generous, because
 * this check only exists to refuse the absurd before the body is read.
 */
const MULTIPART_OVERHEAD_BYTES = 8_192

const MAGIC_BYTES: readonly { readonly contentType: string; readonly bytes: readonly number[] }[] = [
  { contentType: 'image/png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { contentType: 'image/jpeg', bytes: [0xff, 0xd8, 0xff] },
  { contentType: 'image/gif', bytes: [0x47, 0x49, 0x46, 0x38] },
  // WebP is "RIFF" + 4 size bytes + "WEBP"; the size bytes are skipped below.
  { contentType: 'image/webp', bytes: [0x52, 0x49, 0x46, 0x46] },
]

export function registerUploadRoutes(app: UploadApp, deps: UploadRouteDependencies): void {
  const { objectStore = null, newAssetId = () => crypto.randomUUID(), limiter } = deps

  app.post('/api/uploads', async (c) => {
    if (!objectStore) return storageUnavailable(c)
    // A multipart POST is the one shape a cross-site form CAN send, so the
    // studio header does all the CSRF work here.
    if (c.req.header(STUDIO_API_HEADER) !== '1') {
      return apiError(c, 400, 'bad-request', `Missing ${STUDIO_API_HEADER} header.`)
    }
    if (!c.req.header('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
      return apiError(c, 415, 'unsupported-media-type', 'Content-Type must be multipart/form-data.')
    }

    // Checked BEFORE the body is touched: `formData()` materialises the whole
    // upload in memory, so a 100 MB part would cost the isolate its memory
    // budget (128 MB in workerd) before a 413 could be written. A browser always
    // declares the length of a fetch body, so an absent header is refused too.
    const declaredBytes = Number(c.req.header('content-length'))
    if (!Number.isFinite(declaredBytes) || declaredBytes > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
      return tooLarge(c)
    }

    // Counted HERE, after the cheap doorman checks and before `formData()`.
    //
    // Before it, because parsing is the expensive step: `formData()` reads the
    // whole body into the isolate's memory, so a flood must be refused while it
    // is still only headers. After the header, content-type and content-length
    // checks, because a malformed request that never had a chance should not
    // spend a token that an honest one needs.
    if (limiter && !limiter.tryAcquire()) {
      return apiError(
        c,
        429,
        'rate-limited',
        'Too many uploads in the last minute. Wait a moment and try again.',
      )
    }

    let form: FormData
    try {
      form = await c.req.formData()
    } catch {
      return apiError(c, 400, 'bad-request', 'Request body must be a multipart form.')
    }

    const file = form.get(UPLOAD_FIELD_NAME)
    if (!(file instanceof File)) {
      return apiError(c, 400, 'bad-request', `Attach the image as the form field "${UPLOAD_FIELD_NAME}".`)
    }
    // The exact cap; the content-length check above is only the cheap doorman.
    if (file.size > MAX_UPLOAD_BYTES) return tooLarge(c)

    const extension = UPLOAD_CONTENT_TYPES[file.type.toLowerCase()]
    if (extension === undefined) {
      return apiError(
        c,
        415,
        'unsupported-media-type',
        `Images must be one of: ${Object.keys(UPLOAD_CONTENT_TYPES).join(', ')}.`,
      )
    }

    const bytes = await file.arrayBuffer()
    // Checked after the declared type, so the message can be specific, and
    // before anything is stored, so a mislabelled file never lands in R2.
    if (sniffContentType(bytes) !== file.type.toLowerCase()) {
      return apiError(c, 415, 'unsupported-media-type', 'That file is not the image format it claims to be.')
    }

    const key = `img_${newAssetId()}.${extension}`
    await objectStore.put(key, bytes, { httpMetadata: { contentType: file.type.toLowerCase() } })
    console.log(`[uploads] stored ${key} (${bytes.byteLength} bytes) by ${c.get('identity').email}`)

    // ABSOLUTE, because the <img src> ends up in someone's inbox, where there
    // is no page for a relative path to be resolved against.
    const url = new URL(`${MEDIA_PATH_PREFIX}${key}`, c.req.url).toString()
    return c.json({ url }, 201)
  })

  app.get(`${MEDIA_PATH_PREFIX}:key`, async (c) => {
    if (!objectStore) return storageUnavailable(c)
    const key = c.req.param('key')
    // Validated before the lookup: the key shape is the only thing standing
    // between this public route and someone probing the bucket.
    if (!UPLOAD_KEY_PATTERN.test(key)) return apiError(c, 404, 'not-found', 'No such image.')

    const object = await objectStore.get(key)
    if (!object) return apiError(c, 404, 'not-found', 'No such image.')

    return new Response(object.body, {
      headers: {
        'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
        // The key contains a uuid and the bytes behind it never change, so this
        // can be cached forever. A new image gets a new key.
        'cache-control': 'public, max-age=31536000, immutable',
      },
    })
  })
}

function storageUnavailable(c: RouteContext) {
  return apiError(c, 503, 'storage-unavailable', 'No image storage is configured for this server.')
}

function tooLarge(c: RouteContext) {
  return apiError(c, 413, 'payload-too-large', `Images must be ${MAX_UPLOAD_BYTES} bytes or smaller.`)
}

/** The content type the first bytes actually say this is, or null when unrecognised. */
export function sniffContentType(bytes: ArrayBuffer): string | null {
  const head = new Uint8Array(bytes)
  for (const format of MAGIC_BYTES) {
    if (format.bytes.every((byte, index) => head[index] === byte)) {
      // "RIFF" alone is any RIFF container (a .wav, say); WEBP names the codec.
      if (format.contentType === 'image/webp' && !startsWithAscii(head, 'WEBP', 8)) continue
      return format.contentType
    }
  }
  return null
}

function startsWithAscii(bytes: Uint8Array, text: string, offset: number): boolean {
  return [...text].every((character, index) => bytes[offset + index] === character.charCodeAt(0))
}
