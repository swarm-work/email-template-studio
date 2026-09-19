# Learning guide

For a developer coming from Salesforce (Apex, LWC, Flows) into this codebase. Each concept points at the file that uses it, so you can read code and theory together.

| Concept                                                          | Closest Salesforce idea                                               | Where it is used                                                                        | Read                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| TypeScript union types with a discriminant (`ok: true \| false`) | Apex enums + wrapper classes, but checked by the compiler             | `src/domain/preview.ts` (`ValidationResult`, `RenderResult`)                            | TS handbook: Narrowing, Discriminated unions                    |
| Branded ids                                                      | Salesforce `Id` type                                                  | `src/domain/template.ts` (`TemplateId`)                                                 | TS handbook: Type aliases                                       |
| Discriminated unions driving exhaustive `switch`                 | A `Type` picklist plus `if` chains you have to remember to update     | `src/domain/template.ts` (`TemplateRecord`), `src/application/studioState.ts`           | See "Discriminated unions drive exhaustive switches" below      |
| `unknown` at boundaries + runtime validation                     | Deserialising JSON with `JSON.deserializeUntyped` then checking       | `src/application/parsePreviewPayload.ts`, `src/infrastructure/session/sessionStore.ts`  | Zod docs: `safeParse`, `z.strictObject`                         |
| Pure reducer for state                                           | A service class with static methods, no side effects                  | `src/application/studioState.ts` (+ test)                                               | React docs: Extracting state logic into a reducer               |
| React hooks (`useReducer`, `useEffect`, `useMemo`)               | LWC `@wire`/lifecycle hooks, but functions                            | `src/presentation/hooks/useStudio.ts`, `useRenderPreview.ts`                            | React docs: Hooks reference, "You might not need an effect"     |
| Derived state instead of stored state                            | Formula fields                                                        | `useRenderPreview.ts` derives `status` from keys                                        | React docs: Choosing the state structure                        |
| Web Workers and `postMessage`                                    | Queueable/async Apex running off the main thread                      | `src/infrastructure/render/render.worker.ts`, `renderClient.ts`                         | MDN: Using Web Workers                                          |
| `new Function` and CommonJS `require`                            | Dynamic Apex (`Type.forName`) with an allow-list                      | `src/infrastructure/render/evaluateTemplate.ts`                                         | MDN: Function constructor (and why it is dangerous)             |
| iframe `sandbox` and CSP                                         | Lightning Locker / LWS isolation                                      | `src/infrastructure/render/previewDocument.ts`, `PreviewWorkspace.tsx`                  | MDN: iframe sandbox, Content-Security-Policy                    |
| React Email components                                           | Visualforce email templates, but React                                | `src/infrastructure/templates/*.email.tsx`                                              | react.email docs: Components, `render`                          |
| Vite `?raw` imports                                              | Static resources                                                      | `src/infrastructure/templates/registry.ts`                                              | Vite docs: Static asset handling                                |
| Tailwind v4 tokens (`@theme`)                                    | SLDS design tokens                                                    | `src/index.css`                                                                         | Tailwind docs: Theme variables                                  |
| shadcn/ui                                                        | Base Lightning components you copy and own                            | `src/components/ui/*`, `components.json`                                                | ui.shadcn.com/docs                                              |
| Accessible roles and names                                       | LWC accessibility guidance                                            | `aria-label`, `role="region"`, `aria-pressed` across `src/presentation`                 | MDN: ARIA, WAI-ARIA Authoring Practices                         |
| Unit tests with Vitest                                           | Apex test classes                                                     | `*.test.ts` next to each module                                                         | vitest.dev/guide                                                |
| Component tests with Testing Library                             | Jest tests for LWC                                                    | `src/presentation/studio/*.test.tsx`                                                    | testing-library.com/docs                                        |
| Browser tests with Playwright                                    | UTAM / Selenium                                                       | `e2e/studio.spec.ts`, `playwright.config.ts`                                            | playwright.dev/docs                                             |
| Cloudflare Worker (V8 isolate, request-scoped)                   | Apex transaction: short-lived, governor limits                        | `worker/index.ts`, `wrangler.jsonc`                                                     | developers.cloudflare.com/workers: How Workers works            |
| Bindings, `vars` and secrets                                     | Named Credentials, Custom Metadata vs Protected Settings              | `wrangler.jsonc` (`vars`), `.dev.vars.example`, `worker-configuration.d.ts` (generated) | Cloudflare docs: Configuration, Secrets                         |
| One HTTP app, two adapters                                       | One service class called from a trigger and from a batch              | `server/app.ts` (shared), `server/node.ts`, `worker/index.ts`                           | Hono docs: Getting started (Node, Cloudflare Workers)           |
| Same-origin policy and CSRF                                      | CSRF tokens on Visualforce forms                                      | `rejectForeignRequest` in `server/app.ts` (+ test)                                      | MDN: Same-origin policy, Origin header                          |
| API keys shown once                                              | Named Credential secret value shown at creation                       | `src/presentation/api/ApiKeysPage.tsx`, `src/application/apiKeys.ts`                    | OWASP: API keys, MDN: Web Crypto                                |
| Pure functions and table-driven tests                            | A utility Apex class with no SOQL or DML, tested with a list of cases | `src/application/mergeFields.ts` (+ test)                                               | See "Pure functions and table-driven tests: merge fields" below |
| Webhook signatures and replay windows                            | Signed outbound integration callback                                  | `src/presentation/api/ApiKeysPage.tsx` (planned UI), later `docs/WEBHOOKS.md`           | Stripe docs: webhook signatures, MDN: SubtleCrypto HMAC         |

