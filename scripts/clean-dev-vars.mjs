/**
 * Deletes the local secrets file the Cloudflare Vite plugin writes into the
 * build output (`dist/email_template_studio/.dev.vars`), so a normal
 * `npm run build` never leaves it sitting in a folder that could be
 * inspected, zipped up or published.
 *
 * Chained into `npm run build`, right after `vite build` and before
 * `scripts/check-worker-bundle.mjs`, which fails loudly if the file is ever
 * there when it runs - this script is the fix, that check is the safety net.
 *
 * A plain `rm -f` would do this in one line but is not portable (no `rm` on
 * Windows); `fs.rmSync(..., { force: true })` is a Node script's equivalent,
 * and `force: true` means "gone or already absent" both count as success.
 */
import { rmSync } from 'node:fs'

const target = new URL('../dist/email_template_studio/.dev.vars', import.meta.url)
rmSync(target, { force: true })
