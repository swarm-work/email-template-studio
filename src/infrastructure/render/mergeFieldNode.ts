/**
 * The `{{key}}` merge field, as one indivisible thing in the visual editor.
 *
 * Infrastructure layer: this is the editor package's shape of a merge field,
 * built with `EmailNode` from `@react-email/editor/core`. It must not import
 * React components, the application layer or anything from `src/presentation`;
 * it is imported ONLY from `VisualEditorSurface.tsx`, so it rides in the lazy
 * editor chunk (ADR-18, plan §3.10).
 *
 * Why a node rather than plain text: an atom cannot be split, so nobody can
 * bold half of `{{firstName}}` or delete one brace and silently break the
 * substitution. It still EXPORTS as the literal text `{{firstName}}`, which is
 * what keeps the saved HTML and the plain-text part substitutable later
 * (ADR-26).
 */
import { mergeAttributes, nodeInputRule, nodePasteRule } from '@tiptap/core'
import { EmailNode } from '@react-email/editor/core'

/**
 * A merge-field key: a dotted path of identifiers, e.g. `firstName` or
 * `user.first_name`. Deliberately the same shape as `MERGE_FIELD_PATTERN` in
 * `src/application/mergeFields.ts` — the editor and the substitution have to
 * agree on what a key is, or one would create fields the other cannot fill.
 */
const KEY = '[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*'

/** Typing `{{firstName}}` converts to the chip as the last `}` is typed. */
const INPUT_RULE = new RegExp(`\\{\\{\\s*(${KEY})\\s*\\}\\}$`)

/** The same, hunting every occurrence in pasted text (paste rules need /g). */
const PASTE_RULE = new RegExp(`\\{\\{\\s*(${KEY})\\s*\\}\\}`, 'g')

/** The node's name in the document JSON; `listDocumentMergeFields` looks for it. */
export const MERGE_FIELD_NODE = 'mergeField'

/**
 * Commands Tiptap cannot know about until this extension is registered.
 * Augmenting its `Commands` interface is how a custom extension publishes one,
 * and it makes `editor.commands.insertMergeField('x')` type-check at call sites.
 */
declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mergeField: {
      /** Inserts `{{key}}` as a chip at the current selection. */
      insertMergeField: (key: string) => ReturnType
    }
  }
}

/** What the chip is, as HTML and as exported email text. */
export const MergeField = EmailNode.create({
  name: MERGE_FIELD_NODE,
  group: 'inline',
  inline: true,
  // An atom has no editable insides: the caret steps over it, marks apply to it
  // whole or not at all, and Backspace removes the field rather than a brace.
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      key: {
        default: '',
        parseHTML: (element: HTMLElement) => element.getAttribute('data-merge-field') ?? '',
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-merge-field': String(attributes.key ?? ''),
        }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-merge-field]' }]
  },

  // Inside the canvas it is a chip; `.studio-sheet [data-merge-field]` in
  // src/index.css gives it the mono, muted, non-breaking look.
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), `{{${String(node.attrs.key)}}}`]
  },

  // The export is the whole point: a literal token, in the HTML and in the
  // plain-text part, so `applyMergeFields` can still find it afterwards.
  renderToReactEmail({ node }) {
    return `{{${String(node.attrs?.key ?? '')}}}`
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: INPUT_RULE,
        type: this.type,
        getAttributes: (match) => ({ key: match[1] }),
      }),
    ]
  },

  addPasteRules() {
    return [
      nodePasteRule({
        find: PASTE_RULE,
        type: this.type,
        getAttributes: (match) => ({ key: match[1] }),
      }),
    ]
  },

  addCommands() {
    return {
      insertMergeField:
        (key: string) =>
        ({ commands }) =>
          commands.insertContent({ type: MERGE_FIELD_NODE, attrs: { key } }),
    }
  },
})
