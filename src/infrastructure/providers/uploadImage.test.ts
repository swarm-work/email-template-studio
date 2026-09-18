import { describe, expect, it, vi } from 'vitest'
import { STUDIO_API_HEADER, UPLOAD_FIELD_NAME } from '@shared/templateContracts'
import { ImageUploadError, uploadImage } from './uploadImage'

const PNG = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'hero.png', { type: 'image/png' })

function fetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(
    async () =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch
}

describe('uploadImage', () => {
  it('posts the file as multipart with the studio header, and returns the hosted URL', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({ url: 'https://studio.test/media/img_abc.png' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    expect(await uploadImage(PNG, fetchImpl)).toEqual({ url: 'https://studio.test/media/img_abc.png' })

    const [call] = calls
    expect(call.url).toBe('/api/uploads')
    expect(call.init.method).toBe('POST')
    // The browser has to set the multipart boundary itself, so there must be no
    // content-type header of ours.
    expect(call.init.headers).toEqual({ accept: 'application/json', [STUDIO_API_HEADER]: '1' })
    const body = call.init.body as FormData
    expect((body.get(UPLOAD_FIELD_NAME) as File).name).toBe('hero.png')
  })

  it("rejects with the API's own sentence when it refuses the file", async () => {
    const tooLarge = fetchReturning(413, {
      status: 'error',
      code: 'payload-too-large',
      message: 'Images must be 2097152 bytes or smaller.',
    })
    // Rejecting, not returning a result: the editor removes its temporary image
    // node only when this promise rejects.
    await expect(uploadImage(PNG, tooLarge)).rejects.toThrow(ImageUploadError)
    await expect(uploadImage(PNG, tooLarge)).rejects.toThrow('Images must be 2097152 bytes or smaller.')
  })

  it('rejects when the server cannot be reached at all', async () => {
    const offline = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch
    await expect(uploadImage(PNG, offline)).rejects.toThrow(/could not reach the upload server/)
  })

  it('rejects an answer that does not carry a URL, rather than trusting it', async () => {
    await expect(uploadImage(PNG, fetchReturning(201, { ok: true }))).rejects.toThrow(/unexpected/)
    await expect(uploadImage(PNG, fetchReturning(201, { url: 'not a url' }))).rejects.toThrow(/unexpected/)
  })
})
