import { expect, test, type Page } from '@playwright/test'

/**
 * Takes the three screenshots `README.md` shows, from the production build.
 *
 * It is a normal test, not a separate script, so the pictures can never show a
 * screen that does not exist: the same locators the rest of the suite uses have
 * to find the same regions first. Run just this file with
 * `npx playwright test e2e/screenshots.spec.ts` after a UI change.
 *
 * Because it is a normal test, `npm run test:e2e` rewrites these three tracked
 * PNGs every time, so `git status` reports them as modified afterwards. That is
 * expected, not a failure: commit them when the interface really changed, and
 * run `git checkout docs/screenshots` to discard the rendering noise otherwise.
 */

const WELCOME = 'Welcome & verification'
const PRODUCT_LAUNCH = 'Product launch'

/** Where the files land; `README.md` links to them by these names. */
const DIRECTORY = 'docs/screenshots'

/** Same notice as the other specs: proof the preview sandbox works. */
const SANDBOX_NOTICE = /Blocked script execution in 'about:srcdoc'/

const FIRST_RENDER_TIMEOUT = 30_000
const EDITOR_LOAD_TIMEOUT = 30_000

function libraryHeading(page: Page) {
  return page.getByRole('heading', { level: 1, name: 'Templates', exact: true })
}
function templateCard(page: Page, name: string) {
  return page.getByRole('button', { name: `Open ${name}`, exact: true })
}
function modeButton(page: Page, name: string) {
  return page.getByRole('group', { name: 'Editing mode' }).getByRole('button', { name, exact: true })
}

type PageWithErrors = Page & { __errors?: string[] }

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !SANDBOX_NOTICE.test(message.text())) errors.push(message.text())
  })
  ;(page as PageWithErrors).__errors = errors
  // LOAD-BEARING, not a restatement of the config. `playwright.config.ts` asks
  // for 1440x900 in its top-level `use`, but the chromium project spreads
  // `devices['Desktop Chrome']`, whose own 1280x720 viewport wins — so the rest
  // of the suite runs at 1280 and this line is what makes the pictures 1440.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(libraryHeading(page)).toBeVisible()
})

test.afterEach(async ({ page }) => {
  expect((page as PageWithErrors).__errors).toEqual([])
})

test('captures the visual canvas', async ({ page }) => {
  await templateCard(page, PRODUCT_LAUNCH).click()
  await expect(page.getByRole('region', { name: 'Email canvas' })).toBeVisible({
    timeout: EDITOR_LOAD_TIMEOUT,
  })
  await expect(page.locator('.studio-sheet .tiptap')).toBeVisible({ timeout: EDITOR_LOAD_TIMEOUT })
  await expect(page.getByRole('region', { name: 'Inspector' })).toBeVisible()

  await page.screenshot({ path: `${DIRECTORY}/studio-visual.png` })
})

test('captures the code editor and its right rail', async ({ page }) => {
  await templateCard(page, WELCOME).click()
  const editor = page.getByRole('region', { name: 'Code editor' })
  await expect(editor).toBeVisible()
  // Wait for the render to land, so the rail shows a report rather than dashes.
  await expect(editor.getByText('Compiled and rendered without errors.')).toBeVisible({
    timeout: FIRST_RENDER_TIMEOUT,
  })

  await page.screenshot({ path: `${DIRECTORY}/studio-code.png` })
})

test('captures preview mode', async ({ page }) => {
  await templateCard(page, WELCOME).click()
  await modeButton(page, 'Preview').click()
  const preview = page.getByRole('region', { name: 'Preview', exact: true })
  await expect(preview).toBeVisible()
  await expect(page.locator('iframe[title^="Email preview"]').contentFrame().locator('body')).toContainText(
    'Welcome',
    { timeout: FIRST_RENDER_TIMEOUT },
  )

  await page.screenshot({ path: `${DIRECTORY}/studio-preview.png` })
})