## Discriminated unions drive exhaustive switches

In Apex you would probably model "a template is either code or visual" with a picklist field and a
class that has every column on it: `source`, `document`, `theme`. Nothing then stops a record that
claims to be visual but has a source, and every method has to remember which fields are meaningful
together. The bug shows up at runtime, usually in production data.

TypeScript can model it so the compiler does that remembering. `TemplateRecord` in
`src/domain/template.ts` is a **union of two shapes with a shared literal field**:

```ts
type TemplateRecord =
  | (Base & { kind: 'code'; source: string })
  | (Base & { kind: 'visual'; document: EmailDocument; theme: string; html: string; text: string })
```

`kind` is the **discriminant**. Reading `record.source` straight away is a compile error, because the
visual branch has no such field. Check the discriminant first and TypeScript _narrows_ the type
inside that branch:

```ts
if (record.kind === 'code') {
  console.log(record.source) // fine here: this can only be the code shape
}
```

The same works with `switch (record.kind)`. That buys the second half of the promise: with no
`default:` branch, a function that declares it returns `string` **fails to compile** the day a third
kind is added, because that path would now return nothing — TypeScript says _"Function lacks ending
return statement and return type does not include 'undefined'"_ (error TS2366). The repo also turns
on `noFallthroughCasesInSwitch`, which is a different guard: it catches a `case` that accidentally
runs into the next one.
The compiler hands you the list of places to update, which is exactly what a picklist cannot do. You
can see this in `stageLabel()` in `studio/code/RenderErrorBanner.tsx`: adding `'compose'` and `'editor-load'` to
`RenderErrorKind` broke it immediately, on purpose.

`studioReducer` uses the same trick on `action.type`: every action shape carries its own fields, so
`action.source` only exists inside `case 'edit-source'`, and a new action type without a `case` is a
compile error rather than a silently ignored dispatch.

Two habits that keep this working:

- Never add `default:` to a switch over a discriminant just to silence the compiler. The missing case
  **is** the message.
- Put the discriminant in the data, not in a separate boolean (`isVisual`). Two booleans can disagree;
  one literal field cannot.

## Ports and adapters: the repository pattern and `VITE_DATA_MODE`

In Apex you rarely think about this, because there is only ever one database. `Account` is a table
SOQL can reach, and a test class fakes it by inserting real rows into the real org. Here the store
moves: today the templates live in a JavaScript `Map` in the browser tab, tomorrow they live in a
Cloudflare D1 database behind an HTTP API. The screens must not notice.

The trick is to write down **what you need** separately from **who provides it**.

```
src/application/repositories/templateRepository.ts   the PORT: an interface, no code
src/infrastructure/templates/inMemoryTemplateRepository.ts   an ADAPTER: a Map
src/infrastructure/templates/httpTemplateRepository.ts       another ADAPTER (later): fetch + D1
```

