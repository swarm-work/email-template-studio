import { expect, test, type Page } from '@playwright/test'

const WELCOME = 'Welcome & verification'
const PASSWORD_RESET = 'Password reset'
const WELCOME_SOURCE_LABEL = 'Template source for welcome-verification.email.tsx'
const PAYLOAD_LABEL = 'Preview payload JSON'

/**
 * Playwright evaluates locators inside the sandboxed preview frame, which makes
 * Chromium log this message. It is proof the sandbox works, not an app error;
 * a separate assertion checks the rendered HTML contains no script tags.
 */
const SANDBOX_NOTICE = /Blocked script execution in 'about:srcdoc'/

/**
 * How long to wait for a preview. This is not a UI wait: it covers fetching and
 * parsing the ~2 MB render worker and compiling the template inside it, which
 * on a loaded machine took longer than the old 15 s and read as a broken build.
 */
const FIRST_RENDER_TIMEOUT = 30_000

function previewBody(page: Page) {
  return page.frameLocator('iframe[title^="Email preview"]').locator('body')
}
function sourcePanel(page: Page) {
  return page.getByRole('region', { name: /\.email\.tsx$/ })
}
function payloadPanel(page: Page) {
  return page.getByRole('region', { name: 'Preview payload' })
}
function previewPanel(page: Page) {
  return page.getByRole('region', { name: 'Preview', exact: true })
}
function libraryHeading(page: Page) {
  return page.getByRole('heading', { level: 1, name: 'Templates', exact: true })
}
function editorHeading(page: Page) {
  return page.getByRole('heading', { level: 1, name: 'Templates & Studio' })
}
function templateCard(page: Page, name: string) {
  return page.getByRole('button', { name: `Open ${name}`, exact: true })
}

/** The app lands on the library; opening a card is how you reach the editor. */
async function openTemplate(page: Page, name: string) {
  await expect(libraryHeading(page)).toBeVisible()
  await templateCard(page, name).click()
  await expect(editorHeading(page)).toBeVisible()
}

/** The temporary "← Templates" button in the studio header. */
async function backToLibrary(page: Page) {
  await page.getByRole('button', { name: 'Templates', exact: true }).click()
  await expect(libraryHeading(page)).toBeVisible()
}

/** Replaces the whole content of a CodeMirror editor. */
async function replaceEditorText(page: Page, label: string, text: string) {
  const editor = page.getByLabel(label)
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(text)
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

test('the library lists the templates and opens one into the editor and back', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Template library' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(3)
  // A card opens a template; it is an action, not a toggle that stays pressed.
  await expect(templateCard(page, WELCOME)).not.toHaveAttribute('aria-pressed', /.*/)

  await openTemplate(page, WELCOME)
  await expect(page.getByRole('heading', { level: 2, name: 'welcome-verification.email.tsx' })).toBeVisible()
  await expect(libraryHeading(page)).toHaveCount(0)

  await backToLibrary(page)
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(3)
})

test('library search narrows the grid and can be cleared', async ({ page }) => {
  const search = page.getByRole('searchbox', { name: 'Search templates' })
  await search.fill('password')
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(1)
  await expect(templateCard(page, PASSWORD_RESET)).toBeVisible()

  await search.fill('invoice')
  await expect(page.getByText('No templates match "invoice".')).toBeVisible()
  await page.getByRole('button', { name: 'Clear search' }).click()
  await expect(page.getByRole('button', { name: /^Open / })).toHaveCount(3)
})

test('renders the default template in the isolated preview frame', async ({ page }) => {
  await openTemplate(page, WELCOME)
  await expect(previewBody(page)).toContainText('Welcome, Ada', { timeout: FIRST_RENDER_TIMEOUT })
  await expect(previewPanel(page).getByText('Up to date')).toBeVisible()

  const iframe = page.locator('iframe[title^="Email preview"]')
  await expect(iframe).toHaveAttribute('sandbox', '')
  const srcdoc = await iframe.getAttribute('srcdoc')
  expect(srcdoc).toContain('Content-Security-Policy')
  expect(srcdoc).not.toMatch(/<script/i)
})

