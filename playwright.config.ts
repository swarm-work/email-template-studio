import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against the PRODUCTION build served by `vite preview`,
 * so they exercise the real worker bundle and iframe isolation.
 *
 * The API runs in workerd (the Cloudflare runtime) through the Cloudflare Vite
 * plugin, built with the `e2e` environment from wrangler.jsonc: sending enabled
 * in dry-run mode, so the send dialog is exercised without AWS, and a separate
 * local D1 database (also under .wrangler/state/v3) holding only the starters.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  // One worker, not one per file: every spec drives the SAME preview server and
  // the same local D1 and R2, so two browsers racing each other would be two
  // tests editing one database. It also keeps the editor chunk's download time
  // off a second browser's critical path.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  // A test may wait out a cold worker boot (FIRST_RENDER_TIMEOUT) and still do
  // a few UI steps around it, so the per-test budget has to be comfortably larger.
  timeout: 75_000,
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Build with the e2e environment, drop any local secrets that leaked into
    // the bundle, bring the e2e D1 database up to date, reset it to exactly the
    // starters, then serve the production build.
    //
    // The reset deletes EVERY template (versions go with them, ON DELETE
    // CASCADE) and replays every seed migration by hand. Deleting only what a run
    // created would leave a starter a test had saved over at version 2 forever:
    // `d1 migrations apply` has already recorded 0002 as applied, so it never
    // re-seeds, and the next run's "this starter is at v1" assertion would fail.
    command: [
      'CLOUDFLARE_ENV=e2e npm run build',
      'rm -f dist/email_template_studio/.dev.vars',
      'npx wrangler d1 migrations apply STUDIO_DB --local --env e2e',
      'npx wrangler d1 execute STUDIO_DB --local --env e2e --command "DELETE FROM templates"',
      'npx wrangler d1 execute STUDIO_DB --local --env e2e --file migrations/0002_seed_starter_templates.sql',
      'npx wrangler d1 execute STUDIO_DB --local --env e2e --file migrations/0003_seed_visual_starter.sql',
      'npx vite preview --port 4173 --strictPort',
    ].join(' && '),
    url: 'http://localhost:4173/api/send-test/status',
    // Never reuse: a stray preview could be a build with different variables.
    reuseExistingServer: false,
    // The build, two wrangler commands and a cold workerd boot all fit in here.
    timeout: 240_000,
  },
})
