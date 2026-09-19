/**
 * Use case: summarise the studio's current health as a list of diagnostics.
 *
 * Pure function: given validation + render state it returns display items.
 * Anything the app does not actually check is labelled `planned`,
 * `not-connected` or `simulated` so the UI never over-claims.
 */
import type { DiagnosticItem, RenderResult, RenderStatus, TemplateKind, ValidationResult } from '@/domain'

export interface DiagnosticsInput {
  readonly validation: ValidationResult
  readonly renderStatus: RenderStatus
  readonly renderResult: RenderResult | null
  /**
   * What this template is authored in. A code template has a source that
   * compiles; a visual one has a canvas document that exports. The first row
   * says whichever of those is true, because a row that talks about compiling
   * a source a template does not have is worse than no row at all.
   */
  readonly kind: TemplateKind
  /** Unsaved edits to the source (code) or to the canvas document (visual). */
  readonly contentDirty: boolean
  readonly payloadDirty: boolean
  /**
   * Merge-field keys the template uses that the payload has no value for, as
   * `applyMergeFields` reported them. Empty is the good case; the row is only
   * omitted when the template uses no merge fields at all.
   */
  readonly missingMergeFields: readonly string[]
  /** Whether the template uses any merge fields at all (see `mergeFieldsDiagnostic`). */
  readonly mergeFieldCount: number
  /** Hrefs that became `javascript:` or `data:` once the values were filled in. */
  readonly unsafeHrefs: readonly string[]
}

export function buildDiagnostics(input: DiagnosticsInput): DiagnosticItem[] {
  return [
    templateDiagnostic(input),
    payloadDiagnostic(input.validation),
    // Both merge-field rows are conditional: a template with no `{{key}}` in it
    // should not be told anything about merge fields (`?? []` flattens them).
    ...(mergeFieldsDiagnostic(input) ?? []),
    ...(unsafeHrefDiagnostic(input.unsafeHrefs) ?? []),
    renderDiagnostic(input),
    htmlDiagnostic(input.renderResult),
    {
      id: 'links',
      label: 'Link check',
      state: 'planned',
      detail: 'Will verify that every href resolves. Not implemented yet.',
    },
    {
      id: 'spf-dkim-dmarc',
      label: 'SPF / DKIM / DMARC',
      state: 'not-connected',
      detail: 'Requires a sending domain. Not connected in this milestone.',
    },
    {
      id: 'spam-score',
      label: 'Spam score',
      state: 'planned',
      detail: 'Placeholder. No deliverability service is connected.',
    },
  ]
}

/** The first row's vocabulary, which is different for each kind of template. */
const TEMPLATE_ROW = {
  code: {
    label: 'Template source',
    /** Errors that are the template's fault rather than the pipeline's. */
    ownErrors: ['compile', 'forbidden-import', 'evaluate'],
    dirty: 'Compiles. Contains unsaved local edits.',
    clean: 'Compiles. Matches the original file.',
    pending: 'Waiting for the next successful render.',
  },
  visual: {
    label: 'Canvas document',
    ownErrors: ['compose'],
    dirty: 'Exports. Contains unsaved local edits.',
    clean: 'Exports. Matches the saved version.',
    pending: 'Waiting for the next successful export.',
  },
} as const satisfies Record<TemplateKind, unknown>

function templateDiagnostic(input: DiagnosticsInput): DiagnosticItem {
  const row = TEMPLATE_ROW[input.kind]
  const error = input.renderResult && !input.renderResult.ok ? input.renderResult.error : null
  const ownErrors: readonly string[] = row.ownErrors
  if (error && ownErrors.includes(error.kind)) {
    return { id: 'template', label: row.label, state: 'error', detail: error.message }
  }
  if (input.renderStatus === 'success') {
    return {
      id: 'template',
      label: row.label,
      state: 'pass',
      detail: input.contentDirty ? row.dirty : row.clean,
    }
  }
  return {
    id: 'template',
    label: row.label,
    state: 'pending',
    detail: row.pending,
  }
}

