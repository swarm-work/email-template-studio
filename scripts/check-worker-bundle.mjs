/**
 * Build guard: two things that must never end up in the Worker bundle.
 *
 * `@react-email` - the API only signs SES requests and reads D1; rendering
 * happens in the browser, so a rendering import would add hundreds of kilobytes
 * to every cold start. `node:` - workerd is not Node, and `server/starterSeed.ts`
 * (the one server module that reads files) would only fail at runtime there.
 * Chained into `npm run build`.
 */
import { readFileSync } from 'node:fs'

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