The port lives in `application` — the layer that _needs_ templates — and it is written in domain
words: `saveVersion(id, expectedRevision, version)`, not `POST /api/templates/:id/versions`. The
adapters live in `infrastructure`, because that is where the outside world is allowed in. This is the
"dependencies point inwards" rule from `docs/ARCHITECTURE.md` doing real work: the inner layer
declares, the outer layer obeys. The closest Apex habit is an interface plus a mock implementation
you inject in a test — except here the "mock" is a real, shipping adapter.

Three details that are easy to skim past and worth stopping on:

1. **Nothing throws.** Every method returns
   `{ ok: true, value } | { ok: false, failure: { code, message } }`. A save refused because someone
   else saved first is not exceptional, it is Tuesday; the UI has to _explain_ it. Compare an Apex
   `DmlException` you catch four frames away with no idea which record failed. Because `ok` is a
   literal `true`/`false`, TypeScript narrows on it: inside `if (result.ok)` there is a `value` and
   no `failure`, and vice versa (the same discriminated-union trick as above).
2. **`expectedRevision` is optimistic concurrency.** Every write says "I believe this template is at
   revision 7". If it is at 8, the write does nothing and comes back with
   `code: 'version-conflict'` **and the store's current copy**, so the dialog can offer "keep mine /
   discard mine" without another round trip. This is exactly what Salesforce does when it refuses a
   save because the record was "modified by another user", and what an `ETag` does over HTTP.
3. **Everything is copied on the way in and on the way out** (`structuredClone`). An HTTP adapter
   serialises anyway; if the in-memory one handed out live references, code could mutate the store by
   accident and only the HTTP version would break. The strict adapter is the honest one.
4. **The same limits as the API.** Name, description, tag, subject and preheader lengths, and the
   byte caps on the content, are checked here too, against the very constants in
   `shared/templateContracts.ts` that the server validates with. If memory mode accepted a 300-character
   name, the only thing that would tell you it is invalid is a 400 from the API months later.

`createTemplateRepository.ts` is the one place that chooses. It reads `import.meta.env.VITE_DATA_MODE`,
a **build-time** variable: Vite does not look it up at runtime, it substitutes the literal text into
the bundle while building (so `VITE_DATA_MODE=http npm run build` bakes `'http'` in). The `VITE_`
prefix is required and is a safety rule — only variables with it are exposed to browser code, so a
secret in `.env` cannot reach the client by accident. Think Custom Metadata read at compile time
rather than a Custom Setting read at runtime.

Finally, `templateRepositoryContract.ts`: one Vitest suite, handed a factory, that every adapter
runs. When the HTTP adapter arrives it runs the same suite; a difference in behaviour becomes a red
test rather than a bug report. If you write a second implementation of anything in this codebase,
copy this pattern.

## Migrations and optimistic concurrency (revision ≈ Apex SystemModstamp)

Two ideas arrive together with the database. Both have direct Salesforce equivalents, which is the
fastest way in.

**Migrations are your change set, kept in the repository.** In an org you click fields into
existence and then fight to get that change into the next sandbox. Here the schema is a folder of
numbered SQL files:

```
migrations/0001_create_templates.sql        CREATE TABLE templates …
migrations/0002_seed_starter_templates.sql  INSERT INTO templates …
```

`npm run db:migrate` applies the ones that have not run yet to the local database;
`npm run db:migrate:prod` does the same to the real one. Wrangler keeps a small bookkeeping table of
what it has applied, so running it twice is safe. Three rules worth internalising:

1. **A migration is never edited once it has been applied anywhere.** If 0001 is wrong, 0003 fixes
   it. Editing 0001 makes your database and everyone else's disagree while both claim to be at the
   same version.
2. **A migration is never rolled back.** "Undo" is the next migration.
3. **A migration must be safe for the code that is already running.** Deploying is two steps —
   migrate, then deploy — and between them the _old_ Worker is talking to the _new_ schema. Adding
   a table or a nullable column is safe. Renaming a column is not: add the new one, write to both,
   deploy, backfill, and drop the old one in a later release.

**Optimistic concurrency is `SystemModstamp`, written out.** In Apex, if you read a record, sit on
it, and update it after someone else has, the platform throws `UNABLE_TO_LOCK_ROW` /
`ENTITY_IS_DELETED`-style errors, or `SystemModstamp` tells you it moved. The same problem exists
here: two browser tabs, same template, both press Save.