function payloadDiagnostic(validation: ValidationResult): DiagnosticItem {
  if (validation.ok) {
    return {
      id: 'payload',
      label: 'Preview payload',
      state: 'pass',
      detail: 'Valid JSON. Matches the template schema.',
    }
  }
  const first = validation.issues[0]
  const where = first?.path && first.path !== '(document)' && first.path !== '(root)' ? `${first.path}: ` : ''
  const detail = `${where}${first?.message ?? 'Invalid payload.'}`
  return {
    id: 'payload',
    label: 'Preview payload',
    state: 'error',
    detail: validation.kind === 'schema' ? `Schema invalid. ${detail}` : detail,
  }
}

/**
 * The `merge-fields` row: whether every `{{key}}` on the canvas (or in the
 * subject and preheader) has a value in the sample payload.
 *
 * Returns a one-item list or null rather than an item, so the caller can spread
 * it: a template with no merge fields gets no row at all.
 */
function mergeFieldsDiagnostic(input: DiagnosticsInput): DiagnosticItem[] | null {
  if (input.mergeFieldCount === 0) return null
  const missing = input.missingMergeFields
  if (missing.length === 0) {
    return [
      {
        id: 'merge-fields',
        label: 'Merge fields',
        state: 'pass',
        detail: 'All merge fields have values',
      },
    ]
  }
  // Only the first is named: the detail line is one sentence, and the Data tab
  // is where the whole list lives.
  const detail = `Unknown variable {{${missing[0]}}} · not in payload`
  return [
    {
      id: 'merge-fields',
      label: 'Merge fields',
      state: 'warning',
      detail: missing.length === 1 ? detail : `${detail} (+${missing.length - 1} more)`,
    },
  ]
}

/**
 * A link that became `javascript:` or `data:` once a value was substituted in.
 * An error rather than a warning: this is the one merge-field outcome that is
 * not merely untidy.
 */
function unsafeHrefDiagnostic(unsafeHrefs: readonly string[]): DiagnosticItem[] | null {
  if (unsafeHrefs.length === 0) return null
  return [
    {
      id: 'unsafe-links',
      label: 'Unsafe link after substitution',
      state: 'error',
      detail: `A link resolves to ${unsafeHrefs[0]}. Mail clients block it, and it should never be a payload value.`,
    },
  ]
}

function renderDiagnostic(input: DiagnosticsInput): DiagnosticItem {
  switch (input.renderStatus) {
    case 'idle':
      return { id: 'render', label: 'Render', state: 'idle', detail: 'Nothing rendered yet.' }
    case 'blocked':
      return { id: 'render', label: 'Render', state: 'warning', detail: 'Paused until the payload is valid.' }
    case 'rendering':
      return { id: 'render', label: 'Render', state: 'pending', detail: 'Rendering in the preview worker.' }
    case 'success': {
      const duration = input.renderResult?.ok ? `${input.renderResult.durationMs} ms` : ''
      return { id: 'render', label: 'Render', state: 'pass', detail: `Rendered in ${duration}.` }
    }
    case 'error': {
      const error = input.renderResult && !input.renderResult.ok ? input.renderResult.error : null
      return { id: 'render', label: 'Render', state: 'error', detail: error?.message ?? 'Rendering failed.' }
    }
  }
}

function htmlDiagnostic(result: RenderResult | null): DiagnosticItem {
  if (result?.ok) {
    const kilobytes = (new TextEncoder().encode(result.html).length / 1024).toFixed(1)
    const state = Number(kilobytes) > 100 ? 'warning' : 'pass'
    return {
      id: 'html',
      label: 'HTML output',
      state,
      detail:
        state === 'warning'
          ? `${kilobytes} KB. Gmail clips messages over ~102 KB.`
          : `${kilobytes} KB generated.`,
    }
  }
  return { id: 'html', label: 'HTML output', state: 'idle', detail: 'No HTML generated yet.' }
}
