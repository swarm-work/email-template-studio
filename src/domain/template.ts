/**
 * Domain model: email templates.
 *
 * The domain layer holds plain TypeScript types and tiny pure helpers only.
 * It must not import React, Zod, Vite, Tiptap or browser APIs, so the core
 * concepts stay easy to read and easy to unit test.
 */
import type { PropsValidator } from './preview'

/**
 * A "branded" string. At runtime it is just a string, but TypeScript will
 * refuse to pass any random string where a TemplateId is expected.
 */
export type TemplateId = string & { readonly __brand: 'TemplateId' }

/** Create a TemplateId from a plain string (used by the local template registry). */
export function templateId(value: string): TemplateId {
  return value as TemplateId
}

/** Controlled vocabulary for library cards and filters. */
export type TemplateCategory = 'onboarding' | 'security' | 'collaboration' | 'billing' | 'notification'

/** Lifecycle status shown on each library card. */
export type TemplateStatus = 'draft' | 'ready' | 'deprecated'

/**
 * How a template is authored:
 * - code: React Email TSX, edited in CodeMirror and compiled in the browser
 * - visual: a document edited on a canvas and exported to HTML at save time
 */
export type TemplateKind = 'code' | 'visual'

/** Where a template came from: shipped with the studio, or created by a person. */
export type TemplateOrigin = 'user' | 'starter'

/**
 * Structural shape of the visual editor's document (Tiptap JSON).
 *
 * The domain describes it with plain optional fields instead of importing the
 * editor's types: that keeps a 2.5 MB dependency out of every layer and makes
 * the document just data. The single cast to the editor's own type lives in
 * infrastructure.
 */
export interface EmailDocumentNode {
  readonly type?: string
  readonly text?: string
  readonly attrs?: Readonly<Record<string, unknown>>
  readonly marks?: readonly EmailDocumentNode[]
  readonly content?: readonly EmailDocumentNode[]
}

/** A whole visual document is just its root node. */
export type EmailDocument = EmailDocumentNode

export interface TemplateVersion {
  /** Monotonic number, e.g. 3. */
  readonly number: number
  /** Human readable label, e.g. "v3". */
  readonly label: string
  /** ISO-8601 timestamp of when this version was created. */
  readonly createdAt: string
}

export interface EmailAddress {
  readonly name: string
  readonly address: string
}

/**
 * What is written on the envelope rather than inside the letter.
 *
 * The sender ("From") is deliberately absent: it belongs to the send server,
 * not to the template (see EmailProvider.getStatus()).
 */
export interface TemplateEnvelope {
  /** Subject line. May contain {{key}} merge fields. */
  readonly subject: string
  /** Inbox preview text. '' means the email renders no preview line. */
  readonly preheader: string
  /** '' means replies go to the sender address configured on the send server. */
  readonly replyTo: string
}

/** Everything about a template except its content. */
export interface TemplateMetadata {
  readonly id: TemplateId
  readonly name: string
  /** URL/file friendly identifier, e.g. "welcome-verification". */
  readonly slug: string
  readonly description: string
  readonly category: TemplateCategory
  readonly status: TemplateStatus
  /** The version currently on the template. */
  readonly version: TemplateVersion
  /** Concurrency token: the server bumps it on every write (0 = unknown). */
  readonly revision: number
  readonly tags: readonly string[]
  readonly origin: TemplateOrigin
  readonly createdBy: string
  readonly createdAt: string
  readonly updatedBy: string
  /** ISO-8601 timestamp of the last change to the template. */
  readonly updatedAt: string
}

/**
 * The file name shown in the editor chrome. It is derived, never stored, so a
 * rename can never leave the name and the slug disagreeing.
 */
export function fileNameFor(kind: TemplateKind, slug: string): string {
  return kind === 'code' ? `${slug}.email.tsx` : `${slug}.email.json`
}

/** Fields both kinds of template carry. */
interface TemplateRecordBase {
  readonly metadata: TemplateMetadata
  readonly envelope: TemplateEnvelope
  /** Sample props as pretty-printed JSON text. */
  readonly samplePayloadText: string
  /** JSON Schema text describing the props contract. '{}' means "any object". */
  readonly propsSchemaText: string
}

/**
 * A template as it is stored and sent over the wire.
 *
 * `kind` is the discriminant: TypeScript will not let you read `source` before
 * you have checked that the record is a code template, and vice versa.
 * The exported `html` / `text` of a visual template are UNRESOLVED: any
 * {{key}} merge field is still in place, so a later send can substitute
 * per recipient.
 */
export type TemplateRecord =
  | (TemplateRecordBase & {
      readonly kind: 'code'
      /** React Email TSX source. */
      readonly source: string
    })
  | (TemplateRecordBase & {
      readonly kind: 'visual'
      readonly document: EmailDocument
      /** Name of the editor theme this version was authored with. */
      readonly theme: string
      readonly html: string
      readonly text: string
    })

/**
 * A record plus the behaviour the studio needs. `validateProps` is assembled in
 * infrastructure (Zod lives there), so it never travels over the wire.
 */
export type EmailTemplate = TemplateRecord & { readonly validateProps: PropsValidator }

/** The TSX a code template is edited as. Visual templates have no source, so ''. */
export function templateSource(record: TemplateRecord): string {
  return record.kind === 'code' ? record.source : ''
}

/** The canvas document of a visual template; null for code templates. */
export function templateDocument(record: TemplateRecord): EmailDocument | null {
  return record.kind === 'visual' ? record.document : null
}
