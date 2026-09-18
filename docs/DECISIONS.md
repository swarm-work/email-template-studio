# Architecture decision records

Each record: context, decision, alternatives, consequences. Versions are those installed on 2026-09-08.

| #   | Topic            | Decision                                                                                                                       | Rejected                                                                                            |
| --- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| 1   | Framework        | Vite 8.2 + React 19.2 + TypeScript 6.0 single-page app                                                                         | Next.js 16 (server not needed yet), Vite + Hono server                                              |
| 2   | Styling          | Tailwind CSS 4.3 via `@tailwindcss/vite`, tokens as CSS variables                                                              | CSS modules, styled-components                                                                      |
| 3   | Components       | shadcn/ui 4.21 (radix base, "nova" preset, Lucide icons)                                                                       | MUI, Chakra, hand-rolled                                                                            |
| 4   | Motion           | beUI via shadcn registry, one component (`animated-badge`), on `motion` 13.2                                                   | Whole beUI kit; framer-motion legacy; no motion                                                     |
| 5   | Code editor      | CodeMirror 6 via `@uiw/react-codemirror` 4.25                                                                                  | Monaco (10× larger, worker plumbing)                                                                |
| 6   | TSX compiler     | sucrase 3.35 in a Web Worker                                                                                                   | `@babel/standalone` (2.4 MB), esbuild-wasm (14 MB), TypeScript (7.x has no JS transpile API)        |
| 7   | Render location  | Browser, inside the worker, with `@react-email/components` 1.0                                                                 | Server render (no server; riskier for arbitrary code)                                               |
| 8   | Isolation        | Worker + hardened globals + timeout + `iframe sandbox=""` + CSP                                                                | `eval` on main thread; cross-origin iframe host (later)                                             |
| 9   | Validation       | Zod 4.5 schemas per template, adapted to a domain `PropsValidator`                                                             | JSON Schema + ajv; hand-written checks                                                              |
| 10  | State            | `useReducer` + pure reducer + `sessionStorage`                                                                                 | Zustand/Redux (over-scoped for one page)                                                            |
| 11  | Testing          | Vitest 5 (node + jsdom) + Testing Library + Playwright 1.63 on the production build                                            | Jest; Cypress                                                                                       |
| 12  | Lint / format    | oxlint (shipped by the Vite template) + Prettier 3.9 with Tailwind plugin                                                      | ESLint flat config (heavier setup)                                                                  |
| 13  | Package manager  | npm 11 (only one installed)                                                                                                    | pnpm, bun                                                                                           |
| 14  | Fonts            | Geist + Geist Mono (open licence, self-hosted via @fontsource)                                                                 | Inter (closer to the reference product), system fonts                                               |
| 15  | Hosting          | One Cloudflare Worker: static assets + Hono API, built with `@cloudflare/vite-plugin`                                          | Cloudflare Pages (maintenance only), separate Worker + Pages, Node on a VM                          |
| 16  | SES client       | `aws4fetch` 1.0 signing SES v2 REST calls, one sender for Node and the Worker                                                  | `@aws-sdk/client-sesv2` (needs Node APIs), hand-rolled SigV4, Cloudflare Email Service (beta)       |
| 17  | Test recipients  | `SES_ALLOWED_RECIPIENTS` is a list **or** `*`; up to 10 typed addresses per send                                               | Domain allow-list, one request per address, per-send suppression pre-check (deferred)               |
| 19  | Template kinds   | `TemplateRecord` discriminated union on `kind`; `EmailTemplate` = record + `validateProps`, assembled in infrastructure        | One flat type with nullable `source`/`document`; two unrelated types; `validateProps` on the record |
| 20  | Template storage | `TemplateRepository` port; in-memory adapter now, HTTP/D1 adapter later; plain `fetch` + React state, no data-fetching library | TanStack Query now (FEATURE_PLAN #16); calling the API straight from components; localStorage store |

Decisions 21 onwards (Cloudflare Access, Rate Limiting binding, Worker Loaders) are proposed in `docs/PLAN.md` section 1 and get a numbered record here when the phase that uses them lands. ADR-18 belongs to the visual-editor package choice and lands with it; the JSON Schema props contract is part of ADR-19.

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

## ADR-4 Motion: beUI selectively

**Context.** The brief asks for beUI where motion communicates state, and for reduced-motion support.
**Finding.** beUI is not an npm package; it is a shadcn-compatible registry (`npx shadcn@latest add @beui/<name>`) of MIT-licensed components built on `motion/react`, each calling `useReducedMotion()`.
**Decision.** Vendor one component, `animated-badge`, and use it for the two places where a state _change_ is the message: payload validation state and preview render state (its `loading` status pulses while rendering). Its colours were remapped to the studio's status tokens. Tabs, toasts and collapsibles stay on shadcn/Radix + sonner because accessibility there is already solved. Device switching uses a CSS width transition with `motion-reduce:transition-none`.
**Consequences.** `motion` 13.2 is a dependency (≈45 KB gzip). beUI code is unversioned; it is treated as local code after install (do not re-run `shadcn add` over it without a diff).

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
