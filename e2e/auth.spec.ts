import { expect, test } from '@playwright/test'

/**
 * The rule this file exists to enforce: **the Stytch SDK is never downloaded by
 * a build that is not using Stytch.**
 *
 * The e2e environment runs on `STUDIO_DEV_IDENTITY` with no `STYTCH_PROJECT_ID`
 * (`wrangler.jsonc`, `env.e2e`), so the API never reports the `stytch` mode and
 * the sign-in screen is never rendered. That much is arranged by configuration.
 *
 * What configuration CANNOT arrange is the browser bundle. `VITE_` variables are
 * inlined by Vite at build time, and a static `import` in a module the entry
 * chunk already needs ships the SDK — and runs its side effects — whatever the
 * Worker's `vars` say. The SDK initialising with no project would log to the
 * console, and every spec in this suite fails on an unexpected console error,
 * so a single misplaced import turns the whole suite red for a reason unrelated
 * to any test body.
 *
 * `scripts/check-worker-bundle.mjs` catches the obvious version of that mistake
 * at build time. What it cannot see is an ALLOWED module being pulled into the
 * first download by something that eagerly imports it. This is the assertion
 * that catches that, and it is the twin of the editor-chunk test in
 * `e2e/visual.spec.ts` (ADR-31, docs/STYTCH_PLAN.md risk 1).
 */

/** Anything the lazily loaded Stytch chunk could be called. */
const STYTCH_CHUNK = /stytch/i

/** Same notice as the other specs: proof the preview sandbox works. */
const SANDBOX_NOTICE = /Blocked script execution in 'about:srcdoc'/

test('the studio never fetches the Stytch SDK when Stytch is not configured', async ({ page }) => {
  const stytchRequests: string[] = []
  page.on('request', (request) => {
    if (STYTCH_CHUNK.test(request.url())) stytchRequests.push(request.url())
  })

  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !SANDBOX_NOTICE.test(message.text())) errors.push(message.text())
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Templates', exact: true })).toBeVisible()

  // Opening a template exercises the heaviest eager path in the app, which is
  // where an accidental import would most plausibly hide.
  await page.getByRole('button', { name: 'Open Welcome & verification', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Code editor' })).toBeVisible()

  expect(stytchRequests, 'the studio downloaded the Stytch SDK without being asked to').toEqual([])
  expect(errors, 'unexpected console errors').toEqual([])
})

test('the API reports the developer mode, so no sign-in screen is shown', async ({ page }) => {
  // If this ever reports `stytch`, the e2e environment has picked up a project
  // id it should not have and the assertion above stops meaning anything.
  const response = await page.request.get('/api/send-test/status')
  expect(response.status(), 'the e2e build should be authenticated as the fixed developer identity').toBe(200)
})
