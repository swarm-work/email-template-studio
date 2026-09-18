import { expect, test, type Page } from '@playwright/test'

/**
 * The visual editor, end to end against the production build.
 *
 * Everything here needs a real browser: the editor is 2.5 MB of ProseMirror
 * behind `React.lazy`, its bubble menu is positioned by measuring the page, and
 * the whole point of the canvas is that what you see is what is exported
 * (ADR-11, ADR-18).
 */

const PRODUCT_LAUNCH = 'Product launch'
const WELCOME = 'Welcome & verification'

/** Anything the lazily loaded editor chunk could be called. */
const EDITOR_CHUNK = /editor|tiptap|prosemirror/i

/**
 * Playwright evaluates locators inside the sandboxed preview frame, which makes
 * Chromium log this message. It is proof the sandbox works, not an app error.
 */
const SANDBOX_NOTICE = /Blocked script execution in 'about:srcdoc'/

/** Downloading and parsing ~750 KB gzip of editor on a loaded machine. */
const EDITOR_LOAD_TIMEOUT = 30_000

function libraryHeading(page: Page) {
  return page.getByRole('heading', { level: 1, name: 'Templates', exact: true })
}
function templateCard(page: Page, name: string) {
  return page.getByRole('button', { name: `Open ${name}`, exact: true })
}
function canvas(page: Page) {
  return page.getByRole('region', { name: 'Email canvas' })
}
function inspector(page: Page) {
  return page.getByRole('region', { name: 'Inspector' })
}
function statusBar(page: Page) {
  return page.getByRole('region', { name: 'Studio status' })
}
function previewBody(page: Page) {
  return page.frameLocator('iframe[title^="Email preview"]').locator('body')
}
function modeButton(page: Page, name: string) {
  return page.getByRole('group', { name: 'Editing mode' }).getByRole('button', { name, exact: true })
}
function actionsToolbar(page: Page) {
  return page.getByRole('toolbar', { name: 'Template actions' })
}
/** The contenteditable sheet itself. */
function sheet(page: Page) {
  return page.locator('.studio-sheet .tiptap')
}
function bubbleMenu(page: Page) {
  return page.locator('[data-re-bubble-menu]')
}

async function openVisualTemplate(page: Page) {
  await expect(libraryHeading(page)).toBeVisible()
  await templateCard(page, PRODUCT_LAUNCH).click()
  await expect(canvas(page)).toBeVisible({ timeout: EDITOR_LOAD_TIMEOUT })
  await expect(sheet(page)).toBeVisible({ timeout: EDITOR_LOAD_TIMEOUT })
}