The studio's answer is one integer column:

```sql
-- migrations/0001_create_templates.sql
revision INTEGER NOT NULL DEFAULT 1   -- bumps on EVERY write
```

and one `WHERE` clause (`server/d1TemplateStore.ts`):

```sql
UPDATE templates
   SET current_version = current_version + 1, revision = revision + 1, …
 WHERE id = ? AND revision = ?          -- ? is the revision the caller last read
```

If somebody else saved first, `revision` has moved on, the `WHERE` matches nothing, and SQLite
reports `meta.changes === 0`. Nothing was written. The store then re-reads the row and the route
answers `409 conflict` **with the server's current copy in the body**, so the UI can say "someone
saved v4 two minutes ago" and offer a choice instead of silently throwing work away.

Two numbers, two jobs, easy to confuse at first:

| Column                      | Meaning                                               | Moves when                      |
| --------------------------- | ----------------------------------------------------- | ------------------------------- |
| `templates.current_version` | which row of `template_versions` is the live one      | a new version is saved          |
| `templates.revision`        | the concurrency token: "has anything changed at all?" | **any** write, renames included |

Renaming a template bumps `revision` and not `current_version`. That is the point: your stale save
must be refused even though nobody touched the content.

**Versions are append-only.** A save never updates a `template_versions` row; it inserts the next
one. History is therefore a side effect of the design rather than a feature someone has to build,
and "restore v2" is a read plus a save rather than a special code path. The price is storage: three
saves of a 200 KB template is 600 KB of rows, and nothing prunes them yet (`docs/TECH_DEBT.md`).

**Where to look.** `migrations/0001_create_templates.sql` is commented line by line.
`server/templateStoreContract.ts` is the suite both store implementations pass — read the case named
_"refuses a stale expectedRevision, writes nothing, and hands back the current template"_ and you
have the whole idea in twenty lines.

## Controlled inputs and a single reducer: the envelope panel

Coming from Salesforce, the closest thing to `EnvelopePanel` is a Lightning form bound to a record in
a wire adapter: fields show the record, edits go somewhere central, and the form itself owns nothing.
React has no framework doing that for you, so it is worth seeing exactly how little code it takes.

**A controlled input has no memory.** In plain HTML an `<input>` remembers what you typed. A
_controlled_ input does not: it is told what to show, and it reports what you did.

```tsx
<Input
  value={envelope.subject}
  onChange={(event) => onChange({ ...envelope, subject: event.target.value })}
/>
```

`value` comes down, `onChange` goes up. The field cannot get out of step with the draft, because it
has no state to get out of step _with_. Two rules follow, and breaking either is the usual React bug:

1. **Never copy a prop into `useState` "so it can be edited".** You then have two answers to "what is
   the subject?" and they drift the moment anything else changes it (a reset, a template switch, a
   draft restored from session storage).
2. **Always send a whole new object.** `{ ...envelope, subject: next }` builds a new envelope rather
   than assigning `envelope.subject = next`. React decides what to re-render by comparing object
   identity, so mutating in place changes the data and tells no one.

**One reducer, not six `useState`s.** Every edit — subject, preheader, reply-to, the TSX source, the
props JSON — becomes one action dispatched into `application/studioState.ts`:

```ts
onChange={actions.updateEnvelope}      // → { type: 'edit-envelope', id, template, envelope }
```

The reducer is a plain function: given the old state and an action, return the new state. It has no
React in it, so its test is ordinary JavaScript (`studioState.test.ts`). That is where the rules live:
an envelope equal to the saved one deletes the draft instead of storing a no-op, which is why the
**· Unsaved changes** half of the sub-header badge turns itself off when you undo your own edit. (The
other half is the template's stored status — `Draft`, `Ready` or `Deprecated` — read through the same
`templateStatusLabel` the status bar uses, so the two cannot say different things.) The panel does not
know that rule exists, and does not need to.

**Validation is derived, never stored.** The subject counter and the reply-to error are computed while
rendering, from the value that is already on screen:

```ts
const subjectState = subjectLengthState(envelope.subject) // 'empty' | 'ok' | 'too-long'
const replyToError = replyToProblem(envelope.replyTo) // string | undefined
```