test('the source editor scrolls inside a bounded height', async ({ page }) => {
  await openTemplate(page, WELCOME)
  const scroller = sourcePanel(page).locator('.cm-scroller').first()
  await expect(scroller).toBeVisible()
  const metrics = await scroller.evaluate((element) => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    overflowY: getComputedStyle(element).overflowY,
  }))
  expect(metrics.clientHeight).toBeLessThan(700)
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
  expect(['auto', 'scroll']).toContain(metrics.overflowY)

  await scroller.evaluate((element) => element.scrollTo({ top: 10_000 }))
  const scrollTop = await scroller.evaluate((element) => element.scrollTop)
  expect(scrollTop).toBeGreaterThan(200)
  await expect(page.getByLabel(WELCOME_SOURCE_LABEL)).toContainText(
    'satisfies Record<string, React.CSSProperties>',
  )
})

test('payload edits update the preview and are validated separately from JSON syntax', async ({ page }) => {
  await openTemplate(page, WELCOME)
  await expect(previewBody(page)).toContainText('Welcome, Ada', { timeout: FIRST_RENDER_TIMEOUT })

  await replaceEditorText(
    page,
    PAYLOAD_LABEL,
    JSON.stringify(
      {
        recipientName: 'Zed',
        verificationUrl: 'https://example.test/verify',
        expiresInHours: 6,
        productName: 'Meridian',
        supportEmail: 'help@example.test',
      },
      null,
      2,
    ),
  )
  await expect(previewBody(page)).toContainText('Welcome, Zed', { timeout: FIRST_RENDER_TIMEOUT })
  await expect(payloadPanel(page).getByText('Schema valid')).toBeVisible()

  // Schema-invalid: wrong type, reported by field path.
  await replaceEditorText(page, PAYLOAD_LABEL, '{"recipientName": "Zed", "expiresInHours": "soon"}')
  await expect(payloadPanel(page).getByText('Schema invalid')).toBeVisible()
  await expect(payloadPanel(page).getByText('expiresInHours', { exact: true })).toBeVisible()
  await expect(page.getByText('Preview paused. Fix the preview payload to continue rendering.')).toBeVisible()
  // The last good preview is kept on screen.
  await expect(previewBody(page)).toContainText('Welcome, Zed')

  // Invalid JSON is a different failure mode.
  await replaceEditorText(page, PAYLOAD_LABEL, '{"recipientName": ')
  await expect(payloadPanel(page).getByText('Invalid JSON', { exact: true })).toBeVisible()

  // Reset restores the sample data and the preview recovers.
  await payloadPanel(page).getByRole('button', { name: 'Reset' }).click()
  await page.getByRole('button', { name: 'Reset payload' }).click()
  await expect(payloadPanel(page).getByText('Schema valid')).toBeVisible()
  await expect(previewBody(page)).toContainText('Welcome, Ada', { timeout: FIRST_RENDER_TIMEOUT })
})

test('source errors are reported without crashing and reset restores the original', async ({ page }) => {
  await openTemplate(page, WELCOME)
  await expect(previewBody(page)).toContainText('Welcome, Ada', { timeout: FIRST_RENDER_TIMEOUT })

  await replaceEditorText(page, WELCOME_SOURCE_LABEL, 'export default function Broken() {\n  return <p>\n}\n')
  await expect(sourcePanel(page).getByText('Compile error')).toBeVisible({ timeout: FIRST_RENDER_TIMEOUT })
  await expect(previewPanel(page).getByText('Showing last good render')).toBeVisible()

  await replaceEditorText(
    page,
    WELCOME_SOURCE_LABEL,
    "import fs from 'node:fs'\nexport default function T() { return null }\n",
  )
  await expect(sourcePanel(page).getByText('Import not allowed')).toBeVisible({
    timeout: FIRST_RENDER_TIMEOUT,
  })
  await expect(sourcePanel(page).getByText(/"node:fs" is not available in the studio/)).toBeVisible()

  await sourcePanel(page).getByRole('button', { name: 'Reset' }).click()
  await page.getByRole('button', { name: 'Reset source' }).click()
  await expect(sourcePanel(page).getByText('Compiled and rendered without errors.')).toBeVisible({
    timeout: FIRST_RENDER_TIMEOUT,
  })
  await expect(sourcePanel(page).getByText('Original', { exact: true })).toBeVisible()
})