/** Selects a run of text by double-clicking a word inside the sheet. */
async function selectWord(page: Page, word: string) {
  await sheet(page).getByText(word, { exact: false }).first().dblclick()
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

test('the editor chunk is fetched for a visual template and for nothing else', async ({ page }) => {
  const editorRequests: string[] = []
  page.on('request', (request) => {
    if (EDITOR_CHUNK.test(request.url())) editorRequests.push(request.url())
  })

  // A code template must not pay for the editor at all (plan §3.10).
  await templateCard(page, WELCOME).click()
  await expect(page.getByRole('region', { name: 'Code editor' })).toBeVisible()
  expect(editorRequests, 'a code template fetched an editor chunk').toEqual([])

  await page.getByRole('button', { name: 'Templates', exact: true }).click()
  await openVisualTemplate(page)
  expect(editorRequests.length).toBeGreaterThan(0)
})

test('opens the canvas and the inspector, with the email at actual size', async ({ page }) => {
  await openVisualTemplate(page)

  await expect(canvas(page).getByText('600 px canvas · 100%')).toBeVisible()
  await expect(sheet(page)).toContainText('Next-Gen Edge APIs & Global Routing')
  await expect(inspector(page)).toBeVisible()
  await expect(inspector(page).getByRole('tab', { name: 'Style' })).toBeVisible()
  await expect(inspector(page).getByRole('tab', { name: 'Data' })).toBeVisible()
  // The sheet really is 600 px, which is what the chip promises.
  const width = await page.locator('.studio-sheet').evaluate((element) => element.clientWidth)
  expect(width).toBe(600)

  // A visual template offers Visual and Preview; Code says why it does not.
  await expect(modeButton(page, 'Visual')).toHaveAttribute('aria-pressed', 'true')
  await expect(modeButton(page, 'Code')).toHaveAttribute('aria-disabled', 'true')
  await expect(statusBar(page).getByText('Visual', { exact: true })).toBeVisible()
})

/**
 * Long on purpose: the status bar reports the export in tenths of a kilobyte,
 * so a handful of characters can round away and the size would look unchanged
 * even though the export really did grow. Over 102 bytes always moves it.
 */
const TYPED_ON_CANVAS =
  ' in Sydney, Frankfurt, Singapore, Toronto, Dublin, Mumbai, Osaka, Oslo, Lima, Cairo, Lagos, Seoul, Perth, Quito and Accra'

test('typing on the canvas reaches the preview and the exported size', async ({ page }) => {
  await openVisualTemplate(page)
  const size = statusBar(page).getByText(/^HTML export /)
  await expect(size).not.toHaveText('HTML export —', { timeout: EDITOR_LOAD_TIMEOUT })
  const before = await size.textContent()

  await sheet(page).getByText('Next-Gen Edge APIs').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(TYPED_ON_CANVAS)

  await modeButton(page, 'Preview').click()
  await expect(previewBody(page)).toContainText('in Sydney', { timeout: EDITOR_LOAD_TIMEOUT })
  await expect(size).not.toHaveText(before ?? '')
})

test('the bubble menu appears on a selection and is not clipped at either edge', async ({ page }) => {
  await openVisualTemplate(page)

  // The first line of the email: the menu has to go into the canvas gutter
  // above the sheet rather than be cut off by the scroller.
  await selectWord(page, 'SPRING')
  await expect(bubbleMenu(page)).toBeVisible()
  const scroller = canvas(page).locator('.dot-grid')
  const fits = async () => {
    const menu = await bubbleMenu(page).boundingBox()
    const box = await scroller.boundingBox()
    expect(menu, 'the bubble menu has no box').not.toBeNull()
    expect(box, 'the canvas scroller has no box').not.toBeNull()
    return { menu: menu!, box: box! }
  }
  const top = await fits()
  expect(top.menu.y).toBeGreaterThanOrEqual(top.box.y - 1)
  expect(top.menu.y + top.menu.height).toBeLessThanOrEqual(top.box.y + top.box.height + 1)

  // ...and the last line, where it has to flip or shift instead.
  await selectWord(page, 'Privacy policy')
  await expect(bubbleMenu(page)).toBeVisible()
  const bottom = await fits()
  expect(bottom.menu.y).toBeGreaterThanOrEqual(bottom.box.y - 1)
  expect(bottom.menu.y + bottom.menu.height).toBeLessThanOrEqual(bottom.box.y + bottom.box.height + 1)
})

test('"/" opens the slash menu', async ({ page }) => {
  await openVisualTemplate(page)

  await sheet(page).getByText('Meridian Systems').first().click()
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')

  const menu = page.locator('[data-re-slash-command]')
  await expect(menu).toBeVisible()
  await expect(menu).toContainText('Divider')
  await page.keyboard.press('Escape')
})

test('the breadcrumb names the selected block, and the block can be duplicated', async ({ page }) => {
  await openVisualTemplate(page)

  // Before anything is selected the two node buttons say so rather than acting
  // on a block the breadcrumb is not naming.
  const deleteBlock = inspector(page).getByRole('button', { name: 'Delete block' })
  await expect(deleteBlock).toHaveAttribute('aria-disabled', 'true')

  await sheet(page).getByText('Next-Gen Edge APIs').first().click()
  await expect(deleteBlock).not.toHaveAttribute('aria-disabled', 'true')
  const breadcrumb = inspector(page).locator('[data-re-inspector-breadcrumb]')
  await expect(breadcrumb).toContainText('Heading')

  const headings = sheet(page).getByText('Next-Gen Edge APIs')
  const before = await headings.count()
  await inspector(page).getByRole('button', { name: 'Duplicate block' }).click()
  await expect(headings).toHaveCount(before + 1)

  await inspector(page).getByRole('button', { name: 'Delete block' }).click()
  await expect(headings).toHaveCount(before)
})

test('a typography change in the inspector reaches the exported email', async ({ page }) => {
  await openVisualTemplate(page)
  await expect(statusBar(page).getByText(/^HTML export /)).not.toHaveText('HTML export —', {
    timeout: EDITOR_LOAD_TIMEOUT,
  })

  await sheet(page).getByText('Next-Gen Edge APIs').first().click()
  // The library's Typography section; "Size" is its font-size row.
  const size = inspector(page)
    .locator('[data-re-inspector-prop-row]')
    .filter({ hasText: 'Size' })
    .locator('input[data-re-inspector-input]')
    .first()
  await size.fill('48')
  await size.press('Enter')

  await modeButton(page, 'Preview').click()
  const heading = previewBody(page).locator('h1').first()
  await expect(heading).toBeVisible({ timeout: EDITOR_LOAD_TIMEOUT })
  await expect
    .poll(async () => heading.evaluate((element) => getComputedStyle(element).fontSize), {
      timeout: EDITOR_LOAD_TIMEOUT,
    })
    .toBe('48px')
})

test('undo and redo drive the canvas history from the sub-header', async ({ page }) => {
  await openVisualTemplate(page)
  const undo = actionsToolbar(page).getByRole('button', { name: 'Undo' })
  const redo = actionsToolbar(page).getByRole('button', { name: 'Redo' })

  await sheet(page).getByText('Next-Gen Edge APIs').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' undone')
  await expect(sheet(page)).toContainText('undone')

  await expect(undo).not.toHaveAttribute('aria-disabled', 'true')
  await undo.click()
  await expect(sheet(page)).not.toContainText('undone')
  await redo.click()
  await expect(sheet(page)).toContainText('undone')
})

