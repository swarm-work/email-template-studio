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
  [
    'src/presentation/auth/stytchClient.ts',
    'constructs the one client; reached only via React.lazy / dynamic import()',
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

/* --------------------------------------------------------------------------
 * Two more seams, one level below the package itself (ADR-31, update
 * 2026-09-29, third revision).
 * ------------------------------------------------------------------------ */

/**
 * `stytchClient.ts` is the one place a Stytch client is built. A second
 * caller building its own is worse than the extra kilobytes an unchecked
 * editor or Stytch import would be: Stytch's own `SessionManagerRegistry`
 * cancels the OLDER client's background refresh the instant a second one
 * registers (`SessionManager.mjs`), so a stray import here would silently
 * break the keep-alive rather than merely duplicate it.
 */
const STYTCH_CLIENT_ALLOWED = new Set([
  'src/presentation/auth/StytchSignIn.tsx',
  'src/presentation/auth/stytchSignOut.ts',
  'src/presentation/auth/stytchKeepAlive.ts',
])

/**
 * `stytchKeepAlive.ts` names no package itself - it only imports
 * `stytchClient.ts` - so the checks above cannot see it. It must still stay
 * behind a dynamic `import()` (today, only `PasswordGate.tsx` uses one): a
 * static `import ... from './stytchKeepAlive'`, or a bare side-effect
 * `import './stytchKeepAlive'`, would pull it, and the SDK it starts, into
 * whatever chunk that file already ships in.
 */

/**
 * Every specifier a file's source names in a `from '...'` clause or a bare
 * side-effect `import '...'` - NOT a dynamic `import(...)`, which is its own,
 * separate collection below, since a dynamic import is exactly how
 * `stytchKeepAlive.ts` is allowed to be reached.
 *
 * This is a regex scan, not a parser, same as the checks above - it is
 * fooled by nothing more exotic than a string that happens to read
 * `from "…"` outside an import, which none of this source does (checked by
 * hand: every literal `from '...'`/`import '...'` here IS an import).
 *
 * The whitespace before the quote is OPTIONAL (`\s*`, not `\s+`): minified
 * output - which `checkClientBuildOutput` below scans with this same function
 * - writes `from"./chunk.js"` with no space at all, and a `\s+` here once made
 * that half of the output check find no imports whatsoever.
 */
function staticImportSpecifiers(source) {
  const specifiers = new Set()
  for (const match of source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) specifiers.add(match[1])
  for (const match of source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) specifiers.add(match[1])
  return specifiers
}

/** `staticImportSpecifiers`, plus every specifier reached through `import(...)`. */
function allImportSpecifiers(source) {
  const specifiers = staticImportSpecifiers(source)
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.add(match[1])
  return specifiers
}

/**
 * True when `specifier` resolves to a module named `moduleName`, whatever
 * sits in front of it: `./moduleName`, `../auth/moduleName`,
 * `@/presentation/auth/moduleName`, with or without a `.ts`/`.tsx` extension.
 * Anchored so `./moduleNameHelpers` or `./notModuleName` do not match.
 */
function namesModule(specifier, moduleName) {
  return new RegExp(`(?:^|/)${moduleName}(?:\\.tsx?)?$`).test(specifier)
}

/**
 * Files under `src` (tests excluded, same as the checks above) whose imports
 * - drawn from `specifiersOf` - name `moduleName`, other than one of `allowed`.
 */
function offendersNaming(moduleName, specifiersOf, { allowed = new Set() } = {}) {
  const found = []
  for (const file of sourceFiles('src')) {
    if (!isSourceFile(file) || /\.test\.(ts|tsx)$/.test(file) || allowed.has(file)) continue
    const source = readFileSync(join(ROOT, file), 'utf8')
    for (const specifier of specifiersOf(source)) {
      if (namesModule(specifier, moduleName)) {
        found.push(file)
        break
      }
    }
  }
  return found
}

// Any form of import counts here - static OR dynamic - because it is not the
// download weight at stake (as it is for the two packages above), it is a
// SECOND client silently breaking the first one's refresh (see the comment
// above STYTCH_CLIENT_ALLOWED).
const stytchClientOffenders = offendersNaming('stytchClient', allImportSpecifiers, {
  allowed: STYTCH_CLIENT_ALLOWED,
})
if (stytchClientOffenders.length > 0) {
  console.error(
    '\nThese files import "stytchClient", which only StytchSignIn.tsx, stytchSignOut.ts and ' +
      'stytchKeepAlive.ts may:\n' +
      stytchClientOffenders.map((file) => `  ${file}`).join('\n') +
      '\n',
  )
  process.exit(1)
}

// Only STATIC specifiers count here: a dynamic `import('./stytchKeepAlive')`
// is exactly how PasswordGate.tsx is supposed to reach it.
const stytchKeepAliveOffenders = offendersNaming('stytchKeepAlive', staticImportSpecifiers)
if (stytchKeepAliveOffenders.length > 0) {
  console.error(
    '\nThese files import "stytchKeepAlive" with a static (or bare side-effect) import; it must only be ' +
      'reached through a dynamic import():\n' +
      stytchKeepAliveOffenders.map((file) => `  ${file}`).join('\n') +
      '\n',
  )
  process.exit(1)
}

console.log(
  'Stytch internal-module check: "stytchClient" named only by its 3 allowed module(s); ' +
    '"stytchKeepAlive" reached only through dynamic import().',
)

/* --------------------------------------------------------------------------
 * The built CLIENT output, not just its source: the entry chunk every visitor
 * downloads first must never modulepreload or statically import a Stytch
 * chunk. The checks above can be fooled by a THIRD module Rollup happens to
 * merge into an eagerly loaded chunk in some future dependency graph; this
 * checks the actual `vite build` artifact instead (ADR-31).
 * ------------------------------------------------------------------------ */

const CLIENT_DIST_DIR = new URL('../dist/client/', import.meta.url)
const CLIENT_INDEX_HTML = new URL('index.html', CLIENT_DIST_DIR)

/** Every href on a `<link rel="modulepreload">` tag, whatever order its attributes are in. */
function modulePreloadHrefs(html) {
  const hrefs = []
  for (const tag of html.matchAll(/<link\b[^>]*>/g)) {
    if (!/rel=["']modulepreload["']/.test(tag[0])) continue
    const href = /href=["']([^"']+)["']/.exec(tag[0])
    if (href) hrefs.push(href[1])
  }
  return hrefs
}

/** The `src` of the page's entry `<script type="module">`, or undefined. */
function entryScriptSrc(html) {
  for (const tag of html.matchAll(/<script\b[^>]*>/g)) {
    if (!/type=["']module["']/.test(tag[0])) continue
    const src = /src=["']([^"']+)["']/.exec(tag[0])
    if (src) return src[1]
  }
  return undefined
}

/**
 * The specifiers a bundled chunk statically imports, read from the very
 * START of the file only. Rollup always emits every static `import` before
 * any other statement in a chunk, so a generous prefix - far shorter than
 * where this app's OWN source is ever embedded as a literal string deep in
 * the bundle (the code-template scaffolding a "New template" starts from,
 * which itself contains lines that read like imports) - cannot see a dynamic
 * `import()` call and cannot be fooled by a string that merely looks like one.
 */
function leadingStaticImportSpecifiers(source) {
  return staticImportSpecifiers(source.slice(0, 20_000))
}

function checkClientBuildOutput() {
  let html
  try {
    html = readFileSync(CLIENT_INDEX_HTML, 'utf8')
  } catch (error) {
    console.error(`Could not read ${CLIENT_INDEX_HTML.pathname}. Run this after \`vite build\`.`)
    throw error
  }

  const stytchPreloads = modulePreloadHrefs(html).filter((href) => /stytch/i.test(href))
  if (stytchPreloads.length > 0) {
    console.error(
      `\n${CLIENT_INDEX_HTML.pathname} modulepreloads a Stytch chunk, which means it is no longer lazy:\n` +
        stytchPreloads.map((href) => `  ${href}`).join('\n') +
        '\n',
    )
    process.exit(1)
  }

  const entrySrc = entryScriptSrc(html)
  if (!entrySrc) {
    console.error(`\nCould not find the entry <script type="module"> in ${CLIENT_INDEX_HTML.pathname}.\n`)
    process.exit(1)
  }
  const entryPath = new URL(entrySrc.replace(/^\//, ''), CLIENT_DIST_DIR)
  let entrySource
  try {
    entrySource = readFileSync(entryPath, 'utf8')
  } catch (error) {
    console.error(`Could not read the entry chunk at ${entryPath.pathname}.`)
    throw error
  }
  const entryImports = [...leadingStaticImportSpecifiers(entrySource)]
  // A tripwire for this check itself: the entry chunk always imports at least
  // the shared React chunk, so finding NOTHING means the scan has gone blind
  // (a change in how the bundler writes imports), not that the entry is clean.
  if (entryImports.length === 0) {
    console.error(
      `\nFound no static imports at all at the top of the entry chunk (${entrySrc}). The scan in ` +
        'leadingStaticImportSpecifiers no longer understands the bundler output, so this check cannot vouch ' +
        'for anything - fix the scan.\n',
    )
    process.exit(1)
  }
  const staticStytchImports = entryImports.filter((specifier) => /stytch/i.test(specifier))
  if (staticStytchImports.length > 0) {
    console.error(
      `\nThe entry chunk (${entrySrc}) statically imports a Stytch chunk, which means it ships in every ` +
        `page's first download:\n` +
        staticStytchImports.map((specifier) => `  ${specifier}`).join('\n') +
        '\n',
    )
    process.exit(1)
  }

  console.log(
    `Client build output check: ${CLIENT_INDEX_HTML.pathname} modulepreloads nothing Stytch, and the ` +
      `entry chunk (${entrySrc}) statically imports nothing Stytch.`,
  )
}

checkClientBuildOutput()
