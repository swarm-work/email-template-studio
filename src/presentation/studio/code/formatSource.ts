/**
 * Pretty-printing for the two editable tabs: TSX and the props JSON.
 *
 * Presentation layer: a tool the editor chrome offers, not a rule about
 * templates. Prettier is ~250 KB of parser, so it is loaded with a dynamic
 * `import()` the first time someone presses Format; the main bundle never
 * carries it (docs/TECH_DEBT.md).
 */

/** The studio's own formatting, kept in step with .prettierrc. */
const TSX_OPTIONS = { semi: false, singleQuote: true, printWidth: 110 } as const

/**
 * Formats React Email TSX. Throws when the source does not parse, which is the
 * caller's cue to leave the text alone and say so.
 */
export async function formatTsx(source: string): Promise<string> {
  const [prettier, estree, typescript] = await Promise.all([
    import('prettier/standalone'),
    import('prettier/plugins/estree'),
    import('prettier/plugins/typescript'),
  ])
  return prettier.format(source, {
    ...TSX_OPTIONS,
    parser: 'typescript',
    plugins: [estree, typescript],
  })
}

/** Formats a JSON payload with two-space indentation. Throws on invalid JSON. */
export function formatJson(text: string): string {
  return `${JSON.stringify(JSON.parse(text), null, 2)}\n`
}
