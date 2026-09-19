/**
 * Uploads one image for a visual template and returns its hosted URL.
 *
 * Infrastructure layer, mirroring `emailProvider.ts`: a `fetch` across an
 * untrusted boundary, so the response is parsed with Zod before anything is
 * believed. It must not import React or anything from `@/presentation`.
 *
 * Why a hosted URL at all: a `data:` URL is stripped by Gmail and would blow
 * the 102 KB clipping limit, so the editor insists on a real one (plan §0).
 */
import { z } from 'zod'
import { STUDIO_API_HEADER, UPLOAD_FIELD_NAME } from '@shared/templateContracts'

/** What `EmailEditor`'s `onUploadImage` prop must resolve to. */
export interface UploadedImage {
  readonly url: string
}

/** `POST /api/uploads` answers `201 { url }`; anything else is a failure. */
export const uploadResponseSchema = z.object({ url: z.url() })

/** The shape of every failure here: one sentence the toast can show. */
export class ImageUploadError extends Error {}

const UNREACHABLE_MESSAGE = 'The studio could not reach the upload server.'
const UNEXPECTED_MESSAGE = 'The upload server answered with something unexpected.'

/**
 * Sends `file` to the studio API as multipart form data.
 *
 * Rejects (rather than returning a result type) on purpose: the editor's image
 * plugin inserts a temporary node the moment a file is chosen and removes it
 * again only when this promise rejects, so swallowing the error would leave a
 * broken placeholder in the document for ever.
 */
export async function uploadImage(
  file: File,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): Promise<UploadedImage> {
  const body = new FormData()
  body.append(UPLOAD_FIELD_NAME, file)

  let response: Response
  try {
    response = await fetchImpl('/api/uploads', {
      method: 'POST',
      // No content-type header: the browser has to set the multipart boundary.
      // The studio header is what a cross-site form cannot send (see uploadRoutes.ts).
      headers: { accept: 'application/json', [STUDIO_API_HEADER]: '1' },
      body,
    })
  } catch {
    throw new ImageUploadError(UNREACHABLE_MESSAGE)
  }

  const payload: unknown = await response.json().catch(() => null)
  if (!response.ok) throw new ImageUploadError(serverMessage(payload) ?? UNEXPECTED_MESSAGE)

  const parsed = uploadResponseSchema.safeParse(payload)
  if (!parsed.success) throw new ImageUploadError(UNEXPECTED_MESSAGE)
  return { url: parsed.data.url }
}

/** The API's own explanation (413, 415, 503...), when it sent one. */
function serverMessage(payload: unknown): string | null {
  const parsed = z.object({ message: z.string().min(1) }).safeParse(payload)
  return parsed.success ? parsed.data.message : null
}
