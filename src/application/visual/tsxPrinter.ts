/**
 * A very small, deterministic printer for the TSX the converter emits.
 *
 * Application layer, entirely pure: no React, no DOM, no Zod, no editor. It
 * knows nothing about emails — it turns a tiny tree of elements, attributes and
 * expressions into text laid out the way this repository's prettier config
 * would (2-space indent, single quotes, 110 columns).
 *
 * Why not call prettier: it is ~250 KB of parsers the studio loads lazily for
 * the Format button, and a converter that needs a formatter to produce readable
 * output cannot be unit-tested in one step. `documentToTsx.test.ts` checks this
 * printer's output against the real prettier, so the agreement is proved.
 */

/** The column the printer tries to stay inside; the same number as .prettierrc. */
export const PRINT_WIDTH = 110

/** Two spaces, like everything else in this repository. */
const INDENT = '  '

/**
 * One JSX attribute. `value` is ALREADY printed source — `"h1"` or
 * `{styles.body}` — because the converter is the side that knows whether a
 * value is a string, a prop reference or a template literal.
 */
export interface JsxAttribute {
  readonly name: string
  readonly value: string
}

/**
 * A piece of JSX. Deliberately only two shapes: an element, and an expression
 * container. All text is emitted as an expression holding a string literal, so
 * the printer never has to reproduce prettier's re-flowing of JSX text.
 */
export type JsxNode =
  | {
      readonly kind: 'element'
      readonly tag: string
      readonly attributes: readonly JsxAttribute[]
      readonly children: readonly JsxNode[]
    }
  | { readonly kind: 'expression'; readonly code: string }

/** `<Tag …>…</Tag>`, or `<Tag … />` when it has no children. */
export function element(
  tag: string,
  attributes: readonly JsxAttribute[] = [],
  children: readonly JsxNode[] = [],
): JsxNode {
  return { kind: 'element', tag, attributes, children }
}

/** `{code}` — a prop reference, a template literal, a string literal. */
export function expression(code: string): JsxNode {
  return { kind: 'expression', code }
}

/**
 * `name="value"`, with the value escaped for a double-quoted attribute.
 *
 * `&` is escaped FIRST and always: a JSX attribute's text is HTML-entity
 * decoded by the compiler, so an href copied out of a web page as
 * `?a=1&amp;b=2` would otherwise reach the browser as `?a=1&b=2` — a different
 * link. Escaping it to `&amp;amp;` makes the decoder give the `&amp;` back.
 */
export function stringAttribute(name: string, value: string): JsxAttribute {
  const escaped = value.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return { name, value: `"${escaped}"` }
}

/** `name={code}` — for styles, numbers and anything containing a prop. */
export function expressionAttribute(name: string, code: string): JsxAttribute {
  return { name, value: `{${code}}` }
}

/**
 * A JavaScript string literal, single-quoted like the rest of the repository.
 *
 * The exception is prettier's own: even under `singleQuote: true` it picks the
 * quote that needs FEWER escapes, so ordinary email copy like `Here's what's
 * new` comes out double-quoted. Getting this wrong would mean every converted
 * template with an apostrophe in it was reformatted the moment somebody pressed
 * Format.
 *
 * Newlines are escaped rather than kept, so every expression this printer
 * handles really is one line long and the layout decisions below only ever have
 * to compare lengths.
 */
export function stringLiteral(value: string): string {
  const quote = occurrences(value, "'") > occurrences(value, '"') ? '"' : "'"
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .split(quote)
    .join(`\\${quote}`)
  return `${quote}${escaped}${quote}`
}

/** How many times `character` appears in `value`. */
function occurrences(value: string, character: string): number {
  return value.split(character).length - 1
}

/**
 * A template literal: `Hi ${firstName}`. `parts` are the literal pieces and
 * `expressions` the code between them, so `parts.length` is always
 * `expressions.length + 1`.
 */
export function templateLiteral(parts: readonly string[], expressions: readonly string[]): string {
  let out = '`'
  parts.forEach((text, index) => {
    out += escapeTemplateText(text)
    if (index < expressions.length) out += `\${${expressions[index]}}`
  })
  return `${out}\``
}

function escapeTemplateText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')
}

/**
 * Prints one JSX node as lines of source, indented `level` steps.
 *
 * The three layout rules are prettier's own, established by running it (see
 * `tsxPrinter.test.ts`, which re-checks them):
 *
 * 1. An element keeps its child on the same line ONLY when it has exactly one
 *    child, that child is an expression, and its opening tag carries at most
 *    one attribute. Anything else — a second attribute, a second child, an
 *    element child — breaks, even when it would have fitted.
 * 2. Attributes only go one per line when the opening tag alone is too long.
 * 3. An expression that does not fit is indented onto its own line, unless it
 *    is a template literal, which prettier never breaks.
 */
