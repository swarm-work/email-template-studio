// @vitest-environment jsdom
import { Editor } from '@tiptap/core'
import { composeReactEmail } from '@react-email/editor/core'
import { afterEach, describe, expect, it } from 'vitest'
import { studioEditorExtensions } from './editorExtensions'
import { studioTheme } from './studioTheme'
import { MERGE_FIELD_NODE } from './mergeFieldNode'

/** A container-rooted empty document, the same shape the canvas starts from. */
const EMPTY = { type: 'doc', content: [{ type: 'container', content: [{ type: 'paragraph' }] }] }

let editor: Editor | null = null

function mount(): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({
    element,
    extensions: studioEditorExtensions({ theme: studioTheme('studio-v1'), placeholder: 'Type' }),
    content: EMPTY,
  })
  return editor
}

/**
 * Types one character at a time the way a keyboard does.
 *
 * Input rules live on ProseMirror's `handleTextInput`, which `insertContent`
 * never calls — so a test that "typed" with a command would prove nothing about
 * the rule. This drives the same prop the browser drives.
 */
function type(target: Editor, text: string) {
  for (const character of text) {
    const { from, to } = target.state.selection
    const handled = target.view.someProp('handleTextInput', (handler) =>
      // The fifth argument is ProseMirror's "what would have happened anyway"
      // transaction; the input-rules plugin only calls it when no rule matches.
      handler(target.view, from, to, character, () => target.state.tr.insertText(character, from, to)),
    )
    if (!handled) target.commands.insertContent(character)
  }
}

/** Every node of a given type in the document, whatever its depth. */
function nodesOfType(target: Editor, name: string): { attrs: Record<string, unknown> }[] {
  const found: { attrs: Record<string, unknown> }[] = []
  target.state.doc.descendants((node) => {
    if (node.type.name === name) found.push({ attrs: node.attrs })
  })
  return found
}

afterEach(() => {
  editor?.destroy()
  editor = null
})

describe('MergeField node', () => {
  it('turns typed {{firstName}} into one merge-field node', () => {
    const target = mount()
    target.commands.focus('end')
    type(target, 'Hi {{firstName}}')

    const fields = nodesOfType(target, MERGE_FIELD_NODE)
    expect(fields).toHaveLength(1)
    expect(fields[0].attrs.key).toBe('firstName')
  })

  it('accepts a dotted key and spaces inside the braces', () => {
    const target = mount()
    target.commands.focus('end')
    type(target, '{{ user.first_name }}')

    expect(nodesOfType(target, MERGE_FIELD_NODE)[0]?.attrs.key).toBe('user.first_name')
  })

  it('leaves text that is not a key alone', () => {
    const target = mount()
    target.commands.focus('end')
    type(target, '{{ 1nope }}')

    expect(nodesOfType(target, MERGE_FIELD_NODE)).toHaveLength(0)
  })

  it('inserts a field from the command the Data tab uses', () => {
    const target = mount()
    target.commands.focus('end')
    target.commands.insertMergeField('company')

    expect(nodesOfType(target, MERGE_FIELD_NODE)[0]?.attrs.key).toBe('company')
  })

  it('exports the literal token in both the HTML and the plain text', async () => {
    const target = mount()
    target.commands.focus('end')
    type(target, 'Hi {{firstName}}!')

    const { unformattedHtml, text } = await composeReactEmail({ editor: target })
    expect(unformattedHtml).toContain('{{firstName}}')
    expect(text).toContain('{{firstName}}')
  })

  it('cannot be split by a mark: bolding the paragraph keeps the token whole', async () => {
    const target = mount()
    target.commands.focus('end')
    type(target, 'Hi {{firstName}}!')
    target.commands.selectAll()
    target.commands.toggleBold()

    // Still exactly one field, still one key - an atom has no halves to bold.
    const fields = nodesOfType(target, MERGE_FIELD_NODE)
    expect(fields).toHaveLength(1)
    expect(fields[0].attrs.key).toBe('firstName')

    const { unformattedHtml, text } = await composeReactEmail({ editor: target })
    expect(unformattedHtml).toContain('{{firstName}}')
    expect(text).toContain('{{firstName}}')
  })

  it('survives a JSON round trip, so a saved document re-opens with its chips', () => {
    const first = mount()
    first.commands.focus('end')
    type(first, 'Hi {{firstName}}')
    const saved = first.getJSON()
    first.destroy()

    const element = document.createElement('div')
    document.body.appendChild(element)
    editor = new Editor({
      element,
      extensions: studioEditorExtensions({ theme: studioTheme('studio-v1'), placeholder: 'Type' }),
      content: saved,
    })
    expect(nodesOfType(editor, MERGE_FIELD_NODE)[0]?.attrs.key).toBe('firstName')
  })
})