There is no `const [error, setError]` and no effect that runs validation after the fact. Anything you
can calculate from state should be calculated, not stored — stored copies are what go stale. The rule
itself (78 characters) lives in `src/domain/template.ts`, so it is one testable function rather than a
number sprinkled through the UI.

**Labels are wiring, not decoration.** Each field is `<Label htmlFor={id}>` over a control with that
`id`, and hints are linked with `aria-describedby`. That is what lets the tests say
`screen.getByLabelText('Subject line')` — if a test cannot find a field by its visible label, neither
can a screen-reader user. Read `EnvelopePanel.test.tsx` next to the component: every assertion in it
is a sentence about the product, not about the DOM.

## `useMemo`: why one render feeds two views

Phase 4 put the same email on screen twice: full size in Preview mode (⌘P) and postage-stamp size in
the code rail. In Apex you would not query the same record twice on one page; in React the equivalent
mistake is easy to make by accident, because each component _looks_ independent.

**What a render costs here.** Every preview is a message to a Web Worker that compiles TSX with
sucrase and runs React Email over it. Tens of milliseconds, a couple of megabytes of bundle, and a
number the studio shows you (`Render time`). Doing it twice for one email would be silly — and worse,
the two results could differ, so the report would be measuring something other than what you see.

**The shape of the fix.** One render, one string, two readers:

```tsx
// StudioPage.tsx — built once per successful render
const previewDocument = useMemo(
  () => (preview.html === null ? null : buildPreviewDocument(preview.html)),
  [preview.html],
)
```

`useMemo(fn, deps)` means: run `fn` now, then hand back that same value on every later render until
something in `deps` changes. Here `deps` is the HTML of the last good render, so the CSP wrapper is
built once per render rather than once per repaint — and, crucially, **both** consumers are handed
the identical string:

```tsx
<PreviewWorkspace document={previewDocument} … />   // preview mode
<PreviewThumbnail document={previewDocument} … />   // the code rail
```

Three things follow, and they are the reason the code is written this way:

1. **Placement is the decision.** The memo lives in `StudioPage`, the one component that has both
   children. A `useMemo` inside `PreviewWorkspace` would be per-component memory, and the thumbnail
   would still build its own copy.
2. **`useMemo` is a cache, not a guarantee.** React may throw a memoised value away. It is a
   performance tool, so nothing may _depend_ on it running exactly once; here it only saves work.
3. **Identity is what stops the iframe reloading.** An iframe re-parses its `srcDoc` whenever the
   string changes. Same render, same string, same identity, no reload — which is why switching modes
   is instant and why the end-to-end test _"switching modes costs no render"_ can assert that
   `Render time` and `Rendered <time>` do not move.

**What is not memoised.** Anything cheap. `Math.round(scale * 100)` in the thumbnail's caption is not
worth a cache entry; the rule of thumb is to memoise what is expensive to compute or what has to keep
its identity (objects and arrays passed to children), and leave arithmetic alone.

**Where to look.** `src/presentation/studio/StudioPage.tsx` (the memo and the two consumers),
`src/presentation/hooks/useScaledFrame.ts` (a `ResizeObserver` reduced to one number, rounded to three
decimals so a sub-pixel wobble does not re-render), and ADR-25 in `docs/DECISIONS.md` for the decision
itself.

## `React.lazy`, `Suspense` and code splitting

A bundler normally produces one JavaScript file: everything the app might need, downloaded before
anything is drawn. That is fine until one feature is very large. The visual editor is 2.5 MB of
Tiptap, ProseMirror and React Email — bigger than the whole rest of the studio — and most of the
time nobody opens a visual template at all.

**The seam is a dynamic `import()`.** A normal `import X from './X'` is static: the bundler follows it
and puts `X` in the same file. `import('./X')` is a function call that returns a promise, and the
bundler treats it as a **split point**: `X` and everything only `X` needs go into a separate file that
the browser fetches the first time that line runs.

```tsx
const VisualEditorSurface = lazy(() =>
  import('./VisualEditorSurface').then((module) => ({ default: module.VisualEditorSurface })),
)
```

`React.lazy` wraps that promise into something you can put in JSX. The `.then(...)` is only there
because `lazy` wants a module whose `default` export is the component, and this codebase prefers named
exports.