test('an infinite loop is stopped by the worker timeout and the studio recovers', async ({ page }) => {
  await openTemplate(page, WELCOME)
  await expect(previewBody(page)).toContainText('Welcome, Ada', { timeout: FIRST_RENDER_TIMEOUT })

  await replaceEditorText(
    page,
    WELCOME_SOURCE_LABEL,
    'export default function Loop() {\n  while (true) {}\n}\n',
  )
  await expect(sourcePanel(page).getByText('Render stopped')).toBeVisible({ timeout: 20_000 })
  await expect(sourcePanel(page).getByText(/Rendering was stopped after 5s/)).toBeVisible()

  await replaceEditorText(
    page,
    WELCOME_SOURCE_LABEL,
    "import { Html, Text } from '@react-email/components'\nexport default function Fine() { return <Html><Text>Recovered fine</Text></Html> }\n",
  )
  await expect(previewBody(page)).toContainText('Recovered fine', { timeout: FIRST_RENDER_TIMEOUT })
})

test('network globals are unavailable inside the render worker', async ({ page }) => {
  await openTemplate(page, WELCOME)
  await expect(previewBody(page)).toContainText('Welcome, Ada', { timeout: FIRST_RENDER_TIMEOUT })
  await replaceEditorText(
    page,
    WELCOME_SOURCE_LABEL,
    'export default function Probe() {\n  const names = ["fetch", "XMLHttpRequest", "WebSocket", "importScripts", "Worker"]\n  const present = names.filter((n) => typeof (globalThis as any)[n] !== "undefined")\n  throw new Error("present:[" + present.join(",") + "]")\n}\n',
  )
  await expect(sourcePanel(page).getByText('Render error')).toBeVisible({ timeout: FIRST_RENDER_TIMEOUT })
  await expect(sourcePanel(page).getByText(/present:\[\]/)).toBeVisible()
})

test('drafts survive switching templates and reloading the page', async ({ page }) => {
  await openTemplate(page, WELCOME)
  await expect(previewBody(page)).toContainText('Welcome, Ada', { timeout: FIRST_RENDER_TIMEOUT })
  await replaceEditorText(page, PAYLOAD_LABEL, '{"recipientName": "Draft Person"}')
  await expect(payloadPanel(page).getByText('Schema invalid')).toBeVisible()

  // The library badges the card of a template with unsaved edits.
  await backToLibrary(page)
  await expect(templateCard(page, WELCOME)).toContainText('Modified')
  await expect(templateCard(page, PASSWORD_RESET)).not.toContainText('Modified')

  await openTemplate(page, PASSWORD_RESET)
  await expect(page.getByRole('heading', { level: 2, name: 'password-reset.email.tsx' })).toBeVisible()
  await expect(previewBody(page)).toContainText('Reset your password', { timeout: FIRST_RENDER_TIMEOUT })

  await page.reload()
  await openTemplate(page, WELCOME)
  await expect(page.getByLabel(PAYLOAD_LABEL)).toContainText('Draft Person')
})

test('device toggle changes the preview viewport', async ({ page }) => {
  await openTemplate(page, WELCOME)
  const iframe = page.locator('iframe[title^="Email preview"]')
  await expect(iframe).toBeVisible({ timeout: FIRST_RENDER_TIMEOUT })
  const desktopWidth = await iframe.evaluate((element) => element.getBoundingClientRect().width)
  expect(desktopWidth).toBeGreaterThan(375)
  await expect(previewPanel(page).getByText('Desktop · up to 680px')).toBeVisible()

  await page.getByRole('radio', { name: 'Mobile preview' }).click()
  await expect(iframe).toHaveCSS('width', '375px')
  await expect(previewPanel(page).getByText('Mobile · 375px')).toBeVisible()
  await expect(page.getByRole('radio', { name: 'Mobile preview' })).toHaveAttribute('aria-checked', 'true')
})