test('the inspector rail is off-canvas at 1024 and the toggle brings it back', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await openVisualTemplate(page)

  const toggle = actionsToolbar(page).getByRole('button', { name: 'Inspector' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(toggle).toHaveAttribute('aria-controls', 'studio-inspector-rail')
  // The rail is in the DOM the whole time; it is parked just past the right
  // edge of the workspace, which clips it.
  const workspace = page.getByRole('region', { name: 'Visual editor' })
  const workspaceBox = (await workspace.boundingBox())!
  const rightEdge = workspaceBox.x + workspaceBox.width
  expect((await inspector(page).boundingBox())!.x).toBeGreaterThanOrEqual(rightEdge - 1)

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(async () => (await inspector(page).boundingBox())!.x).toBeLessThan(rightEdge - 100)
  // Opening moves focus into the rail, so the next Tab continues inside it.
  await expect(inspector(page)).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  // ...and closing gives focus back to the button that opened it.
  await expect(toggle).toBeFocused()
})

test('an uploaded PNG becomes a hosted image in the exported email', async ({ page }) => {
  await openVisualTemplate(page)
  await sheet(page).getByText('Next-Gen Edge APIs').first().click()

  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    inspector(page).getByRole('button', { name: 'Insert image' }).click(),
  ])
  await chooser.setFiles('e2e/fixtures/pixel.png')

  // The temporary blob: src is swapped for the hosted one once R2 answers.
  const image = sheet(page).locator('img')
  await expect(image).toHaveAttribute('src', /^http:\/\/localhost:4173\/media\/img_/, {
    timeout: EDITOR_LOAD_TIMEOUT,
  })

  await modeButton(page, 'Preview').click()
  await expect(previewBody(page).locator('img')).toHaveAttribute(
    'src',
    /^http:\/\/localhost:4173\/media\/img_/,
    { timeout: EDITOR_LOAD_TIMEOUT },
  )
})

test('the read-only export views are reachable from the overflow menu', async ({ page }) => {
  await openVisualTemplate(page)
  await expect(statusBar(page).getByText(/^HTML export /)).not.toHaveText('HTML export —', {
    timeout: EDITOR_LOAD_TIMEOUT,
  })

  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'View exported code' }).click()

  const dialog = page.getByRole('dialog', { name: 'Exported code' })
  await expect(dialog).toContainText('This template is edited visually.')
  await expect(dialog.getByRole('tab', { name: 'Exported HTML' })).toBeVisible()
  await expect(dialog.getByRole('tab', { name: 'document.json' })).toBeVisible()
  await dialog.getByRole('tab', { name: 'document.json' }).click()
  await expect(dialog.getByLabel('Canvas document JSON (read only)')).toContainText('container')
  await page.keyboard.press('Escape')

  // Converting is phase 8, and the menu says so rather than hiding the item.
  await page.getByRole('button', { name: 'More actions' }).click()
  await expect(page.getByRole('menuitem', { name: /Convert to code template/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await page.keyboard.press('Escape')
})

test('a dark operating system leaves the chrome on the app theme and the sheet white', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await openVisualTemplate(page)

  // The package's default.css sets its own dark --re-* values under
  // prefers-color-scheme; the unlayered `:root:root` bridge has to beat them.
  const chrome = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--re-bg').trim(),
  )
  expect(chrome).not.toBe('#1c1c1c')

  const sheetBackground = await page
    .locator('.studio-sheet')
    .evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(sheetBackground).toBe('rgb(255, 255, 255)')
  const sheetToken = await page
    .locator('.studio-sheet')
    .evaluate((element) => getComputedStyle(element).getPropertyValue('--re-bg').trim())
  expect(sheetToken).toBe('#fff')
})