**`Suspense` is what is on screen while you wait.** A lazy component "suspends" on its first render;
the nearest `<Suspense fallback={...}>` above it shows the fallback until the chunk arrives. The
fallback here is `VisualEditorSkeleton`, drawn in the shape of the finished screen so the layout does
not jump when the real editor appears.

**An error boundary is what happens when it never arrives.** A stale deploy, an offline browser or a
proxy eating the request all end with the promise rejecting, and `Suspense` has nothing to say about
that. Error boundaries are the one thing React still needs a class for (`getDerivedStateFromError`).
Ours turns the failure into a `RenderError { kind: 'editor-load' }` so it is shown by the same banner
as a compile or export error — one vocabulary for "the pipeline could not finish".

**Splitting only works if nothing else imports the module.** One stray `import { EmailEditor } from
'@react-email/editor'` in a file the main bundle already needs and the whole 2.5 MB is back in the
first download, silently. That is why only three modules import the package
statically — `VisualEditorSurface.tsx`, which mounts the editor, and phase 6's `mergeFieldNode.ts`
and `editorExtensions.ts`, which are imported ONLY from inside that surface's subtree — why
`visualEmailRenderer.ts` reaches `/core` through another `import()` rather than a static import, why
`studioTheme.ts` takes the `ThemeConfig` type only (a type import is erased, so it costs nothing),
why `scripts/check-worker-bundle.mjs` greps **`src/` itself** against that five-file allow-list as
well as the directories that must stay entirely clear, and why `e2e/visual.spec.ts` watches the network and asserts that opening a **code** template
fetches no editor chunk at all. A rule nobody can measure is a rule that quietly stops being true.

**Where to look.** `src/presentation/studio/visual/VisualWorkspace.tsx` (the lazy boundary, the
skeleton and the error boundary), `src/infrastructure/render/visualEmailRenderer.ts` (the second
dynamic import), `scripts/check-worker-bundle.mjs` and ADR-18 in `docs/DECISIONS.md`.

## Pure functions and table-driven tests: merge fields

Merge fields are the studio's best example of a feature that is almost entirely **pure functions**,
and of the kind of test that suits them.

### What "pure" bought here

`src/application/mergeFields.ts` takes strings and plain objects and returns strings and plain
objects. It imports nothing but a type. No React, no DOM, no Zod, no editor. That is not purism — it
is what makes the following all true at once:

- The same `applyMergeFields` runs in the browser today and could run on a server tomorrow, per
  recipient, with no changes at all. That is the whole reason a saved version is stored with its
  `{{key}}` tokens still in it (ADR-26).
- Its forty-odd tests run in **milliseconds** in the Node environment. No jsdom, no editor to mount,
  no waiting for a render.
