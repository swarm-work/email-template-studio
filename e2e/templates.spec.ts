import { expect, test, type Browser, type Page } from '@playwright/test'

/**
 * Templates that really are saved: the D1-backed API, end to end.
 *
 * Everything here needs the production build and the local D1 database that
 * `playwright.config.ts` migrates and reseeds before the server starts. The
 * unit tests prove the HTTP adapter maps every status correctly; this file
 * proves the round trip — create, edit, save, reload, conflict, delete —
 * against the real routes (plan §5.6).
 */

/** Three code starters plus the visual one (migrations 0002 and 0003). */
const STARTERS = ['Welcome & verification', 'Password reset', 'Team invitation', 'Product launch']

/**
 * A suffix shared by every name this file creates. The database is reset when
 * the server starts, but a name that is unique per run still makes a failure
 * easy to read and keeps two tests from colliding over one slug.
 */
const RUN = Math.random().toString(36).slice(2, 8)

/** Fetching and parsing the ~2 MB render worker, then compiling the template. */
const FIRST_RENDER_TIMEOUT = 30_000

/** Downloading and parsing ~750 KB gzip of visual editor. */
const EDITOR_LOAD_TIMEOUT = 30_000

/**
 * Playwright evaluates locators inside the sandboxed preview frame, which makes
 * Chromium log this message. It is proof the sandbox works, not an app error.
 */
const SANDBOX_NOTICE = /Blocked script execution in 'about:srcdoc'/

/**
 * Chromium logs every 4xx/5xx response as a console error, whatever the page
 * does with it. Two tests here PROVOKE a 409 on purpose — a stale save and a
 * duplicate slug — and both are handled: one opens the conflict dialog, the
 * other fills in a field error. The browser's note about the status code is
 * therefore expected output, not an unhandled failure.
 */
const EXPECTED_CONFLICT_NOTICE = /Failed to load resource: .*409 \(Conflict\)/

function libraryHeading(page: Page) {
  return page.getByRole('heading', { level: 1, name: 'Templates', exact: true })
}
function editorHeading(page: Page, name: string) {
  return page.getByRole('heading', { level: 1, name, exact: true })
}
function templateCard(page: Page, name: string) {
  return page.getByRole('button', { name: `Open ${name}`, exact: true })
}
function statusBar(page: Page) {
  return page.getByRole('region', { name: 'Studio status' })
}
function sourcePanel(page: Page) {
  return page.getByRole('region', { name: 'Code editor' })
}
function canvasSheet(page: Page) {
  return page.locator('.studio-sheet .tiptap')
}
function toast(page: Page, text: string) {
  return page.locator('[data-sonner-toast]').filter({ hasText: text })
}
function saveButton(page: Page) {
  return page.getByRole('button', { name: 'Save template' })
}

/**
 * Saves, once Save is really available.
 *
 * The button is disabled-with-reason while a render is in flight, because what
 * a version stores is the render's own export: saving inside that window would
 * pair the new source with the previous edit's HTML. Waiting for the reason to
 * go away is therefore waiting for the render that matches what was typed.
 */
async function save(page: Page) {
  const button = saveButton(page)
  await expect(button).not.toHaveAttribute('aria-disabled', 'true', { timeout: FIRST_RENDER_TIMEOUT })
  await button.click()
}

/** Goes back to the library the way the sub-header's breadcrumb does. */
async function backToLibrary(page: Page) {
  await page.getByRole('button', { name: 'Templates', exact: true }).click()
  await expect(libraryHeading(page)).toBeVisible()
}

/** Fills in the create dialog and waits for the new template's editor. */
async function createTemplate(page: Page, name: string, kind: 'code' | 'visual') {
  await page.getByRole('button', { name: 'New template' }).click()
  const dialog = page.getByRole('dialog', { name: 'New template' })
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByRole('radio', { name: kind === 'code' ? /^Code/ : /^Visual/ }).click()
  await dialog.getByRole('button', { name: 'Create template' }).click()
  await expect(dialog).toBeHidden()
  await expect(editorHeading(page, name)).toBeVisible()
}

/** Replaces the whole content of a CodeMirror editor. */
async function replaceEditorText(page: Page, label: string, text: string) {
  const editor = page.getByLabel(label)
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.insertText(text)
}

