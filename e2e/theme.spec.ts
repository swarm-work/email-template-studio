import { expect, test, type Page } from '@playwright/test'

/**
 * The dark-mode toggle, and the one rule that makes it safe: the APP goes dark,
 * the EMAIL does not.
 *
 * An email is drawn by the recipient's client, not by this studio, and almost
 * every template styles a white sheet with dark text. So `.studio-sheet` and
 * the preview document both pin `color-scheme: light` (ADR-29). This needs a
 * real browser: `color-scheme` inheritance into an iframe and the computed
 * colours behind it are exactly what jsdom does not have.
 */

const WELCOME = 'Welcome & verification'
const PRODUCT_LAUNCH = 'Product launch'

/** Same notice as the other specs: proof the preview sandbox works. */
const SANDBOX_NOTICE = /Blocked script execution in 'about:srcdoc'/

/** Compiling a template inside the freshly fetched render worker. */
const FIRST_RENDER_TIMEOUT = 30_000
/** Downloading and parsing the lazy editor chunk. */
const EDITOR_LOAD_TIMEOUT = 30_000

function libraryHeading(page: Page) {
  return page.getByRole('heading', { level: 1, name: 'Templates', exact: true })
}
function templateCard(page: Page, name: string) {
  return page.getByRole('button', { name: `Open ${name}`, exact: true })
}
function themeOption(page: Page, name: string) {
  return page.getByRole('radiogroup', { name: 'Colour theme' }).getByRole('radio', { name, exact: true })
}

/** Turns `rgb(r, g, b)` into the three numbers, so a test can say "light". */
function channels(colour: string): number[] {
  return [...colour.matchAll(/\d+(\.\d+)?/g)].slice(0, 3).map((match) => Number(match[0]))
}

/** True when every channel is near white — which is what the email must stay. */
function isNearWhite(colour: string): boolean {
  const [red, green, blue] = channels(colour)
  return red !== undefined && red > 230 && (green ?? 0) > 230 && (blue ?? 0) > 230
}

type PageWithErrors = Page & { __errors?: string[] }

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' && !SANDBOX_NOTICE.test(message.text())) errors.push(message.text())
  })
  ;(page as PageWithErrors).__errors = errors
  await page.goto('/')
  await expect(libraryHeading(page)).toBeVisible()
})

test.afterEach(async ({ page }) => {
  expect((page as PageWithErrors).__errors).toEqual([])
})

test('the theme toggle starts on System and switches the app between light and dark', async ({ page }) => {
  await expect(themeOption(page, 'System theme')).toHaveAttribute('aria-checked', 'true')
  const root = page.locator('html')
  await expect(root).not.toHaveClass(/dark/)

  await themeOption(page, 'Dark theme').click()
  await expect(root).toHaveClass(/dark/)
  await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark')
  // The app ground really is dark, not just labelled so.
  const background = await page.locator('body').evaluate((body) => getComputedStyle(body).backgroundColor)
  expect(isNearWhite(background), `body stayed light: ${background}`).toBe(false)

  // The choice survives a reload, which is the whole point of persisting it.
  await page.reload()
  await expect(libraryHeading(page)).toBeVisible()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(themeOption(page, 'Dark theme')).toHaveAttribute('aria-checked', 'true')

  await themeOption(page, 'Light theme').click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)
})

test('a code template keeps its email light and its editor dark in dark mode', async ({ page }) => {
  await themeOption(page, 'Dark theme').click()
  await expect(page.locator('html')).toHaveClass(/dark/)

  await templateCard(page, WELCOME).click()
  await expect(page.getByRole('region', { name: 'Code editor' })).toBeVisible()

  // The thumbnail in the code rail renders the same document as preview mode.
  const thumbnail = page.getByRole('region', { name: 'Live preview', exact: true })
  const thumbnailBody = thumbnail.locator('iframe').contentFrame().locator('body')
  await expect(thumbnailBody).toContainText('Welcome', { timeout: FIRST_RENDER_TIMEOUT })
  const thumbnailBackground = await thumbnailBody.evaluate((body) => getComputedStyle(body).backgroundColor)
  expect(isNearWhite(thumbnailBackground), `the thumbnail went dark: ${thumbnailBackground}`).toBe(true)

  // The one-dark code editor is dark in BOTH themes: it is a code surface, not
  // app chrome, and ADR-5 picked its palette on purpose.
  const editorBackground = await page
    .locator('.cm-editor')
    .first()
    .evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(isNearWhite(editorBackground), `the code editor turned light: ${editorBackground}`).toBe(false)

  await page.getByRole('group', { name: 'Editing mode' }).getByRole('button', { name: 'Preview' }).click()
  const previewBody = page.locator('iframe[title^="Email preview"]').contentFrame().locator('body')
  await expect(previewBody).toContainText('Welcome', { timeout: FIRST_RENDER_TIMEOUT })
  const previewBackground = await previewBody.evaluate((body) => getComputedStyle(body).backgroundColor)
  expect(isNearWhite(previewBackground), `the preview went dark: ${previewBackground}`).toBe(true)
  // Dark text on a light sheet: the email reads the same as it will in an inbox.
  const previewColour = await previewBody.evaluate((body) => getComputedStyle(body).color)
  expect(isNearWhite(previewColour), `the email text turned white: ${previewColour}`).toBe(false)
})

test('the visual canvas sheet stays a white page in dark mode', async ({ page }) => {
  await themeOption(page, 'Dark theme').click()
  await expect(page.locator('html')).toHaveClass(/dark/)

  await templateCard(page, PRODUCT_LAUNCH).click()
  const sheet = page.locator('.studio-sheet')
  await expect(sheet).toBeVisible({ timeout: EDITOR_LOAD_TIMEOUT })

  const styles = await sheet.evaluate((element) => {
    const computed = getComputedStyle(element)
    return { background: computed.backgroundColor, colourScheme: computed.colorScheme }
  })
  expect(isNearWhite(styles.background), `the canvas sheet went dark: ${styles.background}`).toBe(true)
  expect(styles.colourScheme).toBe('light')

  // The chrome around it did follow the app: that is the contrast the toggle is for.
  const inspector = page.getByRole('region', { name: 'Inspector' })
  const inspectorBackground = await inspector.evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(isNearWhite(inspectorBackground), `the inspector stayed light: ${inspectorBackground}`).toBe(false)
})

/**
 * `System` is the default every user starts on, and it is the only state that
 * depends on the live `prefers-color-scheme` subscription. The other tests all
 * click an explicit choice, so this is the branch that would otherwise ship
 * untested: a dark operating system, nothing stored.
 */
test.describe('under a dark operating system', () => {
  test.use({ colorScheme: 'dark' })

  test('System draws the app dark, follows a change live, and still leaves the email light', async ({
    page,
  }) => {
    await expect(themeOption(page, 'System theme')).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(page.locator('meta[name="color-scheme"]')).toHaveAttribute('content', 'dark')

    await templateCard(page, PRODUCT_LAUNCH).click()
    const sheet = page.locator('.studio-sheet')
    await expect(sheet).toBeVisible({ timeout: EDITOR_LOAD_TIMEOUT })
    const sheetBackground = await sheet.evaluate((element) => getComputedStyle(element).backgroundColor)
    expect(isNearWhite(sheetBackground), `the canvas sheet went dark: ${sheetBackground}`).toBe(true)

    // The machine changes while the studio is open: `System` has to follow it
    // without a reload, which is what the matchMedia subscription is for.
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(page.locator('html')).not.toHaveClass(/dark/)
    await expect(themeOption(page, 'System theme')).toHaveAttribute('aria-checked', 'true')
  })
})