- A failing test points at one function. When the end-to-end suite reported
  `Unknown variable {{FIRSTNAME}}`, every unit test was green — which was itself the answer: the bug
  was not in the substitution, it was that `html-to-text` uppercases heading text in the plain-text
  part (TECH_DEBT #40).

In Apex terms: this is the utility class with no SOQL, no DML and no `Test.startTest()` — the part
you can test a hundred cases of without ever building a record.

### Table-driven tests

The interesting question about `applyMergeFields` is not "does it replace text" but **which values
count as a value**. A string does. A number and a boolean do, through `String()`. `null`, `undefined`,
an object and an array do not — they have no sensible one-line spelling, so the token stays on screen
and the key is reported as missing.

Nine near-identical tests would bury that rule in ceremony. A table puts it where you can read it:

```ts
const cases = [
  { name: 'a string', payload: { name: 'Ada' }, expected: 'Hi Ada!', missing: [] },
  { name: 'a number', payload: { name: 42 }, expected: 'Hi 42!', missing: [] },
  { name: 'null', payload: { name: null }, expected: 'Hi {{name}}!', missing: ['name'] },
  // …
]

for (const { name, payload, expected, missing } of cases) {
  it(`substitutes ${name}`, () => {
    const result = applyMergeFields('Hi {{name}}!', payload, { escape: 'none' })
    expect(result.text).toBe(expected)
    expect(result.missing).toEqual(missing)
  })
}
```

Each row is still its own `it`, so a failure names exactly which case broke; adding a case is one
line; and the table documents the decision better than prose would. You can see at a glance that an
empty string is a value (`Hi !`) while `null` is not.

Use a table when the cases differ only in **data**. Keep separate tests when they differ in
**behaviour**: `withMissingKeys` preserving the indentation someone hand-aligned and
`withMissingKeys` recovering from unparseable JSON are two different stories, not two rows.

### Two regexes, and the test that stops them drifting

`MERGE_FIELD_PATTERN` matches `{{ key }}` inside a longer string; `MERGE_FIELD_KEY_PATTERN` matches a
bare `key` for the Data tab's "Add field" input. Deriving the second from the first with string
surgery was tried and read horribly, so both are written out — and one test asserts that every key
the first one finds is accepted by the second. That is the cheap way to have readable duplication:
duplicate the code, never the guarantee.

Two things about the `/g` flag are worth remembering, because both produce bugs that look like
witchcraft:

- A global regex keeps a `lastIndex`, so `.test()` on the same string can answer `true` and then
  `false`. Every scan in this module goes through `new RegExp(source, 'g')`, which hands out a fresh
  one each time.
- `String.replace` with a global regex calls your function once per match, and whatever the function
  returns is what lands in the text. Returning `undefined` by accident writes the literal string
  `"undefined"` into somebody's email.

### One rule, in one place

Pure functions only pay off if everyone asks THEM. Two bugs the phase-6 review found were both the
same mistake — a second copy of a rule that already existed:

- The Data tab decided "missing" for itself (`readPayloadValue(...) === ''`), so a key filled in with
  an empty string counted as missing in the panel and as filled everywhere else: the button that
  fills keys in stayed lit forever, next to a diagnostics row saying everything had a value. The fix
  is one line — call `missingMergeFields`, the same function the warning row calls.
- Substitution read the SCHEMA-VALIDATED props (`validation.ok ? validation.value : {}`) instead of
  the payload JSON. Since the schema wants every key, one unfilled key made the whole object `{}`,
  and every _other_ key stopped resolving too. Filling a form in is one field at a time, so that was
  the normal state, not an edge case.

The lesson is not "be careful". It is that a rule you can only apply by re-implementing it will be
re-implemented differently, and the second copy is invisible until somebody notices the two halves
of a screen disagreeing. Export the function, delete the re-implementation.

### Where to look

`src/application/mergeFields.ts` and `mergeFields.test.ts` (the pure core), then
`src/infrastructure/render/mergeFieldNode.ts` (the editor's side of the same rule) and
`src/presentation/studio/StudioPage.tsx`, where one memo decides what is resolved and what is not.
ADR-26 in `docs/DECISIONS.md` explains that boundary.

## HTTP without exceptions: result types and error mapping

In Apex you call an HTTP endpoint and then live with whatever comes back: `Http.send()` throws
`CalloutException` when the socket fails, returns an `HttpResponse` with a status code when it does
not, and it is on you to remember which of those two worlds you are in. JavaScript's `fetch` has the
same split, and it surprises people:

```ts
const response = await fetch('/api/templates') // throws ONLY if the request never completed
// A 404 is not an error here. A 500 is not an error here. `response.ok` is false; that is all.
```

So there are two failure shapes (a thrown `TypeError`, and a perfectly successful promise carrying a
bad status) and a third one nobody thinks about: a 200 whose body is not what you expected, because a
proxy served an HTML error page or half a deploy is live.

### The pattern: make failure a value

`src/infrastructure/templates/httpTemplateRepository.ts` never throws. Every method answers the same
shape, declared by the port in the application layer:

```ts
export type RepositoryResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: RepositoryFailure }
```

That is a **discriminated union** again (see the first section of this file): `result.ok` is the
discriminant, and TypeScript refuses to let you read `result.value` until you have checked it. A
caller cannot forget to handle the failure, because the compiler will not let it reach the success
path. Compare that with `try`/`catch`, where forgetting is the default and the mistake shows up at
runtime, three layers away from the call.

The three failure shapes each get mapped once:

```ts
try {
  response = await this.#fetch(url, { ... })
} catch {
  return failure('unreachable', UNREACHABLE_MESSAGE)   // 1. the request never completed
}

const payload: unknown = await response.json().catch(() => null)
if (!response.ok) return { ok: false, failure: failureFor(response.status, payload) }  // 2. a bad status

const parsed = schema.safeParse(payload)               // 3. a body we do not understand
if (!parsed.success) return failure('unexpected', UNEXPECTED_BODY_MESSAGE)
return { ok: true, value: parsed.data }
```

Note `payload: unknown`. That is the honest type for anything that came off the network, and it is
what forces the `safeParse` — you cannot read `payload.template` until Zod has said the shape is
there. `as TemplateDetailDto` would silence the compiler and move the crash to the first missing
field.

### Mapping statuses to words

`failureFor(status, body)` turns HTTP into the vocabulary the UI already speaks: 401 →
`unauthenticated`, 404 → `not-found`, 409 with `code: 'conflict'` → `version-conflict` **carrying the
server's current copy**, 503 → `storage-unavailable`, and so on. The status is the primary signal
because it survives a body that cannot be parsed; the `code` inside the body only separates the two
meanings one status can have (a 409 is either "somebody saved first" or "that slug is taken").

Two details worth copying:

- **The failure union carries data when the UI needs it.** `version-conflict` is
  `{ code, message, current: TemplateRecord }`, so the conflict dialog can offer "discard mine and
  load v8" without a second request. A bare error string would have cost a round trip and a race.
- **The same status can mean two things at two call sites.** `POST /:id/versions` answers 422 for
  "this version is of the other kind"; `POST /:id/convert` answers 422 for "this template is not
  visual". The port has a word for each, so `saveVersion` asks for its 422 to be read as `invalid`
  while `convertToCode` keeps `not-visual`. The shared contract suite is what caught that: the
  in-memory adapter and the HTTP one disagreed, and a test said so out loud.

### Where to look

`src/application/repositories/templateRepository.ts` (the union, declared where it is needed), then
`src/infrastructure/templates/httpTemplateRepository.ts` and its two test files — one drives recorded
responses status by status, the other runs the shared contract suite against the **real** Hono app
with `fetch` swapped for `app.request`. ADR-27 in `docs/DECISIONS.md` records the trade-offs,
including why that second file is the one place `src/` imports `server/` and what it costs.

## Suggested reading order through the code

1. `src/domain/*` — the vocabulary (10 minutes).
2. `src/application/studioState.ts` and its test — how state changes without React.
3. `src/infrastructure/render/renderTemplate.ts` then `compileTemplate.ts` and `evaluateTemplate.ts` — the pipeline in plain functions.
4. `src/infrastructure/render/renderClient.ts` and `render.worker.ts` — the worker boundary.
5. `src/presentation/studio/StudioPage.tsx` — how everything is composed.
6. `src/presentation/studio/visual/VisualWorkspace.tsx` then `VisualEditorSurface.tsx` — the lazy boundary, and the one module that touches the editor package.
7. `src/application/mergeFields.ts` and its test — a whole feature as pure functions, and what a table-driven test looks like.
8. `migrations/0001_create_templates.sql` then `server/templateStore.ts` — the shape of the data and the port over it.
9. `server/templateRoutes.test.ts` — every HTTP rule the API promises, one case each.
10. `src/infrastructure/templates/httpTemplateRepository.ts` — the browser's side of that API, and what "no method throws" looks like in practice.
11. `e2e/studio.spec.ts` and `e2e/templates.spec.ts` — the behaviours we promise, written as a user would experience them.

## Things worth practising

- Add another code template: create `*.email.tsx`, a Zod schema, an entry in `starterCatalog.json` (with `seedBatch` and `kind: "code"`), then `npm run seed:generate` and `npm test` (the render test and the seed drift test both pick it up).
- Break the code split on purpose: add `import '@react-email/editor'` to `server/app.ts` and watch `npm run build` refuse it by name.
- Break the concurrency rule on purpose: comment out `AND revision = ?` in `server/d1TemplateStore.ts` and watch which contract test fails, and why.
- Add a diagnostic: extend `buildDiagnostics.ts` and its test before touching the panel.
- Add a merge-field rule: make `applyMergeFields` accept a `Date` (as an ISO string, say) — one row in the table, then the code.
- Change the debounce or timeout constants and watch the E2E tests react.
- Break the error mapping on purpose: make `failureFor` return `unexpected` for 409 and watch which test in `httpTemplateRepository.test.ts` fails, and what the conflict dialog does instead.
- Provoke a real conflict: open the same template in two tabs, save in one, then save in the other.
