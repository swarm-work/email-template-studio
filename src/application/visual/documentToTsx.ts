/**
 * The one-way conversion: a visual document becomes a React Email TSX module.
 *
 * Application layer, entirely pure: no React, no DOM, no Zod and — importantly
 * — no Tiptap or `@react-email/editor`. It walks the plain `EmailDocument` the
 * domain describes and prints source text, so the whole converter is table-
 * testable in the Node environment (ADR-28).
 *
 * The rule that shapes everything here: a node this converter does not know is
 * a REFUSAL, not a guess. Degrading an unknown block to raw HTML would hand
 * somebody a template that looks converted and is quietly wrong, so the result
 * is `ok: false` naming the block and where it sits, and the dialog tells them.
 */
import type { EmailDocument, EmailDocumentNode } from '@/domain'
import { MERGE_FIELD_PATTERN } from '../mergeFields'
import {
  element,
  expression,
  expressionAttribute,
  objectKey,
  printJsx,
  printNamedImport,
  printObjectEntry,
  PRINT_WIDTH,
  stringAttribute,
  stringLiteral,
  templateLiteral,
  type JsxAttribute,
  type JsxNode,
  type ObjectEntry,
} from './tsxPrinter'

/**
 * The theme styles a node would have been rendered with, as React style
 * properties. The converter declares the shape; `infrastructure/render/
 * visualStyleResolver.ts` implements it with the editor package's own theming
 * helpers, which is the only reason that package is involved at all.
 */
export type NodeStyleResolver = (
  node: EmailDocumentNode,
  depth: number,
) => Readonly<Record<string, string | number>>

export interface DocumentToTsxOptions {
  /** The exported component's name, e.g. `ProductLaunchEmail`. */
  readonly componentName: string
  /** The props interface's name, e.g. `ProductLaunchProps`. */
  readonly propsInterfaceName: string
  /** Recorded in the module's header comment; a subject is not part of a component. */
  readonly subject: string
  /** '' means the module renders no `<Preview>` element. */
  readonly preheader: string
  /** Optional: with no resolver the output carries no theme styles at all. */
  readonly resolveStyle?: NodeStyleResolver
}

/** One `{{key}}` from the document, and the prop it became. */
export interface ConvertedProp {
  /** The prop name in the generated interface, e.g. `userFirstName`. */
  readonly name: string
  /** The merge field it came from, e.g. `user.first_name`. */
  readonly mergeFieldKey: string
}

/** A block the converter refuses to guess at. */
export interface UnsupportedNode {
  /** The node (or mark) type, e.g. `bulletList`. */
  readonly node: string
  /** One sentence for the dialog. */
  readonly message: string
  /** Where it sits, e.g. `doc > container[0] > bulletList[3]`. */
  readonly path: string
}

export type DocumentToTsxResult =
  | {
      readonly ok: true
      readonly source: string
      /** The prop names the generated interface declares, in order of first use. */
      readonly propKeys: readonly string[]
      readonly props: readonly ConvertedProp[]
      /** Lossy but convertible: shown as a note, never a blocker. */
      readonly warnings: readonly string[]
    }
  | { readonly ok: false; readonly reasons: readonly UnsupportedNode[] }

/**
 * Converts `document` into a React Email module.
 *
 * The narrow first set is deliberate (plan §3.7): doc, body, container,
 * section, div, paragraph, heading 1–6, text, hardBreak, horizontalRule,
 * button, image and mergeField, with the marks bold, italic, underline, strike,
 * code, sup, uppercase, link and preservedStyle. Lists, columns, tables,
 * blockquotes and code blocks are refused until they are really supported.
 */
export function documentToTsx(document: EmailDocument, options: DocumentToTsxOptions): DocumentToTsxResult {
  const context = createContext(options)
  const root = buildRoot(context, document, options)

  if (context.reasons.length > 0) return { ok: false, reasons: context.reasons }

  return {
    ok: true,
    source: printModule(context, root, options),
    propKeys: context.props.map((prop) => prop.name),
    props: context.props,
    warnings: context.warnings,
  }
}

/**
 * The payload that renders a converted template with its merge fields still in
 * place: every prop is set to the `{{key}}` it came from.
 *
 * That is exactly what the smoke render before the save needs. What is stored
 * has to keep its tokens (ADR-26), so the HTML that comes back from rendering
 * with THIS payload is the HTML to store.
 */