/** A minimal template that compiles, renders and says `marker`. */
function sourceSaying(marker: string): string {
  return [
    "import { Body, Container, Html, Text } from '@react-email/components'",
    '',
    'export default function T() {',
    '  return (',
    '    <Html>',
    '      <Body>',
    '        <Container>',
    `          <Text>${marker}</Text>`,
    '        </Container>',
    '      </Body>',
    '    </Html>',
    '  )',
    '}',
    '',
  ].join('\n')
}

/** Waits for the code pipeline to finish, which is what makes Save available. */
async function waitForRender(page: Page) {
  await expect(sourcePanel(page).getByText('Compiled and rendered without errors.')).toBeVisible({
    timeout: FIRST_RENDER_TIMEOUT,
  })
}

/**
 * A reload that keeps nothing: `sessionStorage` holds the studio's drafts, so
 * clearing it first is what makes "the edit persisted" a statement about the
 * database rather than about the browser.
 */
async function reloadWithoutDrafts(page: Page) {
  await page.evaluate(() => sessionStorage.clear())
  await page.reload()
  await expect(libraryHeading(page)).toBeVisible()
}

type PageWithErrors = Page & { __errors?: string[] }

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    const text = message.text()
    if (message.type() !== 'error') return
    if (SANDBOX_NOTICE.test(text) || EXPECTED_CONFLICT_NOTICE.test(text)) return
    errors.push(text)
  })
  ;(page as PageWithErrors).__errors = errors
  await page.goto('/')
  await expect(libraryHeading(page)).toBeVisible()
})

test.afterEach(async ({ page }) => {
  expect((page as PageWithErrors).__errors).toEqual([])
})

test('the library lists every starter the seed migration wrote', async ({ page }) => {
  for (const name of STARTERS) await expect(templateCard(page, name)).toBeVisible()
  await expect(page.getByText(`${STARTERS.length} templates`)).toBeVisible()
})

