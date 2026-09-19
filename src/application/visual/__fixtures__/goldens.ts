/**
 * The converter's golden fixtures, as data: one Tiptap document in, one TSX
 * module out.
 *
 * Test support, imported only from `*.test.ts` files — the three tests that
 * need it (goldens, the compile-and-render guarantee and the fidelity
 * comparison) live in different folders, and a shared list is better than three
 * copies that can drift.
 *
 * When the converter's output changes ON PURPOSE, copy the value Vitest prints
 * as "actual" into the matching `.tsx` file and READ it: these files are the
 * spec for what a converted template looks like, and reviewing them is the
 * point of having them.
 */
import type { EmailDocument } from '@/domain'
import {
  documentToTsx,
  tsxComponentName,
  tsxPropsInterfaceName,
  type DocumentToTsxResult,
  type NodeStyleResolver,
} from '../documentToTsx'
import blocksDocument from './blocks.document.json'
import blocksSource from './blocks.tsx?raw'
import headingsDocument from './headings.document.json'
import headingsSource from './headings.tsx?raw'
import imagesDocument from './images.document.json'
import imagesSource from './images.tsx?raw'
import marksDocument from './marks.document.json'
import marksSource from './marks.tsx?raw'
import mergeFieldsDocument from './merge-fields.document.json'
import mergeFieldsSource from './merge-fields.tsx?raw'
import themedDocument from './themed.document.json'
import themedSource from './themed.tsx?raw'

export interface GoldenFixture {
  readonly name: string
  readonly document: EmailDocument
  /** The expected module text, byte for byte. */
  readonly source: string
  /** Text that must survive all the way into the rendered HTML. */
  readonly expectedText: string
  /** Set on the fixtures that pin the THEMED output — the shape that ships. */
  readonly resolveStyle?: NodeStyleResolver
}

/**
 * A stand-in for the real theme, so the styled path can be pinned in the Node
 * environment.
 *
 * The real resolver (`infrastructure/render/visualStyleResolver.ts`) needs the
 * 2.5 MB editor package and a DOM; this is a fixed table with the same shape.
 * What it proves is not which colours the theme has but that the converter
 * MERGES correctly — theme, then the node's own `style`, then its alignment —
 * and that a module full of two-attribute tags still prints the way prettier
 * would. Every other golden runs with no resolver at all, which is the
 * unstyled path.
 */
const STUB_THEME: Record<string, Record<string, string>> = {
  body: { backgroundColor: '#ffffff', lineHeight: '155%', fontFamily: 'Inter, Helvetica, sans-serif' },
  container: { maxWidth: '600px', padding: '24px' },
  paragraph: { fontSize: '14px', lineHeight: '155%', textAlign: 'left' },
  heading: { fontSize: '28px', fontWeight: '600' },
  horizontalRule: { borderColor: '#e2e8f0' },
  button: { backgroundColor: '#111827', color: '#ffffff', borderRadius: '6px' },
  link: { color: '#2563eb', textDecoration: 'underline' },
}

/** The stub itself: one fixed style table, keyed by node (or mark) type. */
export const STUB_STYLE_RESOLVER: NodeStyleResolver = (node) => STUB_THEME[node.type ?? ''] ?? {}

export const GOLDENS: readonly GoldenFixture[] = [
  { name: 'marks', document: marksDocument, source: marksSource, expectedText: 'Both at once' },
  { name: 'headings', document: headingsDocument, source: headingsSource, expectedText: 'Level six' },
  { name: 'blocks', document: blocksDocument, source: blocksSource, expectedText: 'Get started' },
  { name: 'images', document: imagesDocument, source: imagesSource, expectedText: 'img_hero.png' },
  {
    name: 'merge-fields',
    document: mergeFieldsDocument,
    source: mergeFieldsSource,
    // The smoke payload fills every prop with the token it came from, so the
    // rendered HTML still carries its merge fields (ADR-26).
    expectedText: '{{recipientName}}',
  },
  {
    name: 'themed',
    document: themedDocument,
    source: themedSource,
    expectedText: 'the report',
    resolveStyle: STUB_STYLE_RESOLVER,
  },
]

/** The options every golden was generated with. */
export function convertFixture(
  name: string,
  document: EmailDocument,
  resolveStyle?: NodeStyleResolver,
): DocumentToTsxResult {
  return documentToTsx(document, {
    componentName: tsxComponentName(name),
    propsInterfaceName: tsxPropsInterfaceName(name),
    subject: `The ${name} fixture`,
    // One fixture has no preheader, so the "no <Preview> element" path is covered.
    preheader: name === 'headings' ? '' : `A preheader for ${name}`,
    resolveStyle,
  })
}
