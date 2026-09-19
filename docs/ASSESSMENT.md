# Repository assessment and implementation plan

Written 2026-09-08 at the start of the MVP, kept as the record of what was found and decided.

> **This is a dated snapshot, not a maintained document.** It says what the repository looked like on
> 2026-09-08 and what was decided then; it is deliberately not rewritten as the code moves. For what
> is true today read `README.md`, `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`; for what to do next
> read `docs/PRIORITIES.md`. Three statements below have been annotated where later work made the
> original wording read as a claim about the present (checked 2026-09-19).

## 1. What was in the repository

| Item                          | Finding                                                                                                                       |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Git history                   | Branch `main` with **no commits**.                                                                                            |
| `package.json` / lockfile     | **None.** No framework, no package manager choice, no scripts.                                                                |
| README / configuration        | **None.**                                                                                                                     |
| React Email boilerplate       | **None.** The brief assumed an existing boilerplate; there was nothing to preserve.                                           |
| Existing code to preserve     | None.                                                                                                                         |
| Installed UI/editor libraries | None (no shadcn/ui, Tailwind, Motion, beUI, Monaco, CodeMirror or Zod).                                                       |
| Other content                 | `Picflow Images Sep 7 (1)/`: 278 screenshots (1920×1325 WebP) of a third-party email product, used only as design references. |
| Machine                       | Linux, Node 26.8.1, npm 11.19.0. No pnpm, bun or yarn. Firefox present; Chromium fetched later via Playwright.                |

Because the repository was empty, "do not replace the existing stack" had nothing to protect; the stack below was chosen from scratch and justified in `docs/DECISIONS.md`.

## 2. Assumptions

1. The studio is an **internal** tool used by trusted teammates on their own machines; template authors are not adversaries.
2. Everything may run **in the browser**; no server is required for the MVP. A server (Cloudflare Worker) is expected later for sending and persistence.
3. Templates are **single-file** React Email components that only import `react` and `@react-email/components`.
4. Props are **flat-ish JSON objects** validated by a Zod schema that lives next to each template.
5. The reference screenshots inform composition and tone only; the visual system is original.
6. npm is the package manager because it is the only one installed.
7. "Session" means `sessionStorage`: edits survive a refresh, not closing the tab.

## 3. Risks identified up front (and what happened)

| Risk                                                                                                           | Mitigation / outcome                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package versions newer than the assistant's training data (Vite 8, Tailwind 4.3, React 19.2, TS 6/7, shadcn 4) | Verified every API with `npm view`, official docs and throwaway spikes before use. Two surprises: TS 6 rejects `baseUrl`; the Vite template now ships oxlint instead of ESLint. |
| React Email might not render inside a Web Worker                                                               | Confirmed: `@react-email/render` ships `browser`/`worker` export conditions. Verified in Node and in headless Chromium.                                                         |
| Prism.js (pulled in by React Email's CodeBlock) hijacks worker messages                                        | Found during E2E: it JSON-parses every worker message and crashed the worker. Fixed with `prismWorkerGuard.ts`, which must stay the first import of the worker.                 |
| Executing user TSX in the page origin                                                                          | Worker + hardened globals + timeout + sandboxed iframe with CSP. Residual risk documented in ARCHITECTURE.md.                                                                   |
| Large bundles (React Email + Tailwind compiler + prettier in the worker)                                       | Accepted for an internal tool; measured and logged in TECH_DEBT.md with a plan.                                                                                                 |
| beUI might not exist as an installable library                                                                 | It exists as a shadcn-compatible registry (`npx shadcn add @beui/<name>`), not an npm package. Used selectively (one component).                                                |

## 4. Missing prerequisites

None that block the MVP. For later milestones: an AWS account/SES identity, a Cloudflare account (Workers, D1, Queues) and a decision on authentication. None of these are referenced by code today.

## 5. Files added (all new)

- Tooling: `package.json`, `vite.config.ts`, `tsconfig*.json`, `.oxlintrc.json`, `.prettierrc`, `playwright.config.ts`, `components.json`, `index.html`, `public/favicon.svg`
- `src/domain/*` — types
- `src/application/*` — use cases and reducer (+ tests)
- `src/infrastructure/render/*` — compile, evaluate, render, worker, client, preview document, worker hardening, Prism guard (+ tests)
- `src/infrastructure/templates/*` — three sample templates and the registry with Zod schemas
- `src/infrastructure/validation/zodPropsValidator.ts`, `src/infrastructure/session/sessionStore.ts`, `src/infrastructure/providers/emailProvider.ts`
- `src/presentation/**` — hooks, layout, studio panels, shared components (+ tests)
- `src/components/ui/*` (shadcn), `src/components/motion/animated-badge.tsx` (beUI; still there, but reimplemented on CSS keyframes in phase 6 of the visual-editor work — the `motion` dependency was removed, see the ADR-4 update), `src/lib/*`
- `e2e/studio.spec.ts` — browser tests
- `docs/*` and this file

## 6. Implementation sequence that was followed

1. Verify toolchain and package versions; scaffold Vite + React + TypeScript.
2. Tailwind v4, `@/` alias, shadcn/ui init (radix base, neutral palette), add components.
3. Prove the risky part in Node: sucrase compile → whitelisted `require` → React Email render.
4. Write domain types, then the render pipeline, templates, validation, session store, provider.
5. Unit tests for every pure module; fix what they found.
6. Presentation layer: hooks, panels, dialogs, page; design tokens.
7. Production build; Playwright E2E in headless Chromium; fix the Prism worker crash and locator issues.
8. Add beUI's animated badge for validation/loading state transitions (reduced-motion aware). _Later: `motion` was dropped and the same gesture rewritten in CSS; see the ADR-4 update in `docs/DECISIONS.md`._
9. Documentation, formatting, final checks.

## 7. Validation commands

```bash
npm run typecheck        # tsc -b --noEmit
npm run lint             # oxlint
npm test                 # vitest: 47 unit/component tests AT THE TIME
npm run build            # production build (also type-checks)
npx playwright install chromium   # once
npm run test:e2e         # 8 browser tests against the production build AT THE TIME
```

All of the above passed as of the end of the MVP work. The counts are the ones from that day and are
not updated here: on 2026-09-19 the same commands run **755 unit and component tests** and **58
browser tests**, and the gate to run is `npm run check` (typecheck, lint, `prettier --check` and the
unit tests in one go), followed by `npm run db:migrate` before `npm run dev`. `README.md` has the
current list.
