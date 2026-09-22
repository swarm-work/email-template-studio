import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, UPLOADS_PER_MINUTE } from './app.ts'
import { createDeveloperAuthenticator, createDisabledAuthenticator } from './auth.ts'
import type { SendServerConfig } from './config.ts'
import { InMemoryObjectStore } from './objectStore.ts'
import { sniffContentType } from './uploadRoutes.ts'
import {
  apiErrorSchema,
  MAX_UPLOAD_BYTES,
  MEDIA_PATH_PREFIX,
  STUDIO_API_HEADER,
  UPLOAD_FIELD_NAME,
  uploadResponseSchema,
} from '../shared/templateContracts.ts'

const config: SendServerConfig = { enabled: false, port: 8787, reason: 'not under test' }
const HOST = '127.0.0.1:8787'
const FORM_HEADERS = { host: HOST, [STUDIO_API_HEADER]: '1' }

/** The first bytes of each real format, padded out to something file-sized. */
const SIGNATURES: Readonly<Record<string, number[]>> = {
  'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  'image/jpeg': [0xff, 0xd8, 0xff, 0xe0],
  'image/gif': [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  // "RIFF" + four size bytes + "WEBP"
  'image/webp': [0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50],
}

function imageBytes(contentType: string, totalBytes = 64): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(totalBytes))
  bytes.set(SIGNATURES[contentType] ?? [], 0)
  return bytes
}

function makeApp(objectStore: InMemoryObjectStore | null = new InMemoryObjectStore()) {
  const app = createApp({
    config,
    sender: null,
    authenticator: createDeveloperAuthenticator('tester@example.test'),
    objectStore,
    // Fixed clock: nothing here depends on the time, but a wandering one has no
    // place in a test either.
    now: () => Date.UTC(2026, 8, 18),
  })
  return { app, objectStore }
}

/**
 * Posts one multipart form the way a browser would, Content-Length included.
 * `new Request(…, { body: formData })` does not set that header, but every real
 * client does, and the route refuses an upload that does not declare its size.
 */
async function upload(
  app: ReturnType<typeof createApp>,
  file: File | string,
  headers: Record<string, string> = FORM_HEADERS,
  fieldName = UPLOAD_FIELD_NAME,
) {
  const form = new FormData()
  form.set(fieldName, file)
  const encoded = new Request('http://localhost/api/uploads', { method: 'POST', body: form })
  const body = await encoded.arrayBuffer()
  return app.request('/api/uploads', {
    method: 'POST',
    // The caller's own headers win, so the guard tests can still leave one out.
    headers: {
      'content-type': encoded.headers.get('content-type') ?? '',
      'content-length': String(body.byteLength),
      ...headers,
    },
    body,
  })
}

describe('POST /api/uploads rate limiting', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  /** One PNG upload, small enough that only the limiter can refuse it. */
  function png() {
    return new File([imageBytes('image/png')], 'a.png', { type: 'image/png' })
  }

  it('refuses the upload after the limit and lets an earlier one through', async () => {
    const { app, objectStore } = makeApp()
    const accepted: number[] = []
    for (let attempt = 0; attempt < UPLOADS_PER_MINUTE; attempt += 1) {
      accepted.push((await upload(app, png())).status)
    }
    expect(accepted.every((status) => status === 201)).toBe(true)
    expect(objectStore!.size).toBe(UPLOADS_PER_MINUTE)

    const refused = await upload(app, png())
    expect(refused.status).toBe(429)
    const body = apiErrorSchema.parse(await refused.json())
    expect(body.code).toBe('rate-limited')
    // Refused BEFORE the body was parsed, so nothing reached R2.
    expect(objectStore!.size).toBe(UPLOADS_PER_MINUTE)
  })

  it('does not spend a token on a request that was never going to work', async () => {
    // The cheap doorman checks run first on purpose: a flood of malformed
    // requests must not use up the budget an honest caller needs.
    const { app } = makeApp()
    for (let attempt = 0; attempt < UPLOADS_PER_MINUTE * 2; attempt += 1) {
      const missingHeader = await upload(app, png(), { host: HOST })
      expect(missingHeader.status).toBe(400)
    }
    expect((await upload(app, png())).status).toBe(201)
  })

  it('counts an upload that fails validation, because its body was already read', async () => {
    // A wrongly-typed file gets past the doorman and IS parsed, so it costs a
    // token. That is the honest accounting: the expensive work happened.
    const { app } = makeApp()
    const notAnImage = new File([new Uint8Array([1, 2, 3, 4])], 'a.png', { type: 'image/png' })
    for (let attempt = 0; attempt < UPLOADS_PER_MINUTE; attempt += 1) {
      expect((await upload(app, notAnImage)).status).toBe(415)
    }
    expect((await upload(app, png())).status).toBe(429)
  })
})

