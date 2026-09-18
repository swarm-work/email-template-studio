# Learning guide

For a developer coming from Salesforce (Apex, LWC, Flows) into this codebase. Each concept points at the file that uses it, so you can read code and theory together.

| Concept                                                          | Closest Salesforce idea                                           | Where it is used                                                                        | Read                                                        |
| ---------------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| TypeScript union types with a discriminant (`ok: true \| false`) | Apex enums + wrapper classes, but checked by the compiler         | `src/domain/preview.ts` (`ValidationResult`, `RenderResult`)                            | TS handbook: Narrowing, Discriminated unions                |
| Branded ids                                                      | Salesforce `Id` type                                              | `src/domain/template.ts` (`TemplateId`)                                                 | TS handbook: Type aliases                                   |
| Discriminated unions driving exhaustive `switch`                 | A `Type` picklist plus `if` chains you have to remember to update | `src/domain/template.ts` (`TemplateRecord`), `src/application/studioState.ts`           | See "Discriminated unions drive exhaustive switches" below  |
| `unknown` at boundaries + runtime validation                     | Deserialising JSON with `JSON.deserializeUntyped` then checking   | `src/application/parsePreviewPayload.ts`, `src/infrastructure/session/sessionStore.ts`  | Zod docs: `safeParse`, `z.strictObject`                     |
| Pure reducer for state                                           | A service class with static methods, no side effects              | `src/application/studioState.ts` (+ test)                                               | React docs: Extracting state logic into a reducer           |
| React hooks (`useReducer`, `useEffect`, `useMemo`)               | LWC `@wire`/lifecycle hooks, but functions                        | `src/presentation/hooks/useStudio.ts`, `useRenderPreview.ts`                            | React docs: Hooks reference, "You might not need an effect" |
| Derived state instead of stored state                            | Formula fields                                                    | `useRenderPreview.ts` derives `status` from keys                                        | React docs: Choosing the state structure                    |
| Web Workers and `postMessage`                                    | Queueable/async Apex running off the main thread                  | `src/infrastructure/render/render.worker.ts`, `renderClient.ts`                         | MDN: Using Web Workers                                      |
| `new Function` and CommonJS `require`                            | Dynamic Apex (`Type.forName`) with an allow-list                  | `src/infrastructure/render/evaluateTemplate.ts`                                         | MDN: Function constructor (and why it is dangerous)         |
| iframe `sandbox` and CSP                                         | Lightning Locker / LWS isolation                                  | `src/infrastructure/render/previewDocument.ts`, `PreviewWorkspace.tsx`                  | MDN: iframe sandbox, Content-Security-Policy                |
| React Email components                                           | Visualforce email templates, but React                            | `src/infrastructure/templates/*.email.tsx`                                              | react.email docs: Components, `render`                      |
| Vite `?raw` imports                                              | Static resources                                                  | `src/infrastructure/templates/registry.ts`                                              | Vite docs: Static asset handling                            |
| Tailwind v4 tokens (`@theme`)                                    | SLDS design tokens                                                | `src/index.css`                                                                         | Tailwind docs: Theme variables                              |
| shadcn/ui                                                        | Base Lightning components you copy and own                        | `src/components/ui/*`, `components.json`                                                | ui.shadcn.com/docs                                          |
| Accessible roles and names                                       | LWC accessibility guidance                                        | `aria-label`, `role="region"`, `aria-pressed` across `src/presentation`                 | MDN: ARIA, WAI-ARIA Authoring Practices                     |
| Unit tests with Vitest                                           | Apex test classes                                                 | `*.test.ts` next to each module                                                         | vitest.dev/guide                                            |
| Component tests with Testing Library                             | Jest tests for LWC                                                | `src/presentation/studio/*.test.tsx`                                                    | testing-library.com/docs                                    |
| Browser tests with Playwright                                    | UTAM / Selenium                                                   | `e2e/studio.spec.ts`, `playwright.config.ts`                                            | playwright.dev/docs                                         |
| Cloudflare Worker (V8 isolate, request-scoped)                   | Apex transaction: short-lived, governor limits                    | `worker/index.ts`, `wrangler.jsonc`                                                     | developers.cloudflare.com/workers: How Workers works        |
| Bindings, `vars` and secrets                                     | Named Credentials, Custom Metadata vs Protected Settings          | `wrangler.jsonc` (`vars`), `.dev.vars.example`, `worker-configuration.d.ts` (generated) | Cloudflare docs: Configuration, Secrets                     |
| One HTTP app, two adapters                                       | One service class called from a trigger and from a batch          | `server/app.ts` (shared), `server/node.ts`, `worker/index.ts`                           | Hono docs: Getting started (Node, Cloudflare Workers)       |
| Same-origin policy and CSRF                                      | CSRF tokens on Visualforce forms                                  | `rejectForeignRequest` in `server/app.ts` (+ test)                                      | MDN: Same-origin policy, Origin header                      |
| API keys shown once                                              | Named Credential secret value shown at creation                   | `src/presentation/api/ApiKeysPage.tsx`, `src/application/apiKeys.ts`                    | OWASP: API keys, MDN: Web Crypto                            |
| Webhook signatures and replay windows                            | Signed outbound integration callback                              | `src/presentation/api/ApiKeysPage.tsx` (planned UI), later `docs/WEBHOOKS.md`           | Stripe docs: webhook signatures, MDN: SubtleCrypto HMAC     |

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
can see this in `stageLabel()` in `SourceWorkspace.tsx`: adding `'compose'` and `'editor-load'` to
`RenderErrorKind` broke it immediately, on purpose.

`studioReducer` uses the same trick on `action.type`: every action shape carries its own fields, so
`action.source` only exists inside `case 'edit-source'`, and a new action type without a `case` is a
compile error rather than a silently ignored dispatch.

Two habits that keep this working:

- Never add `default:` to a switch over a discriminant just to silence the compiler. The missing case
  **is** the message.
- Put the discriminant in the data, not in a separate boolean (`isVisual`). Two booleans can disagree;
  one literal field cannot.

## Suggested reading order through the code

1. `src/domain/*` — the vocabulary (10 minutes).
2. `src/application/studioState.ts` and its test — how state changes without React.
3. `src/infrastructure/render/renderTemplate.ts` then `compileTemplate.ts` and `evaluateTemplate.ts` — the pipeline in plain functions.
4. `src/infrastructure/render/renderClient.ts` and `render.worker.ts` — the worker boundary.
5. `src/presentation/studio/StudioPage.tsx` — how everything is composed.
6. `e2e/studio.spec.ts` — the behaviours we promise, written as a user would experience them.

## Things worth practising

- Add a fourth template: create `*.email.tsx`, a Zod schema and a registry entry; run `npm test` (the render test picks it up automatically).
- Add a diagnostic: extend `buildDiagnostics.ts` and its test before touching the panel.
- Change the debounce or timeout constants and watch the E2E tests react.