test('the visual studio never scrolls sideways, at any width', async ({ page }) => {
  await openVisualTemplate(page)

  for (const width of [1440, 1280, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 })
    const shell = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }))
    expect(shell.scrollWidth, `shell at ${width}px`).toBeLessThanOrEqual(shell.clientWidth)

    const rail = await inspector(page).evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }))
    expect(rail.scrollWidth, `inspector at ${width}px`).toBeLessThanOrEqual(rail.clientWidth)
  }
})

test('the feature flag switches the canvas off and says so', async ({ page }) => {
  // The flag is a Worker var, so the browser learns about it from the status
  // endpoint. Stubbing that is the whole switch, as far as the studio knows.
  const editorRequests: string[] = []
  page.on('request', (request) => {
    if (EDITOR_CHUNK.test(request.url())) editorRequests.push(request.url())
  })
  await page.route('**/api/send-test/status', async (route) => {
    // Best effort: `route.fetch()`'s response is disposed if a navigation lands
    // while it is in flight, and a handler that throws never fulfils the route
    // at all. The only part this test needs is the flag, so a failed read falls
    // back to the rest of the answer being empty.
    const body = await route
      .fetch()
      .then((response) => response.json() as Promise<Record<string, unknown>>)
      .catch(() => ({}))
    await route.fulfill({ json: { ...body, features: { visualEditor: false } } })
  })
  await page.reload()

  await expect(libraryHeading(page)).toBeVisible()
  await templateCard(page, PRODUCT_LAUNCH).click()

  await expect(page.getByRole('alert')).toContainText(
    'The visual editor is switched off. This template is read-only until it is switched back on.',
  )
  await expect(modeButton(page, 'Visual')).toHaveAttribute('aria-disabled', 'true')
  await expect(modeButton(page, 'Preview')).toHaveAttribute('aria-pressed', 'true')
  await expect(canvas(page)).toHaveCount(0)
  // Nothing that acts ON the canvas is drawn either: an Inspector toggle would
  // point `aria-controls` at a rail that is not in the document, and Undo would
  // say "still loading" about an editor that is never coming.
  await expect(actionsToolbar(page).getByRole('button', { name: 'Inspector' })).toHaveCount(0)
  await expect(actionsToolbar(page).getByRole('button', { name: 'Undo' })).toHaveCount(0)
  await expect(actionsToolbar(page).getByRole('button', { name: 'Redo' })).toHaveCount(0)
  // The whole point of the switch: the 2.5 MB editor is never downloaded.
  expect(editorRequests, 'the editor chunk was fetched with the flag off').toEqual([])
})

/* ---------------------------------------------------------------------------
 * Merge fields (phase 6). Typed on the canvas, filled in from the Data tab,
 * resolved in the preview - and never resolved in what is saved (ADR-26).
 * ------------------------------------------------------------------------ */

/** The chips themselves, whatever they are styled as. */
function chips(page: Page) {
  return page.locator('.studio-sheet [data-merge-field]')
}
function diagnostics(page: Page) {
  return page.getByRole('region', { name: 'Diagnostics' })
}
function dataTab(page: Page) {
  return inspector(page).getByRole('tab', { name: 'Data' })
}