test('neither the library nor the editor scrolls sideways at any supported width', async ({ page }) => {
  const overflow = () =>
    page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))

  for (const width of [1440, 1280, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(libraryHeading(page)).toBeVisible()
    const library = await overflow()
    expect(library.scrollWidth, `library at ${width}px`).toBeLessThanOrEqual(library.clientWidth)

    // The editor's layout is what is being measured, so this waits for the
    // panels rather than for a finished render (which depends on the worker).
    await openTemplate(page, WELCOME)
    await expect(sourcePanel(page)).toBeVisible()
    await expect(previewPanel(page)).toBeVisible()
    const editor = await overflow()
    expect(editor.scrollWidth, `editor at ${width}px`).toBeLessThanOrEqual(editor.clientWidth)

    await backToLibrary(page)
  }
})

test('API keys page generates a mock key and adds a webhook endpoint', async ({ page }) => {
  await page.getByRole('button', { name: 'API Keys & Webhooks' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'API Keys & Integration' })).toBeVisible()
  await expect(page.getByText('Welcome emails sandbox')).toBeVisible()

  await page.getByRole('button', { name: 'Generate key' }).click()
  const keyDialog = page.getByRole('dialog', { name: 'Generate API key' })
  await keyDialog.getByRole('button', { name: 'Generate key' }).click()
  await expect(keyDialog.getByText(/^st_local_[A-Za-z0-9_-]{22}$/)).toBeVisible()
  await expect(keyDialog.getByRole('button', { name: 'Done' })).toBeDisabled()
  await keyDialog.getByRole('checkbox', { name: /I copied this key/ }).click()
  await keyDialog.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('Transactional send key')).toBeVisible()

  await page.getByRole('button', { name: 'Add webhook' }).click()
  const webhookDialog = page.getByRole('dialog', { name: 'Add webhook endpoint' })
  await webhookDialog.getByLabel('Name').fill('Product event sink')
  await webhookDialog.getByLabel('Endpoint URL').fill('https://hooks.example.test/events')
  await webhookDialog.getByRole('button', { name: 'opened' }).click()
  await webhookDialog.getByRole('button', { name: 'Add endpoint' }).click()
  await expect(page.getByText('Product event sink')).toBeVisible()
})

test('send test email goes through the API in dry-run mode', async ({ page }) => {
  await openTemplate(page, WELCOME)
  await expect(previewBody(page)).toContainText('Welcome, Ada', { timeout: FIRST_RENDER_TIMEOUT })

  await page.getByRole('button', { name: 'Send test email' }).click()
  const sendDialog = page.getByRole('dialog', { name: 'Send test email' })
  await expect(sendDialog.getByText('Connected')).toBeVisible()
  await expect(sendDialog.getByText('Dry run', { exact: true })).toBeVisible()
  await expect(sendDialog.getByText('studio@example.test')).toBeVisible()
  // Recipients are typed, not chosen: the field starts empty and both of these
  // are in the e2e allow-list (wrangler.jsonc env.e2e).
  const recipients = sendDialog.getByLabel('To')
  await expect(recipients).toHaveValue('')
  await recipients.fill('qa@example.test, second@example.test')

  await sendDialog.getByRole('button', { name: /^Send test$/ }).click()
  await expect(sendDialog.getByText('Dry run complete')).toBeVisible()
  await expect(sendDialog.getByText(/dry-run-\d+-[0-9a-f]{52}/)).toBeVisible()
  // Both addresses are named in the outcome alert, not just the field they were typed into.
  const sentAlert = sendDialog.getByRole('status').filter({ hasText: 'Message id' })
  await expect(sentAlert).toContainText('qa@example.test, second@example.test')
  await expect(
    page.getByText(/Dry run complete \(dry-run-\d+-[0-9a-f]{52}\)\. Nothing was sent\./),
  ).toBeVisible()

  // Regression: the long message id and the full-width recipient field must
  // stay inside the dialog instead of widening its grid column.
  const dialogBox = await sendDialog.boundingBox()
  expect(dialogBox).not.toBeNull()
  const overflow = await sendDialog.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }))
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth)
  const recipientsBox = await recipients.boundingBox()
  expect(recipientsBox).not.toBeNull()
  expect(recipientsBox!.x + recipientsBox!.width).toBeLessThanOrEqual(dialogBox!.x + dialogBox!.width - 8)
  // The dialog has two buttons named Close: the icon in the corner and the footer button.
  await sendDialog.getByRole('button', { name: 'Close' }).last().click()
})
