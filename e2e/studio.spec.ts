import { readFileSync } from 'node:fs'
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
/** The code editor region, which holds all four tabs' editors. */
function sourcePanel(page: Page) {
  return page.getByRole('region', { name: 'Code editor' })
}
function payloadPanel(page: Page) {
  return page.getByRole('region', { name: 'Props payload' })
}
function previewPanel(page: Page) {
  return page.getByRole('region', { name: 'Preview', exact: true })
}
/** The scaled-down copy of the preview in the code rail. */
function thumbnailPanel(page: Page) {
  return page.getByRole('region', { name: 'Live preview', exact: true })
}
function modeButton(page: Page, name: string) {
  return page.getByRole('group', { name: 'Editing mode' }).getByRole('button', { name, exact: true })
}
function envelopePanel(page: Page) {
  return page.getByRole('region', { name: 'Envelope & dispatch' })
}
function statusBar(page: Page) {
  return page.getByRole('region', { name: 'Studio status' })
}
function actionsToolbar(page: Page) {
  return page.getByRole('toolbar', { name: 'Template actions' })
}
function libraryHeading(page: Page) {
  return page.getByRole('heading', { level: 1, name: 'Templates', exact: true })
}
/** In the studio the page heading is the template's own name, in the breadcrumb. */
function editorHeading(page: Page, name: string) {
  return page.getByRole('heading', { level: 1, name, exact: true })
}
function templateCard(page: Page, name: string) {
  return page.getByRole('button', { name: `Open ${name}`, exact: true })
}
/** The most recent toast, which is where a disabled control explains itself. */
function toast(page: Page, text: string) {
  return page.locator('[data-sonner-toast]').filter({ hasText: text })
}

/** The app lands on the library; opening a card is how you reach the editor. */
async function openTemplate(page: Page, name: string) {
  await expect(libraryHeading(page)).toBeVisible()
  await templateCard(page, name).click()
  await expect(editorHeading(page, name)).toBeVisible()
}

/** Preview is its own mode now: everything about the iframe starts here. */
async function openPreview(page: Page) {
  await modeButton(page, 'Preview').click()
  await expect(previewPanel(page)).toBeVisible()
}

/** Back to the code editor, the way the mode toggle does it. */
async function openCode(page: Page) {
  await modeButton(page, 'Code').click()
  await expect(sourcePanel(page)).toBeVisible()
}

/**
 * Waits for the render pipeline in CODE mode, where the editor's own banner is
 * the signal — used by tests that must not leave the editor to know a render
 * finished.
 */
async function waitForRender(page: Page) {
  await expect(sourcePanel(page).getByText('Compiled and rendered without errors.')).toBeVisible({
    timeout: FIRST_RENDER_TIMEOUT,
  })
}

/** The "Templates /" crumb in the studio sub-header. */
async function backToLibrary(page: Page) {
  await page.getByRole('button', { name: 'Templates', exact: true }).click()
  await expect(libraryHeading(page)).toBeVisible()
}