test('typed {{keys}} become chips, warn, and resolve one key at a time', async ({ page }) => {
  await openVisualTemplate(page)
  await expect(statusBar(page).getByText(/^HTML export /)).not.toHaveText('HTML export —', {
    timeout: EDITOR_LOAD_TIMEOUT,
  })

  // 1. Typing the token converts it to one atomic chip. A PARAGRAPH, not the
  //    heading: the plain-text part uppercases heading text, which would make
  //    the token in that half `{{FIRSTNAME}}` (docs/TECH_DEBT.md #40).
  await sheet(page).getByText('We have fully rolled out').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' {{firstName}}')
  await expect(chips(page)).toHaveCount(1)
  await expect(chips(page).first()).toHaveText('{{firstName}}')

  // 2. The diagnostics row names the key that has no value. Diagnostics live in
  //    preview mode for a visual template (the canvas has the inspector instead).
  await modeButton(page, 'Preview').click()
  await expect(diagnostics(page)).toContainText('Unknown variable {{firstName}} · not in payload', {
    timeout: EDITOR_LOAD_TIMEOUT,
  })
  // ...and the token is still visible in the preview rather than blanked out.
  await expect(previewBody(page)).toContainText('{{firstName}}')

  // 3. The Data tab says the same thing, and fills the key in.
  await modeButton(page, 'Visual').click()
  await dataTab(page).click()
  await expect(inspector(page).getByText('1 in document')).toBeVisible()
  await expect(inspector(page).getByText('Not in payload')).toBeVisible()
  await inspector(page).getByRole('button', { name: 'Fill in missing keys' }).click()
  await expect(inspector(page).getByText('Not in payload')).toHaveCount(0)

  // By role, because the row's Insert button carries the same name in its
  // `aria-label`; only one of the two is a text box.
  await inspector(page).getByRole('textbox', { name: '{{firstName}}' }).fill('Ada')

  // 4. A SECOND key, with no value. Substitution is per key, not all-or-nothing:
  //    the one that has a value fills in even while the other does not, and only
  //    the unfilled one is warned about.
  await sheet(page).getByText('We have fully rolled out').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' {{company}}')
  await expect(chips(page)).toHaveCount(2)

  await modeButton(page, 'Preview').click()
  await expect(previewBody(page)).toContainText('Ada', { timeout: EDITOR_LOAD_TIMEOUT })
  await expect(previewBody(page)).not.toContainText('{{firstName}}')
  await expect(previewBody(page)).toContainText('{{company}}')
  await expect(diagnostics(page)).toContainText('Unknown variable {{company}} · not in payload')

  // 5. With both filled in, nothing is left over and the row passes.
  await modeButton(page, 'Visual').click()
  await dataTab(page).click()
  await inspector(page).getByRole('textbox', { name: '{{company}}' }).fill('Acme')
  await modeButton(page, 'Preview').click()
  await expect(previewBody(page)).toContainText('Acme', { timeout: EDITOR_LOAD_TIMEOUT })
  await expect(previewBody(page)).not.toContainText('{{company}}')
  await expect(diagnostics(page)).toContainText('All merge fields have values')
})

test('Insert {{key}} from the Data tab puts a second chip on the canvas', async ({ page }) => {
  await openVisualTemplate(page)
  await sheet(page).getByText('We have fully rolled out').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' {{firstName}}')
  await expect(chips(page)).toHaveCount(1)

  await dataTab(page).click()
  await inspector(page).getByRole('button', { name: 'Insert {{firstName}}' }).click()
  await expect(chips(page)).toHaveCount(2)
})

test('the send dialog carries the reply-to, the resolved subject and both parts', async ({ page }) => {
  await openVisualTemplate(page)
  await expect(statusBar(page).getByText(/^HTML export /)).not.toHaveText('HTML export —', {
    timeout: EDITOR_LOAD_TIMEOUT,
  })

  // One field on the canvas and one in the subject, so both halves of what is
  // sent can be checked for the RESOLVED text rather than the template's own.
  await sheet(page).getByText('We have fully rolled out').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type(' {{firstName}}')
  await expect(chips(page)).toHaveCount(1)

  const envelope = page.getByRole('region', { name: 'Envelope & dispatch' })
  await envelope.getByLabel('Subject line').fill('Hello {{firstName}}')
  await envelope.getByLabel('Reply-to address').fill('support@example.test')
  await dataTab(page).click()
  await inspector(page).getByRole('button', { name: 'Fill in missing keys' }).click()
  // By role, because the row's Insert button carries the same name in its
  // `aria-label`; only one of the two is a text box.
  await inspector(page).getByRole('textbox', { name: '{{firstName}}' }).fill('Ada')

  // What actually leaves the browser, rather than what the dialog says it will.
  const sent: Record<string, unknown>[] = []
  await page.route('**/api/send-test', async (route) => {
    sent.push(route.request().postDataJSON() as Record<string, unknown>)
    await route.continue()
  })

  await actionsToolbar(page).getByRole('button', { name: 'Send test' }).click()
  const dialog = page.getByRole('dialog', { name: 'Send test email' })
  await expect(dialog.getByLabel('Reply-to')).toHaveValue('support@example.test')
  await expect(dialog.getByLabel('Subject')).toHaveValue('Hello Ada')
  await expect(dialog.getByText(/Current preview, .* KB HTML \+ .* KB plain text/)).toBeVisible()

  await dialog.getByLabel('To', { exact: true }).fill('qa@example.test')
  await dialog.getByRole('button', { name: /^Send test$/ }).click()
  await expect(dialog.getByText('Dry run complete')).toBeVisible()

  expect(sent).toHaveLength(1)
  expect(sent[0].subject).toBe('Hello Ada')
  expect(sent[0].replyTo).toEqual(['support@example.test'])
  expect(String(sent[0].html)).toContain('Ada')
  expect(String(sent[0].html)).not.toContain('{{firstName}}')
  expect(typeof sent[0].text).toBe('string')
})