describe('POST /api/uploads', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it.each(Object.keys(SIGNATURES))('stores a %s and answers with an absolute URL', async (contentType) => {
    const { app, objectStore } = makeApp()
    const file = new File([imageBytes(contentType)], 'logo', { type: contentType })

    const response = await upload(app, file)

    expect(response.status).toBe(201)
    const { url } = uploadResponseSchema.parse(await response.json())
    // Absolute: an email client has no page to resolve a relative src against.
    // The origin comes from the request the Worker answered, whatever that is.
    expect(url).toMatch(/^https?:\/\/[^/]+\/media\/img_[0-9a-f-]{36}\.(png|jpg|gif|webp)$/)
    expect(objectStore!.size).toBe(1)
  })

  it('names the key img_<uuid>.<ext> and serves it back with its content type', async () => {
    const { app } = makeApp()
    const file = new File([imageBytes('image/png')], 'logo.png', { type: 'image/png' })

    const { url } = uploadResponseSchema.parse(await (await upload(app, file)).json())
    const key = new URL(url).pathname.replace(MEDIA_PATH_PREFIX, '')
    expect(key).toMatch(/^img_[0-9a-f-]{36}\.png$/)

    const fetched = await app.request(`${MEDIA_PATH_PREFIX}${key}`, { headers: { host: HOST } })
    expect(fetched.status).toBe(200)
    expect(fetched.headers.get('content-type')).toBe('image/png')
    expect(fetched.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(new Uint8Array(await fetched.arrayBuffer())).toEqual(imageBytes('image/png'))
  })

  it('refuses a file larger than the cap with 413', async () => {
    const { app } = makeApp()
    const file = new File([imageBytes('image/png', MAX_UPLOAD_BYTES + 1)], 'big.png', { type: 'image/png' })

    const response = await upload(app, file)
    expect(response.status).toBe(413)
    expect(apiErrorSchema.parse(await response.json()).code).toBe('payload-too-large')
  })

  it('refuses an oversized upload on its declared size, before reading the body', async () => {
    const { app, objectStore } = makeApp()
    const file = new File([imageBytes('image/png')], 'logo.png', { type: 'image/png' })

    // A small body claiming to be 100 MB: the answer must come from the header
    // alone, or a real 100 MB body would cost the isolate its memory first.
    const response = await upload(app, file, { ...FORM_HEADERS, 'content-length': '100000000' })

    expect(response.status).toBe(413)
    expect(apiErrorSchema.parse(await response.json()).code).toBe('payload-too-large')
    expect(objectStore!.size).toBe(0)
  })

  it('refuses an upload that declares no size at all (413)', async () => {
    const { app } = makeApp()
    const form = new FormData()
    form.set(UPLOAD_FIELD_NAME, new File([imageBytes('image/png')], 'logo.png', { type: 'image/png' }))

    const response = await app.request('/api/uploads', { method: 'POST', headers: FORM_HEADERS, body: form })

    expect(response.status).toBe(413)
  })

  it('refuses a content type that is not on the allow-list with 415', async () => {
    const { app } = makeApp()
    const file = new File([imageBytes('image/png')], 'drawing.svg', { type: 'image/svg+xml' })

    const response = await upload(app, file)
    expect(response.status).toBe(415)
  })

  it('refuses a file whose bytes do not match the type it claims (415)', async () => {
    const { app, objectStore } = makeApp()
    // A GIF wearing a PNG label: the declared type alone would have let it in.
    const file = new File([imageBytes('image/gif')], 'sneaky.png', { type: 'image/png' })

    const response = await upload(app, file)
    expect(response.status).toBe(415)
    expect(apiErrorSchema.parse(await response.json()).message).toContain('claims')
    expect(objectStore!.size).toBe(0)
  })

  it('refuses a form without the file field (400)', async () => {
    const { app } = makeApp()
    const response = await upload(app, 'just some text', FORM_HEADERS, 'notes')

    expect(response.status).toBe(400)
    expect(apiErrorSchema.parse(await response.json()).message).toContain(UPLOAD_FIELD_NAME)
  })

  it(`refuses an upload without the ${STUDIO_API_HEADER} header (400)`, async () => {
    const { app } = makeApp()
    const file = new File([imageBytes('image/png')], 'logo.png', { type: 'image/png' })

    const response = await upload(app, file, { host: HOST })
    expect(response.status).toBe(400)
  })

  it('refuses a JSON body with 415', async () => {
    const { app } = makeApp()
    const response = await app.request('/api/uploads', {
      method: 'POST',
      headers: { host: HOST, 'content-type': 'application/json', [STUDIO_API_HEADER]: '1' },
      body: '{}',
    })

    expect(response.status).toBe(415)
  })

  it('refuses an unauthenticated caller with 401', async () => {
    const app = createApp({
      config,
      sender: null,
      authenticator: createDisabledAuthenticator('No authenticator is configured.'),
      objectStore: new InMemoryObjectStore(),
    })
    const file = new File([imageBytes('image/png')], 'logo.png', { type: 'image/png' })

    expect((await upload(app, file)).status).toBe(401)
  })

  it('answers 503 when no bucket is bound', async () => {
    const { app } = makeApp(null)
    const file = new File([imageBytes('image/png')], 'logo.png', { type: 'image/png' })

    const response = await upload(app, file)
    expect(response.status).toBe(503)
    expect(apiErrorSchema.parse(await response.json()).code).toBe('storage-unavailable')
  })
})