/** Every editor stays mounted; only the chosen tab's is visible. */
async function openEditorTab(page: Page, name: string) {
  await sourcePanel(page).getByRole('tab', { name, exact: true }).click()
  await expect(sourcePanel(page).getByRole('tab', { name, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  )
}

/** Replaces the whole content of a CodeMirror editor. */
async function replaceEditorText(page: Page, label: string, text: string) {
  const editor = page.getByLabel(label)
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(text)
}

/** Replaces the props JSON, opening its tab first. */
async function replacePayload(page: Page, text: string) {
  await openEditorTab(page, 'preview-props.json')
  await replaceEditorText(page, PAYLOAD_LABEL, text)
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
  // The studio names the file in its tab strip, and the template in its heading.
  await expect(sourcePanel(page).getByRole('tab', { name: 'template.tsx' })).toBeVisible()
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
  await openPreview(page)
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
  await waitForRender(page)

  await replacePayload(
    page,
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
  await expect(payloadPanel(page).getByText('JSON valid')).toBeVisible()
  // Checking the picture means going to Preview, the way a person would.
  await openPreview(page)
  await expect(previewBody(page)).toContainText('Welcome, Zed', { timeout: FIRST_RENDER_TIMEOUT })
  await openCode(page)

  // Schema-invalid: wrong type, reported by field path.
  await replaceEditorText(page, PAYLOAD_LABEL, '{"recipientName": "Zed", "expiresInHours": "soon"}')
  await expect(payloadPanel(page).getByText('Schema invalid')).toBeVisible()
  await expect(payloadPanel(page).getByText('expiresInHours', { exact: true })).toBeVisible()

  await openPreview(page)
  await expect(
    previewPanel(page).getByText('Preview paused. Fix the preview payload to continue rendering.'),
  ).toBeVisible()
  // The last good preview is kept on screen.
  await expect(previewBody(page)).toContainText('Welcome, Zed')
  await openCode(page)

  // Invalid JSON is a different failure mode.
  await replaceEditorText(page, PAYLOAD_LABEL, '{"recipientName": ')
  await expect(payloadPanel(page).getByText('Invalid JSON', { exact: true })).toBeVisible()

  // Reset restores the sample data and the preview recovers.
  await payloadPanel(page).getByRole('button', { name: 'Reset' }).click()
  await page.getByRole('button', { name: 'Reset payload' }).click()
  await expect(payloadPanel(page).getByText('JSON valid')).toBeVisible()
  await openPreview(page)
  await expect(previewBody(page)).toContainText('Welcome, Ada', { timeout: FIRST_RENDER_TIMEOUT })
})

test('source errors are reported without crashing and reset restores the original', async ({ page }) => {
  await openTemplate(page, WELCOME)
  await waitForRender(page)

  await replaceEditorText(page, WELCOME_SOURCE_LABEL, 'export default function Broken() {\n  return <p>\n}\n')
  await expect(sourcePanel(page).getByText('Compile error')).toBeVisible({ timeout: FIRST_RENDER_TIMEOUT })
  // The preview still shows the last good render, and says so.
  await openPreview(page)
  await expect(previewPanel(page).getByText('Showing last good render')).toBeVisible()
  await openCode(page)

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
  // With the source back to the original the draft is clean again. The welcome
  // starter ships as "ready", and the badge says the template's own status.
  await expect(page.getByText('Ready · Saved')).toBeVisible()
})

test('an infinite loop is stopped by the worker timeout and the studio recovers', async ({ page }) => {
  await openTemplate(page, WELCOME)
  await waitForRender(page)

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
  await waitForRender(page)
  await openPreview(page)
  await expect(previewBody(page)).toContainText('Recovered fine', { timeout: FIRST_RENDER_TIMEOUT })
})

test('network globals are unavailable inside the render worker', async ({ page }) => {
  await openTemplate(page, WELCOME)
  await waitForRender(page)
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
  await waitForRender(page)
  await replacePayload(page, '{"recipientName": "Draft Person"}')
  await expect(payloadPanel(page).getByText('Schema invalid')).toBeVisible()

  // The library badges the card of a template with unsaved edits.
  await backToLibrary(page)
  await expect(templateCard(page, WELCOME)).toContainText('Modified')
  await expect(templateCard(page, PASSWORD_RESET)).not.toContainText('Modified')

  await openTemplate(page, PASSWORD_RESET)
  await waitForRender(page)

  await page.reload()
  await openTemplate(page, WELCOME)
  await openEditorTab(page, 'preview-props.json')
  await expect(page.getByLabel(PAYLOAD_LABEL)).toContainText('Draft Person')
})

test('device toggle changes the preview viewport', async ({ page }) => {
  await openTemplate(page, WELCOME)
  await openPreview(page)
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
    const editor = await overflow()
    expect(editor.scrollWidth, `editor at ${width}px`).toBeLessThanOrEqual(editor.clientWidth)

    // Preview mode is a second layout at every width, and the widest thing in
    // it (a 680 px mail frame) is exactly what would push a page sideways.
    await openPreview(page)
    const preview = await overflow()
    expect(preview.scrollWidth, `preview at ${width}px`).toBeLessThanOrEqual(preview.clientWidth)
    await openCode(page)

    // The chrome added in phase 3: each band has to end inside the viewport.
    // The strips themselves may scroll internally; the page never does.
    for (const [label, region] of [
      ['sub-header toolbar', actionsToolbar(page)],
      ['envelope panel', envelopePanel(page)],
      ['status bar', statusBar(page)],
    ] as const) {
      const box = await region.boundingBox()
      expect(box, `${label} at ${width}px`).not.toBeNull()
      expect(box!.x + box!.width, `${label} at ${width}px`).toBeLessThanOrEqual(width + 1)
    }

    await backToLibrary(page)
  }
})

test('the editors keep their undo history and their gutters across a tab switch', async ({ page }) => {
  await openTemplate(page, WELCOME)
  const source = page.getByLabel(WELCOME_SOURCE_LABEL)
  await source.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.insertText('\n// scratch note\n')
  await expect(source).toContainText('// scratch note')

  // Every editor stays mounted, so the round trip must not destroy this one.
  await openEditorTab(page, 'preview-props.json')
  await expect(page.getByLabel(PAYLOAD_LABEL)).toBeVisible()
  await openEditorTab(page, 'template.tsx')

  // A hidden CodeMirror measures itself as zero wide; a re-measure on the way
  // back is what keeps the line-number gutter from collapsing.
  const gutterWidth = await sourcePanel(page)
    .locator('.cm-gutters')
    .first()
    .evaluate((element) => element.getBoundingClientRect().width)
  expect(gutterWidth).toBeGreaterThan(0)

  // Preview mode hides the editors the same way a tab switch does, so the round
  // trip through it has to end with a measured gutter as well.
  await openPreview(page)
  await openCode(page)
  const gutterAfterPreview = await sourcePanel(page)
    .locator('.cm-gutters')
    .first()
    .evaluate((element) => element.getBoundingClientRect().width)
  expect(gutterAfterPreview).toBeGreaterThan(0)

  await source.click()
  await page.keyboard.press('ControlOrMeta+Z')
  await expect(source).not.toContainText('// scratch note')
})

test('a primitive chip inserts a React Email element at the cursor', async ({ page }) => {
  await openTemplate(page, WELCOME)
  const source = page.getByLabel(WELCOME_SOURCE_LABEL)
  await source.click()
  await page.keyboard.press('ControlOrMeta+End')

  await page.getByRole('button', { name: 'Insert <Row>/<Column>' }).click()
  await expect(source).toContainText('<Column></Column>')
})

test('the keyboard shortcuts are registered and explain what is not built yet', async ({ page }) => {
  // ⌘P belongs to the studio: it opens Preview, and the browser's own print
  // dialog never gets the chance.
  await page.addInitScript(() => {
    const flags = window as unknown as { __printed: number }
    flags.__printed = 0
    window.print = () => {
      flags.__printed += 1
    }
  })
  await page.reload()
  await openTemplate(page, WELCOME)

  await page.keyboard.press('ControlOrMeta+P')
  await expect(previewPanel(page)).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(0)
  await page.keyboard.press('ControlOrMeta+P')
  await expect(sourcePanel(page)).toBeVisible()

  // Saving needs somewhere to save to, so ⌘S answers with the button's reason.
  await page.keyboard.press('ControlOrMeta+S')
  await expect(toast(page, 'Coming with saved templates.')).toBeVisible()

  await page.keyboard.press('?')
  const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Send test email')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

test('the envelope panel counts the subject against the 78 character recommendation', async ({ page }) => {
  await openTemplate(page, WELCOME)
  const envelope = envelopePanel(page)
  const subject = envelope.getByLabel('Subject line')

  await expect(envelope.getByText(/\d+ \/ 78 chars/)).toBeVisible()
  await subject.fill('x'.repeat(80))
  await expect(envelope.getByText('80 / 78 chars')).toBeVisible()
  await expect(envelope.getByText('Most clients truncate subjects past 78 characters.')).toBeVisible()
  await expect(page.getByText('Ready · Unsaved changes')).toBeVisible()

  await envelope.getByRole('button', { name: 'Reset envelope' }).click()
  await expect(envelope.getByText('Most clients truncate subjects past 78 characters.')).toBeHidden()
})

test('the mode toggle reaches Code and Preview and explains Visual', async ({ page }) => {
  await openTemplate(page, WELCOME)
  const modes = page.getByRole('group', { name: 'Editing mode' })
  await expect(modes.getByRole('button')).toHaveCount(3)
  await expect(modeButton(page, 'Code')).toHaveAttribute('aria-pressed', 'true')

  const visual = modeButton(page, 'Visual')
  await expect(visual).toHaveAttribute('aria-disabled', 'true')
  // Playwright treats aria-disabled as "not enabled" and would wait forever.
  // A real pointer is not stopped by it, which is the whole point of the
  // pattern: the click is answered with the reason instead of being swallowed.
  await visual.click({ force: true })
  await expect(
    toast(page, 'This template is written in TSX. Visual editing is only available for visual templates.'),
  ).toBeVisible()
  await expect(sourcePanel(page)).toBeVisible()

  // Preview is reachable, and pressing it swaps which workspace is on screen.
  await openPreview(page)
  await expect(modeButton(page, 'Preview')).toHaveAttribute('aria-pressed', 'true')
  await expect(sourcePanel(page)).toBeHidden()
  await openCode(page)
  await expect(previewPanel(page)).toBeHidden()
})

test('a stored preview mode opens the studio in Preview', async ({ page }) => {
  // 'preview' is a legal mode for a code template and the session schema keeps
  // it, so a reload lands back in the workspace that was left open.
  await page.evaluate(() => {
    sessionStorage.setItem(
      'email-template-studio:v1',
      JSON.stringify({
        selectedId: 'welcome-verification',
        device: 'desktop',
        mode: 'preview',
        drafts: {},
      }),
    )
  })
  await page.reload()
  await openTemplate(page, WELCOME)

  await expect(modeButton(page, 'Preview')).toHaveAttribute('aria-pressed', 'true')
  await expect(previewPanel(page)).toBeVisible()
  await expect(sourcePanel(page)).toBeHidden()

  // Code is one press away, and nothing about it is disabled.
  await expect(modeButton(page, 'Code')).not.toHaveAttribute('aria-disabled', 'true')
  await openCode(page)
})

test('the open editor is exactly one viewport tall and scrolls inside itself', async ({ page }) => {
  await openTemplate(page, WELCOME)
  await expect(sourcePanel(page)).toBeVisible()

  // Density 'app': from `lg` up the shell is `h-dvh` and every scrollbar is
  // internal, so the document itself must have nothing to scroll.
  const page_ = await page.evaluate(() => ({
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }))
  expect(page_.scrollHeight).toBeLessThanOrEqual(page_.clientHeight + 1)

  // The status bar is pinned at the bottom of the editor, above the footer,
  // without anyone having to scroll to it.
  const bar = await statusBar(page).boundingBox()
  expect(bar).not.toBeNull()
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(900)

  // Back on the library the page scrolls normally again.
  await backToLibrary(page)
  await expect(libraryHeading(page)).toBeVisible()
})

test('⌘P moves focus into the preview, announces it, and Escape comes back', async ({ page }) => {
  await openTemplate(page, WELCOME)
  await waitForRender(page)

  await page.keyboard.press('ControlOrMeta+P')
  await expect(previewPanel(page)).toBeVisible()
  // Focus follows the mode, so the next Tab starts inside the preview.
  await expect(previewPanel(page)).toBeFocused()
  await expect(page.getByRole('status').filter({ hasText: 'Preview mode. Read only.' })).toBeAttached()

  // Escape inside the preview returns to the editor it came from.
  await page.keyboard.press('Escape')
  await expect(sourcePanel(page)).toBeVisible()
  await expect(modeButton(page, 'Code')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('status').filter({ hasText: 'Code editor.' })).toBeAttached()
})

test('the plain-text part is real text, in the editor tab and in the preview', async ({ page }) => {
  await openTemplate(page, WELCOME)
  await waitForRender(page)

  await openEditorTab(page, 'Plain text')
  await expect(page.getByLabel('Plain text (read only)')).toContainText('WELCOME, ADA')
  await expect(statusBar(page)).toContainText('Plain text ready')

  await openPreview(page)
  // Only the selected tab is in the tab order, so the arrow keys are the one
  // keyboard route to the other panel — the same as the editor's tab strip.
  await previewPanel(page).getByRole('tab', { name: 'Rendered', exact: true }).focus()
  await page.keyboard.press('ArrowRight')
  const plainTab = previewPanel(page).getByRole('tab', { name: 'Plain text', exact: true })
  await expect(plainTab).toHaveAttribute('aria-selected', 'true')
  await expect(plainTab).toBeFocused()
  const plain = previewPanel(page).getByLabel('Plain text part (read only)')
  const contents = await plain.innerText()
  expect(contents).toMatch(/welcome, ada/i)
  // An alternative part is text, not a second copy of the markup.
  expect(contents).not.toContain('<')
})

test('the code rail shows a decorative thumbnail that preview mode takes over', async ({ page }) => {
  await openTemplate(page, WELCOME)
  await waitForRender(page)

  const thumbnail = thumbnailPanel(page)
  await expect(thumbnail).toBeVisible()
  const frame = thumbnail.locator('iframe')
  await expect(frame).toHaveAttribute('aria-hidden', 'true')
  await expect(frame).toHaveAttribute('tabindex', '-1')
  await expect(frame).toHaveAttribute('title', '')
  await expect(thumbnail.getByText(/of 680 px\. ⌘P opens the full preview\./)).toBeVisible()

  // The button is the accessible route to the same picture...
  await thumbnail.getByRole('button', { name: 'Open full preview' }).click()
  await expect(previewPanel(page)).toBeVisible()
  // ...and because pressing it destroys the button, focus has to land on the
  // preview rather than fall back to <body>.
  await expect(previewPanel(page)).toBeFocused()
  // ...and the thumbnail is not mounted at all while preview mode has it.
  await expect(thumbnailPanel(page)).toHaveCount(0)
})

test('switching modes costs no render', async ({ page }) => {
  await openTemplate(page, WELCOME)
  await waitForRender(page)

  const report = page.getByRole('region', { name: 'Render report' })
  const before = await report.getByText(/^\d+ ms$/).textContent()

  await openPreview(page)
  const renderedAt = await previewPanel(page).locator('time').textContent()
  await openCode(page)

  // One render feeds the preview, the thumbnail and the size checks (ADR-25),
  // so a mode round trip cannot produce a new measurement.
  expect(await report.getByText(/^\d+ ms$/).textContent()).toBe(before)
  await openPreview(page)
  expect(await previewPanel(page).locator('time').textContent()).toBe(renderedAt)
})

test('the preview downloads the rendered HTML and the plain text', async ({ page }) => {
  await openTemplate(page, WELCOME)
  await waitForRender(page)
  await openPreview(page)

  const [htmlDownload] = await Promise.all([
    page.waitForEvent('download'),
    previewPanel(page).getByRole('button', { name: 'Download HTML' }).click(),
  ])
  expect(htmlDownload.suggestedFilename()).toBe('welcome-verification.html')
  const htmlPath = await htmlDownload.path()
  expect(htmlPath).not.toBeNull()
  const html = readFileSync(htmlPath!, 'utf8')
  expect(html.length).toBeGreaterThan(0)
  expect(html).toContain('<html')

  const [textDownload] = await Promise.all([
    page.waitForEvent('download'),
    previewPanel(page).getByRole('button', { name: 'Download plain text' }).click(),
  ])
  expect(textDownload.suggestedFilename()).toBe('welcome-verification.txt')
  const textPath = await textDownload.path()
  expect(textPath).not.toBeNull()
  const text = readFileSync(textPath!, 'utf8')
  expect(text.length).toBeGreaterThan(0)
  expect(text).not.toContain('<')

  // The same two actions live in the overflow menu, and they work there too.
  await page.getByRole('button', { name: 'More actions' }).click()
  const item = page.getByRole('menuitem', { name: 'Download HTML' })
  await expect(item).not.toHaveAttribute('aria-disabled', 'true')
  const [menuDownload] = await Promise.all([page.waitForEvent('download'), item.click()])
  expect(menuDownload.suggestedFilename()).toBe('welcome-verification.html')
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
  await waitForRender(page)

  await actionsToolbar(page).getByRole('button', { name: 'Send test' }).click()
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