test('a code template can be created, edited, saved and reloaded', async ({ page }) => {
  const name = `Receipt ${RUN}`
  const marker = `Saved by the e2e run ${RUN}`
  await createTemplate(page, name, 'code')
  await waitForRender(page)

  // Version 1 is what `create` wrote; nothing has been saved over it yet.
  await expect(statusBar(page).getByText(/Last saved v1/)).toBeVisible()

  await replaceEditorText(page, `Template source for receipt-${RUN}.email.tsx`, sourceSaying(marker))
  await waitForRender(page)
  await expect(page.getByText('Draft · Unsaved changes')).toBeVisible()

  await save(page)
  await expect(statusBar(page).getByText(/Last saved v2/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Draft · Saved')).toBeVisible()
  // The save is finished as far as the screen is concerned: Save says so, so a
  // second click cannot write the same version again.
  await expect(saveButton(page)).toHaveAttribute('aria-disabled', 'true')
  // `.first()`: the reason lives in an always-present sr-only span, and the
  // tooltip renders a second copy of it while it is open.
  await expect(page.getByText('There are no changes to save.').first()).toBeAttached()

  // Straight out of D1: the session's drafts are thrown away first.
  await reloadWithoutDrafts(page)
  await templateCard(page, name).click()
  await expect(sourcePanel(page).getByText(marker)).toBeVisible({ timeout: FIRST_RENDER_TIMEOUT })
  await expect(statusBar(page).getByText(/Last saved v2/)).toBeVisible()
})

test('a visual template can be created, saved and reloaded', async ({ page }) => {
  const name = `Launch ${RUN}`
  const marker = `Canvas ${RUN}`
  await createTemplate(page, name, 'visual')

  const sheet = canvasSheet(page)
  await expect(sheet).toBeVisible({ timeout: EDITOR_LOAD_TIMEOUT })
  await sheet.click()
  await page.keyboard.type(marker)
  await expect(page.getByText('Draft · Unsaved changes')).toBeVisible()
  // The export is composed from the canvas; Save needs it to exist.
  await expect(statusBar(page).getByText(/HTML export \d/)).toBeVisible({ timeout: EDITOR_LOAD_TIMEOUT })

  await save(page)
  await expect(statusBar(page).getByText(/Last saved v2/)).toBeVisible({ timeout: 15_000 })

  await reloadWithoutDrafts(page)
  await templateCard(page, name).click()
  await expect(canvasSheet(page).getByText(marker)).toBeVisible({ timeout: EDITOR_LOAD_TIMEOUT })
})

test('a save against a stale revision offers a copy instead of overwriting', async ({ page, browser }) => {
  const name = `Conflict ${RUN}`
  await createTemplate(page, name, 'code')
  await waitForRender(page)

  await replaceEditorText(page, `Template source for conflict-${RUN}.email.tsx`, sourceSaying(`Mine ${RUN}`))
  await waitForRender(page)

  // Somebody else, in their own browser, changes the same template.
  await patchFromAnotherBrowser(browser, `conflict-${RUN}`)

  await save(page)
  const dialog = page.getByRole('dialog', { name: /This template was (saved|changed) elsewhere/ })
  await expect(dialog).toBeVisible({ timeout: 15_000 })

  await dialog.getByRole('button', { name: 'Save as a copy' }).click()
  await expect(editorHeading(page, `${name} (copy)`)).toBeVisible({ timeout: 15_000 })

  // Two templates now: the one that moved on, and the one holding my edits.
  await backToLibrary(page)
  await expect(templateCard(page, name)).toBeVisible()
  await expect(templateCard(page, `${name} (copy)`)).toBeVisible()
})

test('a template can be deleted from the library card', async ({ page }) => {
  const name = `Doomed ${RUN}`
  await createTemplate(page, name, 'code')
  await backToLibrary(page)
  await expect(templateCard(page, name)).toBeVisible()

  await page.getByRole('button', { name: `More actions for ${name}` }).click()
  await page.getByRole('menuitem', { name: 'Delete template…' }).click()

  const dialog = page.getByRole('dialog', { name: `Delete “${name}”?` })
  await expect(dialog).toBeVisible()
  const confirm = dialog.getByRole('button', { name: 'Delete template' })
  // Typing the slug is what unlocks it; one stray click cannot do this.
  await expect(confirm).toBeDisabled()
  await dialog.getByRole('textbox').fill(`doomed-${RUN}`)
  await confirm.click()

  await expect(toast(page, 'Template deleted.')).toBeVisible()
  await expect(templateCard(page, name)).toBeHidden()
})

test('a duplicate name is refused with a field error, not a lost form', async ({ page }) => {
  await page.getByRole('button', { name: 'New template' }).click()
  const dialog = page.getByRole('dialog', { name: 'New template' })
  await dialog.getByLabel('Name', { exact: true }).fill('Password reset')
  await dialog.getByRole('button', { name: 'Create template' }).click()

  await expect(dialog.getByText('A template with that name already exists. Try another name.')).toBeVisible()
  // The dialog stays open with what was typed, so the fix is one word away.
  await expect(dialog.getByLabel('Name', { exact: true })).toHaveValue('Password reset')
})

/**
 * A genuine second caller: its own browser context, its own cookie jar, its own
 * page. The PATCH goes out of that page with `fetch`, so it carries the same
 * Origin and the same studio header a real second tab would — which is what
 * makes the 409 the first page then gets a real one.
 */
async function patchFromAnotherBrowser(browser: Browser, slug: string): Promise<void> {
  const context = await browser.newContext()
  try {
    const other = await context.newPage()
    await other.goto('/')
    const problem = await other.evaluate(async (wanted: string) => {
      const listed = await fetch('/api/templates', {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
      })
      if (!listed.ok) return `list answered ${listed.status}`
      const body = (await listed.json()) as { templates: { id: string; slug: string; revision: number }[] }
      const found = body.templates.find((template) => template.slug === wanted)
      if (!found) return `no template with the slug ${wanted}`
      const patched = await fetch(`/api/templates/${found.id}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-studio-request': '1' },
        body: JSON.stringify({
          expectedRevision: found.revision,
          description: 'Changed from another browser.',
        }),
      })
      return patched.ok ? null : `patch answered ${patched.status}`
    }, slug)
    expect(problem).toBeNull()
  } finally {
    await context.close()
  }
}
