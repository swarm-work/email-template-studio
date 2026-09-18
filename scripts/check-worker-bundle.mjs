/**
 * Build guard: what must never end up in the Worker bundle, and which source
 * files must never import the visual editor.
 *
 * `@react-email` - the API only signs SES requests and reads D1; rendering
 * happens in the browser, so a rendering import would add hundreds of kilobytes
 * to every cold start. `node:` - workerd is not Node, and `server/starterSeed.ts`
 * (the one server module that reads files) would only fail at runtime there.
 *
 * The second half is a SOURCE check rather than a bundle one: the visual editor
 * is 2.5 MB behind `React.lazy`, and a single static import - from the render
 * worker, the API, or any of the app's own eagerly loaded files - would quietly
 * pull all of it into a chunk that everyone downloads. So `src` is scanned too,
 * against a short allow-list, and not only the directories that must stay
 * entirely clear (plan §3.10, ADR-18).
 *
 * Chained into `npm run build`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const BUNDLE = new URL('../dist/email_template_studio/index.js', import.meta.url)

/** Each entry: the text that must not appear, and what its presence would mean. */
const FORBIDDEN = [
  {
    needle: '@react-email',
    why: 'Something under server/, shared/ or worker/ is importing a rendering module.',
    find: 'grep -rn "react-email" server shared worker',
  },
  {
    needle: 'node:fs',
    why: 'Something the Worker imports is reading files - probably server/starterSeed.ts, which is Node-only.',
    find: 'grep -rn "node:" server shared worker',
  },
]

let bundle
try {
  bundle = readFileSync(BUNDLE, 'utf8')
} catch (error) {
  console.error(`Could not read ${BUNDLE.pathname}. Run this after \`vite build\`.`)
  throw error
}

for (const { needle, why, find } of FORBIDDEN) {
  if (bundle.includes(needle)) {
    console.error(`\nThe Worker bundle contains "${needle}".\n${why}\nFind it with: ${find}\n`)
    process.exit(1)
  }
}

const names = FORBIDDEN.map(({ needle }) => `"${needle}"`).join(' or ')
console.log(`Worker bundle check: no ${names} in ${BUNDLE.pathname} (${bundle.length} bytes).`)

/* --------------------------------------------------------------------------
 * The visual editor must stay in its own lazily loaded chunk.
 * ------------------------------------------------------------------------ */

const ROOT = new URL('..', import.meta.url).pathname

/**
 * Everything that must not mention the package at all: the code that runs
 * outside the browser page, plus the render worker.
 */
const EDITOR_FREE_PATHS = [
  'server',
  'shared',
  'worker',
  'src/infrastructure/render/render.worker.ts',
  'src/infrastructure/render/renderTemplate.ts',
]

/**
 * The app's own source is scanned too - this is where the risk actually lives,
 * since one `import { EmailEditor }` in a file the main bundle already needs
 * puts the whole 2.5 MB back in the first download. Three files are allowed to
 * name the package, and each for a different reason.
 */
const EDITOR_SCANNED_PATHS = ['src']

const EDITOR_ALLOWED = new Map([
  ['src/presentation/studio/visual/VisualEditorSurface.tsx', 'the one module that mounts the editor'],
  ['src/infrastructure/render/visualEmailRenderer.ts', 'reaches /core through a dynamic import()'],
  ['src/infrastructure/render/studioTheme.ts', 'a type-only import, erased at build time'],
])

/** The one module allowed to import the package, and its own folder's re-exports. */
const EDITOR_PACKAGE = '@react-email/editor'

function* sourceFiles(path) {
  const full = join(ROOT, path)
  const stats = statSync(full)
  if (stats.isFile()) {
    yield path
    return
  }
  for (const entry of readdirSync(full)) {
    yield* sourceFiles(join(path, entry))
  }
}

/**
 * An import of the package, static or dynamic. A prose mention in a comment is
 * not one, which is why this looks for the specifier after `from` or `import(`
 * rather than for the name anywhere in the file.
 */
const EDITOR_IMPORT = new RegExp(`(?:from|import\\()\\s*['"]${EDITOR_PACKAGE}`)

function isSourceFile(file) {
  return /\.(ts|tsx|mts|js|mjs)$/.test(file)
}

const offenders = []
// Outside the browser page nothing may so much as name it.
for (const root of EDITOR_FREE_PATHS) {
  for (const file of sourceFiles(root)) {
    if (isSourceFile(file) && readFileSync(join(ROOT, file), 'utf8').includes(EDITOR_PACKAGE)) {
      offenders.push(file)
    }
  }
}
// Inside it, only the allowed modules may IMPORT it. Tests are skipped: a
// `vi.mock('@react-email/editor/core')` never ships.
for (const root of EDITOR_SCANNED_PATHS) {
  for (const file of sourceFiles(root)) {
    if (!isSourceFile(file) || /\.test\.(ts|tsx)$/.test(file) || EDITOR_ALLOWED.has(file)) continue
    if (EDITOR_IMPORT.test(readFileSync(join(ROOT, file), 'utf8'))) offenders.push(file)
  }
}

if (offenders.length > 0) {
  const allowed = [...EDITOR_ALLOWED].map(([file, why]) => `  ${file} - ${why}`).join('\n')
  console.error(
    `\nThese files name "${EDITOR_PACKAGE}", which must stay in the lazy editor chunk:\n` +
      offenders.map((file) => `  ${file}`).join('\n') +
      `\n\nOnly these may (ADR-18):\n${allowed}\n`,
  )
  process.exit(1)
}

console.log(
  `Editor split check: "${EDITOR_PACKAGE}" named only by its ${EDITOR_ALLOWED.size} allowed modules` +
    ` (scanned ${[...EDITOR_FREE_PATHS, ...EDITOR_SCANNED_PATHS].join(', ')}).`,
)