export function printJsx(node: JsxNode, level: number): string[] {
  const pad = INDENT.repeat(level)
  if (node.kind === 'expression') return printExpression(node.code, pad)

  if (node.children.length === 0) return printSelfClosing(node, pad)

  if (canHugChild(node)) {
    const only = node.children[0]
    const oneLine = `${pad}${openTag(node)}>${printedExpression(only)}</${node.tag}>`
    if (oneLine.length <= PRINT_WIDTH) return [oneLine]
  }

  const lines = [...printOpenTag(node, pad)]
  for (const child of node.children) lines.push(...printJsx(child, level + 1))
  lines.push(`${pad}</${node.tag}>`)
  return lines
}

/** Rule 1: the only shape prettier is willing to keep on one line. */
function canHugChild(node: Extract<JsxNode, { kind: 'element' }>): boolean {
  return node.children.length === 1 && node.children[0].kind === 'expression' && node.attributes.length <= 1
}

function printedExpression(node: JsxNode): string {
  return node.kind === 'expression' ? `{${node.code}}` : ''
}

function printExpression(code: string, pad: string): string[] {
  const line = `${pad}{${code}}`
  // A template literal is one token to prettier: it stays where it is, however
  // long it is. A string literal gets indented onto a line of its own instead.
  if (line.length <= PRINT_WIDTH || code.startsWith('`')) return [line]
  return [`${pad}{`, `${pad}${INDENT}${code}`, `${pad}}`]
}

function printSelfClosing(node: Extract<JsxNode, { kind: 'element' }>, pad: string): string[] {
  const line = `${pad}${openTag(node)} />`
  if (line.length <= PRINT_WIDTH) return [line]
  return [
    `${pad}<${node.tag}`,
    ...node.attributes.map((attribute) => `${pad}${INDENT}${attribute.name}=${attribute.value}`),
    `${pad}/>`,
  ]
}

function printOpenTag(node: Extract<JsxNode, { kind: 'element' }>, pad: string): string[] {
  const line = `${pad}${openTag(node)}>`
  if (line.length <= PRINT_WIDTH) return [line]
  return [
    `${pad}<${node.tag}`,
    ...node.attributes.map((attribute) => `${pad}${INDENT}${attribute.name}=${attribute.value}`),
    `${pad}>`,
  ]
}

/** `<Tag a="1" b={2}` — everything but the closing bracket. */
function openTag(node: Extract<JsxNode, { kind: 'element' }>): string {
  const attributes = node.attributes.map((attribute) => ` ${attribute.name}=${attribute.value}`).join('')
  return `<${node.tag}${attributes}`
}

/** One `key: value` pair of a printed object literal. */
export interface ObjectEntry {
  readonly key: string
  readonly value: string
}

/**
 * `name: { a: 1, b: 'x' },` on one line when it fits, otherwise one key per line
 * with a trailing comma (`trailingComma: 'all'` in .prettierrc). Used for the
 * entries of the generated `styles` object.
 *
 * Both shapes are stable under prettier: it only collapses an object that has
 * no line break after its `{`, and only expands one that does not fit.
 */
export function printObjectEntry(name: string, entries: readonly ObjectEntry[], level: number): string[] {
  const pad = INDENT.repeat(level)
  const pairs = entries.map((entry) => `${entry.key}: ${entry.value}`)
  const inline = `${pad}${name}: { ${pairs.join(', ')} },`
  if (entries.length > 0 && inline.length <= PRINT_WIDTH) return [inline]
  return [`${pad}${name}: {`, ...pairs.map((pair) => `${pad}${INDENT}${pair},`), `${pad}},`]
}

/**
 * An object key as source: bare when it is a plain identifier, quoted when it
 * is not (a CSS custom property, say). This is prettier's `quoteProps: 'as-needed'`.
 */
export function objectKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : stringLiteral(name)
}

/**
 * `import { A, B } from 'x'` on one line, or one name per line with a trailing
 * comma when that would pass 110 columns.
 */
export function printNamedImport(names: readonly string[], from: string): string[] {
  const sorted = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const inline = `import { ${sorted.join(', ')} } from '${from}'`
  if (inline.length <= PRINT_WIDTH) return [inline]
  return ['import {', ...sorted.map((name) => `${INDENT}${name},`), `} from '${from}'`]
}
