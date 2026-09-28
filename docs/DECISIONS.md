# Architecture decision records

Each record: context, decision, alternatives, consequences. Versions are those installed on 2026-09-08.

| #   | Topic               | Decision                                                                                                                                                                                                                                                                                             | Rejected                                                                                                                                               |
| --- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Framework           | Vite 8.2 + React 19.2 + TypeScript 6.0 single-page app                                                                                                                                                                                                                                               | Next.js 16 (server not needed yet), Vite + Hono server                                                                                                 |
| 2   | Styling             | Tailwind CSS 4.3 via `@tailwindcss/vite`, tokens as CSS variables                                                                                                                                                                                                                                    | CSS modules, styled-components                                                                                                                         |
| 3   | Components          | shadcn/ui 4.21 (radix base, "nova" preset, Lucide icons)                                                                                                                                                                                                                                             | MUI, Chakra, hand-rolled                                                                                                                               |
| 4   | Motion              | beUI via shadcn registry, one component (`animated-badge`), on CSS keyframes since phase 6 (`motion` removed)                                                                                                                                                                                        | Whole beUI kit; framer-motion legacy; no motion                                                                                                        |
| 5   | Code editor         | CodeMirror 6 via `@uiw/react-codemirror` 4.25                                                                                                                                                                                                                                                        | Monaco (10× larger, worker plumbing)                                                                                                                   |
| 6   | TSX compiler        | sucrase 3.35 in a Web Worker                                                                                                                                                                                                                                                                         | `@babel/standalone` (2.4 MB), esbuild-wasm (14 MB), TypeScript (7.x has no JS transpile API)                                                           |
| 7   | Render location     | Browser, inside the worker, with `@react-email/components` 1.0                                                                                                                                                                                                                                       | Server render (no server; riskier for arbitrary code)                                                                                                  |
| 8   | Isolation           | Worker + hardened globals + timeout + `iframe sandbox=""` + CSP                                                                                                                                                                                                                                      | `eval` on main thread; cross-origin iframe host (later)                                                                                                |
| 9   | Validation          | Zod 4.5 schemas per template, adapted to a domain `PropsValidator`                                                                                                                                                                                                                                   | JSON Schema + ajv; hand-written checks                                                                                                                 |
| 10  | State               | `useReducer` + pure reducer + `sessionStorage`                                                                                                                                                                                                                                                       | Zustand/Redux (over-scoped for one page)                                                                                                               |
| 11  | Testing             | Vitest 5 (node + jsdom) + Testing Library + Playwright 1.63 on the production build                                                                                                                                                                                                                  | Jest; Cypress                                                                                                                                          |
| 12  | Lint / format       | oxlint (shipped by the Vite template) + Prettier 3.9 with Tailwind plugin                                                                                                                                                                                                                            | ESLint flat config (heavier setup)                                                                                                                     |
| 13  | Package manager     | npm 11 (only one installed)                                                                                                                                                                                                                                                                          | pnpm, bun                                                                                                                                              |
| 14  | Fonts               | Geist + Geist Mono (open licence, self-hosted via @fontsource)                                                                                                                                                                                                                                       | Inter (closer to the reference product), system fonts                                                                                                  |
| 15  | Hosting             | One Cloudflare Worker: static assets + Hono API, built with `@cloudflare/vite-plugin`                                                                                                                                                                                                                | Cloudflare Pages (maintenance only), separate Worker + Pages, Node on a VM                                                                             |
| 16  | SES client          | `aws4fetch` 1.0 signing SES v2 REST calls, one sender for Node and the Worker                                                                                                                                                                                                                        | `@aws-sdk/client-sesv2` (needs Node APIs), hand-rolled SigV4, Cloudflare Email Service (beta)                                                          |
| 17  | Test recipients     | `SES_ALLOWED_RECIPIENTS` is a list **or** `*`; up to 10 typed addresses per send                                                                                                                                                                                                                     | Domain allow-list, one request per address, per-send suppression pre-check (deferred)                                                                  |
| 18  | Visual editing      | Resend's `@react-email/editor` 1.7.8 pinned exactly, behind `React.lazy`; export via `composeReactEmail` keeping `unformattedHtml`; theme stored by name per version                                                                                                                                 | Tiptap from scratch, Unlayer / react-email-editor, GrapesJS, hand-rolled `contenteditable`                                                             |
| 19  | Template kinds      | `TemplateRecord` discriminated union on `kind`; `EmailTemplate` = record + `validateProps`, assembled in infrastructure                                                                                                                                                                              | One flat type with nullable `source`/`document`; two unrelated types; `validateProps` on the record                                                    |
| 20  | Template storage    | `TemplateRepository` port; in-memory adapter now, HTTP/D1 adapter later; plain `fetch` + React state, no data-fetching library                                                                                                                                                                       | TanStack Query now (FEATURE_PLAN #16); calling the API straight from components; localStorage store                                                    |
| 21  | Persistence         | Cloudflare D1 (SQLite) reached with plain SQL behind a structural port; schema changes as wrangler migrations                                                                                                                                                                                        | Workers KV, a Durable Object with SQLite, Drizzle/Kysely, a hand-rolled migration runner                                                               |
| 22  | Concurrency         | Immutable version rows + a `revision` counter that bumps on every write; a stale write answers 409 with the server's copy                                                                                                                                                                            | Comparing `updated_at`, HTTP `If-Match`/ETag preconditions, last write wins                                                                            |
| 23  | Starter seeding     | Migration 0002 generated from the real `*.email.tsx` files and `starterCatalog.json`, with a drift test                                                                                                                                                                                              | Hand-written seed SQL, seeding at Worker start-up, keeping starters bundled and un-editable                                                            |
| 24  | Studio modes        | Workspaces and editor tabs stay mounted and are toggled with `hidden` + `inert`; the mode switch is a group of `aria-pressed` buttons                                                                                                                                                                | Radix `Tabs`/`ToggleGroup` (they unmount, and cannot express focusable-disabled-with-reason), remounting each mode                                     |
| 25  | One rendered string | One `RenderResult` per render carries HTML **and** plain text; `StudioPage` memoises one preview document that the preview mode, the thumbnail, the size checks and the send all read                                                                                                                | A second render for the thumbnail, re-rendering on every mode switch, deriving plain text from the HTML in the browser                                 |
| 26  | Merge fields        | An atomic `mergeField` editor node that exports as the literal `{{key}}`; substitution is a pure string pass AFTER export; missing keys stay visible; saved versions are stored UNRESOLVED                                                                                                           | Tiptap Mention/suggestion, Handlebars or Liquid in the browser, substituting inside the editor document, blanking unknown keys                         |
| 27  | Template API client | `HttpTemplateRepository`: `fetch` + `credentials: 'same-origin'` + the studio header, every response parsed with the shared Zod contracts, every failure mapped onto `RepositoryFailure`; `VITE_DATA_MODE` defaults to `http`                                                                        | Throwing on a bad status, trusting the JSON, a generated client, TanStack Query (still deferred)                                                       |
| 28  | Visual → code       | A pure `documentToTsx` over a narrow set of nodes; an unknown node is `ok: false` with its path, never a guess; the generated module is smoke-rendered before anything is written                                                                                                                    | `dangerouslySetInnerHTML` for unknown blocks, a best-effort partial conversion, writing first and rendering later, a two-way sync                      |
| 29  | App theme           | A three-way System / Light / Dark toggle that puts `.dark` on `<html>` and a `color-scheme` meta on the page; the EMAIL is pinned to light in both the canvas sheet and the preview document                                                                                                         | A two-state switch with no "follow the system"; theming the email with the app; a server-stored preference                                             |
| 30  | Sample data         | Up to three presets DERIVED from the template's stored sample payload **and its props schema** (`Default`, `Long values`, `Missing optional fields`); a preset that would be invalid, or identical to another, is not offered; the choice is not persisted and picking one is an ordinary draft edit | The mock's `Randomize Values`; storing a `samplePayloads[]` per template (FEATURE_PLAN phase 1); ignoring the schema and offering presets that fail it |

| 31 | Human sign-in | **Stytch B2B**, session JWT verified in the Worker against Stytch's public JWKS; the shared password stays as the rollback lever for a week | Cloudflare Access (recommended by two earlier reviews), Stytch Consumer, the `stytch` Node SDK in the Worker, a second sign-in allow-list |
| 32 | Workspaces | **One flat `workspaces` table** is the unit of isolation: every template (and later every key, endpoint and message) carries a `workspace_id`, every store method takes the workspace first, and the API and the URL are addressed by its slug (`/api/workspaces/:slug/...`, `/w/:slug/...`) | The organisation / project / environment hierarchy of FEATURE_PLAN decisions 18 to 20; a `workspace` header instead of a URL segment; scoping in the routes instead of the store |
| 33 | Workspace access | **Stytch is the directory, D1 is the mapping.** A named member row wins; a `server` identity (developer mode, the shared password) is an admin everywhere; a member of the workspace's Stytch organisation (matched by slug) is an admin; anyone else gets a 404, not a 403 | Stytch RBAC roles as the only source of truth; one Stytch organisation per workspace; a members table with no organisation rule (a bootstrap step for every workspace) |

Decisions 34 onwards (key storage, the SES event transport, the outbox dispatcher, the signature scheme) are proposed in `docs/PLATFORM_PLAN.md` section 3 and get a numbered record here when the slice that uses them lands. The JSON Schema props contract is part of ADR-19.

## ADR-1 Framework: Vite SPA

**Context.** Empty repository; internal tool; future Cloudflare deployment; beginner-friendly code required.
**Decision.** A Vite single-page app. Everything the MVP needs runs client-side, so a static bundle is the simplest thing that works and deploys anywhere (including Cloudflare Pages). When a server is needed (sending via SES, D1 persistence) `@cloudflare/vite-plugin` 1.54 adds a Worker to the same project without switching frameworks.
**Alternatives.** Next.js 16 gives API routes today, but adds routing, RSC and server concepts that the MVP does not use and a beginner must learn. Running arbitrary TSX on a server is also a worse default than running it in the author's browser.
**Consequences.** No SSR; no server code yet; `npm run build` produces static files.

## ADR-15 Hosting: one Cloudflare Worker with static assets

**Context.** The studio needed a URL before the rest of the platform exists (`docs/PLAN.md` phase 0). The team's future backend is Cloudflare (D1, Queues, Access), and the local send server is already a runtime-neutral Hono app.
**Decision.** A single Worker serves the Vite build as static assets and runs the Hono app for `/api/*`. `@cloudflare/vite-plugin` 1.54 keeps `npm run dev/build/preview` and runs the Worker in workerd locally; `wrangler` 4.130 deploys. The Node adapter (`server/node.ts`) stays for live SES sends until phase 1. The first deployment is on the developer's **personal** Cloudflare account, documented as temporary in `docs/DEPLOYMENT.md`, with sending disabled and no data.
**Alternatives.** Cloudflare Pages: Cloudflare's own guidance points new projects at Workers with static assets, and Pages Functions would split the API from the send server code. Two Workers (assets and API): one more deploy and CORS for nothing. Keeping the Node server on a VM: a machine to patch.
**Consequences.** Four TypeScript projects (`app`, `node`, `server`, `worker`); `worker-configuration.d.ts` is generated, not committed. The Worker cannot run `new Function`, so preview rendering stays in the browser. Sending from the Worker landed with ADR-16. The deployed app is unauthenticated until Access is in place (TECH_DEBT #19).

## ADR-16 SES client: aws4fetch, one sender for both runtimes

**Context.** `server/sesSender.ts` used `@aws-sdk/client-sesv2`, which cannot run in a Worker: it reaches for Node built-ins and for a credential provider chain (`~/.aws`, instance metadata) that an isolate does not have. That left the deployed studio unable to send at all, and the Node server as the only real sending path.

**Decision.** Call the SES v2 REST API directly and sign the requests with `aws4fetch` 1.0 (about 2.5 KB, WebCrypto only). `server/sesSender.ts` becomes runtime neutral and is now the single implementation used by both `server/node.ts` and `worker/index.ts`, chosen by a shared `server/createSender.ts`. Three operations are used: `POST /v2/email/outbound-emails`, `GET /v2/email/account`, `GET /v2/email/identities/{id}`. The `EmailSender` interface, the dry-run sender and every guard in `server/app.ts` are unchanged.

Credentials move into `server/config.ts` as `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and optional `AWS_SESSION_TOKEN`. They are required only when sending is enabled **and** `STUDIO_SEND_DRY_RUN` is false, so a dry-run deployment still needs no AWS access. On Cloudflare they are Worker secrets, never `vars`.

**Alternatives.** Keeping the AWS SDK for Node and adding a second Worker-only client: two code paths to keep in step, and the bug you find in one you fix twice. Hand-rolling SigV4: about 150 lines of hashing that is easy to get subtly wrong and hard for a beginner to review. Cloudflare Email Service: no secrets at all, but it is beta, needs Workers Paid and a domain on Cloudflare, and it would not be the same provider the company already uses.

**Consequences.** `@aws-sdk/client-sesv2` is removed; the Worker bundle is about 240 KB, well under the 3 MB free-plan limit. Anyone running the Node server with an AWS **profile** must now export it (`aws configure export-credentials --format env`), because the profile chain is gone. Long-lived IAM keys are a secret to rotate; the IAM policy in `docs/DEPLOYMENT.md` narrows them to `ses:SendEmail` from one identity. `server/sesSender.test.ts` covers signing, the request body, error mapping and preflight with an injected `fetch`, so the tests need no AWS account.

## ADR-17 Free-form test recipients

**Context.** Until now every test send went to an address in `SES_ALLOWED_RECIPIENTS`, enforced in three places at once: the server handler, a dropdown in the send dialog, and an IAM `ses:Recipients` condition on the Worker's key. That was right while the account was in the SES sandbox. Production access for `swarm.camp` has now been granted, and the point of the deployed proof of concept is for a signed-in person to mail a template to whoever needs to see it — a colleague, a client, their own second mailbox — without a deploy per address.

**Decision.** `SES_ALLOWED_RECIPIENTS` takes one of two forms: a comma-separated allow-list, or the single character `*`, which accepts any valid address the caller types. The value is still required, so forgetting it fails the boot rather than opening sending up. The dialog's dropdown becomes a free-text field that accepts commas, semicolons and line breaks (and `Name <address>` pastes), with an editable subject prefilled from the template. One request sends one email to up to 10 de-duplicated addresses, all in the To header, in a single SES call. A live send needs a second, explicit **Confirm send** click that names the addresses. The server keeps adding the `[TEST]` prefix and keeps refusing its own sender address as a recipient.

**Alternatives.** A domain allow-list (`*@swarm.work`): still a deploy away from the common case of mailing a client, and a false sense of safety, since the risky mistake is a typo inside an allowed domain. One request per address: N message ids, N partial failures to explain, N rate-limit tokens, and no real gain over SES's own multi-recipient To. A suppression pre-check before each send (`GetSuppressedDestination` per address): the right idea, but it adds an AWS call per recipient and a new failure mode; sized and deferred (item 4.10 in the priorities doc, once that branch lands). Per-recipient rate limiting: with the current 5-per-minute limiter a normal ten-address send would be refused outright.

**Consequences.** Deliverability is now a real concern: a typo reaches a stranger, and it is the SES **account suppression list** (bounces and complaints), not this code, that protects the domain's reputation. Turning it on is a prerequisite for using `*`. What this code still contributes is the `[TEST]` prefix, the 10-address cap, client-side validation, the confirm step and a human reading the addresses. The rate limiter stays per request and per isolate — a Cloudflare Worker can run several isolates, so the real ceiling is a multiple of 5 sends a minute until the Rate Limiting binding lands. The IAM policy (`infra/ses-policy.json`) drops its `ses:Recipients` condition and now pins only the identity and from-address, so IAM no longer needs editing when the recipient list changes. Under the shared-password gate the audit line reads `by shared-password`; it names a person only once Cloudflare Access is in front of the studio. Rolling back is one variable plus a deploy (`docs/DEPLOYMENT.md`, "Rolling back the recipient policy").

## ADR-18 Visual editing with `@react-email/editor`

**Context.** The studio needed a second way to author an email: a canvas, for people who do not write TSX. Building one means a rich-text engine, an email-safe node set, a serialiser that turns that document into table-based HTML, a plain-text alternative part, an inspector, a bubble menu and a slash menu. All of it has to export HTML that survives Outlook.

**Decision.** Use Resend's own `@react-email/editor`, pinned **exactly** at `1.7.8`, behind `React.lazy`.

- It is Tiptap (ProseMirror) with an email node set — `body container section paragraph heading button twoColumns table …` — and it serialises through the **same React Email components** this studio already renders code templates with. The two pipelines therefore agree about what an email is.
- Export goes through `composeReactEmail({ editor, preview })` from the `/core` subpath, **not** through the ref's `getEmail()`: `getEmail()` passes no preview text, so the envelope's preheader would be silently dropped.
- What is stored and sent is `unformattedHtml`, not `html`. The latter is run through prettier for a source view and measured 1.2-1.7x larger; bytes matter against Gmail's 102 KB clipping limit.
- The theme is stored **by name** on each version (`TemplateRecord.theme` -> `STUDIO_THEMES`), because `getJSON()` does not carry it. One theme ships, `studio-v1`: `extends: 'basic'` plus the Geist font stack, not user-switchable in v1.
- The package's sections, bubble menu and slash menu are kept and **restyled through CSS variables**, never forked. Our own chrome is the frame around them: the canvas, the rail, the Hierarchy header and the two tabs.

**Alternatives.** Tiptap from scratch: the same editor without the email node set, the serialiser or the inspector — weeks of work to arrive where this package already is, and the serialiser is the hard part. Unlayer / react-email-editor: a hosted, proprietary iframe whose document format we would not own, and nothing to convert to TSX later. GrapesJS: a general web-page builder; its email preset is a separate paid product and its output is not React Email. Writing our own block editor over `contenteditable`: the reason ProseMirror exists.

**Consequences.** The editor is about 2.35 MB raw (~729 KB gzip plus 15 KB of CSS — measured, and written down once in `docs/TECH_DEBT.md` #33; re-measured after phase 9, when rolldown began splitting it four ways rather than two), so it is loaded only when a visual template is opened. **Six** modules under `src/` are allowed to name it (`scripts/check-worker-bundle.mjs`), and the rule is not "one importer" but **every importer is reachable only through the lazy seam**: `VisualEditorSurface.tsx` mounts the editor, `mergeFieldNode.ts` (phase 6) builds the merge field on `EmailNode` and `editorExtensions.ts` (phase 6) restates the package's default extensions — those three import it statically and must only ever be imported from inside `VisualEditorSurface`'s subtree — while `visualEmailRenderer.ts` reaches `/core` and `visualStyleResolver.ts` (phase 8) reaches `/plugins` through a dynamic `import()`, and `studioTheme.ts` takes the `ThemeConfig` type only, which TypeScript erases. The guard enforces the allow-list: nothing under `server/`, `shared/`, `worker/` or the render worker may even name the package, and nothing under `src/` outside those six may import it. What the guard CANNOT see is an eagerly loaded module importing `editorExtensions.ts` and dragging the chunk into the first download; the network assertion in `e2e/visual.spec.ts` is what catches that. An end-to-end test asserts a code template fetches none of it. The app now carries **two copies of `@react-email/render`** — 2.0.6 pinned by `@react-email/components`, 2.1.0 needed by `react-email` inside the editor — which is accepted rather than forced together, because the two live in different chunks (worker and editor) and never meet; measured in `docs/TECH_DEBT.md`. The package's own `default.css` arrives unlayered from that chunk, which is why the token bridge in `src/index.css` sits at the top level with `:root:root` (Tailwind v4 layers lose to unlayered author CSS whatever their specificity). `STUDIO_VISUAL_EDITOR` is the rollback switch: with it off the chunk is never even requested. The package is young and moving (1.7.x), so the version is pinned exactly and upgrades are a deliberate, tested step.

## ADR-19 Two template kinds: `TemplateRecord` vs `EmailTemplate`

**Context.** The studio is growing a second way to author an email: a visual canvas whose content is a JSON document, next to the existing React Email TSX. A code template has `source`; a visual one has `document`, `theme` and the `html`/`text` exported at save time. Both carry the same envelope, sample props and props schema. They also have to travel over an HTTP API and live in a database, which the old `EmailTemplate` (source + a `validateProps` function) cannot do: a function does not serialise.

**Decision.** Split the type in two.

- `TemplateRecord` is a **discriminated union on `kind`**: plain data, and the only shape that is ever stored or sent. TypeScript will not let you read `source` until you have checked `kind === 'code'`, so a whole class of "undefined is not a function" bugs becomes a compile error, and `switch (record.kind)` is checked for completeness.
- `EmailTemplate = TemplateRecord & { validateProps }` is the record plus the one behaviour the studio needs. It is assembled in `src/infrastructure/templates/templateMapper.ts`, because the validator is built with Zod and Zod lives in infrastructure. Starters keep their hand-written `z.strictObject` schema (ADR-9); every other template is validated from the JSON Schema text stored with it, permissively, so a schema we cannot read never blocks a preview.
- `fileName` is **derived**, not stored: `fileNameFor(kind, slug)` gives `welcome-verification.email.tsx` or `product-launch.email.json`. A stored copy is one more field to keep in step with the slug, and it would be wrong the moment a template is renamed or converted.

**Alternatives.** A single flat type with nullable `source` and `document` and a boolean flag: every reader then has to remember which fields are meaningful together, and nothing stops a "visual" template with a source. Two unrelated types (`CodeTemplate`, `VisualTemplate`): everything shared — the envelope, the library card, the preview, the send dialog — would be written twice or behind a hand-rolled union anyway. Keeping `validateProps` on the record: it would make the record unserialisable, so the API would need a second, parallel DTO type.

**Consequences.** Everything that touches content now narrows on `kind` first; the two tiny helpers `templateSource()` and `templateDocument()` in the domain answer "what is the text/document here?" for code that does not care. The registry exports `STARTER_TEMPLATES` as records (seed data and test fixtures) with their validators in a separate map, and `App.tsx` maps them through `toEmailTemplate` once. Metadata lost `subject`/`to`/`from`/`fileType`/`fileName`: the subject moved to `TemplateEnvelope`, the sample recipient is the `PREVIEW_SAMPLE_RECIPIENT` constant, the sender belongs to the send server (`EmailProvider.getStatus()`), and the kind replaced the file type.

## ADR-20 Templates behind a repository port; in-memory adapter now, D1 later

**Context.** Until now the three starter templates were a `const` array imported straight into `App.tsx`. They are about to become rows in a Cloudflare D1 database behind an HTTP API, reached over a network that can be slow, unauthenticated or simply down. The studio needs to be built and tested long before that API exists, and the UI has to learn how to show "loading", "empty" and "that failed, here is why" whichever store is behind it.

**Decision.** Put a port between them.

- `src/application/repositories/templateRepository.ts` declares the interface in the **application** layer: the layer that needs templates says what it needs, in domain words. It has no implementation and imports nothing but domain types.
- `src/infrastructure/templates/inMemoryTemplateRepository.ts` is the first adapter. It implements the **final** interface, not a simplified one — a revision counter, slug uniqueness, immutable versions, `version-conflict`, `slug-taken`, `payload-too-large` — so the UI built against it needs no change when the HTTP adapter arrives.
- `templateRepositoryContract.ts` is a Vitest suite both adapters run. "The two stores behave the same" becomes a test instead of a hope.
- `createTemplateRepository.ts` reads `VITE_DATA_MODE` ('memory' | 'http') at build time and is the one place that knows which adapter exists.
- No method throws. Every call answers `{ ok: true, value } | { ok: false, failure }`, because a refused save is a normal outcome the UI has to explain, not an exception to catch three layers up.
- Data fetching is **plain `fetch` plus React state** (`useTemplateLibrary`), not TanStack Query. This deviates from `docs/FEATURE_PLAN.md` #16 and follows #17.

**Alternatives.** Calling the API from components: the component then owns retries, cancellation, error shapes and a mock server in every test. A generic `Store<T>` abstraction: more machinery than one entity needs, and it stops the interface from speaking in domain words (`convertToCode`, `saveVersion(expectedRevision)`). TanStack Query now: about 13 KB gzip and a second mental model (query keys, cache invalidation, `staleTime`) for what is currently **one list and five writes**, all of which invalidate the whole list anyway; it also has to be learned before it can be reviewed, and the reader of this codebase is learning React. It stays on the table for the day the studio has several screens sharing server data — the port is exactly the seam to put it behind.

**Consequences.** The library screen now has four real states (`loading | error | empty | ready`) instead of assuming the array is there, and they are testable without a server. The in-memory store is lost on reload, so the studio still keeps edits in `sessionStorage` (ADR-10) and a "Save" that survives a refresh has to wait for phase 7b. Writes that go through `useTemplateLibrary` re-fetch the whole list, which is fine for tens of templates and would not be for thousands. The `version-conflict` failure carries the store's current copy, so the conflict dialog can offer "keep mine / discard mine" without a second request. Everything the repository hands out is deep-copied, in both directions, so nobody can reach into the store by keeping a reference — an HTTP adapter would serialise anyway, and the in-memory one must not be quietly more permissive.

## ADR-21 Persistence: Cloudflare D1, plain SQL, wrangler migrations

**Context.** Templates had no home outside the bundle: starters were a `const` array and edits lived in `sessionStorage` until the tab closed. The studio already deploys as one Cloudflare Worker (ADR-15), so whatever stores templates has to be reachable from workerd, from `vite preview` and from CI, and has to be something a Salesforce developer moving to full-stack can read without learning a second framework first.

**Decision.** Cloudflare D1 — SQLite, with the queries written as SQL.

- Two tables, `templates` and `template_versions`, created by `migrations/0001_create_templates.sql`. Schema changes are numbered migration files applied with `wrangler d1 migrations apply`; they are never rolled back, and every migration must stay readable by the Worker version still serving traffic while it runs.
- `server/templateStore.ts` declares a **structural** `SqlDatabase` / `SqlStatement` pair that Cloudflare's `D1Database` satisfies by accident of shape. `server/` therefore still imports nothing platform-specific, and `InMemoryTemplateStore` can stand in for D1 in every test.
- One Zod schema per table parses what comes back, so "the database returned something unexpected" is an error at the boundary rather than a strange bug three layers up.
- **Every write is one `db.batch(...)`**, which D1 runs as a single transaction: a save either lands as `templates` row + version row, or not at all.

**Alternatives.** _Workers KV_ is eventually consistent and has no queries: "list templates newest first" would become a hand-maintained index, and two people saving at once would silently lose one. _A Durable Object with SQLite_ gives strong consistency and transactions, but adds an actor model, migrations of its own and a second mental model, for a single-tenant tool with tens of rows. _An ORM (Drizzle, Kysely)_ would generate this SQL and add types, at the price of a schema DSL, a generation step and a layer between the reader and what actually runs; the eight queries here fit on two screens. _A hand-rolled migration runner_ would duplicate what wrangler already does, including the "which migrations have been applied" bookkeeping table.

**Consequences.** `npm run db:migrate` is now part of setting the project up, and there is a real one-time `wrangler d1 create` step whose id has to be pasted into `wrangler.jsonc` (docs/DEPLOYMENT.md). The database is not a test fixture: `@cloudflare/vitest-pool-workers` still peer-requires Vitest 4 and this repo is on 5, so the D1 adapter's contract run uses Node's built-in SQLite driving the real migration file, and the D1 code path itself is proven by the Playwright suite and by hand (TECH_DEBT). Local D1, `vite preview` and the e2e environment all share `.wrangler/state/v3`, keyed by `database_id`, which is why `preview_database_id` is deliberately never set. Two facts the plan flagged as unverified were checked on local D1 on 2026-09-18 and recorded in DEPLOYMENT.md: `UPDATE ... RETURNING` works, and a 500 KB **bound parameter** is stored and read back intact (the 100 KB limit is on statement text, not on bound values).

## ADR-22 Immutable versions + a revision counter for optimistic concurrency

**Context.** Two people — or one person in two tabs — can open the same template and save. Without a rule, the second save silently overwrites the first, and the only evidence is a confused user. The studio also wants history: "what did v2 look like?" is a normal question about an email that has already been sent.

**Decision.** Versions are append-only, and `templates.revision` is the concurrency token.

- A save **inserts** a new `template_versions` row and bumps `templates.current_version`. Nothing ever updates a version row, so history is a side effect of saving rather than a feature bolted on.
- `revision` bumps on **every** write, including a metadata-only `PATCH` that creates no version. The browser keeps the revision it last read (`baseRevision` in the draft) and sends it as `expectedRevision`.
- The guard is in the SQL: `UPDATE templates SET ... WHERE id = ? AND revision = ?`. When it matches no row, `meta.changes` is 0, nothing was written, and the store re-reads the row so the `409` can carry the server's current copy — enough for the UI to say "someone saved v4 two minutes ago" without a second request.
- The paired `INSERT ... SELECT` for the new version is guarded by `revision = ? + 1` **and** a `NOT EXISTS` clause on the version number, so a stale save that happens to be exactly one revision behind writes nothing instead of aborting the batch on a unique-index violation.

**Alternatives.** _Comparing `updated_at`_ makes correctness depend on clock resolution: two saves in the same millisecond compare equal. _HTTP `If-Match` with an ETag_ is the same idea moved into headers; it is genuinely nicer for caches, but it spreads the rule across middleware, makes the 409 body awkward to populate, and hides the mechanism from a reader following the request through the code. (The read route still sends `ETag: W/"<revision>"`, so nothing stops a later phase adding preconditions on top.) _Last write wins_ is what this exists to prevent.

**Consequences.** Every write path carries an `expectedRevision`; phase 7b built the conflict dialog the 409 feeds (Save as a copy / Discard mine / Keep editing) and phase 9 built the read-only `Version history` dialog over `GET /api/templates/:id/versions`, which is the first screen to read the history this decision creates. It shows and does not restore: restoring is milestone M4, and a button that reopened an old version without writing one would be a claim the data does not support. `revision` and `version_number` are two different numbers on purpose — a rename moves one and not the other — which has to be explained once and then reads naturally. History grows without bound: three saves of a 200 KB template is 600 KB of rows, and no pruning exists yet (TECH_DEBT). A Salesforce developer already knows this pattern: it is `SystemModstamp` and the "record was modified" error, with the comparison written out where it can be read.

## ADR-23 Starters seeded by a generated migration, with a drift test

**Context.** The three starter templates are real React Email components: they are type-checked, unit-tested and rendered by the same pipeline as anything a user writes. Once templates live in a database they have to exist as rows too — and a row that is a stale copy of a file is a trap, because editing the file changes what the tests see and not what the database holds.

**Decision.** Generate the seed migration from the files.

- `src/infrastructure/templates/starterCatalog.json` holds the plain data (name, slug, description, category, tags, envelope, sample payload, JSON Schema, and which `*.email.tsx` file is the source). It is format-neutral so all three consumers can read it: the browser registry, `server/starterSeed.ts` and the generator script.
- `npm run seed:generate` writes `migrations/0002_seed_starter_templates.sql`: plain INSERTs, `origin 'starter'`, `created_by 'seed'`, ids `tpl_<slug>`, history starting at version 1.
- `server/seedMigration.test.ts` regenerates the SQL in memory and asserts it equals the committed file, then applies both migrations to an in-memory SQLite database and checks the three rows land. Editing a starter without regenerating fails CI.
- `server/node.ts` seeds its in-memory store from the same `readStarterSeed()`, so there is one source of starter rows rather than two that drift.

**Alternatives.** _Hand-written seed SQL_ is a second copy of every starter, escaped by hand, and nothing notices when it rots. _Seeding at Worker start-up_ means every cold start does write work, needs an "is it already seeded?" check, and quietly re-creates a starter someone deliberately deleted. _Keeping starters bundled and un-editable_ would mean two kinds of template with two code paths for the rest of the tool's life; making them ordinary rows costs one migration and removes that fork.

**Consequences.** The generated file is committed and must not be edited by hand, which the header says in capital letters. `starterPropsSchemas.ts` is gone: its hand-written JSON Schema text now lives in the catalog as data, and `registry.test.ts` still regenerates it from the Zod schemas and fails on drift, so the reason it existed (never shipping `z.toJSONSchema` to the browser) still holds. The database starts every starter's history at v1 even where the browser fixture still carries an older made-up label like "v3"; that fiction disappears in phase 7b, when the app reads templates from the API instead of the registry. Each INSERT is checked against a 90 KB budget at generation time, well inside D1's 100 KB per-statement limit, so a starter that grows too large fails loudly rather than at `migrations apply` time.

## ADR-24 Studio modes are always-mounted workspaces toggled with `hidden` + `inert`; the mode toggle is an `aria-pressed` group

**Context.** The studio is getting three workspaces (Visual, Code, Preview) and, inside code mode, four editor tabs. Two of those tabs are CodeMirror editors that people type in. A tab component that unmounts what it is not showing would throw away, on every switch, the one thing an editor must keep: its undo history. It would also destroy and rebuild a ~100 KB editor instance for a change that should be instant. On top of that, most of these buttons currently lead somewhere that does not exist yet, and they have to say so without becoming unreachable from the keyboard.

**Decision.** Nothing is unmounted, and nothing is `disabled`.

- Every editor tab panel is rendered; the ones that are not showing get `hidden` and `inert`. `hidden` takes them off the screen, and `inert` takes them out of the tab order and out of the accessibility tree — `hidden` alone would leave CodeMirror's contenteditable focusable. Phase 4 and 5 apply the same rule to the whole workspaces.
- A hidden CodeMirror measures itself as zero pixels wide, which is what leaves the line-number gutter collapsed when it comes back. `CodeEditor` therefore takes a `refreshKey`; changing it runs `view.requestMeasure()`. An end-to-end test asserts the gutter has a width after a tab round trip, and another asserts undo still works after one.
- The mode switch is three plain `<button aria-pressed>` elements inside `<div role="group" aria-label="Editing mode">`, not a Radix `ToggleGroup`. A mode that is not available has to stay focusable and carry its reason; `ToggleGroup` can only offer a bare `disabled`, which removes exactly the people who need the explanation.
- That pattern is one component, `presentation/shared/ReasonedButton.tsx`: `aria-disabled`, an always-present sr-only sentence referenced by `aria-describedby`, a tooltip for the mouse, and a toast of the same sentence on click. The library's "New template" button, Save, the overflow menu items and the primitives row all use it.

**Alternatives.** _Radix `Tabs`_ unmounts inactive panels (`forceMount` keeps them, but then the `hidden`/`inert` bookkeeping is ours anyway, with Radix's data attributes in the way). _Remounting each mode_ is simpler to write and loses undo history, scroll position and iframe state on every switch. _`display: none` without `inert`_ leaves a hidden editor in the tab order, so Tab lands the caret somewhere invisible. _Bare `disabled` plus a tooltip_ is the common shortcut, and it is the one thing the house rules forbid: a disabled button cannot be focused, so its tooltip never opens for a keyboard or screen-reader user.

**Consequences.** Four CodeMirror instances exist at once in code mode; they are cheap once created, and the memory is the price of a tab switch that keeps your undo history. Every disabled-with-reason control answers a click with a toast, which Playwright's actionability check reads as "not enabled" — the tests click those with `force: true` and say why. The sr-only reason sentences are real DOM, so tests that look for the reason text must scope to the toast rather than the page.

## ADR-25 One rendered HTML string feeds the preview, the thumbnail, the size checks and the send

**Context.** Phase 4 put the preview in its own mode (⌘P) and, at the same time, added a scaled-down copy of it to the code rail. That is two pictures of the same email on two screens, plus a status bar and a render report that measure it, plus a send dialog that posts it. The obvious way to build each of those is to render the template again where it is needed — and it is the wrong way: rendering is the single most expensive thing the studio does (a Web Worker, sucrase, React Email), and two renders of the same source can disagree, which would make `Render time` change because somebody glanced at a thumbnail.

**Decision.** One render, one string, many readers.

- `renderTemplate` produces **both** parts in one worker message: `render(element, { pretty: false })` for the HTML and `render(element, { plainText: true })` for the alternative part. They travel back as one `RenderResult { html, text, durationMs }`, and `durationMs` covers both — it is what one render of this template costs the studio, not what one of its halves costs.
- `useRenderPreview` keeps the last **successful** pair. When a newer edit fails to compile, the HTML and the text on screen still belong to the same render.
- `StudioPage` wraps that HTML in the preview document (`buildPreviewDocument`: the CSP meta tag) inside **one `useMemo`** and hands the resulting string to both the preview workspace and `PreviewThumbnail`. Neither component renders anything; both are given a string.
- Switching modes therefore costs nothing. An end-to-end test asserts that the render report's duration and the preview's "Rendered <time>" are unchanged after a mode round trip.

**Alternatives.** _A second render for the thumbnail_ doubles the most expensive operation in the app to draw something 40 % of full size. _Rendering on mode switch_ (the natural consequence of unmounting workspaces) would make ⌘P cost a worker round trip and make the preview flash empty. _Deriving the plain text in the browser from the HTML_ means shipping a second HTML parser to the main thread and inventing our own rules for what a text part looks like, when `@react-email/render` already has them — and the result would not be what a later server-side send produces.

**Consequences.** The worker renders twice per request internally, which is the honest cost of an email that has two parts; measured on the starters it is roughly a third on top of the HTML render, and the worker bundle grew by 24 bytes because `html-to-text` was already inside `@react-email/render`. `RenderResult.text` is now real everywhere: the status bar says "Plain text ready", the render report measures it, the `Plain text` tab shows it and both downloads come from it. The memo is in `StudioPage` rather than in either consumer, which is the part a reader has to notice: a `useMemo` inside `PreviewWorkspace` would be recomputed per component, not per render.

## ADR-26 Merge fields: an atomic editor node, string substitution after export, missing keys stay visible, saved versions are stored unresolved

**Context.** A template is written once and sent to many people, so it has to carry holes: `{{firstName}}` in the body, in the subject, in a link. Three questions had to be answered together. What is a merge field _inside the editor_? Where does the value get put in? And what is stored when the template is saved?

The editor package ships no merge-field extension and its slash menu cannot be extended without forking it (docs/DESIGN.md, "Editor hooks inventory"), so whatever a merge field is, the studio has to build it and give it its own way in.

**Decision.**

- **In the editor: one atomic node.** `src/infrastructure/render/mergeFieldNode.ts` builds `mergeField` on the package's `EmailNode`: `inline`, `atom`, one `key` attribute, `parseHTML`/`renderHTML` on `span[data-merge-field]`. An atom has no insides, so nobody can bold half of a field, delete one brace, or split it with a line break — the three ways plain text merge fields rot. It arrives by typing `{{firstName}}` (an input rule), by pasting text that contains one (a paste rule), or from the Data tab's **Insert {{key}}** button (`insertMergeField`).
- **tiptap is declared, not borrowed.** `mergeFieldNode.ts` and `editorExtensions.ts` import values from `@tiptap/core` and `@tiptap/extension-placeholder`, which until phase 6 were only ever type imports hoisted out of `@react-email/editor`. Both are now in `package.json` pinned EXACTLY to the version the editor resolves (3.31.3): a second copy of tiptap would be a second `Extension` class, and the merge-field node would register against a schema the editor never instantiates, with no type error to warn anybody. They are bumped in the same step as the editor package. The allow-list in `scripts/check-worker-bundle.mjs` grew to five files for the same reason it existed at three — what it cannot see is an eagerly loaded module importing `editorExtensions.ts`, which is what the network assertion in `e2e/visual.spec.ts` catches.
- **`extensions` REPLACES the package's defaults**, it does not add to them (`dist/index.mjs`: `const base = extensionsProp ?? [...]`). So `src/infrastructure/render/editorExtensions.ts` restates StarterKit, the placeholder and `EmailTheming` and appends `MergeField`. Forgetting that would have silently removed the whole editor's node set.
- **It exports as literal text.** `renderToReactEmail` returns the string `{{key}}`, so the exported HTML _and_ the plain-text part both still contain the token. That is what makes the next step possible at all.
- **Substitution is a pure string pass, after export.** `src/application/mergeFields.ts` has no React, no DOM, no Zod and no editor: `applyMergeFields(text, payload, { escape })` over the exported HTML (`escape: 'html'`), the plain text, the subject and the preheader (`escape: 'none'`). It runs in `StudioPage`'s one `buildPreviewDocument` memo, and the preview, the thumbnail, the downloads, the status bar's sizes, the envelope summary and the test send all read the resolved strings (ADR-25 unchanged: still one render, still one string).
- **A missing key stays visible** as `{{key}}` and becomes a `merge-fields` warning row. An email that quietly says "Hi ," looks correct and is not; one that says "Hi {{firstName}}," tells you what went wrong. There is ONE rule for what "missing" means — `missingMergeFields`: no key, or a value nothing can print (`null`, an object, an array). An empty string is a value, so the Data tab, the warning row and the substitution all agree. Only text that is not a JSON object at all resolves against `{}`, and then everything shows as missing rather than blank.
- **Substitution reads the payload JSON, not the validated props.** Filling the Data tab in is one key at a time, so the schema is unsatisfied most of the time; resolving against `validation.value` would mean one unfilled key leaving every other key unresolved, and the warning row naming keys whose value was sitting right there. `StudioPage` therefore resolves against `parsePayloadObject(draft.payloadText)` and keeps the validated props for the CODE render path, which genuinely needs typed props. For the same reason the Data tab refuses to WRITE while the JSON does not parse — re-printing text it could not read would throw the rest of it away — and says so instead.
- **The saved version stays unresolved.** The `html` and `plain_text` columns keep their `{{key}}` tokens, and `props_schema` gets the JSON Schema `mergeFieldsJsonSchema(keys)` builds. That is the boundary: _what you look at is resolved, what is stored is not_, so a later server-side send can substitute per recipient from real data instead of re-rendering a template that was flattened against one person's sample values.
- **The contract of a visual template is its own document.** There is no TSX to read props from, so `StudioPage` computes `listDocumentMergeFields(draft.document) ∪ listMergeFields(subject) ∪ listMergeFields(preheader)` and builds `mergeFieldPropsValidator(keys)` — a non-strict `z.object` requiring a string, number or boolean per key — through the same `PropsValidator` seam as every other validator (ADR-9). The plan said "required string"; the leaf was widened because `applyMergeFields` prints a number or a boolean quite happily, and a validator that called `{"orderCount": 3}` invalid would just be two halves of one feature disagreeing about what a value is. Code templates keep theirs.
- **One safety check.** A payload value substituted into an `href` could turn data into code, so `findUnsafeHrefs` runs on the RESOLVED html and any `javascript:` or `data:` link is a diagnostics **error**.

**Alternatives.** _Tiptap's Mention extension_ (or a suggestion plugin) brings a whole popup UI and a data shape built for @-mentioning people, and still would not export as a token. _Handlebars or Liquid in the browser_ is a templating engine (30–80 KB) plus a new language in the product, for a feature whose entire grammar is `{{key}}`. _Substituting inside the editor document_ before export would mean the canvas showed resolved text — you could no longer see where the holes are, and the saved document would be somebody's sample data. _Blanking unknown keys_ produces the confident, wrong email described above. _Escaping `'` as well_ was rejected: the studio's exported HTML quotes attributes with `"`, and `&#39;` would show up in a reader's inbox.

**Consequences.** Substitution is HTML-context-blind: it escapes `& < > "`, which is safe in element text and inside a double-quoted attribute, and it is NOT safe inside a `<script>` or a `style="..."` url() — neither of which the exported email contains, and the unsafe-href check covers the one case that matters (TECH_DEBT #41). A merge field typed inside a heading is uppercased by `html-to-text` in the plain-text part, so that half shows `{{FIRSTNAME}}` and reports as missing (TECH_DEBT #40). The Data tab finally gives a visual template a typeable payload editor, bound to the same `draft.payloadText` as code mode. And `{{` in ordinary prose is now meaningful: `{{ 1nope }}` is left alone because the key pattern requires an identifier, but `{{total}}` in a sentence about arithmetic would become a field.

## ADR-27 The template API is reached through the same port, over `fetch`, and nothing throws

**Context.** Phase 7a built the eight template routes over D1; phase 7b had to make the browser use them. The port (ADR-20) and its in-memory adapter already existed, so the question was not "how does the studio get templates" but "what does the HTTP adapter owe the rest of the app" — and what it must never do, which is throw a network error into a React render.

**Decision.** One module, `src/infrastructure/templates/httpTemplateRepository.ts`, modelled line for line on `providers/emailProvider.ts`.

- **`fetch` with `credentials: 'same-origin'`.** The API sits behind the same gate as the page, so the session cookie has to travel; `omit` would turn every call into a 401.
- **`x-studio-request: 1` on every mutation**, and `content-type: application/json` when there is a body. A cross-site page cannot set a custom header without a CORS preflight the API never answers, which is the CSRF guard (`shared/templateContracts.ts`).
- **Every response is parsed with the shared Zod schema** before anything reads a field. The network is an untrusted boundary: a proxy's HTML error page, a half-deployed API or an old cached build all produce JSON the studio must refuse rather than destructure.
- **No method throws.** A failed `fetch` becomes `unreachable`; the status becomes the failure code (401 `unauthenticated`, 403 including `forbidden-origin` `forbidden`, 404 `not-found`, 409 `slug-taken` or `version-conflict` with the server's copy parsed out of the body, 413 `payload-too-large`, 422 `not-visual`, 503 `storage-unavailable`, 400/415 `invalid`, anything else `unexpected`). The DTO-to-domain mapping lives in `templateMapper.ts`, so the wire's vocabulary (`versionNumber`, `propsSample`, a bare document object) stops at one file.
- **`VITE_DATA_MODE` now defaults to `http`.** Only the literal `memory` picks the in-memory adapter. An unset or mistyped variable must not quietly drop the studio into a store whose saves vanish on reload. `npm run db:migrate` is therefore a prerequisite for `npm run dev` (docs/DEPLOYMENT.md).
- **One 422 means two things, so the call site decides.** `POST /:id/versions` answers 422 when the version is of the other kind, and `POST /:id/convert` answers 422 when the template is not visual. The port has a word for the second (`not-visual`) and a word for the first (`invalid`), so `saveVersion` asks for its 422 to be read as `invalid`. Without that the two adapters genuinely disagreed — which is how the contract suite found it.
- **`list()` is a list request plus one detail request per template, in parallel.** `GET /api/templates` deliberately carries no content blobs, and the port promises whole records because the studio opens a template straight out of the library. Loading N+1 requests is honest and fine for tens of templates; it is the same "no pagination" debt as docs/TECH_DEBT.md #25, measured as its own row in #42.

**Alternatives.** _Throwing on a bad status_ and catching in components: every caller then needs a `try`/`catch` and a way to tell "409, here is the server's copy" from "TypeError: Failed to fetch". _Trusting the JSON_ (`as TemplateDetailDto`): the compiler is happy and the app crashes on the first field that is not there. _A generated client_ (openapi-typescript, tRPC): a build step and a second schema language for eight routes that already have Zod contracts shared by both sides. _TanStack Query_: still deferred for the reasons in ADR-20; nothing in this phase changed them. _Returning summaries as records_ from `list()` and fetching the detail when a template is opened: that is the right answer at a hundred templates, and it needs a per-template loading state the library does not have yet.

**Consequences.** `describeTemplateRepository()` now runs against the **real** API — an injected `fetch` that calls straight into the Hono app with the server's in-memory store — so "both adapters behave the same" is checked against the routes rather than against a recording. That one file is the only place `src/` imports `server/`, and it pays for the crossing: `tsconfig.app.json` excludes `*.contract.test.ts`, because type-checking Worker code inside the browser program compares it against the DOM's lib and reports errors that are not errors where the code runs. Vitest does not type-check, so the test still runs; the adapter itself is fully type-checked. A save now writes the UNRESOLVED export (ADR-26) and, for a visual template, `mergeFieldsJsonSchema(discoveredKeys)` as the props schema. A refused save keeps the draft exactly as it was: `template-saved` REBASES the draft onto the version that was written rather than dropping it, so the editor does not flash the old content — or lose the cursor — in the moment between the server's answer and the library's refetch.

## ADR-28 One-way visual to code conversion: fail loudly on unknown nodes rather than degrade

**Context.** A visual template is a Tiptap document; a code template is React Email TSX. Phase 8 had to turn the first into the second, one way, knowing that the editor's document can hold blocks React Email has no component for (lists, two/three/four-column rows, tables, blockquotes, code blocks) and that whatever is written is what the template IS from then on — there is no way back to a canvas.

**Decision.**

- **The converter is pure and the node set is narrow.** `src/application/visual/documentToTsx.ts` walks the plain `EmailDocument` the domain describes: doc, body, container, section, div, paragraph, heading 1–6, text, hardBreak, horizontalRule, button, image and mergeField, plus the marks bold, italic, underline, strike, code, sup, uppercase, link and preservedStyle. `hardBreak` and `preservedStyle` are in the first set because both are reachable from the default UI and from any paste. No React, no DOM, no Zod, no Tiptap, so the whole thing is table-testable in the Node environment.
- **An unknown node is a REFUSAL.** `documentToTsx` returns `{ ok: false, reasons: [{ node, message, path }] }` and the dialog lists the blocks with their paths (`doc > container[0] > twoColumns[3]`) under _"These blocks have no React Email equivalent yet"_. There is no `dangerouslySetInnerHTML` fallback: pasting the editor's HTML for a block it could not convert would produce a template that LOOKS converted, renders differently in half the mail clients, and can no longer be fixed on a canvas. A person who is told "I cannot convert your two-column row" can delete it, or wait; a person handed a wrong template finds out from a recipient.
- **The smoke render gates the write.** Convert in the browser → render the generated source through the studio's own worker (`compileTemplate` → `evaluateTemplate` → `renderTemplate`) → only on success `POST /api/templates/:id/convert`. A generated module that does not compile or does not render must never become the stored template: the failure is shown in the dialog and the visual template is untouched. The render is not wasted work — its output IS the `html`/`text` the new version stores.
- **The smoke payload is the merge fields themselves.** Every prop is set to the `{{key}}` it came from, so the stored export keeps its tokens (ADR-26) and the render proves the module works in one pass.
- **The theme comes from the editor, lazily.** `src/infrastructure/render/visualStyleResolver.ts` is the only reason the converter needs `@react-email/editor`: it `import()`s `/plugins` and closes over `getMergedCssJs` / `getResolvedNodeStyles`, so the styles a block was drawn with become inline styles in the generated module. It is on the allow-list in `scripts/check-worker-bundle.mjs`, and the editor-split check still passes.
- **The printer is ours, not prettier's.** ~180 lines (`tsxPrinter.ts`) laying out JSX at 2-space indent and 110 columns. Prettier is 250 KB of parsers the studio only loads for the Format button, and a converter that needs a formatter cannot be unit-tested in one step. `documentToTsx.test.ts` runs the real prettier over every golden and asserts it changes nothing, so "the output is house style" is proved rather than claimed.
- **Three tests, three different promises.** Golden fixtures say what the output looks like; the **guarantee** test compiles, evaluates and renders every golden through the real pipeline; the **fidelity** test compares the converted render with `composeReactEmail`'s output on the same document by TEXT and by the set of link hrefs. Never by bytes: the two pipelines build their table scaffolding differently and always will.
- **The draft is dropped, not rebased.** `template-converted` is the one reducer action that deletes the draft: it holds a visual document describing a template that no longer exists.

**Alternatives.** _`dangerouslySetInnerHTML` for unknown blocks_ — the fallback that turns a refusal into a silent wrong answer; it also defeats the allow-list the render worker relies on. _A best-effort partial conversion_ (drop what you cannot convert) — the same problem, minus the evidence. _Write first, render later_ — the template would be broken for as long as it took somebody to notice, and the version is already in the history. _Two-way sync_ (TSX back to a canvas) — that is a TSX parser and a layout inference engine, and the package cannot accept code anyway (plan §1.2).

**Consequences.** Templates using lists, columns, tables, blockquotes or code blocks cannot be converted yet; the dialog names them and `docs/TECH_DEBT.md` carries the row. Conversion is not byte-faithful — spacing differs where the editor's serializer and React Email disagree, and that is what the fidelity test's contract (text + hrefs) admits. A dotted merge field becomes a flat prop (`{{user.first_name}}` → `userFirstName`), so `convertedSamplePayload` ADDS the prop-named entries to the sample payload and keeps the old keys, because the subject and the preheader still substitute by the original names. The generated module carries a header comment saying where it came from and that it cannot go back, since a converted file has no author to ask.

## ADR-29 The app has a dark theme; the email never does

**Context.** `src/index.css` has carried a complete `.dark` palette since the MVP, with nothing able to reach it (TECH_DEBT #10). Adding the toggle is easy. The hard part is that this app's main content is _a picture of somebody else's email_, and a dark theme applied to that would be wrong in a way that is hard to notice: an email that sets no colours is black text on a white page, and a page drawn in dark mode is light text on a dark page. Turn on dark mode carelessly and the studio shows a white-on-white email while the recipient's inbox will show a perfectly readable one.

**Decision.** The app theme is three-way and the email is exempt.

- `ThemeToggle` in the global header is a Radix `ToggleGroup` (so `radiogroup` semantics, three `role="radio"` buttons): **System**, **Light**, **Dark**. Three, not two, because "follow the operating system" is a real answer and a two-state switch cannot express it — with a switch, the only honest default is a lie about which way it is pointing.
- `useTheme` is the one module that touches the outside world: it reads and writes `localStorage` **inside a try/catch** (a private window throws on the property access itself, not on the value), listens to `prefers-color-scheme` so `System` follows the machine live, toggles `.dark` on `<html>` in a **layout** effect so switching never shows a frame of the old palette, and keeps `<meta name="color-scheme">` in step so the browser's own scrollbars and form controls match.
- **The first paint is won before the bundle exists.** A layout effect only beats the paint after React's first render; the stylesheet paints the light `:root` palette as soon as it lands, hundreds of milliseconds before a 430 KB gzip bundle has parsed. So `index.html` carries a small blocking inline script that reads the same storage key, resolves `system` with `matchMedia` and sets `.dark` plus the `color-scheme` meta before the stylesheet is applied. It is a hand copy of `resolveTheme` because nothing from `src/` can run that early, and `src/presentation/layout/themeBootstrap.test.ts` runs the copy against the original for all six preference/OS combinations so the two cannot drift. It also means the `PasswordGate` screen — which renders above `GlobalHeader`, and therefore above the only `useTheme` caller — is themed too.
- The rules are pure and separately tested in `src/presentation/layout/theme.ts`: what a stored value means (anything unrecognised is `system`) and what a preference plus the machine's setting resolve to.
- **The email stays light, in all three places it is drawn.** The canvas sheet already pinned `color-scheme: light` and its own light `--re-*` values (phase 5). Phase 9 added the same pin to the preview document, because a frame inherits the colour scheme of the page that embeds it — without it the preview iframe and the rail thumbnail would both go dark with the app. The CodeMirror editors stay on the one-dark theme in both app themes: they are a code surface, not chrome (ADR-5).

**Alternatives.** _A two-state toggle with a `System` default_ — half the states are unrepresentable and `aria-pressed` has to lie about one of them. _Theming the email too_ — some clients do honour `prefers-color-scheme`, but only for templates written for it; applying it to every template would misrepresent every template that was not. _Storing the preference server-side_ — a theme is a fact about this browser, not about the account, and it would mean a write on every toggle. _`sessionStorage`_ — the same window twice would forget.

**Consequences.** Everything the app draws follows the theme; nothing the email draws does, and `e2e/theme.spec.ts` asserts exactly that (the canvas sheet, the preview iframe and the thumbnail all stay near-white while `<html>` carries `.dark`, and the code editor stays dark) — including the default `System` case under a dark operating system, which is the branch every user starts on. A template written WITH dark-mode media queries cannot be previewed in its dark form — that is a preview target, like Desktop and Mobile, and it is TECH_DEBT #44. The preference is per browser: a second machine starts on `System` again.

## ADR-30 Sample-data presets are derived, not stored

**Context.** The mock the studio was drawn from had a `Randomize Values` button next to the props JSON. `docs/DESIGN.md` §4.7 refused it: random data answers no question an author has. `docs/FEATURE_PLAN.md` phase 1 proposed the opposite extreme — a `samplePayloads: { label, text }[]` array on every template, written by hand per template.

**Decision.** Up to three presets, computed from the payload and the schema the template already stores.

- `src/application/propsPresets.ts` is pure and takes two strings: the template's saved `samplePayloadText` and its `propsSchemaText`. It returns `Default` (that text verbatim), `Long values` (every free-text string stretched to at least 72 characters, which is past the width of the 600 px canvas, so what wraps badly wraps here) and `Missing optional fields` (every key kept, every **optional** value emptied per type: `''`, `0`, `false`, `[]`).
- **The schema is what keeps a derived preset valid**, which is the whole point of offering it: a preset that red-lines the props card and stops the preview teaches the author nothing. So a key the schema lists in `required` keeps its sample value, and a key pinned by `enum`, `const`, `pattern` or `maxLength` is never stretched — the `Team invitation` starter's `role` is `admin | member | viewer`, and `"member member member…"` is none of them. The schema is walked alongside the payload, so the constraint that applies is the one on the key being changed, however deep it sits. A template with no schema (`'{}'`) has no required keys and no pinned values, which is the old behaviour exactly.
- Two values are stretched carefully rather than repeated: a URL grows in its path and an address grows before the `@`, because a repeated URL is not a URL and the author would be looking at a broken link instead of a long one.
- The picker is a `Select` labelled `Sample data` in `PropsPayloadCard`. Choosing one **replaces the payload text** and is an ordinary draft edit from then on — undo, Reset and the dirty badge all behave exactly as they do for typing.
- The choice is **not persisted**, and not even held in state: the label is derived by comparing the current payload with each preset's text, so the moment the JSON is edited the picker says `Custom` by itself. Nothing can claim data that is no longer on screen.
- A template whose sample payload is not a JSON object gets only `Default`, and the picker is not drawn at all. **A derived preset that came out identical to one already listed is dropped** for the same reason: the shipped `Product launch` starter has `{}` for sample data, so there is nothing to stretch and nothing to empty, and three identically-behaving options would be the dishonest control this feature replaced. A starter whose schema requires every key (`Welcome & verification`) offers `Default` and `Long values`, and no `Missing optional fields` — because it has none.

**Alternatives.** _`Randomize Values`_ — it teaches nothing and its output is different every time, so nothing it shows can be reproduced or reported. _Stored `samplePayloads` per template_ (FEATURE_PLAN #1) — a schema change, a migration, an editing UI, and three more strings per template to keep in step with the props; deriving costs none of that and cannot go stale. _Remembering the last preset per template_ — one more thing in the session payload, and the answer after any edit would be wrong.

**Consequences.** Every template gets its sets for free, including one created a minute ago, and how many it gets depends on what its own schema leaves free to vary. The two derived sets are heuristics, not fixtures: `Long values` makes a long version of whatever is there rather than a realistic one, and `Missing optional fields` sets an optional number to `0`, which is empty-ish rather than absent — chosen so the preset shows a thin email rather than a type error. `src/infrastructure/templates/registry.test.ts` runs every preset of every shipped starter through that starter's own `jsonSchemaPropsValidator`, so "a preset is always a valid payload" is checked against the real schemas rather than claimed here. Adding a fourth preset is one entry in one pure function with a table test.

## ADR-31 Human sign-in: Stytch B2B, verified in the Worker, with the password gate as the rollback

**Context.** Everyone who opens the deployed studio types the same shared password. The cost is not
weak security so much as **no attribution**: `server/app.ts:441` writes `by shared-password` into the
send audit line, and since ADR-21 the same literal goes into the `created_by` and `updated_by`
columns of every template and every immutable version (`migrations/0001_create_templates.sql`).
Authorship is already fiction. There is also no way to remove one person without changing a password
everybody shares.

Two earlier reviews in this repository — `AUTH_REVIEW.md` and
`docs/reviews/2026-09-16-stytch-review.md`, neither merged — recommended Cloudflare Access instead.
Access is genuinely cheaper: it needs no code at all, it blocks the request before the Worker runs,
and it adds no third-party failure domain because Cloudflare already serves the Worker. This ADR
overrides them, and records why, so the argument is not re-opened in three weeks.

**Decision.** Stytch **B2B**, with the session JWT verified inside the Worker.

- **B2B, not Consumer**, and this cannot be changed later — Stytch's own migration guide says
  switching means a new project from scratch. A Consumer session JWT carries no email claim, so the
  audit line and the `NOT NULL` audit columns would have nothing to name a person with. B2B also
  gives native domain restriction (`email_allowed_domains` plus `RESTRICTED` JIT provisioning);
  Consumer cannot do that at all, and without it anyone who can receive a magic link could sign in
  to a studio wired to live SES sending.
- **Verified in the Worker against the public JWKS**, mirroring `createAccessAuthenticator`. No
  Stytch secret in the Worker, no `stytch` Node SDK, no `@hono/stytch-auth`. Stytch's own Workers
  template does exactly this.
- **Why not Access:** Access cannot protect a `workers.dev` hostname, because `workers.dev` is on the
  Public Suffix List. Adopting Access therefore blocks on DNS work that has not happened
  (`docs/PRIORITIES.md` item 4.12), while Stytch can be pointed at an exact `workers.dev` URL today.
  That is the whole of the reason, and it is a scheduling reason rather than a technical preference:
  if the DNS work lands first, Access is the better answer.
- **The shared password stays** until Stytch has run in production for a week. `loadAuthConfig`
  orders the modes Access, then Stytch, then password, so the rollback is removing one variable and
  redeploying — and it is rehearsed before it is needed.

**Alternatives.** _Cloudflare Access_ — better on every axis except the one that decides it; revisit
once a real hostname exists. _Stytch Consumer_ — cheaper concepts, but no email claim and no domain
restriction, which defeats the purpose. _The `stytch` Node SDK in the Worker_ — needs the project
secret at the edge to verify what a public key already proves. _A second `STUDIO_ALLOWED_EMAILS`
allow-list in the Worker_ — its only unique value is closing the five-minute revocation window
below, and the price is a second source of truth for "who may use this"; this repository already
shows what that costs, with the production hostname written down three different ways
(`docs/PRIORITIES.md:26`).

**Consequences.** Three are worth stating plainly because they are worse than what they replace.

1. **Revocation lags by up to five minutes.** The Worker verifies signatures locally against cached
   keys and never calls Stytch, so a member removed from the organisation keeps a working token
   until it expires. This is **accepted**, not overlooked. If it ever stops being acceptable, the
   allow-list is about forty lines.
2. **Stytch's cookie is not `HttpOnly` and is `SameSite=Lax`.** The password cookie is `HttpOnly`
   and `SameSite=Strict` (`server/app.ts:586-600`), and `docs/DEPLOYMENT.md` sells it on exactly
   that. This is a real reduction in defence in depth; recovering `HttpOnly` needs a Stytch custom
   domain, which is the same DNS work Access is waiting on. What still protects the send route is
   the `x-studio-send: 1` header and the JSON content type, neither of which a cross-site form can
   set. Keep both.
3. **A new failure domain.** If Stytch is down, existing sessions die within five minutes and nobody
   can sign in. Access would have added no such domain.

Two more that are merely different. The token lives about five minutes rather than twelve hours, so
the Worker will legitimately see expired tokens from sleeping tabs and must refuse them and let the
browser refresh — widening `CLOCK_SKEW_SECONDS` to hide that would be a mistake, since 60 seconds is
a fifth of this token's life. And the issuer literal is accepted in both its scheme-less and `https`
spellings, both derived from the project id, because a wrong literal there is a total lockout whose
error message reads like a broken signature.

## ADR-32 Workspaces: one flat table, and the store scopes every read and write by it

**Context.** Until 2026-09-25 the studio was single-tenant: one library, one `templates.slug`
unique across everything, a header showing the literal `meridian-platform`. The next slices
(`docs/PLATFORM_PLAN.md`) add API keys, webhook endpoints and a message log, and every one of them
needs an owner, a sending domain and a place for reputation to live. swarm.camp (transactional) and
swarm.work (marketing) must never share any of those (`docs/SENDING.md`). FEATURE_PLAN had sketched
an organisation / project / environment hierarchy for this.

**Decision.** A **workspace** is one row in `workspaces` (migration 0004) and the unit of isolation.
It owns a slug (the URL: `/w/<slug>/...` in the browser, `/api/workspaces/<slug>/...` in the API),
a name, a default sender, a sending domain, an optional SES configuration set and the rule for who
may enter (ADR-33). `templates` gained `workspace_id`; the slug index became `(workspace_id, slug)`.

- **The store enforces it, not the routes.** Every `TemplateStore` method takes the workspace
  first, and every SQL statement that names a template also says `AND workspace_id = ?`. From
  another workspace a template is not "forbidden", it does not exist: reads answer `null`, writes
  answer `not-found`. The contract suite has cases for this, so both adapters prove it.
- **One level.** No organisations, no projects, no environment rows. dev / staging / production stay
  separate Workers with separate databases, as `wrangler.jsonc` already has them. "Test mode" for
  integrators will be a property of an API key (slice 3), not a row.
- **The URL is the state.** React Router (`react-router` 8, library mode) reads `:slug` and
  `:templateId`; the header's links and the workspace switcher only build URLs. The one screen that
  used to hold a `view` state (`TemplatesRoute`) now reads `useParams()`.
- **Migration 0004 gives every existing row a home** through `DEFAULT 'ws_swarm-camp'`. The column
  carries no `REFERENCES`, because SQLite only allows a foreign key on `ADD COLUMN` when the default
  is NULL, and rebuilding `templates` would cascade-delete every version. The store is the guard.

**Alternatives.** _The FEATURE_PLAN hierarchy_ — three tables and a switcher for a team that has one
organisation; the "change this if" in `docs/PLATFORM_PLAN.md` names when to add a level above.
_A `workspace` request header_ — invisible in links and logs, and easy to forget. _Scoping in the
routes_ — one forgotten predicate is a cross-tenant read; a store method that cannot be called
without a workspace cannot forget.

**Consequences.** Every template URL and API path changed at once (one pull request, nothing else
in it). The browser builds its template repository per workspace and rebuilds it on a switch; the
screens under `/w/:slug` are keyed by the slug, so an editor never survives into another workspace.
`templates.workspace_id` has no foreign key (TECH_DEBT #45) and workspaces carry no `revision`
counter yet (#46).

## ADR-33 Workspace access: Stytch is the directory, D1 is the mapping

**Context.** Who may enter a workspace, and as what? Stytch B2B (ADR-31) already knows the team:
sign-in lands in the organisation `swarm`, restricted to swarm.work addresses, and the session token
names that organisation (`https://stytch.com/organization`, verified on a real token). Two more modes
exist with no directory at all: the developer identity (`npm run dev`, Playwright) and the shared
password. And a workspace made for one client may one day need a person from outside the team.

**Decision.** `Identity` now carries `origin` (`directory` for Stytch and Access, `server` for the
developer identity and the password), the Stytch `organization` when there is one, and the token's
roles. `server/workspaceAccess.ts` decides, in this order, with no I/O:

1. A **named member row** (`workspace_members`, roles `admin` and `editor`) wins. It is how someone
   outside the organisation gets in, and how someone inside it is held to `editor`.
2. A **`server` identity is an admin everywhere.** Those modes already mean "whoever reached this
   server is trusted", so this is exactly the access they had before workspaces existed - and it is
   why `npm run dev` and the e2e suite need no bootstrap step.
3. A member of the workspace's **Stytch organisation**, matched by slug, is an admin. The slug, not
   the id: the id differs between Stytch's Test and Live environments, the slug is what the team
   chose. The default workspace ships with `swarm`, so nobody has to be added by hand.
4. Otherwise **404, not 403**, byte for byte the same body as a slug that does not exist.

Admins may change settings and members; editors may read and write templates. A members-only
workspace (no organisation) refuses to remove or demote its last admin (`409 last-admin`). Creating a
workspace inherits the creator's organisation and names the creator an explicit admin.

**Alternatives.** _Stytch RBAC as the only source of truth_ — needs a dashboard change per workspace
and cannot name someone outside the organisation. _One Stytch organisation per workspace_ — the
discovery flow already built becomes the switcher, but every switch is a new session and every staff
member must be a member of every client organisation; the "change this if" in the plan names this
as the move if clients ever sign in themselves. _A members table only_ — a bootstrap step for every
workspace, and a lockout the moment a table is empty.

**Consequences.** The Stytch roles are read and kept but not yet acted on; mapping `stytch_admin`
onto `admin` is a one-line change in `roleFor` when the team wants editors by default. The password
mode's "everyone is an admin" is the same fact it has always been, now written down.

## ADR-4 Motion: beUI selectively

**Context.** The brief asks for beUI where motion communicates state, and for reduced-motion support.
**Finding.** beUI is not an npm package; it is a shadcn-compatible registry (`npx shadcn@latest add @beui/<name>`) of MIT-licensed components built on `motion/react`, each calling `useReducedMotion()`.
**Decision.** Vendor one component, `animated-badge`, and use it for the two places where a state _change_ is the message: payload validation state and preview render state (its `loading` status pulses while rendering). Its colours were remapped to the studio's status tokens. Tabs, toasts and collapsibles stay on shadcn/Radix + sonner because accessibility there is already solved. Device switching uses a CSS width transition with `motion-reduce:transition-none`.
**Consequences.** beUI code is unversioned; it is treated as local code after install (do not re-run `shadcn add` over it without a diff).
**Update (phase 6).** `motion` is gone. `animated-badge` is reachable from three eagerly rendered components, so the library sat in the main chunk for one badge; phase 6 reimplemented the same gesture in about 30 lines of CSS keyframes (`src/index.css`, `.badge-roll` / `.badge-pulse`) and removed the dependency — **438.87 KB → 397.26 KB gzip**, the whole budget phase 6 then spent from (docs/TECH_DEBT.md #30). The exported API and the status vocabulary are unchanged, so no caller moved. The one deliberate difference: CSS cannot animate an element that is already gone, so the badge has a roll-IN and no roll-out. `prefers-reduced-motion` is honoured in the stylesheet instead of by `useReducedMotion()`.

## ADR-5 Editor: CodeMirror 6

**Decision.** `@uiw/react-codemirror` with `@codemirror/lang-javascript` (`{ jsx: true, typescript: true }`), `@codemirror/lang-json` + `jsonParseLinter`, `@codemirror/lang-html` for the read-only HTML tab and `@codemirror/theme-one-dark`.
**Why.** Roughly 176 KB gzip for the whole stack versus more than 1 MB plus worker configuration for Monaco; React 19 compatible; accessible by default (`role="textbox"`, `aria-label` via `contentAttributes`, Escape-then-Tab to leave the editor).
**Consequences.** No TypeScript IntelliSense in the editor. A later milestone can add type-aware hints if wanted.

## ADR-6/7/8 Compile, render and isolate in the browser

See `docs/ARCHITECTURE.md` for the mechanism. Key facts verified: sucrase `transforms: ['typescript','jsx','imports']` with `jsxRuntime: 'automatic'` and `production: true` emits CommonJS whose `require` calls we control; `@react-email/render` selects a DOM-free build under the `browser`/`worker` export conditions; Prism.js needs `globalThis.Prism = { manual: true, disableWorkerMessageHandler: true }` before it loads inside a worker.

## ADR-9 Validation with Zod, behind a domain interface

Templates declare a `z.strictObject` schema in the registry; `zodPropsValidator` adapts it to the domain's `PropsValidator` so the domain and application layers never import Zod. `strictObject` flags unknown keys, which catches typos in payloads.

## ADR-11 Testing strategy

- Pure modules (compile, evaluate, render, parse, reducer, diagnostics, session store, worker hardening) have Vitest unit tests in the Node environment. The render test proves each sample template renders with its sample payload.
- Components and hooks use jsdom with Testing Library (`// @vitest-environment jsdom`).
- Anything that depends on a real browser (Web Worker, iframe sandbox, timeout) is covered by Playwright against `vite preview` of the production build, so the worker bundle itself is tested.
