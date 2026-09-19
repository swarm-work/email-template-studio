/**
 * The whole "convert this visual template to code" flow, in one hook.
 *
 * Presentation layer, React wiring only: every rule it applies lives in
 * `@/application/visual` (what the TSX looks like, what the new version
 * carries) or in infrastructure (the theme styles, the render pipeline).
 *
 * The order is the point, and it never varies (ADR-28):
 *   convert in the browser → smoke-render the generated source → only then
 *   write the new version. A failure at any step leaves the visual template
 *   exactly as it was.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { parsePayloadObject } from '@/application/mergeFields'
import { buildConvertToCodeInput } from '@/application/visual/convertedVersion'
import {
  conversionPayload,
  documentToTsx,
  tsxComponentName,
  tsxPropsInterfaceName,
  type ConvertedProp,
  type UnsupportedNode,
} from '@/application/visual/documentToTsx'
import type { ConvertToCodeInput, RepositoryResult } from '@/application/repositories/templateRepository'
import type { EmailDocument, EmailTemplate, TemplateId, TemplateRecord } from '@/domain'
import type { TemplateRenderer } from '@/infrastructure/render/renderClient'
import { createNodeStyleResolver } from '@/infrastructure/render/visualStyleResolver'

/**
 * What the studio knows about this conversion by the time the dialog opens.
 *
 * It lives here rather than in the dialog because this hook is what PRODUCES
 * it; the dialog only draws it. Every other hook in this folder points the same
 * way (see `useSavedExport`'s `RenderPreviewState`).
 */
export type ConvertPreparation =
  /** The editor chunk and the converter are still working. */
  | { readonly status: 'preparing' }
  /** It converted. `warnings` are lossy-but-fine notes; they never block. */
  | { readonly status: 'ready'; readonly warnings: readonly string[] }
  /** It refused: these blocks have no equivalent yet. */
  | { readonly status: 'blocked'; readonly reasons: readonly UnsupportedNode[] }
  /** Something else went wrong before the conversion could even be tried. */
  | { readonly status: 'failed'; readonly message: string }

/** The toast a completed conversion leaves behind. */
export const CONVERTED_MESSAGE = 'Converted to a code template. The visual document was discarded.'

/** Shown when the editor chunk — and with it the theme — could not be read. */
const NO_STYLES_MESSAGE =
  'The visual editor could not be loaded, so this template’s styles could not be read. Try again once the canvas is open.'

/**
 * The server stores the sample payload as a JSON OBJECT and rejects anything
 * else, so half-typed JSON is caught here — where the dialog can explain it —
 * rather than coming back as a 400 in a toast. Saving is gated the same way.
 */
const BAD_PAYLOAD_MESSAGE =
  'The preview payload is not a JSON object yet. Fix it on the Data tab, then convert.'

/**
 * The envelope is written by the SERVER from the last saved version, so an
 * unsaved subject or preheader cannot survive a conversion. Said out loud
 * rather than discovered afterwards: the draft is dropped by the conversion.
 */
const UNSAVED_ENVELOPE_WARNING =
  'Unsaved subject and preheader changes are not carried over. Cancel and save first if you want them.'

export interface UseConvertToCodeOptions {
  readonly template: EmailTemplate
  /** The document as it is on screen, drafts included. */
  readonly document: EmailDocument | null
  /**
   * The SAVED envelope: the subject is recorded in the module's header comment
   * and the preheader becomes its `<Preview>`. It is deliberately not the
   * draft's — the server writes the saved envelope onto the converted version,
   * and a generated `<Preview>` that disagreed with the stored envelope would
   * be a permanent inconsistency in a one-way operation.
   */
  readonly subject: string
  readonly preheader: string
  /** True when the envelope on screen differs from the saved one; it is warned about. */
  readonly envelopeDirty: boolean
  readonly samplePayloadText: string
  /** The revision the conversion is written against (the draft's base). */
  readonly expectedRevision: number
  /** The studio's own renderer: the smoke test runs through the real pipeline. */
  readonly renderer: TemplateRenderer
  readonly convert: (id: TemplateId, input: ConvertToCodeInput) => Promise<RepositoryResult<EmailTemplate>>
  /** The server wrote the code version; the reducer drops the visual draft. */
  readonly onConverted: (record: EmailTemplate) => void
  /** Somebody else saved first: the phase-7b conflict dialog takes over. */
  readonly onConflict: (record: TemplateRecord) => void
}

