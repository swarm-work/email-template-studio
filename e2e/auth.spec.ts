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

test('the account menu names the developer identity and offers no sign out', async ({ page }) => {
  // Sign out exists only when there is a Stytch session to end. Developer mode
  // has none, so the menu carries the name and the theme switch and stops there.
  await page.goto('/')
  const trigger = page.getByRole('button', { name: 'Signed in as playwright@example.test' })
  await expect(trigger).toBeVisible()

  await trigger.click()
  const menu = page.getByRole('menu')
  await expect(menu).toContainText('playwright@example.test')
  await expect(menu.getByRole('menuitemcheckbox', { name: 'Dark mode' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Sign out' })).toHaveCount(0)

  // Escape closes it and hands focus back to the avatar, as a menu should.
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(trigger).toBeFocused()
})