export function conversionPayload(props: readonly ConvertedProp[]): Record<string, string> {
  const payload: Record<string, string> = {}
  for (const prop of props) payload[prop.name] = `{{${prop.mergeFieldKey}}}`
  return payload
}

/** `Product launch` → `ProductLaunchEmail`, the name of the exported component. */
export function tsxComponentName(templateName: string): string {
  const pascal = toPascalCase(templateName)
  return pascal === '' ? 'ConvertedEmail' : `${pascal}Email`
}

/** `Product launch` → `ProductLaunchProps`, the name of the generated interface. */
export function tsxPropsInterfaceName(templateName: string): string {
  const pascal = toPascalCase(templateName)
  return pascal === '' ? 'ConvertedEmailProps' : `${pascal}Props`
}

/* -------------------------------------------------------------------------
 * Walking the document
 * ---------------------------------------------------------------------- */

interface Context {
  readonly resolveStyle?: NodeStyleResolver
  /**
   * Names the generated module already uses. A prop called `styles` would
   * shadow the module's own `styles` object inside the component, and every
   * `style={styles.text}` would silently read a property off a string.
   */
  readonly reserved: ReadonlySet<string>
  readonly reasons: UnsupportedNode[]
  readonly warnings: string[]
  readonly props: ConvertedProp[]
  /** Merge-field key → prop name, so the same key always prints the same prop. */
  readonly propNames: Map<string, string>
  /** Serialised style → the name it was stored under, so identical styles share one entry. */
  readonly styleNames: Map<string, string>
  /** Style name → its printed entries, in insertion order. */
  readonly styles: Map<string, readonly ObjectEntry[]>
  /** Names imported from `@react-email/components`. */
  readonly components: Set<string>
}

function createContext(options: DocumentToTsxOptions): Context {
  return {
    resolveStyle: options.resolveStyle,
    reserved: new Set(['React', 'styles', options.componentName, options.propsInterfaceName]),
    reasons: [],
    warnings: [],
    props: [],
    propNames: new Map(),
    styleNames: new Map(),
    styles: new Map(),
    components: new Set(),
  }
}

/**
 * The `<Html>` shell: head, optional preview line, and a `<Body>` holding the
 * document's blocks.
 *
 * A document may or may not have a `body` node — the editor's own starters are
 * rooted in a `container` — so one is synthesised when it is missing, with the
 * theme's body styles on it. That mirrors what the editor's serializer does at
 * export time, which is what keeps the two renderings comparable.
 */
function buildRoot(context: Context, document: EmailDocument, options: DocumentToTsxOptions): JsxNode {
  const topLevel = (document.content ?? []).filter((node) => {
    if (node.type === 'globalContent') return false
    if (node.type === 'previewText') {
      addWarning(
        context,
        'The document’s own preview text was dropped: the envelope’s preheader becomes the <Preview> line.',
      )
      return false
    }
    return true
  })

  const bodyIndex = topLevel.findIndex((node) => node.type === 'body')
  const bodyNode = bodyIndex === -1 ? undefined : topLevel[bodyIndex]

  // A document rooted in a `body` puts every block inside it. Anything ELSE at
  // the top level would have nowhere to go, and dropping a block in silence is
  // the one thing this converter must never do (ADR-28), so it is refused.
  if (bodyNode) {
    topLevel.forEach((node, index) => {
      if (index === bodyIndex) return
      const type = node.type ?? 'unknown'
      refuse(context, type, `doc > ${type}[${index}]`, 'This block sits outside the email body.')
    })
  }

  // The path names every level, `body` included, because the whole value of a
  // refusal is that somebody can find the block it is talking about.
  const blockSource = bodyNode ? (bodyNode.content ?? []) : topLevel
  const blockPath = bodyNode ? `doc > body[${bodyIndex}]` : 'doc'
  const blocks = visibleContent(context, blockSource)
    .map((node, index) => buildNode(context, node, blockPath, index))
    .filter(isJsxNode)

  const shell: JsxNode[] = [withImport(context, element('Head'))]
  if (options.preheader !== '') {
    shell.push(withImport(context, element('Preview', [], [inlineFromText(context, options.preheader)])))
  }
  const bodyStyle = styleAttribute(context, bodyNode ?? { type: 'body' }, 'body')
  shell.push(withImport(context, element('Body', attributes(bodyStyle), blocks)))

  return withImport(context, element('Html', [stringAttribute('lang', 'en')], shell))
}

