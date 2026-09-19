/**
 * The editor screen for ONE template: chrome, envelope, workspaces, status bar.
 *
 * Presentation layer, composition only. It owns no template data — the draft
 * lives in `useStudio` (held by the route) — just the few things that describe
 * the screen itself: which dialog is open, which editor tab is showing, which
 * mode ⌘P should return to, and the ring buffer of recent render times.
 *
 * It also builds the one preview document string (ADR-25): the preview mode and
 * the code rail's thumbnail both read it, so neither costs a second render.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { buildDiagnostics } from '@/application/buildDiagnostics'
import {
  applyMergeFields,
  findUnsafeHrefs,
  listDocumentMergeFields,
  listMergeFields,
  missingMergeFields,
  parsePayloadObject,
} from '@/application/mergeFields'
import { parsePreviewPayload } from '@/application/parsePreviewPayload'
import type {
  RepositoryResult,
  TemplateMetadataPatch,
  VersionInput,
} from '@/application/repositories/templateRepository'
import { describeVersionConflict, type VersionConflictCopy } from '@/application/versionConflict'
import { buildVersionInput } from '@/application/versionInput'
import {
  ALL_STUDIO_MODES,
  availableModes,
  defaultMode,
  nextModeForPreviewToggle,
} from '@/application/studioModes'
import {
  templateDocument,
  VISUAL_EDITOR_OFF_MESSAGE,
  type EmailDocument,
  type EmailTemplate,
  type TemplateId,
  type TemplateRecord,
  type PreviewPayload,
  type StudioFeatures,
  type StudioMode,
  type TemplateKind,
} from '@/domain'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { buildPreviewDocument } from '@/infrastructure/render/previewDocument'
import { DEFAULT_STUDIO_THEME } from '@/infrastructure/render/studioTheme'
import { mergeFieldPropsValidator } from '@/infrastructure/validation/mergeFieldPropsValidator'
import type { EmailProvider } from '@/infrastructure/providers/emailProvider'
import type { TemplateRenderer } from '@/infrastructure/render/renderClient'
import { slugify } from '@shared/templateContracts'
import { useSendServerStatus } from '@/presentation/hooks/useSendServerStatus'
import type { TemplateWrites } from '@/presentation/hooks/useTemplateLibrary'
import { useTemplateSave } from '@/presentation/hooks/useTemplateSave'
import { useUnsavedChangesGuard } from '@/presentation/hooks/useUnsavedChangesGuard'
import { useRenderPreview, type RenderPreviewState } from '@/presentation/hooks/useRenderPreview'
import { SAVED_EXPORT_REASON, useSavedExport } from '@/presentation/hooks/useSavedExport'
import { useConvertToCode } from '@/presentation/hooks/useConvertToCode'
import { useVisualPreview } from '@/presentation/hooks/useVisualPreview'
import type { UseStudioResult } from '@/presentation/hooks/useStudio'
import { useStudioShortcuts } from '@/presentation/hooks/useStudioShortcuts'
import { downloadTextFile } from '@/presentation/shared/downloadFile'
import { unavailableModeReason } from './chrome/modeReasons'
import { saveTemplateReason } from './chrome/SaveTemplateButton'
import { StudioStatusBar } from './chrome/StudioStatusBar'
import { StudioSubHeader } from './chrome/StudioSubHeader'
import { CodeWorkspace } from './code/CodeWorkspace'
import type { EditorTabId } from './code/editorTabs'
import { formatJson, formatTsx } from './code/formatSource'
import { PreviewThumbnail } from './code/PreviewThumbnail'
import { PropsPayloadCard } from './code/PropsPayloadCard'
import { ConvertToCodeDialog } from './dialogs/ConvertToCodeDialog'
import { ExportedCodeDialog } from './dialogs/ExportedCodeDialog'
import { ShortcutsDialog } from './dialogs/ShortcutsDialog'
import { VersionConflictDialog } from './dialogs/VersionConflictDialog'
import { DeleteTemplateDialog } from '@/presentation/templates/DeleteTemplateDialog'
import { EMPTY_EMAIL_DOCUMENT } from './visual/canvas'
import { VisualEditorSkeleton } from './visual/VisualEditorSkeleton'
import type { VisualEditorControls } from './visual/editorControls'
import { VisualWorkspace } from './visual/VisualWorkspace'
import { EnvelopePanel } from './envelope/EnvelopePanel'
import { NOTHING_RENDERED_REASON } from './preview/previewStatus'
import { PreviewWorkspace } from './preview/PreviewWorkspace'
import { SendTestEmailDialog } from './SendTestEmailDialog'

/** How many render times the sparkline keeps. */
const RENDER_HISTORY_SIZE = 12

/** What the one hidden live region says when the workspace changes. */
const MODE_ANNOUNCEMENTS: Readonly<Record<StudioMode, string>> = {
  preview: 'Preview mode. Read only.',
  code: 'Code editor.',
  visual: 'Visual editor.',
}

