/**
 * Small HTTP helpers shared by the template and upload routes.
 *
 * Server layer: Hono and Zod only, no storage and no app modules. Everything
 * here exists so `templateRoutes.ts` and `uploadRoutes.ts` do not each grow
 * their own copy of "is this JSON?", "is the studio header there?" and "what
 * does an error body look like?".
 */
import type { Context } from 'hono'
import type { z } from 'zod'
import type { ApiErrorCode } from '../shared/templateContracts.ts'
import { STUDIO_API_HEADER } from '../shared/templateContracts.ts'

/** Status codes this API actually returns; Hono wants a literal union here. */
export type ApiStatus = 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 500 | 503

/** One issue as `apiErrorSchema` describes it: where the problem is, and what it is. */
export interface ApiIssue {
  readonly path: string
  readonly message: string
}

/** Extra fields an error body may carry; `template` travels with every 409. */
export interface ApiErrorExtras {
  readonly issues?: readonly ApiIssue[]
  readonly template?: unknown
}

/**
 * The one place an error body is built, so every failure in this API has the
 * same shape and the browser can parse it with `apiErrorSchema`.
 */
export function apiError(
  c: Context,
  status: ApiStatus,
  code: ApiErrorCode,
  message: string,
  extras: ApiErrorExtras = {},
) {
  return c.json({ status: 'error' as const, code, message, ...extras }, status)
}

/** Turns a Zod failure into the `issues` array the error body carries. */
export function issuesOf(error: z.ZodError): ApiIssue[] {
  return error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
}

/**
 * The two guards every mutation shares. Both force a CORS preflight for a
 * cross-site caller, and this server never answers OPTIONS, so browsers refuse
 * the request before it arrives. Returns a Response to send, or null to carry on.
 *
 * Pass `null` for `expectedContentType` on a request with no body (DELETE):
 * there is nothing to declare a type for, so only the studio header is checked.
 */
export function checkMutationHeaders(c: Context, expectedContentType: string | null = 'application/json') {
  if (
    expectedContentType !== null &&
    !c.req.header('content-type')?.toLowerCase().startsWith(expectedContentType)
  ) {
    return apiError(c, 415, 'unsupported-media-type', `Content-Type must be ${expectedContentType}.`)
  }
  if (c.req.header(STUDIO_API_HEADER) !== '1') {
    return apiError(c, 400, 'bad-request', `Missing ${STUDIO_API_HEADER} header.`)
  }
  return null
}

/** Reads the JSON body, or returns the 400 to send when it is not JSON at all. */
export async function readJsonBody(c: Context): Promise<{ body: unknown } | { response: Response }> {
  try {
    return { body: await c.req.json() }
  } catch {
    return { response: apiError(c, 400, 'bad-request', 'Request body must be JSON.') }
  }
}

/** Counts bytes, not characters: every size cap in this API is a byte cap. */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}