/**
 * The editor's serializer drops a trailing empty paragraph unless the node
 * before it is a paragraph too (`composeReactEmail`'s own filter). The rule is
 * mirrored here so the converted module renders the same trailing space — or
 * the same lack of it — as the canvas did.
 */
function visibleContent(
  context: Context,
  content: readonly EmailDocumentNode[],
): readonly EmailDocumentNode[] {
  const kept = content.filter((node, index, nodes) => {
    if (node.type !== 'paragraph' || (node.content?.length ?? 0) > 0) return true
    if (index !== nodes.length - 1) return true
    const previous = nodes[index - 1]
    return previous ? previous.type === 'paragraph' : false
  })
  if (kept.length !== content.length) {
    addWarning(context, 'A trailing empty paragraph was dropped, exactly as the visual export drops it.')
  }
  return kept
}

/** One node of the document, or null when it was refused (a reason was recorded). */
function buildNode(
  context: Context,
  node: EmailDocumentNode,
  parentPath: string,
  index: number,
): JsxNode | null {
  const type = node.type ?? 'unknown'
  const path = `${parentPath} > ${type}[${index}]`

  switch (type) {
    case 'container':
      return withImport(
        context,
        element(
          'Container',
          attributes(styleAttribute(context, node, 'container')),
          children(context, node, path),
        ),
      )

    case 'section':
    case 'div':
      return withImport(
        context,
        element(
          'Section',
          attributes(styleAttribute(context, node, 'section')),
          children(context, node, path),
        ),
      )

    case 'paragraph': {
      // The style is resolved before the children so that the `styles` object
      // ends up in document order, which is how somebody will read it.
      const style = styleAttribute(context, node, 'text')
      const inline = children(context, node, path)
      // An empty paragraph is a deliberate blank line; the editor renders <br/>.
      const content = inline.length > 0 ? inline : [element('br')]
      return withImport(context, element('Text', attributes(style), content))
    }

    case 'heading':
      return buildHeading(context, node, path)

    case 'button':
      return buildButton(context, node, path)

    case 'horizontalRule':
      return withImport(context, element('Hr', attributes(styleAttribute(context, node, 'hr'))))

    case 'image':
      return buildImage(context, node, path)

    case 'hardBreak':
      return element('br')

    case 'mergeField':
      return expression(propFor(context, String(node.attrs?.key ?? '')))

    case 'text':
      return buildText(context, node, path)

    default:
      refuse(context, type, path)
      return null
  }
}

/** Every child of `node`, refusals removed (they are recorded as reasons). */
function children(context: Context, node: EmailDocumentNode, path: string): JsxNode[] {
  return visibleContent(context, node.content ?? [])
    .map((child, index) => buildNode(context, child, path, index))
    .filter(isJsxNode)
}

function buildHeading(context: Context, node: EmailDocumentNode, path: string): JsxNode | null {
  const level = Number(node.attrs?.level ?? 1)
  if (!Number.isInteger(level) || level < 1 || level > 6) {
    refuse(
      context,
      'heading',
      path,
      `Heading level ${String(node.attrs?.level)} has no React Email equivalent.`,
    )
    return null
  }
  const style = styleAttribute(context, node, `heading${level}`)
  return withImport(
    context,
    element(
      'Heading',
      [stringAttribute('as', `h${level}`), ...attributes(style)],
      children(context, node, path),
    ),
  )
}

/**
 * A button is two elements: the row that positions it and the button itself.
 * React Email's `<Button>` is an inline-block anchor, so the alignment lives on
 * a `<Section>` around it (plan §3.7) rather than on the button.
 */
function buildButton(context: Context, node: EmailDocumentNode, path: string): JsxNode {
  const alignment = textAlignmentOf(node) || 'left'
  const rowStyle = registerStyle(context, 'buttonRow', { textAlign: alignment })
  const href = readString(node.attrs?.href) || '#'
  const buttonAttributes: JsxAttribute[] = [
    textAttribute(context, 'href', href),
    // The alignment is already on the row; repeating it on the button would
    // centre the label inside a button that is only as wide as its label.
    ...attributes(styleAttribute(context, node, 'button', { alignment: false })),
  ]
  const button = withImport(context, element('Button', buttonAttributes, children(context, node, path)))
  return withImport(context, element('Section', attributes(rowStyle), [button]))
}