export interface UseConvertToCodeResult {
  readonly open: boolean
  readonly preparation: ConvertPreparation
  readonly converting: boolean
  /** The smoke render's error, or null. */
  readonly renderError: string | null
  /** Opens the dialog and starts converting in the background. */
  readonly openDialog: () => void
  readonly setOpen: (open: boolean) => void
  readonly confirm: () => void
}

export function useConvertToCode(options: UseConvertToCodeOptions): UseConvertToCodeResult {
  const [open, setOpen] = useState(false)
  const [preparation, setPreparation] = useState<ConvertPreparation>({ status: 'preparing' })
  const [converting, setConverting] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  /** The generated module, kept out of state: nothing renders it. */
  const generated = useRef<{ source: string; props: readonly ConvertedProp[] } | null>(null)

  // The newest inputs, read inside the async work. A dependency array holding
  // the document would restart the conversion on every keystroke behind the
  // dialog; this way it is prepared once, when it opens.
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })

  const openDialog = useCallback(() => {
    generated.current = null
    setRenderError(null)
    setPreparation({ status: 'preparing' })
    setOpen(true)
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false

    const prepare = async () => {
      const { template, document } = latest.current
      if (document === null) {
        setPreparation({ status: 'failed', message: 'This template has no visual document to convert.' })
        return
      }
      if (parsePayloadObject(latest.current.samplePayloadText) === null) {
        setPreparation({ status: 'failed', message: BAD_PAYLOAD_MESSAGE })
        return
      }
      const theme = template.kind === 'visual' ? template.theme : undefined
      const resolveStyle = await createNodeStyleResolver(document, theme)
      if (cancelled) return

      const result = documentToTsx(document, {
        componentName: tsxComponentName(template.metadata.name),
        propsInterfaceName: tsxPropsInterfaceName(template.metadata.name),
        subject: latest.current.subject,
        preheader: latest.current.preheader,
        resolveStyle,
      })
      if (cancelled) return
      if (!result.ok) {
        setPreparation({ status: 'blocked', reasons: result.reasons })
        return
      }
      generated.current = { source: result.source, props: result.props }
      const warnings = latest.current.envelopeDirty
        ? [...result.warnings, UNSAVED_ENVELOPE_WARNING]
        : result.warnings
      setPreparation({ status: 'ready', warnings })
    }

    void prepare().catch(() => {
      if (!cancelled) setPreparation({ status: 'failed', message: NO_STYLES_MESSAGE })
    })
    return () => {
      cancelled = true
    }
  }, [open])

  const confirm = useCallback(() => {
    const module = generated.current
    if (module === null || converting) return
    setConverting(true)
    setRenderError(null)

    const run = async () => {
      const { renderer, convert, template, samplePayloadText, expectedRevision } = latest.current
      // The smoke test: the SAME pipeline the code workspace uses, with every
      // prop holding the `{{key}}` it came from — so what comes back is both
      // proof that the module renders and the unresolved export to store.
      const rendered = await renderer.render(module.source, conversionPayload(module.props))
      if (!rendered.ok) {
        setRenderError(rendered.error.message)
        setConverting(false)
        return
      }

      const result = await convert(
        template.metadata.id,
        buildConvertToCodeInput({
          expectedRevision,
          source: module.source,
          html: rendered.html,
          text: rendered.text,
          samplePayloadText,
          props: module.props,
        }),
      )
      setConverting(false)
      if (result.ok) {
        setOpen(false)
        latest.current.onConverted(result.value)
        toast.success(CONVERTED_MESSAGE)
        return
      }
      if (result.failure.code === 'version-conflict') {
        setOpen(false)
        latest.current.onConflict(result.failure.current)
        return
      }
      toast.error('The template was not converted.', { description: result.failure.message })
    }

    void run().catch(() => {
      setConverting(false)
      toast.error('The template was not converted.', { description: 'The conversion could not be sent.' })
    })
  }, [converting])

  return { open, preparation, converting, renderError, openDialog, setOpen, confirm }
}
