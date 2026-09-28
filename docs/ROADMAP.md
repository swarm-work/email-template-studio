# Roadmap and backlog

Deferred on purpose. Nothing still listed as backlog below is implemented, simulated or wired.

Last checked against the code on **2026-09-19**, after the visual-editor and persistence work
(phases 1 to 9 of the visual-editor plan). That work delivered M3 and part of what M4 will need, so
the milestone table and the backlog below both moved; the items it finished have been struck out
rather than left to read as future work.

The step-by-step build and Cloudflare migration plan for M2 onwards is `docs/PLAN.md` (phases 0 to 5, decisions, risks). The current, verified order of work is `docs/PRIORITIES.md` (2026-09-19); when it and this file disagree, PRIORITIES wins. This file stays the short list of what is in and out of scope.
The revised order (2026-09-09): deploy the foundation on Cloudflare first (PLAN.md phase 0 and 1), then build each feature as a vertical slice. The detailed, feature-by-feature plan for the dashboard screens (Overview and Logs, Domains and DNS, API keys and webhooks, Projects Hub) and the multi-project hierarchy is `docs/FEATURE_PLAN.md`. Its phases map onto the milestones below: phase 0 to 5 are the UI over seeded data, phase 6 is M2 to M6.

## Milestones

| Milestone | Goal                                               | Notes                                                                                                                                                                                                                                                                                                                                                                                 |
| --------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 (done) | Local studio: edit, validate, preview, diagnostics | This repository (PLAN phase 0 deploys it as-is)                                                                                                                                                                                                                                                                                                                                       |
| M2        | Test-email sending through a server-side provider  | Local half done (`server/`, see SENDING.md). Deployed half = PLAN phase 1: Cloudflare Access + SES via aws4fetch in the Worker; allow-listed recipients                                                                                                                                                                                                                               |
| M3 (done) | Persistence                                        | **Delivered.** Templates and immutable versions live in Cloudflare D1 behind `/api/templates` (ADR-21, ADR-22); the studio creates, saves, renames and deletes through the repository port; uploaded images live in R2. Drafts stay in `sessionStorage` on purpose (ADR-10). `registry.ts` is now `STARTER_TEMPLATES`, used only to generate the seed migration and by tests (ADR-23) |
| M4        | Publishing, rollback and version restore           | PLAN phase 3: a real "publish" with environment targets and an approval step, plus **restoring an older version** and **rolling back** a published one. The read-only `Version history` dialog (phase 9) is what a restore button would sit next to; the simulated Publish that used to stand in for all of this was deleted in phase 2                                               |
| M5        | Access control                                     | Sign-in is Stytch (ADR-31, delivered). Workspaces and API keys are `docs/PLATFORM_PLAN.md` slices 1 and 3                                                                                                                                                                                                                                                                             |
| M6        | Delivery pipeline                                  | `docs/PLATFORM_PLAN.md` slices 2, 4 and 5: one recorded send path, SES events in through SNS, outbound webhooks from a D1 outbox with a Cron Trigger (no Queues on the Free plan)                                                                                                                                                                                                     |

## Backlog (from the MVP non-goals)

- Amazon SES integration beyond local test sends: Worker deployment, auth, bounce/complaint handling (M2)
- Cloudflare Queues and dead-letter queues (M6)
- ~~D1 production persistence (M3)~~ — delivered; the remaining half is running `npm run db:migrate:prod` against a real database on the right account
- Authentication and API-key management (M5)
- Production publishing and template approvals (M4)
- Version **restore** and rollback (M4). The history itself exists: every save writes an immutable row and the studio's overflow menu lists them read-only
- Collaborative editing
- AI-generated email content
- Attachments
- Marketing campaigns, contact management, customer-managed domains
- Advanced deliverability analytics (SPF/DKIM/DMARC checks, spam scoring, link checking) — the diagnostics panel already reserves labelled placeholder rows

**No longer out of scope:** visual email building. It used to read "drag-and-drop email building" in
the list above; that line is gone, and the studio now has a visual canvas built on
`@react-email/editor`, with its own template kind, its own starter, its own lazily loaded chunk and a
one-way conversion to TSX. The reasoning, and what was bought and given up, is **ADR-18** (and
**ADR-28** for the conversion) in `docs/DECISIONS.md`. `docs/PLAN.md` §2 carried the same "out of
scope" line and was corrected with it.

## Smaller improvements

Done in the visual-editor work (kept here, struck out, so nobody re-plans them):

- ~~Create a new template from the UI~~ — `CreateTemplateDialog`, `POST /api/templates`
- ~~Plain-text rendering tab~~ — both pipelines return HTML and text from one render (ADR-25)
- ~~Dark theme toggle~~ — System / Light / Dark in the header; the email stays light (ADR-29)
- ~~Code-split the editor~~ — the visual editor is lazy and a code template never fetches it
- ~~Keyboard shortcuts with `<Kbd>` hints~~ — one `SHORTCUTS` array drives the card, the footer strip and the dialog
- ~~Export rendered HTML to a file~~ — Download HTML and Download plain text, in the overflow menu and the preview toolbar

Still open:

- Type-aware editor hints for TSX (TECH_DEBT #4)
- Code-split the **render worker** (TECH_DEBT #1); the editor half is done
- A theme picker for visual templates (TECH_DEBT #35)
- A preview target for dark-mode emails (TECH_DEBT #44)
- Restoring an older version from the history dialog (M4)