function buildImage(context: Context, node: EmailDocumentNode, path: string): JsxNode | null {
  const src = readString(node.attrs?.src)
  if (src === '') {
    refuse(context, 'image', path, 'This image has no source address, so it cannot be converted.')
    return null
  }
  const alt = readString(node.attrs?.alt)
  if (alt === '') {
    addWarning(context, 'An image has no alternative text, so it was converted with an empty `alt`.')
  }
  const alignment = readString(node.attrs?.alignment)
  if (alignment !== '' && alignment !== 'left') {
    addWarning(context, 'Image alignment is not carried over; set it with a style on the image instead.')
  }

  const imageAttributes: JsxAttribute[] = [
    textAttribute(context, 'src', src),
    stringAttribute('alt', alt),
    ...sizeAttribute(node.attrs?.width, 'width'),
    ...sizeAttribute(node.attrs?.height, 'height'),
    // `alignment: false` is what makes the warning above honest: `text-align`
    // does nothing to a replaced element like `<img>`, and the editor's own
    // image serializer does not emit it either. Warning that alignment was
    // dropped while quietly emitting it would be the worst of both.
    ...attributes(styleAttribute(context, node, 'image', { alignment: false })),
  ]
  const image = withImport(context, element('Img', imageAttributes))

  const href = readString(node.attrs?.href)
  if (href === '') return image
  return withImport(context, element('Link', [textAttribute(context, 'href', href)], [image]))
}

/**
 * `width` / `height` as React Email takes them: a string or a number.
 *
 * `'auto'` is the editor's own spelling of "not set" — it is the default for
 * both dimensions, so every image inserted through the canvas carries it — and
 * its serializer drops it rather than writing it out. It has to be dropped here
 * too: `width="auto"` is not a legal value for the HTML attribute, and Outlook
 * in particular does not read it as "unspecified".
 */
function sizeAttribute(value: unknown, name: string): JsxAttribute[] {
  if (typeof value === 'number') return [expressionAttribute(name, String(value))]
  const text = readString(value)
  return text === '' || text === 'auto' ? [] : [stringAttribute(name, text)]
}

/** A text node, wrapped in one element per mark it carries. */
function buildText(context: Context, node: EmailDocumentNode, path: string): JsxNode | null {
  let current: JsxNode = inlineFromText(context, node.text ?? '')
  for (const mark of sortMarks(node.marks ?? [])) {
    const wrapped = wrapInMark(context, mark, current, path)
    if (wrapped === null) return null
    current = wrapped
  }
  return current
}

/**
 * The order marks are applied in, innermost first. The editor sorts by its
 * schema's own ranking; a fixed order here is what makes the output the same
 * every time, and the nesting of `<strong>` inside `<em>` (or the other way
 * round) renders identically anyway.
 */
const MARK_ORDER = [
  'code',
  'sup',
  'strike',
  'underline',
  'italic',
  'bold',
  'preservedStyle',
  'uppercase',
  'link',
]

function sortMarks(marks: readonly EmailDocumentNode[]): readonly EmailDocumentNode[] {
  return [...marks].sort((a, b) => rankOf(a.type) - rankOf(b.type))
}

function rankOf(type: string | undefined): number {
  const rank = MARK_ORDER.indexOf(type ?? '')
  return rank === -1 ? MARK_ORDER.length : rank
}

function wrapInMark(context: Context, mark: EmailDocumentNode, child: JsxNode, path: string): JsxNode | null {
  const type = mark.type ?? 'unknown'
  // The editor styles a mark exactly as it styles a node of that name, so the
  // resolver is asked the same question here (see composeReactEmail).
  const themed = styleAttribute(context, { type, attrs: mark.attrs }, type)

  switch (type) {
    case 'bold':
      return element('strong', attributes(themed), [child])
    case 'italic':
      return element('em', attributes(themed), [child])
    case 'underline':
      return element('u', attributes(themed), [child])
    case 'strike':
      return element('s', attributes(themed), [child])
    case 'code':
      return element('code', attributes(themed), [child])
    case 'sup':
      return element('sup', attributes(themed), [child])
    case 'uppercase':
      return element('span', attributes(uppercaseStyle(context, mark)), [child])
    case 'preservedStyle':
      return element('span', attributes(styleAttribute(context, { type, attrs: mark.attrs }, 'span')), [
        child,
      ])
    case 'link':
      return buildLink(context, mark, child, themed)
    default:
      refuse(context, type, path, `The text style "${type}" has no React Email equivalent yet.`)
      return null
  }
}