export interface StudioPageProps {
  studio: UseStudioResult
  renderer: TemplateRenderer
  provider: EmailProvider
  /** The repository's four writes; the studio uses three of them. */
  writes: TemplateWrites
  /** Opens another template — used after "Save as a copy". */
  onOpenTemplate: (id: TemplateId) => void
  /** Deletes this template and goes back to a refreshed library. */
  onDeleteTemplate: (id: TemplateId) => Promise<void>
  /** Fetches the library again, e.g. after discarding a draft for the server's copy. */
  onReloadLibrary: () => void
  /** Goes back to the library; the sub-header's breadcrumb calls it. */
  onBackToLibrary: () => void
  /** Reports the last render time up to the header's latency pill. */
  onRenderTime: (ms: number | null) => void
}

export function StudioPage({
  studio,
  renderer,
  provider,
  writes,
  onOpenTemplate,
  onDeleteTemplate,
  onReloadLibrary,
  onBackToLibrary,
  onRenderTime,
}: StudioPageProps) {
  const { template, draft, sourceDirty, documentDirty, payloadDirty, envelopeDirty, state, actions } = studio
  const templateId = template.metadata.id

  // What the send server says about itself: the From address the envelope panel
  // and the preview summary show, and which features are switched on. Asked for
  // ONCE here, because two callers would be two requests that can answer
  // differently.
  const { from: fromIdentity, features, ready: featuresReady } = useSendServerStatus(provider)
  const isVisual = template.kind === 'visual'

  // The reducer clamps the mode by KIND; the feature flag can take a mode away
  // after that, so what is actually shown is clamped again here. Nothing is
  // written back, so switching the flag on again returns you where you were.
  const kindModes = availableModes(template.kind, features)
  const mode = kindModes.includes(state.mode) ? state.mode : kindModes[0]

  /**
   * Every `{{key}}` this template uses: the chips on the canvas plus anything
   * typed into the subject or the preheader. For a visual template this is the
   * contract - there is no schema to read and no TSX to infer props from - so
   * it is computed from the LIVE document rather than from the saved version
   * (plan §3.4). A code template keeps the validator its mapper built.
   */
  // Memoised through a STRING rather than straight to an array. The inputs
  // change on every keystroke, but the keys they yield usually do not, and a
  // fresh array each time would give `validation` - and through it the render
  // hook - a new identity, re-rendering the template while somebody types a
  // subject that contains no merge fields at all.
  const mergeFieldKeysText = useMemo(() => {
    const fromDocument = isVisual ? listDocumentMergeFields(draft.document ?? templateDocument(template)) : []
    return unique([
      ...fromDocument,
      ...listMergeFields(draft.envelope.subject),
      ...listMergeFields(draft.envelope.preheader),
    ]).join('\n')
  }, [isVisual, draft.document, draft.envelope.subject, draft.envelope.preheader, template])

  const mergeFieldKeys = useMemo(
    () => (mergeFieldKeysText === '' ? EMPTY_KEYS : mergeFieldKeysText.split('\n')),
    [mergeFieldKeysText],
  )

  const validateProps = useMemo(
    () => (isVisual ? mergeFieldPropsValidator(mergeFieldKeys) : template.validateProps),
    [isVisual, mergeFieldKeys, template],
  )

  // Validation is memoised on the text so its identity only changes when the text does.
  const validation = useMemo(
    () => parsePreviewPayload(draft.payloadText, validateProps),
    [draft.payloadText, validateProps],
  )
  // Only the CODE render path takes these: a component is given typed props or
  // it is not rendered at all. Merge-field substitution deliberately does not
  // go through here - see the `payload` memo below.
  const props = validation.ok ? validation.value : null

  // Counts the canvas transactions a person has made. The document itself is a
  // fresh object on every keystroke, so it is useless as a trigger; a number is
  // exactly as expressive and compares in one step.
  const [documentRevision, setDocumentRevision] = useState(0)

  // BOTH pipelines are wired up on every render - hooks cannot live inside an
  // `if` - and each one is switched off unless it is the one this template
  // uses. Everything downstream reads `preview`, so the preview, the status
  // bar, the diagnostics, the downloads and the send dialog go on working for
  // either kind without knowing which one they are looking at.
  // The canvas waits for the server's answer before it is mounted at all. That
  // is what makes STUDIO_VISUAL_EDITOR a real rollback switch: with it off, the
  // editor chunk is never even requested.
  const canvasEnabled = isVisual && featuresReady && features.visualEditor
  const codePreview = useRenderPreview(renderer, templateId, draft.source, props, { enabled: !isVisual })
  const visualPreview = useVisualPreview({
    enabled: canvasEnabled,
    resetKey: templateId,
    preheader: draft.envelope.preheader,
    revision: documentRevision,
  })
  // With the canvas switched off there is no editor to compose from - and the
  // whole point of the flag is that the editor is never even downloaded - so
  // the preview falls back to the export saved with this version.
  const savedExport = useSavedExport(template)
  const preview = isVisual ? (canvasEnabled ? visualPreview : savedExport) : codePreview

  /**
   * Merge fields filled in (ADR-26). Everything a PERSON looks at or sends -
   * the preview, the thumbnail, the downloads, the status bar's sizes, the
   * envelope summary and the test send - reads these resolved strings. What is
   * SAVED stays unresolved, so a later server-side send can substitute per
   * recipient.
   *
   * Substitution reads the payload JSON itself, NOT the schema-validated
   * props. Filling the Data tab in is a key at a time, so the schema is red
   * most of the time; resolving against `validation.value` would mean one
   * unfilled key left every OTHER key unresolved too, and the diagnostics row
   * would then name keys whose value is sitting right there. Only text that is
   * not a JSON object at all resolves against `{}` — and then every key shows
   * as missing rather than blank, which is how you find out the JSON is broken.
   */
  const payload: PreviewPayload = useMemo(
    () => parsePayloadObject(draft.payloadText) ?? EMPTY_PAYLOAD,
    [draft.payloadText],
  )
  const resolved = useMemo(() => {
    const html = preview.html === null ? null : applyMergeFields(preview.html, payload, { escape: 'html' })
    const text = preview.text === null ? null : applyMergeFields(preview.text, payload, { escape: 'none' })
    const subject = applyMergeFields(draft.envelope.subject, payload, { escape: 'none' })
    const preheader = applyMergeFields(draft.envelope.preheader, payload, { escape: 'none' })
    return {
      html: html?.text ?? null,
      text: text?.text ?? null,
      envelope: { ...draft.envelope, subject: subject.text, preheader: preheader.text },
      // A `javascript:` or `data:` link can only appear AFTER substitution, so
      // the check runs on the resolved HTML, never on the template's own.
      unsafeHrefs: findUnsafeHrefs(html?.text ?? ''),
    }
  }, [preview.html, preview.text, draft.envelope, payload])

  /**
   * Every key in play, and which of them the payload cannot fill in. The export
   * is debounced, so the keys are taken from the document AND from the last
   * export: a chip typed a second ago is counted immediately.
   */
  const keysInUse = useMemo(
    () =>
      unique([
        ...mergeFieldKeys,
        ...listMergeFields(preview.html ?? ''),
        ...listMergeFields(preview.text ?? ''),
      ]),
    [mergeFieldKeys, preview.html, preview.text],
  )
  const missingKeys = useMemo(() => missingMergeFields(keysInUse, payload), [keysInUse, payload])

  /**
   * The one preview document, built once per successful render (ADR-25).
   * Preview mode and the thumbnail are two views of this exact string; that is
   * what makes switching between them free.
   */
  const previewDocument = useMemo(
    () => (resolved.html === null ? null : buildPreviewDocument(resolved.html)),
    [resolved.html],
  )

  const diagnostics = useMemo(
    () =>
      buildDiagnostics({
        validation,
        renderStatus: preview.status,
        renderResult: preview.result,
        kind: template.kind,
        // Whichever half of the template this kind is authored in. A visual
        // template's source is always empty, so `sourceDirty` could only ever
        // say "Matches the original file" - about a document being typed into.
        contentDirty: isVisual ? documentDirty : sourceDirty,
        payloadDirty,
        missingMergeFields: missingKeys,
        mergeFieldCount: keysInUse.length,
        unsafeHrefs: resolved.unsafeHrefs,
      }),
    [
      validation,
      preview.status,
      preview.result,
      template.kind,
      isVisual,
      documentDirty,
      sourceDirty,
      payloadDirty,
      missingKeys,
      keysInUse,
      resolved.unsafeHrefs,
    ],
  )

  /**
   * The version this studio would write if Save were pressed right now.
   *
   * `preview.html` / `preview.text` rather than `resolved.*` on purpose: what
   * is stored keeps its `{{key}}` tokens (ADR-26). The rule itself — and the
   * shape of each kind's version — lives in `application/versionInput.ts`,
   * where it is unit-tested; this callback only gathers the inputs.
   */
  const currentVersionInput = useCallback(
    (): VersionInput | null =>
      buildVersionInput({
        kind: template.kind,
        envelope: draft.envelope,
        samplePayloadText: draft.payloadText,
        html: preview.html,
        text: preview.text,
        source: draft.source,
        document: draft.document ?? EMPTY_EMAIL_DOCUMENT,
        theme: template.kind === 'visual' ? template.theme : DEFAULT_STUDIO_THEME,
        // A code template's schema is authored with the template; the studio has
        // no UI for it yet, so it is carried forward untouched.
        propsSchemaText: template.propsSchemaText,
        mergeFieldKeys,
      }),
    [preview.html, preview.text, draft, template, mergeFieldKeys],
  )

  const sendVersion = useCallback(
    async (expectedRevision: number): Promise<RepositoryResult<EmailTemplate>> => {
      const input = currentVersionInput()
      if (!input) {
        return { ok: false, failure: { code: 'invalid', message: 'Nothing has been rendered to save yet.' } }
      }
      return writes.saveVersion(templateId, expectedRevision, input)
    },
    [currentVersionInput, writes, templateId],
  )

  const {
    saving,
    conflict: saveConflict,
    dismissConflict,
    save,
  } = useTemplateSave({
    send: sendVersion,
    baseRevision: draft.baseRevision,
    onSaved: actions.markSaved,
  })

  // A metadata PATCH can be refused for exactly the same reason a save can, so
  // it feeds the same dialog rather than inventing a second one.
  const [metadataConflict, setMetadataConflict] = useState<TemplateRecord | null>(null)
  // A refused conversion is the same conflict as a refused save, and reuses the
  // same dialog; it is its own state only because it can be dismissed on its own.
  const [convertConflict, setConvertConflict] = useState<TemplateRecord | null>(null)
  const [copyBusy, setCopyBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  // The open-time banner can be dismissed with "Keep mine"; that choice lasts
  // as long as the screen does, which is what "keep editing" means.
  const [bannerDismissed, setBannerDismissed] = useState(false)

  /**
   * Sends a metadata change. Metadata has no version of its own — it is what
   * the library card shows — so it goes out immediately rather than waiting for
   * a save.
   *
   * `template` is the record the library holds, and every successful write
   * patches that list synchronously (`useTemplateLibrary`), so the revision
   * quoted here is the newest one this browser has been told about — two
   * metadata edits in a row no longer make the second one a conflict with the
   * first.
   */
  const patchMetadata = useCallback(
    async (patch: TemplateMetadataPatch) => {
      const expectedRevision = template.metadata.revision
      const result = await writes.updateMetadata(templateId, expectedRevision, patch)
      if (result.ok) {
        actions.markMetadataSaved(result.value, expectedRevision)
        return
      }
      if (result.failure.code === 'version-conflict') {
        setMetadataConflict(result.failure.current)
        return
      }
      toast.error('That change was not saved.', { description: result.failure.message })
    },
    [writes, templateId, template.metadata.revision, actions],
  )

  const [sendOpen, setSendOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [exportedCodeOpen, setExportedCodeOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<EditorTabId>('tsx')
  // Undo/redo and selection state, published by the canvas for the sub-header.
  // null until the editor chunk has arrived.
  const [visualControls, setVisualControls] = useState<VisualEditorControls | null>(null)
  // The inspector rail below xl. At xl and up the rail is always on screen and
  // this value is simply ignored, which is why it is not stored in the session.
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const renderHistory = useRenderHistory(templateId, preview)
  const { returnMode, rememberMode } = useReturnMode(templateId, template.kind, features)

  /**
   * Visual → code, one way (ADR-28). The hook owns the whole flow: convert,
   * smoke-render through the renderer this page already holds, and only then
   * write. It is called for every template because hooks cannot live inside an
   * `if`; it does nothing at all until the dialog is opened.
   */
  const conversion = useConvertToCode({
    template,
    document: draft.document,
    // The SAVED envelope, not the draft's: the server writes the saved one onto
    // the converted version, so generating the <Preview> from anything else
    // would leave the stored envelope and the stored source disagreeing. An
    // unsaved edit is warned about instead (see useConvertToCode).
    subject: template.envelope.subject,
    preheader: template.envelope.preheader,
    envelopeDirty,
    samplePayloadText: draft.payloadText,
    expectedRevision: draft.baseRevision,
    renderer,
    convert: writes.convertToCode,
    onConverted: actions.markConverted,
    onConflict: setConvertConflict,
  })

  const previewRef = useRef<HTMLElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const inspectorToggleRef = useRef<HTMLButtonElement>(null)
  // Focus follows the workspace only when the keyboard asked for the switch; a
  // click on the mode toggle leaves focus on the button that was just pressed.
  // A ref rather than state: it is a one-shot instruction for the next commit,
  // not something the screen is rendered from.
  const moveFocusOnModeChange = useRef(false)

  useEffect(() => {
    if (!moveFocusOnModeChange.current) return
    moveFocusOnModeChange.current = false
    // The workspace that was hidden a moment ago is on screen by now, so it can
    // take focus. `preventScroll` keeps the page from jumping under the reader.
    const target = mode === 'preview' ? previewRef.current : editorRef.current
    target?.focus({ preventScroll: true })
  }, [mode])

  const lastRenderMs = preview.result?.ok ? preview.result.durationMs : null
  useEffect(() => {
    onRenderTime(lastRenderMs)
    // Back on the library there is no render on screen, so the header's pill
    // must fall back to "—" rather than keep quoting a number from a closed
    // editor (docs/DESIGN.md: it is a measurement of what you are looking at).
    return () => onRenderTime(null)
  }, [lastRenderMs, onRenderTime])

  /**
   * One canvas edit: the draft takes the new document, and the revision counter
   * tells the preview hook to compose again.
   */
  const handleDocumentChange = useCallback(
    (document: EmailDocument) => {
      actions.updateDocument(document)
      setDocumentRevision((revision) => revision + 1)
    },
    [actions],
  )

  /** Closes the off-canvas rail and puts focus back on the button that opened it. */
  const closeInspector = useCallback(() => {
    setInspectorOpen(false)
    inspectorToggleRef.current?.focus({ preventScroll: true })
  }, [])

  /** Pretty-prints one editable tab; the generated tabs have nothing to format. */
  const formatTab = useCallback(
    (tab: EditorTabId) => {
      if (tab === 'props') {
        try {
          actions.updatePayload(formatJson(draft.payloadText))
        } catch {
          toast.error('The payload is not valid JSON, so it was left as it is.')
        }
        return
      }
      if (tab !== 'tsx') return
      void formatTsx(draft.source)
        .then((formatted) => actions.updateSource(formatted))
        .catch(() => toast.error('The source could not be parsed, so it was left as it is.'))
    },
    [actions, draft.payloadText, draft.source],
  )

  /** Every route into a mode goes through here, so the return mode is never missed. */
  const changeMode = useCallback(
    (next: StudioMode) => {
      if (next === mode) return
      if (next === 'preview') rememberMode(mode)
      actions.setMode(next)
    },
    [actions, mode, rememberMode],
  )

  /**
   * The thumbnail's "Open full preview" button, which unmounts itself by
   * switching modes. Focus has to follow, or the browser drops it on <body>
   * and the reader's next Tab starts again at the top of the page.
   */
  const openPreviewFromThumbnail = useCallback(() => {
    moveFocusOnModeChange.current = true
    changeMode('preview')
  }, [changeMode])

  /** ⌘P (and Escape out of the preview): a round trip, with focus following. */
  const togglePreview = useCallback(() => {
    const next = nextModeForPreviewToggle(mode, returnMode)
    if (mode !== 'preview') rememberMode(mode)
    moveFocusOnModeChange.current = true
    actions.setMode(next)
  }, [actions, mode, rememberMode, returnMode])

  const downloadReason = resolved.html === null ? NOTHING_RENDERED_REASON : undefined
  // Refresh re-runs a pipeline, and the saved export is not one. Saying so is
  // better than a button that looks live and does nothing.
  const refreshReason = preview === savedExport ? SAVED_EXPORT_REASON : undefined
  // What you download is what you were looking at: the resolved email, not the
  // template with its tokens still in it.
  const downloadHtml = useCallback(() => {
    if (resolved.html === null) return
    downloadTextFile(`${template.metadata.slug}.html`, resolved.html, 'text/html')
  }, [resolved.html, template.metadata.slug])
  const downloadText = useCallback(() => {
    if (resolved.text === null) return
    downloadTextFile(`${template.metadata.slug}.txt`, resolved.text, 'text/plain')
  }, [resolved.text, template.metadata.slug])

  const dirty = studio.dirtyTemplateIds.has(templateId)
  const errorLabels = useMemo(
    () => diagnostics.filter((item) => item.state === 'error').map((item) => item.label),
    [diagnostics],
  )
  const saveReason = saveTemplateReason({
    dirty,
    rendered: preview.html !== null,
    // What is stored is the render's own output, so Save waits for the render
    // that matches the draft rather than saving the previous one's export.
    status: preview.status,
    errors: errorLabels,
  })

  // Moving around inside the studio never prompts (drafts survive in session
  // storage); leaving the PAGE throws that storage away, so it does.
  useUnsavedChangesGuard(dirty)

  /** ⌘S and the button take the same route, reason included. */
  const requestSave = useCallback(() => {
    if (saveReason !== undefined) {
      toast(saveReason)
      return
    }
    save()
  }, [saveReason, save])

  /**
   * The conflict the dialog is about, whichever write was refused.
   *
   * The wording needs the version the draft started from. A draft written by an
   * older build records 0 for that, and a metadata-only change elsewhere moves
   * the revision without moving the version number, so there is a fallback
   * sentence for the cases `describeVersionConflict` cannot describe.
   */
  const conflictRecord = saveConflict ?? metadataConflict ?? convertConflict
  const conflictCopy: VersionConflictCopy =
    describeVersionConflict(
      draft.baseVersionNumber || template.metadata.version.number,
      conflictRecord?.metadata.version.number ?? template.metadata.version.number,
    ) ?? GENERIC_CONFLICT_COPY

  const closeConflict = useCallback(() => {
    dismissConflict()
    setMetadataConflict(null)
    setConvertConflict(null)
  }, [dismissConflict])

  /** Throws the draft away and shows what the server has. */
  const discardMine = useCallback(() => {
    actions.resetTemplate()
    closeConflict()
    setBannerDismissed(false)
    onReloadLibrary()
    toast.success('Your edits were discarded. Showing the saved version.')
  }, [actions, closeConflict, onReloadLibrary])

  /**
   * Keeps the draft by making it a NEW template. The slug is derived from the
   * copy's name and given a number if that is taken, so pressing this twice
   * produces two copies rather than one error.
   */
  const saveAsCopy = useCallback(async () => {
    const input = currentVersionInput()
    if (!input) {
      toast(NOTHING_RENDERED_REASON)
      return
    }
    const name = `${template.metadata.name} (copy)`
    const base = slugify(name)
    setCopyBusy(true)
    let created = null
    for (let attempt = 0; attempt < MAX_COPY_SLUG_ATTEMPTS; attempt += 1) {
      const result = await writes.create({
        name,
        slug: attempt === 0 ? base : `${base}-${attempt + 1}`,
        kind: template.kind,
        description: template.metadata.description,
        category: template.metadata.category,
        tags: template.metadata.tags,
        initialVersion: input,
      })
      if (result.ok) {
        created = result.value
        break
      }
      if (result.failure.code !== 'slug-taken') {
        setCopyBusy(false)
        toast.error('The copy could not be created.', { description: result.failure.message })
        return
      }
    }
    setCopyBusy(false)
    if (!created) {
      toast.error('The copy could not be created.', { description: 'Too many templates share that name.' })
      return
    }
    // The edits now live in the copy, so the original goes back to its saved state.
    actions.resetTemplate()
    closeConflict()
    toast.success(`Saved as a copy: ${created.metadata.name}.`)
    onOpenTemplate(created.metadata.id)
  }, [currentVersionInput, template, writes, actions, closeConflict, onOpenTemplate])

  /**
   * The draft was made against an older version and the template has since
   * moved on. Shown when the editor OPENS, which is the moment somebody can
   * still choose what to do about it cheaply.
   */
  const showConflictBanner =
    !bannerDismissed &&
    conflictRecord === null &&
    draft.baseRevision > 0 &&
    draft.baseRevision !== template.metadata.revision

  useStudioShortcuts({
    enabled: true,
    onSave: requestSave,
    onPreview: togglePreview,
    onFormat: () => formatTab(activeTab === 'props' ? 'props' : 'tsx'),
    onSendTest: () => setSendOpen(true),
    onShowShortcuts: () => setShortcutsOpen(true),
  })

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <StudioSubHeader
        template={template}
        dirty={studio.dirtyTemplateIds.has(templateId)}
        lastSavedAt={studio.lastSavedAt}
        mode={mode}
        modes={ALL_STUDIO_MODES}
        onModeChange={changeMode}
        modeReason={(candidate: StudioMode) => unavailableModeReason(template.kind, candidate, features)}
        device={state.device}
        onDeviceChange={actions.setDevice}
        onSendTest={() => setSendOpen(true)}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onBackToLibrary={onBackToLibrary}
        onDownloadHtml={downloadHtml}
        onDownloadText={downloadText}
        downloadReason={downloadReason}
        onViewExportedCode={() => setExportedCodeOpen(true)}
        onConvertToCode={canvasEnabled ? conversion.openDialog : undefined}
        onSave={requestSave}
        saving={saving}
        saveReason={saveReason}
        onRename={(name) => void patchMetadata({ name })}
        onToggleStatus={() =>
          void patchMetadata({ status: template.metadata.status === 'ready' ? 'draft' : 'ready' })
        }
        onDelete={() => setDeleteOpen(true)}
        visualControls={visualControls}
        canvasEnabled={canvasEnabled}
        inspectorOpen={canvasEnabled ? inspectorOpen : undefined}
        onToggleInspector={canvasEnabled ? () => setInspectorOpen((open) => !open) : undefined}
        inspectorToggleRef={inspectorToggleRef}
      />

      <EnvelopePanel
        envelope={draft.envelope}
        metadata={template.metadata}
        dirty={envelopeDirty}
        onChange={actions.updateEnvelope}
        onReset={() => {
          actions.resetEnvelope()
          toast.success('Envelope restored to the saved values.')
        }}
        from={fromIdentity}
        onMetadataChange={(patch) => void patchMetadata(patch)}
      />

      {showConflictBanner ? (
        <Alert className="border-warning/30 bg-warning-muted text-warning-foreground mx-4 mt-3 w-auto">
          <AlertTitle>This template changed while you were editing</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-2">
            <span>{conflictCopy.banner}</span>
            <span className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setBannerDismissed(true)}>
                Keep mine
              </Button>
              <Button variant="outline" size="sm" onClick={discardMine}>
                {conflictCopy.discardLabel}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void saveAsCopy()} disabled={copyBusy}>
                Save as a copy
              </Button>
            </span>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* The one scroller in the editor: from `lg` up the shell is exactly one
          viewport tall, so this is what moves. Below `lg` it has no height to
          fill and the page scrolls instead. */}
      <div className="min-h-0 flex-1 overflow-y-auto max-lg:min-h-[640px]">
        <div className="mx-auto flex w-full max-w-[1440px] min-w-0 flex-col gap-4 px-4 py-4">
          {/* The rollback flag, said out loud. Without this the Visual button
              would simply be missing and nobody could tell why. */}
          {isVisual && !features.visualEditor ? (
            <Alert className="border-warning/30 bg-warning-muted text-warning-foreground">
              <AlertTitle>Visual editing is switched off</AlertTitle>
              <AlertDescription>{VISUAL_EDITOR_OFF_MESSAGE}</AlertDescription>
            </Alert>
          ) : null}

          {/* This template's own editor stays mounted while you are in preview
              mode - `hidden` and `inert` (ADR-24) - so the canvas keeps its
              undo history and CodeMirror keeps its measurements. The OTHER
              kind's workspace is not rendered at all: for a code template that
              is what keeps the editor chunk off the wire (plan §3.10; its
              measured size lives in docs/TECH_DEBT.md #33). */}
          {canvasEnabled ? (
            <div
              ref={editorRef}
              tabIndex={-1}
              hidden={mode !== 'visual'}
              inert={mode !== 'visual'}
              className="flex min-h-0 min-w-0 flex-1 flex-col focus-visible:outline-none"
            >
              <VisualWorkspace
                templateId={templateId}
                document={draft.document ?? EMPTY_EMAIL_DOCUMENT}
                theme={template.kind === 'visual' ? template.theme : DEFAULT_STUDIO_THEME}
                onDocumentChange={handleDocumentChange}
                onEditorReady={visualPreview.onReady}
                onEditorDestroy={visualPreview.onDestroy}
                onControlsChange={setVisualControls}
                inspectorOpen={inspectorOpen}
                onCloseInspector={closeInspector}
                mergeFields={{
                  keys: mergeFieldKeys,
                  payloadText: draft.payloadText,
                  onPayloadChange: actions.updatePayload,
                }}
                dataPanel={
                  <PropsPayloadCard
                    validation={validation}
                    payloadDirty={payloadDirty}
                    onFormat={() => formatTab('props')}
                    onReset={() => {
                      actions.resetPayload()
                      toast.success('Preview payload restored to the sample data.')
                    }}
                  />
                }
              />
            </div>
          ) : null}

          {/* Waiting for the server to say whether the canvas is switched on.
              It is one small same-origin request, and the skeleton is the shape
              of the screen that is about to appear. */}
          {isVisual && !featuresReady ? <VisualEditorSkeleton /> : null}

          {isVisual ? null : (
            <div
              ref={editorRef}
              tabIndex={-1}
              hidden={mode !== 'code'}
              inert={mode !== 'code'}
              className="flex min-w-0 flex-col focus-visible:outline-none"
            >
              <CodeWorkspace
                active={mode === 'code'}
                template={template}
                source={draft.source}
                onSourceChange={actions.updateSource}
                sourceDirty={sourceDirty}
                onResetSource={() => {
                  actions.resetSource()
                  toast.success('Source restored to the original file.')
                }}
                payloadText={draft.payloadText}
                onPayloadChange={actions.updatePayload}
                validation={validation}
                payloadDirty={payloadDirty}
                onResetPayload={() => {
                  actions.resetPayload()
                  toast.success('Preview payload restored to the sample data.')
                }}
                html={preview.html}
                text={preview.text}
                renderStatus={preview.status}
                renderResult={preview.result}
                renderHistory={renderHistory}
                activeTab={activeTab}
                onActiveTabChange={setActiveTab}
                onFormat={formatTab}
                diagnostics={diagnostics}
                previewThumbnail={
                  // Not mounted in preview mode: the same document is already on
                  // screen full size, and a second iframe would cost memory for a
                  // picture nobody can see.
                  mode === 'preview' ? null : (
                    <PreviewThumbnail
                      document={previewDocument}
                      status={preview.status}
                      stale={preview.result !== null && !preview.result.ok && previewDocument !== null}
                      onOpenPreview={openPreviewFromThumbnail}
                    />
                  )
                }
              />
            </div>
          )}

          <div hidden={mode !== 'preview'} inert={mode !== 'preview'} className="flex min-w-0 flex-col">
            <PreviewWorkspace
              ref={previewRef}
              template={template}
              envelope={resolved.envelope}
              from={fromIdentity}
              device={state.device}
              status={preview.status}
              result={preview.result}
              document={previewDocument}
              text={resolved.text}
              renderedAt={preview.renderedAt}
              onRefresh={preview.refresh}
              refreshReason={refreshReason}
              onDownloadHtml={downloadHtml}
              onDownloadText={downloadText}
              downloadReason={downloadReason}
              diagnostics={diagnostics}
              onExit={togglePreview}
            />
          </div>
        </div>
      </div>

      {/* Sizes are measured on the RESOLVED email, because that is what would
          be sent; a name is rarely the same length as `{{firstName}}`. */}
      <StudioStatusBar template={template} html={resolved.html} text={resolved.text} />

      {/* The studio's one mode live region: a whole sentence, announced when
          the workspace changes and at no other time (docs/DESIGN.md §4.6). */}
      <span role="status" className="sr-only">
        {MODE_ANNOUNCEMENTS[mode]}
      </span>

      <SendTestEmailDialog
        open={sendOpen}
        onOpenChange={setSendOpen}
        template={template}
        provider={provider}
        subject={resolved.envelope.subject}
        replyTo={draft.envelope.replyTo}
        html={resolved.html}
        text={resolved.text}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ExportedCodeDialog
        open={exportedCodeOpen}
        onOpenChange={setExportedCodeOpen}
        html={preview.html}
        text={preview.text}
        document={draft.document}
      />
      <ConvertToCodeDialog
        open={conversion.open}
        onOpenChange={conversion.setOpen}
        templateName={template.metadata.name}
        preparation={conversion.preparation}
        converting={conversion.converting}
        renderError={conversion.renderError}
        onConfirm={conversion.confirm}
      />
      <VersionConflictDialog
        open={conflictRecord !== null}
        onOpenChange={(open) => {
          if (!open) closeConflict()
        }}
        copy={conflictCopy}
        onSaveAsCopy={() => void saveAsCopy()}
        onDiscardMine={discardMine}
        busy={copyBusy}
      />
      <DeleteTemplateDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        template={template}
        onDelete={async () => {
          await onDeleteTemplate(templateId)
          setDeleteOpen(false)
        }}
      />
    </div>
  )
}

/** How many `-2`, `-3` … slugs "Save as a copy" will try before giving up. */
const MAX_COPY_SLUG_ATTEMPTS = 5

/**
 * What the conflict dialog says when the two version numbers are the same.
 * That happens when the change made elsewhere was metadata only: the revision
 * moved, the version did not, and there is no "v8" to name.
 */
const GENERIC_CONFLICT_COPY: VersionConflictCopy = {
  banner: 'This template was changed elsewhere since you started editing.',
  title: 'This template was changed elsewhere.',
  discardLabel: 'Discard mine and reload',
}

/** The payload every substitution falls back to when the JSON does not parse. */
const EMPTY_PAYLOAD: PreviewPayload = {}

/** One shared empty list, so "no merge fields" keeps a stable identity. */
const EMPTY_KEYS: readonly string[] = []

/** The same list with duplicates removed, keeping the first of each. */
function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}

