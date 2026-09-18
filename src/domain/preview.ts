/**
 * Domain model: preview payloads, validation and rendering results.
 *
 * Everything here is a plain data type. Union types with a discriminant
 * (`ok`, `kind`, `status`) are used so that TypeScript forces callers to
 * handle every case. No React, Zod or browser APIs.
 */
import type { EmailAddress } from './template'

/** Template props supplied by the JSON payload editor. */
export type PreviewPayload = Readonly<Record<string, unknown>>

export interface ValidationIssue {
  /** Dot path to the offending field, e.g. "recipient.email", or "(document)" for JSON syntax errors. */
  readonly path: string
  readonly message: string
  /** 1-based position inside the JSON text, when known. */
  readonly line?: number
  readonly column?: number
}

/**
 * Why a payload was rejected:
 * - invalid-json: the text is not JSON at all
 * - not-an-object: valid JSON, but not an object (e.g. an array or a string)
 * - schema: a JSON object, but the fields do not match the template's contract
 */
export type PayloadValidationKind = 'invalid-json' | 'not-an-object' | 'schema'

export type ValidationResult =
  | { readonly ok: true; readonly value: PreviewPayload }
  | { readonly ok: false; readonly kind: PayloadValidationKind; readonly issues: readonly ValidationIssue[] }

/** A function that validates an unknown value as a template's props. */
export type PropsValidator = (value: unknown) => ValidationResult

/**
 * Where the preview pipeline currently is:
 * - idle: nothing rendered yet
 * - blocked: the payload is invalid, so rendering was not attempted
 * - rendering: a render is in flight (or scheduled after the debounce)
 * - success / error: the last render finished
 */
export type RenderStatus = 'idle' | 'blocked' | 'rendering' | 'success' | 'error'

/**
 * Which stage failed:
 * - forbidden-import: the source imports something outside the allow-list
 * - compile: TSX could not be parsed / transformed
 * - evaluate: the compiled module threw while loading, or has no default export
 * - render: the component threw while rendering to HTML
 * - timeout: the render worker was stopped because it took too long
 * - worker: the worker crashed or was restarted
 * - compose: the visual editor could not compose its document into an email
 * - editor-load: the lazily loaded visual editor chunk never arrived
 */
export type RenderErrorKind =
  'forbidden-import' | 'compile' | 'evaluate' | 'render' | 'timeout' | 'worker' | 'compose' | 'editor-load'

export interface RenderError {
  readonly kind: RenderErrorKind
  /** One-sentence, human readable explanation. */
  readonly message: string
  /** 1-based source position, when the failing stage knows it. */
  readonly line?: number
  readonly column?: number
  /** Optional longer detail such as a stack trace. */
  readonly detail?: string
}

/**
 * One currency for both pipelines (code templates through the render worker,
 * visual templates through the editor): the same result shape, so the preview,
 * the diagnostics and the send dialog never care which kind they are showing.
 */
export type RenderResult =
  | {
      readonly ok: true
      readonly html: string
      /** Plain-text alternative part. '' until the plain-text render lands. */
      readonly text: string
      readonly durationMs: number
    }
  | { readonly ok: false; readonly error: RenderError }

/**
 * Which workspace the studio is showing. Which of these a template can reach
 * depends on its kind; see application/studioModes.ts.
 */
export type StudioMode = 'visual' | 'code' | 'preview'

export type PreviewDevice = 'desktop' | 'mobile'

/** Viewport widths (CSS px) used by the preview mail frame. Desktop is a maximum; mobile is exact. */
export const PREVIEW_DEVICE_WIDTHS: Readonly<Record<PreviewDevice, number>> = {
  desktop: 680,
  mobile: 375,
}

/**
 * The recipient shown in the preview's mail frame. It is a fixed sample, not
 * template data, and is never used for sending.
 */
export const PREVIEW_SAMPLE_RECIPIENT: EmailAddress = { name: 'Ada Lovelace', address: 'ada@example.com' }