/** `uppercase` is a style, not an element: the mark IS `text-transform`. */
function uppercaseStyle(context: Context, mark: EmailDocumentNode): JsxAttribute | null {
  const themed = context.resolveStyle ? context.resolveStyle({ type: 'uppercase', attrs: mark.attrs }, 0) : {}
  return registerStyle(context, 'uppercase', { ...themed, textTransform: 'uppercase' })
}

function buildLink(
  context: Context,
  mark: EmailDocumentNode,
  child: JsxNode,
  themed: JsxAttribute | null,
): JsxNode {
  const attributeList: JsxAttribute[] = [textAttribute(context, 'href', readString(mark.attrs?.href))]
  const target = readString(mark.attrs?.target)
  if (target !== '') attributeList.push(stringAttribute('target', target))
  const rel = readString(mark.attrs?.rel)
  if (rel !== '') attributeList.push(stringAttribute('rel', rel))
  attributeList.push(...attributes(themed))
  return withImport(context, element('Link', attributeList, [child]))
}

/** Records a refusal. The walk carries on so the dialog can list every one. */
function refuse(context: Context, node: string, path: string, message?: string): void {
  context.reasons.push({
    node,
    path,
    message: message ?? `"${node}" has no React Email equivalent yet, so it cannot be converted.`,
  })
}

/** Warnings are shown once, however many nodes produced them. */
function addWarning(context: Context, message: string): void {
  if (!context.warnings.includes(message)) context.warnings.push(message)
}

function isJsxNode(node: JsxNode | null): node is JsxNode {
  return node !== null
}

/* -------------------------------------------------------------------------
 * Merge fields → props
 * ---------------------------------------------------------------------- */

interface Segment {
  readonly kind: 'text' | 'field'
  readonly value: string
}

/** Splits `Hi {{name}}!` into its literal pieces and its merge fields. */
function splitMergeFields(text: string): Segment[] {
  const segments: Segment[] = []
  // A fresh regex per scan: a global one remembers where it stopped.
  const scanner = new RegExp(MERGE_FIELD_PATTERN.source, 'g')
  let position = 0
  for (const match of text.matchAll(scanner)) {
    const start = match.index ?? 0
    if (start > position) segments.push({ kind: 'text', value: text.slice(position, start) })
    segments.push({ kind: 'field', value: match[1] })
    position = start + match[0].length
  }
  if (position < text.length) segments.push({ kind: 'text', value: text.slice(position) })
  return segments
}

/**
 * Text as one JSX expression: a string literal, a lone prop reference, or a
 * template literal when the two are mixed.
 */
function inlineFromText(context: Context, text: string): JsxNode {
  const segments = splitMergeFields(text)
  if (segments.length === 0) return expression(stringLiteral(''))
  if (segments.length === 1) {
    const [only] = segments
    return expression(only.kind === 'text' ? stringLiteral(only.value) : propFor(context, only.value))
  }
  return expression(templateFrom(context, segments))
}

/** The same for an attribute: `href="/x"`, `href={link}` or `href={`/x/${id}`}`. */
function textAttribute(context: Context, name: string, value: string): JsxAttribute {
  const segments = splitMergeFields(value)
  if (segments.length === 1 && segments[0].kind === 'field') {
    return expressionAttribute(name, propFor(context, segments[0].value))
  }
  if (segments.some((segment) => segment.kind === 'field')) {
    return expressionAttribute(name, templateFrom(context, segments))
  }
  return stringAttribute(name, value)
}

function templateFrom(context: Context, segments: readonly Segment[]): string {
  const parts: string[] = []
  const expressions: string[] = []
  let pending = ''
  for (const segment of segments) {
    if (segment.kind === 'text') {
      pending += segment.value
      continue
    }
    parts.push(pending)
    pending = ''
    expressions.push(propFor(context, segment.value))
  }
  parts.push(pending)
  return templateLiteral(parts, expressions)
}

