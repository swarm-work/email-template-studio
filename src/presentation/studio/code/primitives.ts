/**
 * The React Email building blocks the Primitives row can insert.
 *
 * Presentation layer: plain data, no React. Each snippet is a complete,
 * well-formed element, so inserting one never leaves the source in a state
 * that will not compile — the editor re-indents it to wherever the cursor is.
 */

export interface EmailPrimitive {
  /** Stable id, also the accessible name suffix ("Insert <Section>"). */
  readonly id: string
  /** What the chip says, e.g. "<Section>". */
  readonly label: string
  /** What is inserted at the cursor. */
  readonly snippet: string
}

export const EMAIL_PRIMITIVES: readonly EmailPrimitive[] = [
  { id: 'section', label: '<Section>', snippet: '<Section>\n  \n</Section>' },
  { id: 'text', label: '<Text>', snippet: '<Text></Text>' },
  { id: 'heading', label: '<Heading>', snippet: '<Heading as="h1"></Heading>' },
  { id: 'button', label: '<Button>', snippet: '<Button href="https://example.com"></Button>' },
  { id: 'img', label: '<Img>', snippet: '<Img src="https://example.com/logo.png" alt="" width="120" />' },
  { id: 'hr', label: '<Hr>', snippet: '<Hr />' },
  {
    id: 'row-column',
    label: '<Row>/<Column>',
    snippet: '<Row>\n  <Column></Column>\n  <Column></Column>\n</Row>',
  },
  { id: 'link', label: '<Link>', snippet: '<Link href="https://example.com"></Link>' },
  { id: 'preview', label: '<Preview>', snippet: '<Preview></Preview>' },
]
