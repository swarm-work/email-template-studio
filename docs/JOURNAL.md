# Project journal

A plain record of what happened, day by day, newest first. Add an entry at the top whenever
something is merged, deployed, decided or changed in AWS, Cloudflare or GitHub.

- **Plans** live in [PLATFORM_PLAN.md](PLATFORM_PLAN.md) and [BUILD_LANES.md](BUILD_LANES.md).
- **Ranked backlog:** [PRIORITIES.md](PRIORITIES.md).
- **Why things are the way they are:** [DECISIONS.md](DECISIONS.md).
- **Times** are Philippine time (UTC+8).

## Where we are now

| Area                                          | State                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Production sending                            | Live since 2026-09-30, to `echo@swarm.work` only, from `testing@swarm.camp`, no `[TEST]` prefix |
| Environments                                  | dev (sending off), staging (dry run), production (live), all deployed from `main` 8c84774       |
| Sign-in                                       | Stytch, Swarm team only (Test project)                                                          |
| Workspaces (slice 1)                          | Done                                                                                            |
| Send log, API keys, bounce handling, webhooks | Planned in round 2 (PR #34), not built yet                                                      |
| Legacy Worker                                 | Deleted 2026-09-30                                                                              |

## 2026-10-01

- **Decided:** round-2 decisions R1 to R6 answered "yes to all" (BUILD_LANES section 8.2):
  - R1: alarm mailbox is `ses-alerts@swarm.work`. It must exist before the AWS alarm setup.
  - R2: record six SES event types: Bounce, Complaint, Delivery, Reject, DeliveryDelay, RenderingFailure.
  - R3: Amazon's three test mailboxes join production's allowed recipients.
  - R4: the allowed-recipient list applies to every way of sending, including the future API.
  - R5: only admins create webhook endpoints. R6: production sender `Swarm <no-reply@swarm.camp>`.
- **Started:** this journal.
- **Waiting on you:** confirm the `ses-alerts@swarm.work` alias exists, approve the AWS setup batch
  (S0.1 to S0.6) and the three GitHub settings (SEC.1 to SEC.3), and merge PR #34.

## 2026-09-30

- **Merged:** #30 (team-only sign-in), #31 and #33 (session length follow-ups), #32 (live
  production sending; `[TEST]` only on dev and staging).
- **AWS:** a second key for the IAM user `email-studio-ses` was created and stored as production
  secrets. Production's key is `AKIAXTOJWDT7VYPBK545`.
- **DNS problem found and fixed:** the three `swarm.camp` DKIM records were lost when the domain
  moved to another Cloudflare account on 2026-09-29. They were re-added, and a duplicate DMARC
  record was removed.
- **Deployed** from `main` 8c84774: dev `e8331ca9`, staging `4cabd4a3`, production `f520c3f9`.
- **First live email:** sent from production to `echo@swarm.work`. SPF, DKIM and DMARC all PASS.
- **Legacy retired** (you approved): the old Worker `email-template-studio` was still sending to
  any address behind a shared password. Deleted: the Worker, its empty database, and a duplicate
  IAM policy. Its key `AKIAXTOJWDT75W2H53HC` is inactive; delete it on or after 2026-10-07.
- **Research:** the per-workspace sender is possible and partly built (assessment only, no code).
  Backlog progress report: webhooks, API keys and SNS events are building blocks only.
- **Opened:** PR #34, the round-2 plan (18 lanes, 5 waves, decisions R1 to R18).

## 2026-09-29

- **Merged:** #27 (account menu, no primitives bar), #28 (SES event reader and webhook signer,
  plus the SNS signature test), #29 (workspace follow-ups), #26 (build lanes plan).
- **Sign-in:** Google sign-in fixed with a Stytch custom claim. You turned off Stytch
  organisation creation, so strangers cannot make their own organisation.
- **Decided:** strangers must never get into the app. Sessions last about an hour without use.

## 2026-09-28

- **Merged:** #25, three named environments (dev, staging, production).
- **Decided:** `env.production` is production; deploy without R2 for now; Stytch on all three;
  dry run first, live later.
- **Found:** R2 is not enabled on the Cloudflare account, which had blocked every deploy since
  2026-09-19. Its bindings were removed so deploys work again.
- **Deployed:** dev, staging and production for the first time, with migrations 0001 to 0004.

## 2026-09-25

- **Asked:** plan webhooks, API keys and workspaces, with a webhook per workspace.
- **Merged:** #22, the platform plan (slices 0 to 6). #24, workspaces (slice 1).

## Decisions log

| Date       | Decision                                                                                                                                         | Where it is recorded        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| 2026-10-01 | R1 to R6 as recommended (mailbox, six event types, test mailboxes, one allow-list for every send path, admins-only endpoints, production sender) | BUILD_LANES 8.2 and 8.7     |
| 2026-09-30 | `[TEST]` prefix per environment; production sends live                                                                                           | ADR-41                      |
| 2026-09-30 | Retire the legacy Worker                                                                                                                         | This journal; DEPLOYMENT.md |
| 2026-09-29 | API keys: admins only                                                                                                                            | BUILD_LANES section 6       |
| 2026-09-29 | Session ends about an hour after last use                                                                                                        | ADR-31, STYTCH_LOG          |
| 2026-09-29 | Only the Swarm team may sign in                                                                                                                  | ADR-31                      |
| 2026-09-28 | Three environments; production is `env.production`                                                                                               | DEPLOYMENT.md               |