/** JavaScript words a prop cannot be named, because `{ class }` would not parse. */
const RESERVED_WORDS = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
])

/**
 * The prop a merge field becomes: `{{user.first_name}}` → `userFirstName`.
 * The same key always gives the same prop, and two different keys that would
 * collide get a number (`userName`, `userName2`).
 */
function propFor(context: Context, key: string): string {
  const existing = context.propNames.get(key)
  if (existing !== undefined) return existing

  const base = propNameFor(key)
  let name = base
  let suffix = 2
  const taken = new Set([...context.reserved, ...context.props.map((prop) => prop.name)])
  while (taken.has(name)) {
    name = `${base}${suffix}`
    suffix += 1
  }
  context.propNames.set(key, name)
  context.props.push({ name, mergeFieldKey: key })
  return name
}

function propNameFor(key: string): string {
  const words = key.split(/[.\-_]+/).filter((word) => word !== '')
  const camel = words
    .map((word, index) => (index === 0 ? lowerFirst(word) : upperFirst(word)))
    .join('')
    .replace(/[^A-Za-z0-9_$]/g, '')
  if (camel === '' || /^[0-9]/.test(camel)) return `field${upperFirst(camel)}`
  return RESERVED_WORDS.has(camel) ? `${camel}Value` : camel
}

function lowerFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1)
}

function upperFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function toPascalCase(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== '')
    .map((word) => upperFirst(word))
    .join('')
    .replace(/^[0-9]+/, '')
}

/* -------------------------------------------------------------------------
 * Styles
 * ---------------------------------------------------------------------- */

/**
 * The style a node ends up with: the theme's, then whatever the inspector
 * wrote into the node's own `style` attribute, then its alignment. That is the
 * same order the editor's serializer merges them in.
 */
function styleAttribute(
  context: Context,
  node: EmailDocumentNode,
  baseName: string,
  options: { readonly alignment?: boolean } = {},
): JsxAttribute | null {
  const themed = context.resolveStyle ? context.resolveStyle(node, 0) : {}
  const merged: Record<string, string | number> = {
    ...themed,
    ...inlineCssToJs(node.attrs?.style),
    ...(options.alignment === false ? {} : alignmentStyle(node)),
  }
  return registerStyle(context, baseName, merged)
}

/**
 * The three values `text-align` may take here.
 *
 * The editor offers a fourth, `justify`, and then throws it away at export time
 * (`getTextAlignment` returns nothing for it). Converting it would make the
 * email justified where the canvas showed it ragged — a silent difference in an
 * operation that cannot be undone — so the same three are the only ones kept.
 */
const TEXT_ALIGNMENTS = new Set(['left', 'center', 'right'])

/** A node's alignment, or '' when it has none this converter will carry over. */
function textAlignmentOf(node: EmailDocumentNode): string {
  const alignment = readString(node.attrs?.align) || readString(node.attrs?.alignment)
  return TEXT_ALIGNMENTS.has(alignment) ? alignment : ''
}

function alignmentStyle(node: EmailDocumentNode): Record<string, string> {
  const alignment = textAlignmentOf(node)
  return alignment === '' ? {} : { textAlign: alignment }
}

/**
 * Stores a style in the module's `styles` object and returns `style={styles.x}`.
 *
 * Two nodes with the same style share one entry: a converted template is read
 * by a person, and twelve identical `text2 … text13` blocks would be noise.
 */
function registerStyle(
  context: Context,
  baseName: string,
  style: Record<string, string | number | undefined>,
): JsxAttribute | null {
  const entries: ObjectEntry[] = []
  for (const [property, value] of Object.entries(style)) {
    if (value === undefined || value === null || value === '') continue
    entries.push({
      key: objectKey(property),
      value: typeof value === 'number' ? String(value) : stringLiteral(value),
    })
  }
  if (entries.length === 0) return null

  const fingerprint = entries.map((entry) => `${entry.key}:${entry.value}`).join(';')
  const known = context.styleNames.get(fingerprint)
  if (known !== undefined) return expressionAttribute('style', `styles.${known}`)

  let name = baseName
  let suffix = 2
  while (context.styles.has(name)) {
    name = `${baseName}${suffix}`
    suffix += 1
  }
  context.styleNames.set(fingerprint, name)
  context.styles.set(name, entries)
  return expressionAttribute('style', `styles.${name}`)
}

