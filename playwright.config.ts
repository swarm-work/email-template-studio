import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests run against the PRODUCTION build served by `vite preview`,
 * so they exercise the real worker bundle and iframe isolation.
 *
 * The API runs in workerd (the Cloudflare runtime) through the Cloudflare Vite
 * plugin, built with the `e2e` environment from wrangler.jsonc: sending enabled
 * in dry-run mode, so the send dialog is exercised without AWS.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
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
    command:
      'CLOUDFLARE_ENV=e2e npm run build && rm -f dist/email_template_studio/.dev.vars && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/api/send-test/status',
    // Never reuse: a stray preview could be a build with different variables.
    reuseExistingServer: false,
    timeout: 180_000,
  },
})