describe('GET /media/:key', () => {
  it('is public: no session, no studio header, still served', async () => {
    const { app, objectStore } = makeApp()
    await objectStore!.put('img_00000000-0000-4000-8000-000000000000.png', imageBytes('image/png').buffer, {
      httpMetadata: { contentType: 'image/png' },
    })

    // Deliberately built the way a stranger's mail client would ask for it.
    const response = await app.request('/media/img_00000000-0000-4000-8000-000000000000.png', {
      headers: { host: HOST },
    })
    expect(response.status).toBe(200)
  })

  it('answers 404 for a key that is not there', async () => {
    const { app } = makeApp()
    const response = await app.request('/media/img_00000000-0000-4000-8000-000000000000.png', {
      headers: { host: HOST },
    })
    expect(response.status).toBe(404)
  })

  it('answers 404 for a key that does not match the expected shape', async () => {
    const { app } = makeApp()
    const response = await app.request('/media/..%2Fwrangler.jsonc', { headers: { host: HOST } })
    expect(response.status).toBe(404)
  })

  it('answers 503 when no bucket is bound', async () => {
    const { app } = makeApp(null)
    const response = await app.request('/media/img_00000000-0000-4000-8000-000000000000.png', {
      headers: { host: HOST },
    })
    expect(response.status).toBe(503)
  })
})

describe('sniffContentType', () => {
  it.each(Object.keys(SIGNATURES))('recognises %s from its first bytes', (contentType) => {
    expect(sniffContentType(imageBytes(contentType).buffer)).toBe(contentType)
  })

  it('does not mistake another RIFF container for a WebP', () => {
    const wav = new Uint8Array(32)
    wav.set([0x52, 0x49, 0x46, 0x46, 0x10, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45], 0)
    expect(sniffContentType(wav.buffer)).toBeNull()
  })

  it('returns null for anything it does not know', () => {
    expect(sniffContentType(new Uint8Array([1, 2, 3, 4]).buffer)).toBeNull()
  })
})