/**
 * `font-size: 14px; color: red` → `{ fontSize: '14px', color: 'red' }`.
 *
 * Values are kept as text: `'14px'` is what the editor stored and what a mail
 * client will read. A declaration containing a `;` inside a value (a `data:`
 * URL in a `background-image`, say) is beyond this splitter — the studio has no
 * UI that writes one, and the fidelity test would catch it if it did.
 */
function inlineCssToJs(css: unknown): Record<string, string> {
  const text = readString(css)
  if (text === '') return {}
  const styles: Record<string, string> = {}
  for (const declaration of text.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon === -1) continue
    const property = declaration.slice(0, colon).trim()
    const value = declaration.slice(colon + 1).trim()
    if (property === '' || value === '') continue
    styles[cssPropertyToJs(property)] = value
  }
  return styles
}

function cssPropertyToJs(property: string): string {
  // Custom properties (`--brand`) keep their name; React passes them straight through.
  if (property.startsWith('--')) return property
  return property.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase())
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** `[attribute]` when there is one, `[]` when there is not. */
function attributes(attribute: JsxAttribute | null): JsxAttribute[] {
  return attribute === null ? [] : [attribute]
}

/** Records that the module imports this component, and returns the node unchanged. */
function withImport(context: Context, node: JsxNode): JsxNode {
  if (node.kind === 'element' && /^[A-Z]/.test(node.tag)) context.components.add(node.tag)
  return node
}

/* -------------------------------------------------------------------------
 * Printing the module
 * ---------------------------------------------------------------------- */

function printModule(context: Context, root: JsxNode, options: DocumentToTsxOptions): string {
  const hasStyles = context.styles.size > 0
  const lines: string[] = []

  // `React` is imported only when the styles object needs `React.CSSProperties`:
  // an unused import would fail `noUnusedLocals` in the studio's own build.
  if (hasStyles) lines.push("import * as React from 'react'")
  lines.push(...printNamedImport([...context.components], '@react-email/components'))
  lines.push('')
  lines.push(...printHeaderComment(options))
  lines.push('')

  if (context.props.length > 0) {
    lines.push(`export interface ${options.propsInterfaceName} {`)
    for (const prop of context.props) lines.push(`  ${prop.name}: string`)
    lines.push('}')
    lines.push('')
  }

  lines.push(...printSignature(context, options))
  lines.push('  return (')
  lines.push(...printJsx(root, 2))
  lines.push('  )')
  lines.push('}')

  if (hasStyles) {
    lines.push('')
    lines.push('const styles = {')
    for (const [name, entries] of context.styles) lines.push(...printObjectEntry(name, entries, 1))
    lines.push('} satisfies Record<string, React.CSSProperties>')
  }

  return `${lines.join('\n')}\n`
}

/** The module's own explanation, since a converted file has no author to ask. */
function printHeaderComment(options: DocumentToTsxOptions): string[] {
  const subject = options.subject === '' ? '(none)' : safeComment(options.subject)
  return [
    '/**',
    ` * ${safeComment(options.componentName)}: converted from a visual template.`,
    ' *',
    ` * Subject: ${subject}`,
    ' *',
    ' * This file is the template now. The visual document it came from was',
    ' * discarded, and hand-written TSX cannot be converted back to a canvas.',
    ' * Every {{key}} merge field became a prop, so the same preview payload',
    ' * keeps working.',
    ' */',
  ]
}

/** A comment can hold anything except the sequence that would end it. */
function safeComment(value: string): string {
  return value.replace(/\*\//g, '* /')
}

/**
 * `export default function X({ a, b }: XProps) {`, broken one prop per line
 * when that line would pass 110 columns — which is what prettier would do.
 */
function printSignature(context: Context, options: DocumentToTsxOptions): string[] {
  if (context.props.length === 0) return [`export default function ${options.componentName}() {`]
  const names = context.props.map((prop) => prop.name)
  const inline = `export default function ${options.componentName}({ ${names.join(', ')} }: ${options.propsInterfaceName}) {`
  if (inline.length <= PRINT_WIDTH) return [inline]
  return [
    `export default function ${options.componentName}({`,
    ...names.map((name) => `  ${name},`),
    `}: ${options.propsInterfaceName}) {`,
  ]
}