/**
 * Which mode ⌘P returns to, per template.
 *
 * It is state rather than a constant because a visual template returns to the
 * canvas and a code template to the editor; it is keyed by template id so that
 * opening another template does not send you back to the previous one's mode.
 */
function useReturnMode(templateId: string, kind: TemplateKind, features: StudioFeatures) {
  const [remembered, setRemembered] = useState<{ key: string; mode: StudioMode }>(() => ({
    key: templateId,
    mode: defaultMode(kind, features),
  }))

  const rememberMode = useCallback(
    (mode: StudioMode) => setRemembered({ key: templateId, mode }),
    [templateId],
  )

  const returnMode = remembered.key === templateId ? remembered.mode : defaultMode(kind, features)
  return { returnMode, rememberMode }
}

/**
 * The durations of the last twelve successful renders, oldest first.
 *
 * `renderedAt` is a fresh Date on every success, so it is the signal that a new
 * measurement exists; switching template starts the buffer again, because the
 * numbers describe one template's source.
 */
function useRenderHistory(templateId: string, preview: RenderPreviewState): readonly number[] {
  const [history, setHistory] = useState<History>({ key: templateId, seen: null, values: [] })
  const durationMs = preview.result?.ok === true ? preview.result.durationMs : null
  const renderedAt = preview.renderedAt

  // Adjusting state while rendering (rather than in an effect) is React's own
  // recommendation for "something upstream changed, derive from it": it avoids
  // the extra paint an effect would cause.
  if (renderedAt !== history.seen || templateId !== history.key) {
    setHistory(nextHistory(history, templateId, renderedAt, durationMs))
  }

  return history.key === templateId ? history.values : []
}

interface History {
  readonly key: string
  /** The `renderedAt` already counted, so one success is never counted twice. */
  readonly seen: Date | null
  readonly values: readonly number[]
}

function nextHistory(
  history: History,
  templateId: string,
  renderedAt: Date | null,
  durationMs: number | null,
): History {
  // A different template is a different measurement; the buffer starts again.
  const values = templateId === history.key ? history.values : []
  const measured = renderedAt !== null && durationMs !== null
  return {
    key: templateId,
    seen: renderedAt,
    values: measured ? [...values, durationMs].slice(-RENDER_HISTORY_SIZE) : values,
  }
}
