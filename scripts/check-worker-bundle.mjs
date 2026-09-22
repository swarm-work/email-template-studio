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
  {
    needle: '@stytch',
    why:
      'Something under server/, shared/ or worker/ is importing the Stytch BROWSER SDK. ' +
      'The Worker verifies session tokens with WebCrypto against a public JWKS (ADR-31) and needs no SDK at all.',
    find: 'grep -rn "@stytch" server shared worker',
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
 * puts the whole 2.5 MB back in the first download. A handful of files are
 * allowed to name the package, and each for a different reason.
 */
const EDITOR_SCANNED_PATHS = ['src']

const EDITOR_ALLOWED = new Map([
  ['src/presentation/studio/visual/VisualEditorSurface.tsx', 'the one module that mounts the editor'],
  ['src/infrastructure/render/visualEmailRenderer.ts', 'reaches /core through a dynamic import()'],
  ['src/infrastructure/render/studioTheme.ts', 'a type-only import, erased at build time'],
  ['src/infrastructure/render/mergeFieldNode.ts', 'the merge-field node, built on EmailNode'],
  ['src/infrastructure/render/editorExtensions.ts', "the canvas's extension list (StarterKit + theming)"],
  ['src/infrastructure/render/visualStyleResolver.ts', 'reaches /plugins through a dynamic import()'],
])

/** The one module allowed to import the package, and its own folder's re-exports. */
const EDITOR_PACKAGE = '@react-email/editor'

/**
 * The Stytch browser SDK is the second package behind a lazy seam, for a
 * different reason from the editor's size (ADR-31).
 *
 * The editor must stay lazy so a code template does not download 2.5 MB it will
 * never use. Stytch must stay lazy so it never LOADS AT ALL in a build that is
 * not using it - the Playwright suite runs on `STUDIO_DEV_IDENTITY` with no
 * Stytch configured, and all five of its spec files fail on any unexpected
 * browser console error. A top-level import in a conditionally rendered
 * component still ships and still runs its side effects, so "it is only
 * rendered when mode is stytch" is not enough.
 */
const STYTCH_PACKAGE = '@stytch/react'

/** The Worker verifies tokens itself; nothing outside the page may name the SDK. */
const STYTCH_FREE_PATHS = [
  'server',
  'shared',
  'worker',
  'src/infrastructure/render/render.worker.ts',
  'src/infrastructure/render/renderTemplate.ts',
]

const STYTCH_ALLOWED = new Map([
  [
    'src/presentation/auth/StytchSignIn.tsx',
    'the one module that mounts the Stytch SDK, reached only through React.lazy',
  ],
  [
    'src/presentation/auth/stytchSignOut.ts',
    'reaches the SDK through a dynamic import(), so the always-mounted header does not pull the chunk in',
  ],
])

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

function isSourceFile(file) {
  return /\.(ts|tsx|mts|js|mjs)$/.test(file)
}

/**
 * One lazily loaded package and the rules that keep it lazy.
 *
 * `freePaths` may not so much as NAME the package; `scannedPaths` may name it in
 * prose but only `allowed` may import it. A missing entry in `allowed` is the
 * point: adding one is a deliberate act that says "this module is inside the
 * lazy seam", and getting it wrong is what puts the chunk in everyone's first
 * download.
 */
const LAZY_PACKAGES = [
  {
    name: EDITOR_PACKAGE,
    label: 'Editor',
    adr: 'ADR-18',
    freePaths: EDITOR_FREE_PATHS,
    scannedPaths: EDITOR_SCANNED_PATHS,
    allowed: EDITOR_ALLOWED,
  },
  {
    name: STYTCH_PACKAGE,
    label: 'Stytch',
    adr: 'ADR-31',
    freePaths: STYTCH_FREE_PATHS,
    scannedPaths: ['src'],
    allowed: STYTCH_ALLOWED,
  },
]

/**
 * Returns the files breaking the rule for one package.
 *
 * An import is the specifier after `from` or `import(`, so a prose mention in a
 * comment is not one. Tests are skipped inside `scannedPaths`: a
 * `vi.mock('@stytch/react')` never ships.
 */
function offendersFor({ name, freePaths, scannedPaths, allowed }) {
  const importPattern = new RegExp(`(?:from|import\\()\\s*['"]${name}`)
  const found = []
  for (const root of freePaths) {
    for (const file of sourceFiles(root)) {
      if (isSourceFile(file) && readFileSync(join(ROOT, file), 'utf8').includes(name)) {
        found.push(file)
      }
    }
  }
  for (const root of scannedPaths) {
    for (const file of sourceFiles(root)) {
      if (!isSourceFile(file) || /\.test\.(ts|tsx)$/.test(file) || allowed.has(file)) continue
      if (importPattern.test(readFileSync(join(ROOT, file), 'utf8'))) found.push(file)
    }
  }
  return found
}

for (const lazy of LAZY_PACKAGES) {
  const found = offendersFor(lazy)
  if (found.length > 0) {
    const permitted = [...lazy.allowed].map(([file, why]) => `  ${file} - ${why}`).join('\n')
    console.error(
      `\nThese files name "${lazy.name}", which must stay in its own lazily loaded chunk:\n` +
        found.map((file) => `  ${file}`).join('\n') +
        `\n\nOnly these may (${lazy.adr}):\n${permitted || '  (none yet)'}\n`,
    )
    process.exit(1)
  }
  console.log(
    `${lazy.label} split check: "${lazy.name}" named only by its ${lazy.allowed.size} allowed module(s)` +
      ` (scanned ${[...lazy.freePaths, ...lazy.scannedPaths].join(', ')}).`,
  )
}
