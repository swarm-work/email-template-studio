# Build lanes: what gets built next, in what order, and what can run side by side

Written 2026-09-29. Four planners (one per lane) drafted this against the code on `main` (`99b2ca8`)
plus open PR #25, and a reviewer checked every plan against the code and against the other plans.
The corrections the reviewer made are already applied below. `docs/PLATFORM_PLAN.md` says **what**
each slice is; this file says **how the next three weeks of it are sequenced**.

Updated 2026-09-30: statuses refreshed against main `8c84774`; section 8 adds round 2, the next tasks.

## 1. The short version

| Lane | What it is for, in plain words                                                                  | Size         | Status (2026-09-30)                                                                                                       |
| ---- | ----------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| A    | Your dashboard and AWS work. No code                                                            | minutes each | steps 1 and 3 done; step 2 not confirmed (round 2 lane ST checks it); step 4 parked (R2); step 5 moved to round 2 lane S0 |
| U    | The UI agent's pull request: account menu, no primitives row, switcher on narrow screens        | half a day   | done, PR #27                                                                                                              |
| B1   | Clean up the workspace feature that already shipped: lockout guard, email case, a build leak    | about 5.5 h  | done, PR #29 (plus: who may create a workspace)                                                                           |
| B2   | Every test email leaves a record, a Logs page shows them, and a per-workspace do-not-email list | about 25 h   | not started; round 2 lane B2                                                                                              |
| C    | Three stand-alone tools the email-events and webhook slices will need later                     | about 4.5 h  | done, PR #28; spike passed, so SNS; ADR-36 is written by round 2 lane S0                                                  |
| D    | Real API keys, so the app backend or Attio can send through the studio                          | about 19 h   | not started; round 2 lanes D-1 and D-2                                                                                    |

Total hands-on work is about 55 hours. The longest chain is PR #25, then B2, then the second half of D:
about 37 hours. With lanes side by side that is roughly 5 to 6 working days; one lane at a time, about 8.

Left from this table: B2 and D, about 45 hours. Section 8 re-plans them with slices 4 to 6.

**None of these lanes makes production send real email.** That stays a separate decision (section 7) (taken 2026-09-30, ADR-41).

## 2. The suppression list, and why there are two

There are **two** do-not-email lists, and they do different jobs.

1. **AWS's account-level list** (already on, currently empty). AWS fills it by itself: when an address
   hard-bounces (it does not exist) or the recipient clicks "Report spam", AWS adds it. From then on,
   AWS does not even try to deliver to that address. It still answers the studio "OK", so today the
   studio cannot tell the difference. Salesforce analogy: org-wide bounce handling, a safety net you do
   not manage.
2. **The studio's own list, per workspace** (built in B2). The studio checks it **before** calling AWS
   and refuses with a clear "suppressed" message, so a person sees why. In slice 4 the studio fills it
   automatically from AWS's bounce and complaint events, and an admin can remove an entry. Salesforce
   analogy: the Email Opt Out checkbox on a contact.

Why both: AWS's list protects the sending reputation (AWS reviews an account at 5% bounces or 0.1%
complaints and can pause it at 10% or 0.5%, which would stop invoices too). The studio's list is what
lets a human see and fix a refusal.

## 3. The lanes, step by step

Each step is one bounded action. "See it" is how you can tell it worked.

### Lane A: you, no code

1. **Stytch hosts.** Done 2026-09-29 (authorised domains and `/authenticate` redirect URLs for the three Workers).
2. **Google sign-in.** Add the custom claim template in the Stytch **Test** environment:
   `{ "email": {{ member.email_address }} }`, save, then sign in again with Google. See it: Google
   sign-in opens the studio instead of "carries no email address". 5 min. **Not confirmed done; round 2 ST.1 checks it.**
3. **Second access key** on the IAM user `email-studio-ses` (profile `swarm-main`), for production's
   live sending. Only when you decide production goes live (decided 2026-09-30, ADR-41). 10 min. **Done 2026-09-30:** key `AKIAXTOJWDT7VYPBK545`, used for the first live send.
4. **R2.** Parked as a placeholder until R2 is activated on the account (TECH_DEBT #48).
5. **SES events destination.** Waits for lane C's spike: then add an event destination (SNS or
   EventBridge) to the existing `my-first-configuration-set`. 20 min. **The spike passed (PR #28), so SNS. Moved to round 2 lane S0, task S0.4.**

### Lane U: the UI agent (separate Opus 5.5 session, Herdr tab "ui-agent (opus 5.5)") (merged as PR #27)

One draft PR against `main`:

1. Remove the code editor's Primitives row.
2. Replace the header's theme buttons, avatar and Sign out with one account dropdown: name, a dark/light
   switch, Sign out. System mode stops being a visible choice; ADR-29 gets an update note.
3. Make the workspace switcher (the only way to Settings and New workspace) reachable on screens
   narrower than 1280px. **Moved here from B1**, because it is the same header row.

### Lane B1: slice 1 follow-ups (one PR, three commits, about 5.5 h) (merged as PR #29)

1. **Lockout guard on the workspace settings PATCH.** Clearing or changing the linked Stytch
   organisation must be refused with `409 last-admin` when no named member is an admin. A new check,
   because the existing `lastAdminProblem` returns early exactly when an organisation is set. 45 min.
   See it: a new test in `server/workspaceRoutes.test.ts`.
2. **Case-insensitive member emails.** Lower-case the address once, in both workspace stores and the
   create route, so `Jane@swarm.work` and `jane@swarm.work` are the same person. 45 min. See it: a new
   test adds `Jane@Swarm.Work` and signs in as `jane@swarm.work`.
3. **Commit 1** (security fixes). `npm run check` green. 10 min.
4. **Settings page test.** A new `WorkspaceSettingsPage.test.tsx`: the page renders, an editor sees it
   read-only. 1 h.
5. **Small fixes:** give the two settings sections distinct keys, fix the stale comment on the template
   API's default URL, and correct the "slugs are not enumerable" claim (creating a workspace answers
   `409 slug-taken`, which does reveal a slug) in `docs/PLATFORM_PLAN.md` and `docs/LEARNING.md`. 30 min.
6. **Commit 2.** 10 min.
7. **Stop the build copying `.dev.vars` (with AWS keys) into `dist/`.** First delete it at the end of
   `npm run build`, **then** add a guard in `scripts/check-worker-bundle.mjs` that fails the build if it
   ever comes back (this order, or every build fails until the delete lands). 50 min. See it:
   `ls dist/email_template_studio/.dev.vars` says "No such file".
8. **Docs:** the AWS profile is `swarm-main`, and the rollback table says `npm run deploy:<env>` (a
   plain `wrangler deploy` now follows the last build, so "edit a var and deploy without rebuilding"
   no longer works). 20 min.
9. **Commit 3, open the PR.** 20 min.

### Lane C: three stand-alone tools (about 4.5 h) (merged as PR #28)

1. **Spike: can a Worker check an AWS SNS signature?** Built **outside** the repo (the repo's format and
   lint checks cover every folder). AWS's published example message has a fake signature, so make a
   test key and self-signed certificate with `openssl`, sign a message the SNS way, and ask a throwaway
   Worker to verify it. 1.5 h. See it: `verified: true` for the good message, `verified: false` for a
   tampered one. **Pass** means slice 0 uses SNS. **Fail** means slice 0 uses EventBridge (the plan's
   only fallback). The verdict goes into the C pull request's description. **Verdict: pass** (SignatureVersion 2 verifies with `X509Certificate`; tested in local `wrangler dev` only).
2. **SES event parser** (`server/sesEvents.ts` + tests). Turns AWS's event messages into the plan's
   `email.*` names. AWS has **ten** event types (including `Subscription`, which we ignore), the
   rendering-failure value is `Rendering Failure` with a space, and the delay detail key is
   `deliveryDelay`. 2 h. See it: `npx vitest run server/sesEvents.test.ts`, one test per type.
3. **Webhook signer** (`shared/webhookSignature.ts` + tests). Stamps the webhooks we will send to
   customers (Standard Webhooks scheme) and checks them. Tested against the worked example Svix
   publishes (same algorithm; the Standard Webhooks spec itself gives no numeric example), vendored
   with its source link and date. 1 h. See it: `npx vitest run shared/webhookSignature.test.ts`.

The C pull request holds only new files. It can merge any time after PR #25.

### Lane B2: slice 2, one recorded send path (about 25 h)

1. **Move the send route into its own file, unchanged** (`server/sendRoutes.ts`), taking
   `applyTestSubjectPrefix` with it. That function already exists since ADR-41 and takes the
   per-environment switch as an argument. 2 h. See it: the same tests pass in their new file.
2. **Migration 0005 and the message store:** `email_messages` (one row per send: queued, then sent or
   failed) and `suppressions` (the per-workspace list). Store port, two adapters, one shared test suite.
   5 h. See it: `npx vitest run server/messageStore.test.ts` runs the suite on both adapters.
3. **Sender learns message tags** (`studio_message`, `studio_workspace`) so later AWS events can be
   matched back to a row. It sends **no** configuration-set name: B2 ignores the workspace field (decision 2 in section 6, decided 2026-09-29): `swarm.camp` already uses `my-first-configuration-set` by default, and IAM
   allows only that set. 1.5 h.
4. **`sendMessage()`**, the one function allowed to call AWS: check the do-not-email list, write the
   row, send, mark it sent or failed. 3 h.
5. **Switch the Send test button to the recorded path.** Server and browser change together: the route
   moves under the workspace, the header check becomes `x-studio-request`. 3 h. See it: send a test,
   it still works, and a row exists.
6. **History and do-not-email routes** (list, detail; admins can view and remove list entries). 2 h.
7. **Logs page** at `/w/<workspace>/logs`, with a "Logs" link in the header. Lane U has merged, so there is no wait. 4 h. See it: your test send appears as a row.
8. **Docs and ADR-39.** 2 h.
9. **Rollout,** per environment: `npm run db:migrate:<env>`, **then** `npm run deploy:<env>`, dev first.
   Staging (dry-run) and production (configured live by ADR-41) will show a new row; dev has sending off. 2 h.

Refreshed in section 8, lane B2 (two additions: the allow-list moves into `sendMessage()`, and a guard test).

### Lane D: slice 3, API keys (about 19 h, in two halves)

**First half, can start now** (only new files, until B2 merges):

1. **Migration `0006_create_api_keys.sql`**, named 0006 from day one (B2 owns 0005). 45 min.
2. **Real key generation** in `shared/apiKeys.ts`: `st_live_…` / `st_test_…`, stored only as a hash. 30 min.
3. **Key store:** port, two adapters, shared test suite. 2 h.
4. **Key sign-in check** for `Authorization: Bearer st_…`, tested on its own. 1.5 h.
5. **Rate-limit probe:** you run one deploy of the dev Worker from a throwaway branch to learn whether
   the Workers Free plan allows the Rate Limiting binding, then redeploy dev from `main`. 15 min of yours.
6. **`docs/API.md` draft**, authentication section. 45 min.

**Second half, after B2 merges:**

7. Wire the key store into the app, the key management routes (create shows the key once, list,
   revoke, rotate), admins only (decided 2026-09-29), and replace the mock keys card with the real table. 6 h.
8. `POST /api/v1/emails` and the two read routes, calling `sendMessage()`; the per-key rate limit
   (binding, or the in-memory limiter if the probe says no); the new error codes. 5 h.
9. Rollout: `db:migrate:<env>` (0006), then `deploy:<env>`, dev first. 1.5 h.

Split in section 8 into D-1 (steps 1 to 6) and D-2 (steps 7 to 9).

## 4. Order of play

1. **Merge PR #25** (the deploy scripts and config). **Done: PR #25 merged.** Every lane branches from the new `main`, because
   `main` squash-merges and a lane branched from #25's commit would carry it twice.
2. **Run side by side:** lane U (running), B1, C, B2 steps 1 to 6, and D's first half.
3. **Merge order:** U, then B1, then C (any time), then B2, then D's first half (rebased on B2), then
   D's second half. **U, B1 and C merged; B2 and D continue in section 8.**
4. **Every deploy:** `npm run db:migrate:<env>`, then `npm run deploy:<env>`; dev, then staging, then
   production.

## 5. Where the lanes touch the same files

- **`src/presentation/layout/GlobalHeader.tsx`:** lane U rewrites the right-hand side and the switcher;
  B2 adds a Logs link. U merges first.
- **`server/app.ts`, `worker/index.ts`, `server/node.ts`:** B2 moves the send route and adds a store; D
  adds another store and changes the auth middleware. D waits for B2 before touching them.
- **`shared/templateContracts.ts` (the error codes):** B2 adds one, D adds five. B2 first.
- **`src/App.tsx`, `e2e/studio.spec.ts`:** B2 (Logs route, send path) before D (keys).
- **Docs** (`DEPLOYMENT`, `PRIORITIES`, `PLATFORM_PLAN`, `TECH_DEBT`, `LEARNING`): each lane rebases just
  before its docs step. ADR numbers: B2 is ADR-39, D is ADR-40 (34 to 38 are reserved by
  `docs/PLATFORM_PLAN.md` section 3 and not yet written; 32, 33 and 41 are written).

## 6. Decisions only you can make, most urgent first

1. **Merge PR #25 now?** **Decided: PR #25 merged.** Recommended yes: every lane depends on it.
2. **The workspace "SES configuration set" setting.** **Decided: B2 ignores the field, 2026-09-29.** It is editable today, but IAM only allows the
   default set. Recommended: B2 ignores the field until it is needed, so a typo there cannot break
   sending. Alternative: honour it, and widen IAM each time a set is added.
3. **`409 slug-taken` reveals that a workspace slug exists.** **Decided: accepted, 2026-09-29.** Recommended: accept it (workspace names
   are not secret) and fix the docs. Alternative, later: auto-pick `acme-2`.
4. **Lane C spike:** **Decided: done; the spike passed.** test with a self-made certificate now (recommended), and if it fails go straight
   to EventBridge (the plan's only fallback).
5. **Who may create API keys?** **Decided: workspace admins only, 2026-09-29.** Recommended: workspace admins only.

Later, not blocking anyone yet:

- API sends: are visual templates plus merge fields enough, or does the app backend need code
  templates with fresh data per send (a server-side rendering slice)? Now section 8.7, R8.
- API sends need a from address IAM allows (today only `testing@swarm.camp`): widen it? Now section 8.7, R6.
- ~~When should production really send?~~ **Decided 2026-09-30: now**, to its one allow-listed address
  (ADR-41).
- Open and click tracking is **on** account-wide in SES (VDM engagement metrics), so links in every
  email are rewritten. Keep it, or turn it off for `swarm.camp` transactional mail? This changes which
  events lane C's parser will actually see. Now section 8.7, R10.
- ~~When the `[TEST]` prefix goes: for everyone, or as a per-workspace setting?~~ **Decided 2026-09-30:
  per environment** (ADR-41). `STUDIO_TEST_SUBJECT_PREFIX` is on for dev and staging and off for
  production. A per-workspace setting can still come with slice 2, on the same
  `applyTestSubjectPrefix` seam.

## 7. What is deliberately not in these lanes

- **Production live sending:** operator steps, `docs/DEPLOYMENT.md` "Turning live sending on".
- **Retiring the legacy top-level Worker:** done 2026-09-30. The Worker and its empty D1 database (`f270cbc3`) were deleted; its IAM key `AKIAXTOJWDT75W2H53HC` is inactive (delete on or after 2026-10-07); the redundant inline policy `ses-send-scoped` was deleted.
- **R2:** parked until it is activated.
- **Slice 4's live route and slice 5's dispatcher:** now planned in section 8.

## 8. Round 2 (written 2026-09-30): SES events, API keys and webhooks

Sections 1 to 7 were written on 2026-09-29. This section is the next plan. It was drafted on 2026-09-30 by three planners (one thinking about the critical path, one about risk, one about parallel work), merged into one plan, and checked against `main` at `8c84774` and against the live AWS (profile `swarm-main`, region `ap-southeast-2`), Cloudflare (account `d0fa6b3d`) and GitHub state, all read-only.

### 8.1 The short version

**None of these three things exists yet:**

1. Per-workspace **webhooks** (the studio calls your app when something happens to an email).
2. Per-workspace **API keys** (your app calls the studio to send an email).
3. **Bounce and complaint handling** (AWS tells the studio an email bounced, and the studio stops sending to that address).

What does exist: the workspaces feature (#24, #29), the Stytch team lock (#30), live sending on production to `echo@swarm.work` (#32), and two stand-alone tools from lane C (#28): the event parser `server/sesEvents.ts` and the webhook signer `shared/webhookSignature.ts`. No route uses either yet.

**Bounces reach an inbox the same day.** Lane S0 needs no code. It sets up alarms and an email for every bounce and complaint. You do not have to wait for any building.

**The three goals, as chains of work, in hours after this plan merges:**

| Goal                                 | Chain                                                              | Hours |
| ------------------------------------ | ------------------------------------------------------------------ | ----- |
| Bounces and complaints in the studio | B2, then E2                                                        | ~40 h |
| Real API keys                        | B2, then SND.3 (R6), then D-2 (D-1 beside B2; D-2 merges after E2) | ~41 h |
| Per-workspace webhooks               | B2, then E2, then D-2 and W1, then W2                              | ~72 h |

B2 comes first in all three chains. It is the critical path. The hours are build hours (B2 25.5, E2 14.5, SND.3 1.5, D-2 13.5, W2 18), with the waits for your review and merge left out. D-1 and E1 run beside B2, and W1 runs beside E2, so they add nothing.

**The lanes.** A lane is a bundle of tasks one builder can do alone. Hours marked `BL` in section 8.4 are taken from this file's earlier sections. Every other figure is an estimate.

| Lane | What it is for, in plain words                                                                      | Hours | Can start                                           |
| ---- | --------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------- |
| P    | This plan, plus making every present-tense doc match what runs today (one docs PR)                  | 6.75  | now (Claude writes it, you merge)                   |
| S0   | Alarms, the SES events topic, bounce emails in an inbox, ADR-36. Mostly AWS clicks, no code         | 3.4   | now                                                 |
| SEC  | Free GitHub protections, a rule that protects `main`, the CI account fix, IAM key clean-up          | 2.5   | now                                                 |
| S    | Local dev can never live-send by accident; backup scripts; one restore rehearsal                    | 3.25  | after P merges                                      |
| CIH  | CI hygiene, Dependabot, and the missing tests for `worker/index.ts` and `server/createSender.ts`    | 4.5   | after P merges                                      |
| B2   | Every send goes through one function and leaves a row; a Logs page shows the rows                   | 25.5  | after P merges                                      |
| D-1  | API keys, first half: table, token minting, key store, Bearer check. New files only                 | 5.75  | after P merges (beside B2)                          |
| E1   | Bounce handling, first half: the AWS signature check, event store core, status rule. New files only | 7.5   | after P merges (beside B2)                          |
| HDR  | The header says dev, staging or production and names the signed-in person (TECH_DEBT #47)           | 2.75  | after B2 merges                                     |
| SND  | Each workspace sends from its own address and display name                                          | 8.1   | after B2 merges and R6                              |
| E2   | Bounce handling, second half: the route AWS calls, the timeline, the live subscription              | 14.5  | after B2, D-1 and E1 merge                          |
| D-2  | API keys, second half: key routes, real keys card, `POST /api/v1/emails`                            | 13.5  | after B2, D-1 and SND.3 merge (R6); merges after E2 |
| W1   | Webhooks, first half: payload, delivery engine, store core. New files only                          | 10.5  | after E1 merges                                     |
| W2   | Webhooks, second half: tables, retry Cron, routes, UI                                               | 18    | after E2, D-2 and W1 merge                          |
| ST   | Production signs in against the Stytch LIVE project                                                 | 4.75  | wave 3, after R11                                   |
| H    | Hardening: audit trail, retention, auto-off for dead endpoints, real rate limits                    | 14    | H.1 port in wave 3, rest after W2                   |
| CI   | A push to `main` deploys dev; staging and production wait for your approval                         | 4.75  | wave 4, after CIH merges                            |
| R2   | Image uploads work again (TECH_DEBT #48)                                                            | 1.35  | any time after R16                                  |

**Words you will meet in this section:**

- **SNS topic:** an AWS mailbox for machines. AWS SES drops event messages into it, and it forwards each one to whoever subscribed (an email address, or a web address). Salesforce analogy: a Platform Event channel.
- **Configuration set:** a named bundle of SES settings that you attach to a sending identity or a single send. Ours is `my-first-configuration-set`, and it is the default for everything sent from `swarm.camp`.
- **Event destination:** the setting on a configuration set that says "send bounce, complaint and delivery events to this SNS topic".
- **Dead-letter queue (DLQ):** a holding box for messages that could not be delivered after every retry. Nothing is lost, and you can look at them later.
- **Outbox:** a database table of "things still to send". A worker reads it, tries each one, and marks it done or retries later. This is how webhooks survive a crash.
- **Cron Trigger:** Cloudflare runs a function of ours on a timer, like a Salesforce scheduled Apex job.
- **Contract suite:** one set of tests that runs unchanged against two implementations of the same interface (here, a real D1 database and an in-memory copy), so both must behave the same.
- **Allow-list:** the list of addresses the studio may send to. Today it holds `echo@swarm.work` on production.
- **Migration:** a numbered SQL file that changes the database. They run strictly in number order.
- **Deploy train:** one batch: back up, run every merged migration, then deploy dev, staging and production, in that order.
- **ADR:** an architecture decision record, one entry in `docs/DECISIONS.md`.

### 8.2 Your five moments

The plan batches everything that needs you into five moments. Between moments, Claude builds and you only review and merge. At most three code pull requests are open for review at once.

**Reply card: answer this first.** Reply "yes to all", or "yes except R2: all types". Each line is a decision from section 8.7 (`R1` to `R18` are the round-2 numbers).

- R1. Alarm mailbox: give me the address. Recommended: a shared alias read every day, such as `ses-alerts@swarm.work`, not a personal inbox.
- R2. SES events captured: the six deliverability types (Bounce, Complaint, Delivery, Reject, DeliveryDelay, RenderingFailure), not Open, Click or Send.
- R3. Production allow-list gains the three SES mailbox simulator addresses, permanently. This amends ADR-41 point 5.
- R4. The allow-list applies to every send path, including the API.
- R5. Only admins create webhook endpoints, like API keys.
- R6. Production sender `Swarm <no-reply@swarm.camp>`, address and display name per workspace, swarm.camp only, admins may change it. This amends ADR-41 point 5.

R7 to R18 can wait. R13 to R15 have safe defaults (the recommendations are used until you answer), so answer them by moment 2.

1. **Moment 1: today, about 1 hour, plus reading this PR.**
   1. Reply to the card above (5 minutes).
   2. Approve one AWS batch (S0.1 to S0.6) and click two SNS confirmation emails (20 minutes).
   3. Approve three GitHub settings (SEC.1 to SEC.3) (10 minutes).
   4. Merge P (this plan). It is docs only, so review is reading. S0.7 follows as a small docs PR.

   Result: alarms are live, and bounces and complaints reach an inbox today, before any code exists.

2. **Moment 2: closes wave 1.** You run deploy train 1 (task B2.9): back up, run migrations 0005 and 0006, then deploy B2's code. Dev first, then staging, then production. The S0.2 alarms must be live before production. You also run D.5's two probe deploys any time in wave 1.
3. **Moment 3: closes wave 2.** You run deploy train 2 (task E2.6): migration 0007, the SNS subscription (dev first, then production with the dead-letter queue), the simulator test, the IAM widening (SND.2), the settings edit (SND.6) and the cURL sends (D.9). You answer R3 first. After it: bounces in the studio, and real API keys.
4. **Moment 4: closes wave 3.** You run deploy train 3 (task W2.7): migration 0008 and the Cron Trigger, and you approve a throwaway receiver Worker. You also do ST.1 in the Stytch dashboard, put the Live token in your local file (ST.2), and run ST.4, the separate production deploy. You answer R5 before W2.4.
5. **Moment 5: closes wave 4.** You run deploy train 4 (task H.6): migration 0009. You also do the CI settings and secret (CI.1, CI.4), decide about R2, and delete the inactive IAM key on or after 2026-10-07 (SEC.4).

### 8.3 Waves

A wave is a batch of lanes that can be built at the same time. Each wave ends with one of your moments.

**How every code lane is built.** The same five steps, with an explicit model on every subagent (never the session model):

1. One **opus** spec author fixes the interfaces, the file split and the insertion points.
2. **sonnet** builders work in parallel on disjoint file groups (the Files column of 8.4 gives the groups).
3. **opus** reviewers, each with a different lens, read the finished branch.
4. One **opus** verifier checks every must-fix finding against the code. Only confirmed ones go on.
5. One **sonnet** fixer applies the confirmed fixes.

Every code PR ends with the comment-drift review (checks that comments still match the code). No lane skips it, whether or not its last task says so. Docs-only PRs do not need it.

| Lane                  | Opus spec scope                                  | Sonnet builders (file groups)                | Opus reviewer lenses                                                                  |
| --------------------- | ------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------- |
| B2                    | MessageStore port, message contracts, send order | send path, store and adapters, routes, UI    | correctness of status and suppression; tenant and allow-list security; tests and docs |
| D-1                   | Key format, hash storage, authenticator contract | table and store, token minting, Bearer check | security (secrets never stored or logged); tests and docs                             |
| E1                    | Verifier and status-rule contracts               | SNS verifier, event store core, status rule  | security (signature checks); correctness of event ordering                            |
| HDR                   | Environment variable and header props            | config and status route, header and page     | correctness; UI and accessibility                                                     |
| SND                   | Sender resolution and error-code ownership       | resolver and config, settings route and page | security (from-address limits); correctness; tests and docs                           |
| E2                    | Route order, exemption, idempotency              | route and wiring, timeline UI                | security (SNS trust, no addresses logged); correctness; Free-plan limits              |
| D-2                   | Key routes, v1 send contract, limiter move       | key routes and UI, v1 routes, limiter        | security (Bearer, scopes, rate limit); correctness; API docs                          |
| W1                    | Payload and delivery-engine contracts            | payload, delivery engine, store core         | correctness of retries; security (signing)                                            |
| W2                    | Outbox tables, Cron claim rule, route contracts  | tables and store, cron, routes, UI           | correctness under retries; security (secrets, admin-only); Free-plan limits           |
| S, CIH, CI, R2, ST, H | One short spec per lane, from its own task table | the file groups in its own table             | correctness, plus security for ST and H, and workflow safety for CI                   |

1. **Moment 1 and wave 0: today (you, about 1 hour; Claude writes P).** Lanes: P, S0, SEC.

   Four things happen now:
   1. Reply to the card in 8.2 (R1 to R6). R13 to R15 can wait until moment 2.
   2. Approve one AWS batch (S0.1 to S0.6) and click two SNS confirmation emails.
   3. Approve three GitHub settings (SEC.1 to SEC.3).
   4. Merge P, the plan plus doc refresh. S0.7 follows as a small docs PR.

   Result: alarms are live, and bounces and complaints reach an inbox today, before any code exists. None of this touches code files.

2. **Wave 1: after P merges (about 3 to 4 working days).** Lanes: B2, D-1, E1, S, CIH.

   B2 is the critical path. Its opus spec fixes the MessageStore port (including `findByProviderMessageId`, `setStatus` and `addSuppression`) and `shared/messageContracts.ts`. Then four sonnet builders run on disjoint files: server send path, store, routes, UI.

   Beside it, new files only: D-1 (carries 0006), E1, S and CIH. D.5's throwaway probe deploy can happen any time.

   Merge order: S, CIH, B2, D-1, E1. At most three code PRs in review at once.

   Moment 2 closes the wave with deploy train 1: backup, then migrations 0005 and 0006, then B2's code; dev, staging, production. The S0.2 alarms must be live before production.

3. **Wave 2: after B2 and D-1 merge and train 1 is out (about 3 days).** Lanes: HDR, SND, E2, D-2, W1.

   B2's `sendMessage`, store and Logs page unblock four code lanes at once. One wave-2 opus spec fixes their insertion points in `server/app.ts`, `worker/index.ts`, `server/config.ts` and `wrangler.jsonc`, and who owns which error code (SND owns `from-not-allowed`, D-2 owns the rest).

   Merge order: HDR, SND, E2, D-2 (rebased on E2), then W1. E2 goes before D-2 so bounce feedback and auto-suppression are live before a new send path exists.

   Moment 3 closes the wave with deploy train 2: 0007, the SNS subscription (dev first, then production with the DLQ), the simulator test, the SND.2 IAM widening, and the D.9 cURL sends. After it: bounces in the studio, and real API keys.

4. **Wave 3: after slice 4 is live (about 2 to 3 days).** Lanes: W2, ST.

   W2 needs `message_events` (0007) and E2's route to hook into. It follows D-2 because both edit `ApiKeysPage`. H.1's port and in-memory adapter can be built now as new files.

   ST is dashboard work plus a small build change, in parallel.

   Moment 4 closes the wave with deploy train 3 (0008 and the cron) and ST's separate production deploy. After it: per-workspace webhooks.

5. **Wave 4: hardening and later side work.** Lanes: H, CI, R2, SEC.

   None of this moves bounces, keys or webhooks forward:
   - H: slice 6 hardening (0009, retention in the existing minute cron, auto-deactivation, limiters).
   - CI: deploys armed in the order CI.1, CI.2, CI.3, then CI.4.
   - R2: whenever uploads are wanted.
   - SEC: SEC.4 (on or after 2026-10-07; it can ride on any earlier moment), SEC.5 and SEC.6.

   Moment 5 closes the wave with deploy train 4 (0009).

### 8.4 The lanes, task by task

Column "Hours": `BL` means the figure comes from this file's sections 1 to 7; all others are estimates. "Needs you" says what only you can do.

#### Lane P: Round-2 plan and doc refresh (one docs PR)

Goal: you review and merge this plan before any building starts, as with PR #22 and PR #26. The same PR makes every present-tense doc match what runs today, after the legacy retirement.

| #   | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Files                                                            | Hours | Depends on | Needs you  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----- | ---------- | ---------- |
| P.1 | Refresh the status of lanes A, U, B1, B2, C and D in this file, and add section 8 (lanes, waves, task tables, merge order, conflict map, decisions, risks, ADR reservations)                                                                                                                                                                                                                                                                                                              | docs/BUILD_LANES.md                                              | 2.5   | none       | Merge only |
| P.2 | Mark done items, add the 2026-09-30 callout, and point section 3.0 at section 8.5 as the one round-2 order; point open items at the round-2 lanes                                                                                                                                                                                                                                                                                                                                         | docs/PRIORITIES.md                                               | 1.5   | none       | Merge only |
| P.3 | Legacy retirement facts: rewrite the DEPLOYMENT.md "Where it runs today" table and the callout under it, and fix every claim that the legacy Worker exists or is limited to one address; same for HANDOVER.md and README.md status. Also fix the DEPLOYMENT.md local row (`npm run dev` is a live sender when `.dev.vars` holds keys) and the SENDING.md lines that still name the shared password gate and future-tense "live from its first deploy"                                     | docs/DEPLOYMENT.md, docs/HANDOVER.md, docs/SENDING.md, README.md | 1.5   | none       | Merge only |
| P.4 | TECH_DEBT: update #19 and #47, strike #50, add #52 (inactive key), #53 (top-level database_id kept for local state), #54 (top-level vars live-send locally), #55 (sender and IAM limited to testing@swarm.camp)                                                                                                                                                                                                                                                                           | docs/TECH_DEBT.md                                                | 0.5   | none       | Merge only |
| P.5 | `wrangler.jsonc` comment-only edits: header, top-level d1, r2 and vars comments, env.production send-posture comment. No value changes                                                                                                                                                                                                                                                                                                                                                    | wrangler.jsonc                                                   | 0.25  | none       | Merge only |
| P.6 | PLATFORM_PLAN: a status line per slice; section 2 becomes a historical snapshot (d9c01e8); nine event types become ten; tracking is on (VDM); slice 0 steps 3 and 5, and the configuration-set half of step 4, are superseded by the default set (the FromAddress widening is SND.2), and step 1 notes the legacy Worker was deleted; slice 2 says B2 sends no configuration set and the allow-list moves into `sendMessage()`; event-type wording says "recommends" until R2 is answered | docs/PLATFORM_PLAN.md                                            | 0.5   | none       | Merge only |

Migration: none. ADR: none (reserves 42 to 45 in section 8.9).

#### Lane S0: Slice 0 remainder: alarms, SES events topic, inbox visibility, ADR-36

Goal: today, before any code, (1) account-level bounce, complaint and volume alarms reach a mailbox someone reads, (2) SES publishes the event types chosen in R2 (recommended: six deliverability types) to one SNS topic, (3) bounce and complaint notifications reach the same inbox, and (4) the setup is committed and recorded as ADR-36.

| #    | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Files                                                                                                                  | Hours     | Depends on                       | Needs you                                           |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------- | -------------------------------- | --------------------------------------------------- |
| S0.1 | Create SNS topic `studio-ses-alarms` (alarms only) with an email subscription to the R1 mailbox                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | AWS SNS (swarm-main, ap-southeast-2)                                                                                   | 0.25      | R1 (mailbox)                     | Approve the AWS write; click the confirmation email |
| S0.2 | CloudWatch alarms on the account-level AWS/SES metrics, missing data = not breaching, actions to `studio-ses-alarms`: Reputation.BounceRate warning at 0.025 and critical at 0.05; Reputation.ComplaintRate warning at 0.0005 and critical at 0.001; an hourly Send ceiling (recommended 200) to catch a leaked key or a loop. Test each alarm with `set-alarm-state`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | AWS CloudWatch                                                                                                         | 0.5       | S0.1                             | Approve the AWS write; confirm the hourly ceiling   |
| S0.3 | Create SNS topic `studio-ses-events` with SignatureVersion 2. Topic policy: only `ses.amazonaws.com` may publish, conditioned on `aws:SourceAccount` and the configuration set's `aws:SourceArn`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | AWS SNS                                                                                                                | 0.25      | none                             | Approve the AWS write                               |
| S0.4 | Add event destination `studio-events` on `my-first-configuration-set` pointing at `studio-ses-events`. Types: BOUNCE, COMPLAINT, DELIVERY, REJECT, DELIVERY_DELAY, RENDERING_FAILURE. Warning: this set is swarm.camp's identity default, so ALL swarm.camp mail emits events. BL: lane A step 5 (20 min)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | AWS SES v2                                                                                                             | 0.33 (BL) | S0.3; R2 (event types)           | Approve the AWS write                               |
| S0.5 | Interim inbox visibility until slice 4 is live. Add an email subscription on `studio-ses-events` to the R1 mailbox, with FilterPolicyScope MessageBody and filter `{"eventType":["Bounce","Complaint"]}`, so only bounces and complaints arrive, never every Delivery. Keep it as a backup after E2 ships, or remove it then                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | AWS SNS subscription                                                                                                   | 0.25      | S0.4; R1                         | Approve; click the confirmation email               |
| S0.6 | Prove the pipe with the CLI (it bypasses the Worker allow-list): `aws sesv2 send-email` from testing@swarm.camp to success@, bounce@ and complaint@simulator.amazonses.com. Check that NumberOfMessagesPublished rises on the topic and that exactly two notifications (bounce, complaint) reach the inbox. Simulator mail does not count toward reputation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | AWS SES (CLI)                                                                                                          | 0.33      | S0.5                             | Approve the three sends                             |
| S0.7 | Small docs PR with four parts. (1) ADR-36 in DECISIONS.md: SNS, not EventBridge; the PR #28 spike verdict and its caveats (local wrangler dev only, no real SigningCertURL fetch, SubscriptionConfirmation untested; the deployed check is E2.6); the six types instead of PLATFORM_PLAN's "all nine"; the shared-default consequence; the separate alarm topic. (2) `infra/sns-studio-ses-events-policy.json` and `infra/cloudwatch-alarms.md` with the exact CLI. (3) A DEPLOYMENT.md section "SES events and alarms": topic ARNs, and how to undo (`delete-configuration-set-event-destination`, `delete-alarms`). (4) A "Stop sending now" card, fastest first: 1. deactivate `AKIAXTOJWDT7VYPBK545`, which stops only the studio; 2. `npx wrangler rollback --name email-template-studio-production`; 3. `STUDIO_SEND_DRY_RUN` "true" plus `deploy:production`. Never pause `my-first-configuration-set` or account sending: that stops ALL swarm.camp mail | docs/DECISIONS.md, docs/DEPLOYMENT.md, infra/sns-studio-ses-events-policy.json (new), infra/cloudwatch-alarms.md (new) | 1.5       | S0.2, S0.6; P merged (same docs) | Merge only                                          |

Migration: none. ADR: ADR-36 (written in S0.7; E2.5 adds the deployed-verification update note).

#### Lane SEC: Security and repo hygiene (settings, mostly no code)

Goal: turn on the free GitHub protections while the repo is public, protect `main`, remove the wrong-account CI foot-gun, and finish the IAM key clean-up.

| #     | Task                                                                                                                                                                    | Files                                                               | Hours | Depends on                | Needs you                              |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----- | ------------------------- | -------------------------------------- |
| SEC.1 | Turn on secret scanning, push protection, Dependabot alerts and Dependabot security updates. All are free on a public repo, and secret scanning covers the full history | GitHub settings                                                     | 0.25  | none                      | Approve the settings write (moment 1)  |
| SEC.2 | Ruleset on `main`: require a PR and the `check` status, block force-push and deletion, no required approvals (R14)                                                      | GitHub ruleset                                                      | 0.25  | R14 (approvals part only) | Approve the settings write (moment 1)  |
| SEC.3 | Set the `CLOUDFLARE_ACCOUNT_ID` repo variable to `d0fa6b3d72170539438800a907ec5323` (today `0f95923f`, the retired personal account). PRIORITIES 4.6                    | GitHub variables                                                    | 0.1   | none                      | Approve the GitHub write (moment 1)    |
| SEC.4 | On or after 2026-10-07: confirm `get-access-key-last-used` for `AKIAXTOJWDT75W2H53HC` still says 2026-09-18, then delete it. Strike TECH_DEBT #52                       | AWS IAM; docs/TECH_DEBT.md                                          | 0.1   | date 2026-10-07           | Approve the IAM delete                 |
| SEC.5 | Read the secret-scanning results. Rotate anything real. Then act on R13: go private, or scrub personal identifiers (PRIORITIES 4.4)                                     | README.md, docs/HANDOVER.md, docs/DEPLOYMENT.md, docs/PRIORITIES.md | 1.5   | SEC.1; R13                | R13; the visibility change or rotation |
| SEC.6 | Delete the stale unauthenticated Worker on the personal account `0f95923f` (4.3), or record that the account is unreachable (R18)                                       | none                                                                | 0.25  | R18                       | Only you can log in there              |

Migration: none. ADR: none.

#### Lane S: Safety quick wins for live production (one small PR plus one rehearsal)

Goal: a local dev server can never live-send by accident. Every migration has a backup command. The restore has been done once before 0005 reaches production (production D1 holds 5 real templates).

| #   | Task                                                                                                                                                                                                                                                                                                                                     | Files                                                                                                                                      | Hours | Depends on | Needs you                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ---------- | ------------------------------------------------------------------------------ |
| S.1 | Set the top-level wrangler vars to `STUDIO_SEND_DRY_RUN "true"`. That block now only drives local `npm run dev`, and `.dev.vars` can still override it on purpose. Update `.dev.vars.example`. Change `package.json`'s bare `deploy` message from "The top-level Worker is frozen" to "deleted". Strike TECH_DEBT #54. Run comment-drift | wrangler.jsonc (one value), .dev.vars.example, package.json, docs/TECH_DEBT.md, docs/DEPLOYMENT.md (local row: back to dry-run by default) | 0.75  | P merged   | PR review only                                                                 |
| S.2 | Add `db:backup:dev`, `db:backup:staging` and `db:backup:production` scripts (`wrangler d1 export STUDIO_DB --remote --env <env> --output backups/<env>-<timestamp>.sql`). Add `backups/` to `.gitignore`: after B2 the files hold recipient addresses. Add "backup before every migrate" to the pre-deploy checklist                     | package.json, .gitignore, docs/DEPLOYMENT.md                                                                                               | 1     | none       | PR review only                                                                 |
| S.3 | On dev: export, restore into a scratch D1, check `d1 time-travel info`, delete the scratch database. Run the remote RETURNING and 500 KB bound-parameter check (PRIORITIES 3.5, TECH_DEBT #28). Record the commands and timings in DEPLOYMENT.md and TECH_DEBT #28                                                                       | docs/DEPLOYMENT.md, docs/TECH_DEBT.md                                                                                                      | 1.5   | S.2        | Approve the Cloudflare writes (scratch D1 create and delete, one write to dev) |

Migration: none. ADR: none.

#### Lane CIH: CI hygiene and missing tests (no deploy changes)

Goal: the `check` job gets the missing hygiene. `worker/index.ts` and `server/createSender.ts` get tests, as a safety net before B2, E2, D-2 and W2 all edit `worker/index.ts`.

| #     | Task                                                                                                                                                                                                                                              | Files                                                                         | Hours | Depends on | Needs you      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----- | ---------- | -------------- |
| CIH.1 | Four changes: move `concurrency` to the check job only, so a deploy is never cancelled; pin `wranglerVersion` 4.130.0 in wrangler-action; add an `npm audit --audit-level=high` step, report-only at first; add `.nvmrc` (24) and align `engines` | .github/workflows/ci.yml, .nvmrc (new), package.json (engines only)           | 1     | none       | PR review only |
| CIH.2 | `.github/dependabot.yml`: monthly npm and github-actions updates, with minor and patch grouped                                                                                                                                                    | .github/dependabot.yml (new)                                                  | 0.5   | none       | PR review only |
| CIH.3 | Tests for `server/createSender.ts` (the no-send guarantee) and `worker/index.ts`. Add `worker/**/*.test.ts` to the Vitest include. Run comment-drift                                                                                              | server/createSender.test.ts (new), worker/index.test.ts (new), Vitest config  | 2.5   | none       | PR review only |
| CIH.4 | Remove the two dead eslint-disable comments. Correct or retire `.claude/agents/ui-overflow-fixer.md`                                                                                                                                              | the two files PRIORITIES section 5 names; .claude/agents/ui-overflow-fixer.md | 0.5   | none       | PR review only |

Migration: none. ADR: none.

#### Lane B2: One recorded send path (slice 2), refreshed against 8c84774

Goal: every send goes through `sendMessage()`. `sendMessage()` checks the environment allow-list and the per-workspace do-not-email list, then leaves an `email_messages` row with the SES message id and the tags `studio_message` and `studio_workspace`. A Logs page shows the rows. This is the critical path for all three goals.

| #     | Task                                                                                                                                                                                                                                                                                                                                                                              | Files                                                                                                                                                                                                                                                                     | Hours                                            | Depends on                                                           | Needs you                                  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- | ------------------------------------------ |
| B2.1  | Move `GET /api/send-test/status` and `POST /api/send-test` (`server/app.ts` lines 347 to about 540) into `server/sendRoutes.ts` unchanged, with `applyTestSubjectPrefix` (ADR-41). Keep the guard order                                                                                                                                                                           | server/app.ts, server/sendRoutes.ts (new), server/app.test.ts, server/sendRoutes.test.ts (new)                                                                                                                                                                            | 2 (BL)                                           | P merged                                                             | No                                         |
| B2.2  | Migration 0005 (`email_messages`, `suppressions`), additive only. MessageStore port, D1 and in-memory adapters, one contract suite, and `server/ulid.ts` (no new npm dependency). The port ALSO exposes `findByProviderMessageId`, `setStatus` (never moves backwards) and `addSuppression(workspaceId, address, reason, sourceEventId)`, so slice 4 does not reopen these files. | migrations/0005_create_email_messages.sql, server/ulid.ts, server/messageStore.ts, server/d1MessageStore.ts, server/inMemoryMessageStore.ts, server/messageStoreContract.ts, server/messageStore.test.ts (all new)                                                        | 5 (BL)                                           | opus spec fixes the port                                             | No                                         |
| B2.3  | The sender adds EmailTags `studio_message` and `studio_workspace` (values limited to `[A-Za-z0-9_-]`). It sends NO configuration-set name (decided: production uses swarm.camp's default set; B2 ignores the workspace field)                                                                                                                                                     | server/emailSender.ts, server/sesSender.ts, server/sesSender.test.ts                                                                                                                                                                                                      | 1.5 (BL)                                         | none                                                                 | No                                         |
| B2.4  | `sendMessage()`, in order: 1. the environment allow-list check (moved here from the route, so API sends obey it too; R4); 2. the suppression check (`recipient-suppressed`); 3. the queued row; 4. the send; 5. mark sent or failed, with the SES error text                                                                                                                      | server/sendMessage.ts (new), server/sendMessage.test.ts (new), server/sendRoutes.ts, shared/templateContracts.ts (`recipient-suppressed`)                                                                                                                                 | 3.5 (BL 3 h, plus 0.5 h for the allow-list move) | B2.2, B2.3; R4                                                       | No                                         |
| B2.4b | Guard test: it fails if any module other than `server/sendMessage.ts` calls `EmailSender.send`, so no later path can skip the allow-list and suppression checks                                                                                                                                                                                                                   | server/sendPathGuard.test.ts (new)                                                                                                                                                                                                                                        | 0.5                                              | B2.4                                                                 | No                                         |
| B2.5  | Switch the Send test button to the recorded path. The route moves to `/api/workspaces/:workspace/send-test`. The header `x-studio-send` becomes `x-studio-request` (`STUDIO_API_HEADER` in `shared/templateContracts.ts`). The send-test schemas move to `shared/messageContracts.ts`. Server and browser change together                                                         | server/sendRoutes.ts, server/app.ts, shared/messageContracts.ts (new), worker/index.ts, server/node.ts, src/infrastructure/providers/emailProvider.ts, src/presentation/studio/SendTestEmailDialog.tsx, src/presentation/hooks/useSendServerStatus.ts, e2e/studio.spec.ts | 3 (BL)                                           | B2.1, B2.4                                                           | No                                         |
| B2.6  | History routes (list, detail) and do-not-email routes (admins view and remove entries)                                                                                                                                                                                                                                                                                            | server/messageRoutes.ts (new), server/messageRoutes.test.ts (new), shared/messageContracts.ts, server/app.ts                                                                                                                                                              | 2 (BL)                                           | B2.2                                                                 | No                                         |
| B2.7  | Logs page at `/w/<workspace>/logs`, and a Logs link in the header. Lane U is merged, so there is no wait                                                                                                                                                                                                                                                                          | src/presentation/logs/\* (new), src/domain/message.ts (new), src/application/repositories/messageRepository.ts (new), src/infrastructure/messages/\* (new), src/App.tsx, src/presentation/layout/GlobalHeader.tsx                                                         | 4 (BL)                                           | B2.6 contract                                                        | No                                         |
| B2.8  | Docs and ADR-39: the ARCHITECTURE send path, LEARNING, and PRIORITIES 4.10 marked absorbed. Rebase on P first. Run comment-drift                                                                                                                                                                                                                                                  | docs/DECISIONS.md, docs/ARCHITECTURE.md, docs/LEARNING.md, docs/PRIORITIES.md, docs/SENDING.md, docs/TECH_DEBT.md                                                                                                                                                         | 2 (BL)                                           | B2.1 to B2.7                                                         | Merge only                                 |
| B2.9  | Deploy train 1, for each environment: `db:backup:<env>`, then `db:migrate:<env>` (0005 and 0006), then `deploy:<env>`. Order: dev, staging, production. Rollback: `wrangler rollback --name email-template-studio-<env>`. 0005 is additive, so the previous version keeps working                                                                                                 | none                                                                                                                                                                                                                                                                      | 2 (BL)                                           | B2 and D-1 merged; S.2, S.3 done; S0.2 alarms live before production | Yes: you run migrate and deploy (moment 2) |

Migration: `0005_create_email_messages.sql` (`email_messages`, `suppressions`). ADR: ADR-39.

#### Lane D-1: Lane D first half: API key foundations (slice 3)

Goal: new files only, beside B2: the `api_keys` table, token minting, the key store and the Bearer authenticator, each tested alone. It merges straight after B2, so 0006 follows 0005.

| #   | Task                                                                                                                                                                                 | Files                                                                                                                                              | Hours     | Depends on                   | Needs you                                      |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------- | ---------------------------------------------- |
| D.1 | Migration `0006_create_api_keys.sql`, numbered 0006 from day one                                                                                                                     | migrations/0006_create_api_keys.sql (new)                                                                                                          | 0.75 (BL) | none (merges right after B2) | No                                             |
| D.2 | `shared/apiKeys.ts`: `st_live_` and `st_test_` tokens, stored only as a SHA-256 hex hash, with a 12-character display prefix. `src/application/apiKeys.ts` stays untouched until D.7 | shared/apiKeys.ts (new), shared/apiKeys.test.ts (new)                                                                                              | 0.5 (BL)  | none                         | No                                             |
| D.3 | Key store: port, D1 and in-memory adapters, contract suite                                                                                                                           | server/apiKeyStore.ts, server/d1ApiKeyStore.ts, server/inMemoryApiKeyStore.ts, server/apiKeyStoreContract.ts, server/apiKeyStore.test.ts (all new) | 2 (BL)    | D.1, D.2                     | No                                             |
| D.4 | Bearer authenticator, tested alone: hash lookup, revoked and expired keys, `last_used_at` written at most once a minute                                                              | server/apiKeyAuth.ts (new), server/apiKeyAuth.test.ts (new)                                                                                        | 1.5 (BL)  | D.3                          | No                                             |
| D.5 | Rate-limit probe: one dev deploy from a throwaway branch with a `ratelimits` block. Then redeploy dev from `main` immediately. Record the result for D.8 and H.5                     | wrangler.jsonc on a throwaway branch only (never merged)                                                                                           | 0.25 (BL) | none                         | Yes: you run both deploys (any time in wave 1) |
| D.6 | `docs/API.md` draft, authentication section                                                                                                                                          | docs/API.md (new)                                                                                                                                  | 0.75 (BL) | none                         | No                                             |

Migration: `0006_create_api_keys.sql`. ADR: none in this half.

#### Lane E1: Slice 4 first half: SNS verifier, event store core, status rule (new files only)

Goal: the pure parts of "SES events in", built beside B2 with no migration, so E2 only adds the D1 adapter, the route, the wiring and the UI.

| #    | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Files                                                                                                                                             | Hours | Depends on | Needs you |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------- | --------- |
| E1.1 | `server/sns.ts` `verifySnsMessage(body, fetchCert)`: SignatureVersion 2 only; `SigningCertURL` must match `https://sns.ap-southeast-2.amazonaws.com/...pem`; canonical strings for Notification, SubscriptionConfirmation and UnsubscribeConfirmation; the parsed key is cached in module scope for 1 h; `fetchCert` is injected. Tests use self-made certificate fixtures (the PR #28 openssl method), plus tampered, wrong-host and SignatureVersion 1 cases | server/sns.ts, server/sns.test.ts, server/sns.fixtures.ts (all new)                                                                               | 4     | none       | No        |
| E1.2 | MessageEventStore port, in-memory adapter and contract suite: insert is idempotent on `source_id`; `listByMessage`. Types from PLATFORM_PLAN section 4                                                                                                                                                                                                                                                                                                         | server/messageEventStore.ts, server/inMemoryMessageEventStore.ts, server/messageEventStoreContract.ts, server/messageEventStore.test.ts (all new) | 2     | none       | No        |
| E1.3 | Pure `sesEventEffects(event, currentStatus)`. It returns three things: the next status (it never goes backwards: a Delivery arriving after a Complaint does not overwrite it, and bounced, complained, rejected and failed are terminal; there is also a multi-recipient rule); whether a suppression is due (a Permanent bounce, or any complaint); whether to enqueue a webhook dispatch                                                                     | server/sesEventEffects.ts (new), server/sesEventEffects.test.ts (new)                                                                             | 1.5   | none       | No        |

Migration: none (0007 is in E2). ADR: none (ADR-36 by S0.7).

#### Lane HDR: TECH_DEBT #47: real environment and signed-in user in the header

Goal: the header says dev, staging or production (from `STUDIO_ENVIRONMENT`, which no code reads today) and names the signed-in person. The `LIVE : Local` literal and the `ENVIRONMENT` constant go. Small, so it merges first in wave 2.

| #     | Task                                                                                                                                                                          | Files                                                                                                          | Hours | Depends on | Needs you |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----- | ---------- | --------- |
| HDR.1 | `server/config.ts` reads `STUDIO_ENVIRONMENT`. Return it from `GET /api/workspaces/:workspace/send-test/status` (the moved status route), with the shared schema              | server/config.ts, server/sendRoutes.ts, shared/messageContracts.ts                                             | 1     | B2 merged  | No        |
| HDR.2 | GlobalHeader shows the environment and the user. Remove `const ENVIRONMENT = 'Local'` from `App.tsx` and the prop from `ApiKeysPage`. Strike TECH_DEBT #47. Run comment-drift | src/presentation/layout/GlobalHeader.tsx, src/App.tsx, src/presentation/api/ApiKeysPage.tsx, docs/TECH_DEBT.md | 1.75  | HDR.1      | No        |

Migration: none. ADR: none.

#### Lane SND: Per-workspace sender (sender assessment option A, after B2 step 5)

Goal: each workspace sends from its own address and display name (stored as one mailbox string in the existing `default_from` column, so no migration). It is checked against `allowed_from_domain` and a server-side allowed-from list that mirrors IAM. Admins change it. Production stops sending as `testing@swarm.camp`.

| #     | Task                                                                                                                                                                                                                                                                                                                            | Files                                                                                                                                                                              | Hours | Depends on        | Needs you                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------- | ----------------------------------------------- |
| SND.1 | R6 and the sender questions (see R6)                                                                                                                                                                                                                                                                                            | none                                                                                                                                                                               | 0.1   | none              | Yes: decision (moment 1)                        |
| SND.2 | Widen `ses:FromAddress` on `SendOnlyAsTheStudioIdentity` to include the chosen address, keeping `testing@swarm.camp` for dev and staging. Mirror the change in `infra/ses-policy.json`                                                                                                                                          | AWS IAM; infra/ses-policy.json                                                                                                                                                     | 0.5   | SND.1             | Approve the IAM write (moment 3)                |
| SND.3 | `server/fromAddress.ts` `resolveFromAddress(workspace, requested?)`: domain check plus the `SES_ALLOWED_FROM` list. It owns the `from-not-allowed` error code. D.8 imports it                                                                                                                                                   | server/fromAddress.ts (new), server/fromAddress.test.ts (new), server/config.ts, shared/templateContracts.ts                                                                       | 1.5   | B2 merged; SND.1  | No                                              |
| SND.4 | `sendMessage` and the send-test route use the workspace sender, with `SES_FROM_ADDRESS` as the fallback. Settings page: a sender field (display name and address) with validation; PATCH stays admin-only. `SES_FROM_ADDRESS` and `SES_ALLOWED_FROM` per env in `wrangler.jsonc`. Run comment-drift                             | server/sendMessage.ts, server/sendRoutes.ts, server/workspaceRoutes.ts, shared/workspaceContracts.ts, src/presentation/workspace/WorkspaceSettingsPage.tsx (+test), wrangler.jsonc | 3.5   | SND.3             | No                                              |
| SND.5 | `docs/SENDING_POLICY.md` (PRIORITIES 4.8): identity per domain, transactional-only, suppression and allow-list first, who decides. Flag that the SES account record says MailType MARKETING. Also ADR-42 and SENDING.md, and an ADR-41 update note if R6 changes the sender (ADR-41 point 5 says it stays `testing@swarm.camp`) | docs/SENDING_POLICY.md (new), docs/SENDING.md, docs/DECISIONS.md                                                                                                                   | 2     | SND.4             | Merge only                                      |
| SND.6 | Ship in deploy train 2 after SND.2. Set production's workspace sender in Settings, and send one production test to `echo@swarm.work`                                                                                                                                                                                            | none (production D1 row via the UI)                                                                                                                                                | 0.5   | SND merged; SND.2 | Yes: deploy go and the settings edit (moment 3) |

Migration: none (uses the 0004 `default_from` and `allowed_from_domain` columns). ADR: ADR-42 (reserved).

#### Lane E2: Slice 4 second half: `POST /api/webhooks/ses`, timeline, subscription

Goal: a bounce or complaint on a studio message appears as `email.bounced` or `email.complained` in Logs within a minute, adds a suppression row in that message's workspace, and makes the next send to that address refused. Events for mail the studio did not send get 200 and are dropped. Failed deliveries go to a dead-letter queue.

| #    | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Files                                                                                                                                         | Hours | Depends on                   | Needs you                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------- | ------------------------------------------------------------------------------- |
| E2.1 | Migration 0007 `message_events` (additive, `source_id` unique) plus `D1MessageEventStore`. The contract suite runs on both adapters. D1 enforces foreign keys, so 0005 must be present                                                                                                                                                                                                                                                                                                                                                                                                               | migrations/0007_create_message_events.sql (new), server/d1MessageEventStore.ts (new)                                                          | 1.5   | B2 and D-1 merged; E1 merged | No                                                                              |
| E2.2 | `POST /api/webhooks/ses`: exempt from session auth and the CSRF header, like `/api/session`; body capped at 256 KB; verify with `verifySnsMessage`; confirm a subscription only when `TopicArn` equals `SNS_TOPIC_ARN`, with a `SubscribeURL` host check; parse with `server/sesEvents.ts`; match by `provider_message_id`, then by the `studio_message` tag; insert idempotently; apply `sesEventEffects` via `setStatus` and `addSuppression`; the enqueue hook is a no-op until W2; unknown messages: 200, a count in the log, no addresses logged, nothing stored                                | server/sesWebhookRoute.ts (new), server/sesWebhookRoute.test.ts (new)                                                                         | 4     | E2.1                         | No                                                                              |
| E2.3 | Wiring: mount the route and add the auth exemption; wire the stores in both runtimes; `SNS_TOPIC_ARN` var on env.dev and env.production (empty on staging, where the route answers 404); add bounce@, complaint@ and success@simulator.amazonses.com to env.production `SES_ALLOWED_RECIPIENTS` (R3)                                                                                                                                                                                                                                                                                                 | server/app.ts (mount and the exemption, next to the `SESSION_ROUTE` check), server/config.ts, worker/index.ts, server/node.ts, wrangler.jsonc | 1.5   | E2.2                         | R3                                                                              |
| E2.4 | The message detail route returns its events. The Logs drawer shows a timeline, and the status badges become real                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | server/messageRoutes.ts, shared/messageContracts.ts, src/domain/message.ts, src/presentation/logs/\*                                          | 3.5   | B2.6, B2.7 merged            | No                                                                              |
| E2.5 | Docs: the ARCHITECTURE event path, a DEPLOYMENT subscription runbook (dev first, DLQ, undo), a LEARNING entry, TECH_DEBT, the ADR-36 update note ("verified on a deployed Worker"), and an ADR-41 update note if R3 is yes (the simulator addresses join the allow-list). Run comment-drift                                                                                                                                                                                                                                                                                                          | docs/ARCHITECTURE.md, docs/DEPLOYMENT.md, docs/LEARNING.md, docs/DECISIONS.md, docs/TECH_DEBT.md                                              | 1.5   | E2.2 to E2.4                 | Merge only                                                                      |
| E2.6 | Deploy train 2, in order: 1. backup, migrate 0007 and deploy, for dev, staging and production; 2. subscribe the DEV URL (it confirms itself), `aws sns publish` one test, check `wrangler tail` for "verified" and CPU time under the Free plan's 10 ms, unsubscribe dev; 3. create the SQS queue `studio-ses-events-dlq` with a depth alarm to `studio-ses-alarms`; 4. subscribe the production URL with a longer delivery retry policy and redrive to the DLQ; 5. from the studio, send to the bounce and complaint simulators, and see the events, the suppression row, and the next send refused | AWS SNS and SQS; no repo files                                                                                                                | 2.5   | E2 merged; S0.3, S0.4        | Yes: you run migrate and deploy; approval for each SNS and SQS write (moment 3) |

Migration: `0007_create_message_events.sql`. ADR: ADR-36 update note.

#### Lane D-2: Lane D second half: key routes, real keys card, `POST /api/v1/emails`

Goal: admins create, list, revoke and rotate keys. The app backend or Attio sends with `Authorization: Bearer st_live_` or `st_test_` through `sendMessage()`, inside the environment allow-list. A test key records a row and never calls SES.

| #    | Task                                                                                                                                                                                                                                                                                                                    | Files                                                                                                                                                                                                                                                                                                                                                                               | Hours    | Depends on                                                | Needs you                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------- | -------------------------- |
| D.7  | Wire the key store and authenticator into the app. Key routes (create shows the key once, list, revoke, rotate), ADMINS ONLY (decided 2026-09-29). Replace the mock keys card with the real table. Switch imports to `shared/apiKeys.ts` and remove `src/application/apiKeys.ts`                                        | server/apiKeyRoutes.ts (new), shared/apiKeyContracts.ts (new), server/app.ts, worker/index.ts, server/node.ts, shared/templateContracts.ts, src/presentation/api/ApiKeysPage.tsx (+test), src/application/apiKeys.ts (removed), src/App.tsx, e2e/studio.spec.ts                                                                                                                     | 6 (BL)   | B2 and D-1 merged; rebase on HDR and E2 (merges after E2) | No                         |
| D.8  | `POST /api/v1/emails` plus `GET /api/v1/emails/:id` and the list, all calling `sendMessage()`: `from` comes from `resolveFromAddress` (SND.3); Idempotency-Key support; a per-key rate limit (the binding, or the in-memory limiter if D.5 said no); the new error codes; code templates answer `template-not-sendable` | server/v1Routes.ts (new), server/v1Routes.test.ts (new), server/rateLimit.ts (new: D.8 first moves `createRateLimiter` out of server/app.ts, and its tests out of server/app.test.ts, unchanged), server/app.ts, server/app.test.ts, worker/index.ts (passes the binding in), server/config.ts, shared/templateContracts.ts, wrangler.jsonc (ratelimits if D.5 passed), docs/API.md | 5 (BL)   | D.7; SND.3 merged; R8 answered before it is called done   | R8 (server-side rendering) |
| D.10 | ADR-34 (test mode is a key mode), ADR-35 (key storage), ADR-40 (lane D choices: admins only, the D.5 result, the allow-list applies). Finish API.md. TECH_DEBT row: code templates are not renderable server-side. LEARNING. Run comment-drift                                                                          | docs/DECISIONS.md, docs/API.md, docs/TECH_DEBT.md, docs/LEARNING.md                                                                                                                                                                                                                                                                                                                 | 1        | D.8                                                       | Merge only                 |
| D.9  | Deploy train 2: `deploy:<env>` (0006 was applied in train 1, which waits for D-1), dev first. Create one key and send once with cURL using an `st_test_` key, then once with `st_live_` to `echo@swarm.work`                                                                                                            | none                                                                                                                                                                                                                                                                                                                                                                                | 1.5 (BL) | D-2 merged                                                | Yes: you deploy (moment 3) |

Migration: none new (0006 shipped with D-1). ADR: ADR-34, ADR-35, ADR-40.

#### Lane W1: Slice 5 first half: payload, dispatcher, webhook store core (new files only)

Goal: the delivery engine and endpoint rules for per-workspace webhooks, tested with a fake fetch and an in-memory store, with no table yet.

| #    | Task                                                                                                                                                                                                                                                                                                                      | Files                                                                                                                         | Hours | Depends on | Needs you |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----- | ---------- | --------- |
| W1.1 | `server/webhookPayload.ts`: build the PLATFORM_PLAN 5.4 outbound body from a message and an event (pure, with tests)                                                                                                                                                                                                      | server/webhookPayload.ts (new), server/webhookPayload.test.ts (new)                                                           | 1.5   | E1.2 types | No        |
| W1.2 | `server/webhookDispatcher.ts` `deliverDispatch()`: sign with `shared/webhookSignature.ts`; 10 s timeout; success on 2xx; record status, latency and the first 4 KB of the response; backoff 1 m, 5 m, 30 m, 2 h, 12 h, then dead after attempt 5                                                                          | server/webhookDispatcher.ts (new), server/webhookDispatcher.test.ts (new)                                                     | 3     | none       | No        |
| W1.3 | WebhookStore port, in-memory adapter and contract suite: endpoint CRUD; `enqueue(event)` picks only active endpoints of the event's workspace that subscribe to the type, with a cross-workspace isolation test; `claimDue(now, limit)` with an atomic claim, so overlapping cron runs never double-send; `recordAttempt` | server/webhookStore.ts, server/inMemoryWebhookStore.ts, server/webhookStoreContract.ts, server/webhookStore.test.ts (all new) | 3.5   | E1.2 types | No        |
| W1.4 | `shared/webhookEndpoints.ts`: https only, rejects IP literals, localhost and private hosts, lists the event types, generates `whsec_` secrets                                                                                                                                                                             | shared/webhookEndpoints.ts (new), shared/webhookEndpoints.test.ts (new)                                                       | 1     | none       | No        |
| W1.5 | `docs/WEBHOOKS.md` draft: event types, payload, headers, verification in Node, Python and cURL, retry schedule                                                                                                                                                                                                            | docs/WEBHOOKS.md (new)                                                                                                        | 1.5   | none       | No        |

Migration: none (0008 is in W2). ADR: none (ADR-37 and ADR-38 in W2).

#### Lane W2: Slice 5 second half: per-workspace webhooks live

Goal: each workspace registers its own https endpoints (admins), each with its own `whsec_` secret and event types. Events are signed (Standard Webhooks) and tried at once in `waitUntil`. A one-minute Cron Trigger retries them through the D1 outbox, because the Free plan has no Queues. The mock webhook cards become real.

| #    | Task                                                                                                                                                                                                                                                                                                                                        | Files                                                                                                                                           | Hours | Depends on                   | Needs you                                                           |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------- | ------------------------------------------------------------------- |
| W2.1 | Migration 0008 (`webhook_endpoints`, `webhook_dispatches`) plus `D1WebhookStore`. The contract suite runs on both adapters                                                                                                                                                                                                                  | migrations/0008_create_webhooks.sql (new), server/d1WebhookStore.ts (new)                                                                       | 2     | E2 merged (0007); W1 merged  | No                                                                  |
| W2.2 | Hook into `sesWebhookRoute`: after the event is stored, enqueue, then `waitUntil(deliverDue())` for the first attempt                                                                                                                                                                                                                       | server/sesWebhookRoute.ts, server/sesWebhookRoute.test.ts                                                                                       | 1     | W2.1                         | No                                                                  |
| W2.3 | The first `scheduled` export in `worker/index.ts`, plus `triggers.crons ['* * * * *']`. Each run claims at most 25 dispatches, to stay under the Free plan's 50 subrequests. The spec confirms whether named environments inherit triggers (3 of the account's 5 Free cron slots). Also add a manual "deliver due" hook in `server/node.ts` | worker/index.ts, wrangler.jsonc, server/node.ts, server/webhookScheduler.ts (new)                                                               | 2     | W2.1                         | No                                                                  |
| W2.4 | `server/webhookRoutes.ts`: endpoint CRUD and a test event for admins, the dispatch list for members, retry for admins. Plus `shared/webhookContracts.ts` and the `app.ts` mount                                                                                                                                                             | server/webhookRoutes.ts (new), server/webhookRoutes.test.ts (new), shared/webhookContracts.ts (new), shared/templateContracts.ts, server/app.ts | 4     | W2.1; R5                     | R5                                                                  |
| W2.5 | Studio: replace the mock webhook cards with the endpoint list, an add and edit dialog (https only, event-type toggles defaulting per R9, secret reveal and copy) and the dispatch log with a response expander                                                                                                                              | src/presentation/api/\* (webhook components), src/infrastructure/webhooks/\* (new), e2e/studio.spec.ts                                          | 5.5   | W2.4; D-2 merged (same page) | No                                                                  |
| W2.6 | ADR-37 (outbox plus Cron) and ADR-38 (Standard Webhooks). Finish WEBHOOKS.md. TECH_DEBT row: signing secrets are stored in clear. ARCHITECTURE and LEARNING. Run comment-drift                                                                                                                                                              | docs/DECISIONS.md, docs/WEBHOOKS.md, docs/TECH_DEBT.md, docs/ARCHITECTURE.md, docs/LEARNING.md                                                  | 2     | W2.2 to W2.5                 | Merge only                                                          |
| W2.7 | Deploy train 3: 1. backup, migrate 0008 and deploy, and confirm the cron fires (`wrangler tail`); 2. point an endpoint at a throwaway receiver Worker (not a public catcher) and see a signed test event arrive; 3. stop the receiver and watch attempts 1 to 5; 4. retry from the UI                                                       | none                                                                                                                                            | 1.5   | W2 merged                    | Yes: migrate, deploy, and approve the throwaway receiver (moment 4) |

Migration: `0008_create_webhooks.sql`. ADR: ADR-37, ADR-38.

#### Lane ST: Production on the Stytch LIVE project

Goal: production signs in against Stytch Live with self-service organisations off. Dev and staging stay on Test. Membership keeps working because workspaces match on the org slug `swarm` (TECH_DEBT #51).

| #    | Task                                                                                                                                                                                                                                                                                                                                                                       | Files                                                                                       | Hours | Depends on | Needs you                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----- | ---------- | --------------------------------------------- |
| ST.1 | In the Stytch Live environment: claim organisation slug `swarm` FIRST; turn self-service organisation creation off; set up magic link and Google (Live client); add the claim template `{ "email": {{ member.email_address }} }`; add the authorised domain and the `/authenticate` redirect for the production host. Also confirm lane A step 2 (the Test claim template) | Stytch dashboard                                                                            | 1     | R11        | Yes: dashboard work only you can do           |
| ST.2 | Per-environment browser token at build: production uses the Live public token, which you write into your local env file (Claude never reads it). `env.production` `STYTCH_PROJECT_ID` becomes the Live id. A bundle guard fails the build if a `project-live` id ships with a Test token                                                                                   | wrangler.jsonc, vite.config.ts, package.json, scripts/check-worker-bundle.mjs, .env.example | 2.5   | ST.1       | Yes: you put the Live token in the local file |
| ST.3 | `STYTCH_LOG`, `STYTCH_PLAN`, the DEPLOYMENT rollback (revert the var, redeploy), ADR-44. Run comment-drift                                                                                                                                                                                                                                                                 | docs/STYTCH_LOG.md, docs/STYTCH_PLAN.md, docs/DEPLOYMENT.md, docs/DECISIONS.md              | 0.75  | ST.2       | Merge only                                    |
| ST.4 | Deploy production on its own. Everyone signs in again, once by magic link and once by Google                                                                                                                                                                                                                                                                               | none                                                                                        | 0.5   | ST merged  | Yes: deploy and test sign-in (moment 4)       |

Migration: none. ADR: ADR-44 (reserved).

#### Lane H: Slice 6: hardening

Goal: an audit trail of key, webhook, member and workspace changes. Bounded tables. Dead endpoints switch themselves off. Real rate limits if the probe passed.

| #   | Task                                                                                                                                                                       | Files                                                                                                                                                    | Hours | Depends on             | Needs you                          |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------- | ---------------------------------- |
| H.1 | AuditStore port, in-memory adapter and contract suite (new files, can start in wave 3). Then migration 0009 `audit_log` plus `D1AuditStore`                                | server/auditStore.ts, server/inMemoryAuditStore.ts, server/auditStoreContract.ts, migrations/0009_create_audit_log.sql, server/d1AuditStore.ts (all new) | 3     | 0009 merges after W2   | No                                 |
| H.2 | Write audit rows from key, webhook, member and workspace mutations                                                                                                         | server/apiKeyRoutes.ts, server/webhookRoutes.ts, server/workspaceRoutes.ts, server/app.ts, worker/index.ts, server/node.ts                               | 3     | H.1; D-2 and W2 merged | No                                 |
| H.3 | Retention inside the existing minute cron, run once a day: dispatches older than 30 days, `message_events` older than 90, `email_messages` per R17. No second cron trigger | server/retention.ts (new), server/webhookScheduler.ts, store ports and adapters                                                                          | 2     | W2 merged; R17         | R17                                |
| H.4 | Switch an endpoint inactive after 20 consecutive dead dispatches, with a banner                                                                                            | server/webhookDispatcher.ts, server/webhookStore.ts and adapters, src/presentation/api/\*                                                                | 2.5   | W2 merged              | No                                 |
| H.5 | Move the studio's in-memory send and login limiters to the Rate Limiting binding, only if D.5 passed. Strike TECH_DEBT #16 if so                                           | server/rateLimit.ts (created by D.8), server/sendRoutes.ts, server/app.ts, worker/index.ts, wrangler.jsonc                                               | 2     | D.5 result; D-2 merged | No                                 |
| H.6 | ADR-43 (audit and retention), docs. Deploy train 4: backup, migrate 0009, deploy. Run comment-drift                                                                        | docs/DECISIONS.md, docs/TECH_DEBT.md, docs/LEARNING.md                                                                                                   | 1.5   | H.1 to H.5             | Yes: migrate and deploy (moment 5) |

Migration: `0009_create_audit_log.sql`. ADR: ADR-43 (reserved).

#### Lane CI: CI deploys

Goal: a push to `main` deploys dev automatically. Staging and production deploy through `workflow_dispatch` behind a GitHub Environment approval. Deploys are never cancelled and are smoke-checked afterwards.

| #    | Task                                                                                                                                                                                                                                                                | Files                                                           | Hours | Depends on       | Needs you                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----- | ---------------- | ------------------------------------------------- |
| CI.1 | GitHub Environments dev, staging and production. You are the required reviewer on staging and production, with self-approval allowed. Add a `VITE_STYTCH_PUBLIC_TOKEN` variable per Environment BEFORE any token exists, or the first CI build ships broken sign-in | GitHub settings                                                 | 0.5   | R12; R14         | Yes: GitHub settings; you supply the token values |
| CI.2 | Rework the deploy job: a push to `main` deploys dev; staging and production run through `workflow_dispatch` with `environment:`; per-environment `CLOUDFLARE_ENV` build and `d1 migrate`, with `db:backup` before the production migrate. Write ADR-45              | .github/workflows/ci.yml, docs/DEPLOYMENT.md, docs/DECISIONS.md | 3     | CIH merged; CI.1 | PR review only                                    |
| CI.3 | `scripts/smoke.mjs`, built from DEPLOYMENT's "Post-deploy checks": the page loads, the API answers 401 with mode stytch, the bundle carries a defined Stytch token (a live one on production once ST lands)                                                         | scripts/smoke.mjs (new), .github/workflows/ci.yml               | 1     | CI.2             | PR review only                                    |
| CI.4 | You create a `CLOUDFLARE_API_TOKEN` scoped to account `d0fa6b3d` (Workers Scripts Edit, D1 Edit; R2 Edit later) and run `gh secret set` per Environment. Order matters: only after CI.1 to CI.3 have merged                                                         | Cloudflare dashboard, GitHub secrets                            | 0.25  | CI.1 to CI.3     | Yes: the secret write only you can run            |

Migration: none. ADR: ADR-45 (reserved).

#### Lane R2: R2 image uploads

Goal: image upload works again on all three environments (TECH_DEBT #48).

| #    | Task                                                                                                                                                      | Files                                                 | Hours | Depends on  | Needs you                     |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----- | ----------- | ----------------------------- |
| R2.1 | Enable R2 in the Cloudflare dashboard. It may ask for a payment method; the free tier covers 10 GB                                                        | Cloudflare dashboard                                  | 0.1   | R16         | Yes: dashboard                |
| R2.2 | Create the buckets `email-template-studio-assets-dev`, `-staging` and `-production`                                                                       | Cloudflare R2                                         | 0.25  | R2.1        | Approve the Cloudflare writes |
| R2.3 | Restore the `r2_buckets` blocks in env.dev, env.staging and env.production, run `cf:types`, close TECH_DEBT #48, and note that the CI token needs R2 Edit | wrangler.jsonc, docs/TECH_DEBT.md, docs/DEPLOYMENT.md | 0.5   | R2.2        | PR review only                |
| R2.4 | Deploy each environment and upload one image                                                                                                              | none                                                  | 0.5   | R2.3 merged | Yes: deploy                   |

Migration: none. ADR: none.

### 8.5 Merge order

You merge every PR, so the order matters. **At most three code PRs are in review at once.** Review time, not build time, is the real limit.

**PR order:**

1. P (this plan, plus the doc refresh)
2. S0.7 (the small docs PR after the AWS work)
3. S (safety quick wins)
4. CIH (CI hygiene and tests)
5. B2
6. D-1
7. E1
8. HDR
9. SND
10. E2
11. D-2 (rebased on E2)
12. W1
13. W2
14. ST
15. H
16. Then CI and R2, in either order

**Migration order, strictly in number order:**

1. `0005` B2
2. `0006` D-1
3. `0007` E2
4. `0008` W2
5. `0009` H

Every migration is additive, so the previous Worker version keeps working between the migrate and the deploy. A bad migration is undone by a new migration, never by a rollback. **Take a backup before every production migrate** (`npm run db:backup:production`, from lane S).

### 8.6 Where the lanes touch the same files

Each lane rebases on the one before it. The wave-2 spec names the exact insertion lines.

- `migrations/`: 0005 B2, then 0006 D-1, then 0007 E2, then 0008 W2, then 0009 H. Merge and deploy strictly in this order. E1, W1 and H.1's port carry no migration file.
- `server/app.ts`: B2 (B2.1, B2.5, B2.6), then E2 (E2.3: route mount and the webhook auth exemption, added next to the `SESSION_ROUTE` check in the `/api/*` auth middleware; SNS sends no `Origin` header, so the forbidden-origin check in front of it lets it through, and that check stays), then D-2 (D.7: key routes and the Bearer authenticator; D.8: `createRateLimiter` moves out), then W2 (W2.4), then H (H.2, H.5). HDR and SND do not touch it. `server/auth.ts` is not edited in round 2.
- `server/rateLimit.ts` (new): D.8 creates it by moving `createRateLimiter` out of `server/app.ts` (tests move from `server/app.test.ts`), then H.5 edits it.
- `worker/index.ts` and `server/node.ts`: B2.5, then E2.3, then D.7, then D.8 and H.5 (`worker/index.ts` only: the Rate Limiting binding is passed in from `env`), then W2.3 (the first scheduled export), then H.2 and H.3. CIH.3's `worker/index.test.ts` must stay green for every later lane.
- `server/config.ts`: HDR.1 (`STUDIO_ENVIRONMENT`), SND.3 (`SES_ALLOWED_FROM`), E2.3 (`SNS_TOPIC_ARN`), D.8 (rate limit). All in wave 2; the wave-2 spec gives each its own field. Merge order: HDR, SND, E2, D-2.
- `wrangler.jsonc`, in order: P.5 (comments only), S.1 (top-level dry-run value), SND.4 (`SES_FROM_ADDRESS`, `SES_ALLOWED_FROM`), E2.3 (`SNS_TOPIC_ARN`, simulator addresses), D.8 (`ratelimits`, if D.5 passed), W2.3 (`triggers.crons`), ST.2 (`env.production` `STYTCH_PROJECT_ID`), H.5, R2.3 (`r2_buckets`). D.5's edit lives on a throwaway branch and never merges.
- `shared/templateContracts.ts` (error codes): B2.4 (`recipient-suppressed`), then SND.3 (`from-not-allowed`), then D.7 and D.8 (`invalid-api-key`, `key-revoked`, `scope-insufficient`, `rate-limited`, `template-not-sendable`), then W2.4.
- `server/messageStore.ts` and its adapters: B2.2 only. E2 uses `findByProviderMessageId`, `setStatus` and `addSuppression` without editing them.
- `server/messageRoutes.ts`, `shared/messageContracts.ts`, `src/domain/message.ts`, `src/presentation/logs/*`: B2 creates them, then HDR.1 (status contract), then E2.4 (events and the timeline).
- `server/sendRoutes.ts` and `server/sendMessage.ts`: B2 creates them, then HDR.1 (status), then SND.4 (from resolution), then H.5 (limiter). D.8 only calls `sendMessage`.
- `server/sesWebhookRoute.ts`: E2.2 creates it, then W2.2 adds enqueue and `waitUntil`.
- `src/presentation/api/ApiKeysPage.tsx` (+test): HDR.2 (drop the `ENVIRONMENT` prop), then D.7 (keys card), then W2.5 (webhook cards), then H.4 (banner).
- `src/App.tsx` and `src/presentation/layout/GlobalHeader.tsx`: B2.7 (Logs route and link), then HDR.2 (environment and user), then D.7 (`App.tsx` keys wiring).
- `e2e/studio.spec.ts`: B2.5, then D.7, then W2.5.
- `server/workspaceRoutes.ts`, `shared/workspaceContracts.ts`, `src/presentation/workspace/WorkspaceSettingsPage.tsx`: SND.4, then H.2.
- `package.json`: S.1 (deploy message), S.2 (`db:backup` scripts), CIH.1 (`engines`), ST.2 (build scripts). B2 adds no npm dependency, so `package-lock.json` stays untouched.
- `.github/workflows/ci.yml`: CIH.1, then CI.2 and CI.3. `.github/dependabot.yml`: CIH.2 only.
- `infra/`: S0.7 adds new files; SND.2 edits `ses-policy.json`. No overlap.
- `docs/DECISIONS.md`, append in numeric position: S0.7 (36), B2.8 (39), E2.5 (36 update), SND.5 (42), D.10 (34, 35, 40), W2.6 (37, 38), ST.3 (44), H.6 (43), CI.2 (45). Rebase before each docs step.
- `docs/DEPLOYMENT.md` (the hottest doc): P.3 first, then S0.7, S.1 to S.3, E2.5, CI.2, ST.3, R2.3. After P, each lane edits only its own section.
- `docs/PRIORITIES.md`, `docs/TECH_DEBT.md`, `docs/PLATFORM_PLAN.md`: P first, then small ticks and rows by each lane in merge order (TECH_DEBT: S.1 #54, S.3 #28, HDR.2 #47, SEC.4 #52, D.10, W2.6, H.5 #16, R2.3 #48).
- `docs/API.md`: D.6 creates it, then D.8 and D.10 extend it. `docs/WEBHOOKS.md`: W1.5 creates it, then W2.6 finishes it. `docs/BUILD_LANES.md`: P.1 only; later lanes tick their status line.

### 8.7 Decisions only you can make

These are the round-2 decisions, written R1 to R18 everywhere in section 8 so they are not confused with the older numbered lists. Where a decision is also in `docs/PRIORITIES.md` section 2, its number there is named as "PRIORITIES decision N".

- **R1. PRIORITIES decision 10: which mailbox receives the bounce and complaint alarms, the SNS confirmations and the interim bounce notifications?**
  - Recommendation: a shared alias read every day (for example `ses-alerts@swarm.work`), not a personal inbox. Not `echo@swarm.work`: it is the test-send inbox, and alerts would get buried. Only the alarm topic and the filtered bounce/complaint subscription send email.
  - Blocks: S0.1, S0.2, S0.5, S0.6 and the E2.6 DLQ alarm. It does NOT block the events topic or the destination (S0.3, S0.4).

- **R2. Which SES event types go to the destination: all (Send, Open and Click too, since VDM engagement tracking is on) or the six deliverability types?**
  - Recommendation: the six: Bounce, Complaint, Delivery, Reject, DeliveryDelay, RenderingFailure. The set is swarm.camp's identity default, so every open and click of every swarm.camp email would become a Free-plan Worker request, and other senders' recipient behaviour would flow into the studio. Send adds requests but no information: `sendMessage()` already marks a row sent from the SES reply. Adding types later is one CLI call. ADR-36 records the change from PLATFORM_PLAN's "all nine".
  - Blocks: S0.4, and so E2.6 end to end.

- **R3. May production's `SES_ALLOWED_RECIPIENTS` include the SES mailbox simulator (`bounce@`, `complaint@` and `success@simulator.amazonses.com`)?** This amends ADR-41 point 5 ("the allow-list stays `echo@swarm.work`"). E2.5 records it as an update note on ADR-41.
  - Recommendation: yes, permanently. They never reach a person and do not count toward reputation. Without them, slice 4's done-when cannot be tested on the only environment that sends.
  - Blocks: E2.3 (the var change) and E2.6 (production verification).

- **R4. Does the recipient allow-list apply to every send path, including `POST /api/v1/emails`?**
  - Recommendation: yes. B2.4 moves the check into `sendMessage()`. Widening production beyond `echo@swarm.work` becomes its own later decision. Take it only after the alarms (S0.2), slice 4 on production (E2.6), a real sender (SND) and `SENDING_POLICY.md` (SND.5) are all in place.
  - Blocks: the B2.4 spec, and D.8's behaviour.

- **R5. Who may create webhook endpoints?**
  - Recommendation: admins create, edit and retry, the same as API keys (decided 2026-09-29). Members may view the dispatch log.
  - Blocks: W2.4 and W2.5.

- **R6. PRIORITIES decision 6 and the sender questions: the production address; address, display name or both; which domains; who may change it.**
  - Recommendation: `Swarm <no-reply@swarm.camp>` on the already-verified swarm.camp identity. DKIM was restored today and passes DMARC, so there is no DNS wait. `testing@swarm.camp` stays for dev and staging. Address and display name, per workspace, within `allowed_from_domain`. swarm.camp only for now; swarm.work stays the separate marketing track. Workspace admins may change it. Custom MAIL FROM (`mail.swarm.camp`) comes later. This replaces PRIORITIES decision 6's older `mail.swarm.camp` suggestion.
  - Blocks: SND.2 to SND.6, and a real sender for D.8.

- **R7. PLATFORM_PLAN question 1: is a workspace a sending domain or a client?**
  - Recommendation: a sending domain (`swarm-camp` now, `swarm-work` later). A client engagement is a `tags` value. One workspace per client can come later with no schema change.
  - Blocks: nothing in round 2.

- **R8. PLATFORM_PLAN question 3: are visual templates plus merge fields enough for API sends, or is server-side code-template rendering needed?**
  - Recommendation: enough for v1. Code templates answer `template-not-sendable`, and the caller sends `html`. Server-side rendering becomes its own slice only if the app backend needs React props per send.
  - Blocks: D.8 being called done (not its start).

- **R9. PLATFORM_PLAN question 4: which event types do the app backend and Attio need first?**
  - Recommendation: default endpoint subscription `email.delivered`, `email.bounced` and `email.complained`. Then rejected, failed and `delivery_delayed` as toggles. Opened and clicked come only if R2 is widened later.
  - Blocks: W2.5 defaults only; it does not block building.

- **R10. Open and click tracking on swarm.camp mail: keep it or turn it off?**
  - Recommendation: leave the account setting unchanged, because other senders may rely on it. The studio does not capture Open or Click (R2). Revisit with R9.
  - Blocks: nothing now.

- **R11. When does production move to the Stytch LIVE project?**
  - Recommendation: wave 3, after slice 4 is live, and before anyone outside the Swarm team signs in to the studio. Claim the slug `swarm` first, and turn self-service organisations off.
  - Blocks: ST.1 to ST.4.

- **R12. Should CI deploy at all?**
  - Recommendation: yes, in steps, in wave 4. Fix the account variable now (SEC.3). Keep deploys manual until slice 4 is live. Then a push to `main` auto-deploys dev only; staging and production go through `workflow_dispatch` behind a GitHub Environment approval.
  - Blocks: CI.1 to CI.4.

- **R13. PRIORITIES decision 2: does the repo stay public?**
  - Recommendation: turn on free secret scanning today, while the repo is public, so the whole history is scanned. When the scan is clean, go private, as HANDOVER already decided: the repo publishes live infrastructure details. Accept that a private repo loses free secret scanning and push protection unless the org pays.
  - Blocks: SEC.5.

- **R14. PRIORITIES decision 8: is there a second repo admin?**
  - Recommendation: none is needed now. The ruleset requires a PR and the `check` status, with no approval rule. Environment reviews allow self-approval.
  - Blocks: the approval part of SEC.2, and CI.1.

- **R15. PRIORITIES decision 7: who owns the Worker's IAM key, and when does it rotate?**
  - Recommendation: you own it. Rotate every 90 days with two keys overlapping; the next rotation is due by 2026-12-29 for `AKIAXTOJWDT7VYPBK545`. Delete the inactive `AKIAXTOJWDT75W2H53HC` on or after 2026-10-07.
  - Blocks: the S0.7 runbook text, and SEC.4.

- **R16. Enable R2?**
  - Recommendation: when image uploads are wanted again, and only if a payment method on the Cloudflare account is acceptable. It blocks none of the three goals.
  - Blocks: R2.1 to R2.4.

- **R17. How long are `email_messages` rows (recipient addresses and subjects) kept?**
  - Recommendation: 13 months for messages, 90 days for events, and 30 days for dispatches.
  - Blocks: H.3.

- **R18. PRIORITIES decision 4: can you still log in to the personal Cloudflare account `0f95923f`?**
  - Recommendation: try once. If it works, delete the stale unauthenticated Worker. If not, record it as unreachable in HANDOVER.
  - Blocks: SEC.6 only.

**Already decided (do not reopen):**

- Admins create API keys (2026-09-29).
- B2 ignores the workspace `ses_configuration_set` field; production uses swarm.camp's default set.
- The `409 slug-taken` leak is accepted and documented.
- The lane C spike used a self-made certificate.
- `[TEST]` is per environment (ADR-41).
- Production sends live to `echo@swarm.work` (R3 asks to add the three simulator addresses, and would amend ADR-41 point 5).
- A session lasts about an hour without use.
- Strangers never get in (the Stytch organisation allow-list `swarm`).

### 8.8 Risks

- **Shared default set.** `my-first-configuration-set` is swarm.camp's identity default, so the destination emits events for ALL swarm.camp mail, from any sender. Mitigations: only six types; no unfiltered email subscription on the events topic; the route answers 200 to unknown messages, stores nothing and logs no addresses. The Stop-sending card warns that pausing the set or account sending stops everyone's mail.
- **Workers Free plan limits.**
  - 10 ms CPU per invocation. The spike ran only in local `wrangler dev`, which does not enforce CPU, so E2.6 measures CPU on a deployed dev Worker before production subscribes, and the parsed certificate key is cached.
  - 50 subrequests per invocation, so a cron run claims at most 25 dispatches.
  - 5 cron triggers per account: three environments use 3, so retention shares the minute cron.
  - 100,000 requests a day: other senders' events count too; watch request counts after E2.6.
- **Lost events.** SNS's default HTTPS retry gives up quickly, so a broken production deploy would lose events. Mitigations: the dev subscription first, a longer retry policy, the `studio-ses-events-dlq` queue with a depth alarm, and the S0.5 inbox subscription as a backup.
- **Out-of-order and per-recipient events.** SES events arrive per recipient and out of order. E1.3's rule means status never moves backwards, and suppression never depends on arrival order.
- **Migration order.** 0005, 0006, 0007, 0008 and 0009 merge and deploy strictly in number order. D-1 carries 0006 and merges right after B2, so a slow D-2 cannot hold up 0007. Every migration is additive, so the previous Worker version keeps working between migrate and deploy. A bad migration is undone by a new migration, never a rollback.
- **Production data.** Production D1 holds 5 real templates. Run `db:backup` before every production migrate (S.2); the restore is rehearsed once (S.3). Backups hold recipient addresses once B2 lands, so they stay out of git.
- **Allow-list bypass.** Today the recipient allow-list lives in the send-test route, and the IAM policy has no recipient condition. If a new path skipped it, v1 could reach anyone. Mitigations: B2.4 moves the allow-list into `sendMessage()`, and B2.4b's guard test fails if anything else calls `EmailSender.send`.
- **Leaked or misused AWS key.** It could send up to the SES quota from `testing@swarm.camp`. Mitigations: the S0.2 hourly send-volume alarm, IAM key deactivation as kill switch 1 (S0.7 card), and 90-day rotation (R15).
- **Local live-send.** `npm run dev` is a live sender today whenever `.dev.vars` holds AWS keys, because the top-level vars say enabled and not dry-run. S.1 fixes the default. Until then, TECH_DEBT #54 records it.
- **D.5 probe.** It redeploys dev from a throwaway branch. Dev must be redeployed from `main` straight afterwards, or dev runs unreviewed code.
- **CI trap.** Adding `CLOUDFLARE_API_TOKEN` before the Environment gates, the per-environment `VITE_STYTCH_PUBLIC_TOKEN` and the environment-aware job would deploy production with a broken sign-in. SEC.3 fixes the account variable now. The CI lane keeps the order CI.1, CI.2, CI.3, then CI.4.
- **Stytch.** Production auth runs on the Stytch TEST project until ST. The switch resets every session. The Live project needs its own slug claim, domains and claim template, and ST.2's bundle guard catches a Test token in a production build.
- **Review bandwidth, not build time, is the real limit.** One person merges every PR. Keep at most three code PRs in review at once, and rebase each lane on P before its docs step.
- **Public repo.** Scanning has been off while live infrastructure details were committed. SEC.1 scans the full history before R13 settles visibility.
- **ADR numbers** are pre-assigned in one place (section 8.9) so parallel lanes do not collide.
- **Side note, no action proposed.** The SES account record lists MailType MARKETING, while swarm.camp is meant to be transactional-only. SND.5's `SENDING_POLICY.md` records it.

### 8.9 ADR numbers

| ADR | Topic                           | Written by                 |
| --- | ------------------------------- | -------------------------- |
| 34  | Test mode is a key mode         | D-2 (D.10)                 |
| 35  | Key storage                     | D-2 (D.10)                 |
| 36  | SES events                      | S0.7 (update note in E2.5) |
| 37  | Outbox plus Cron                | W2 (W2.6)                  |
| 38  | Standard Webhooks signature     | W2 (W2.6)                  |
| 39  | One recorded send path          | B2 (B2.8)                  |
| 40  | Lane D choices                  | D-2 (D.10)                 |
| 41  | `[TEST]` prefix per environment | already written            |
| 42  | Per-workspace sender            | SND (SND.5), reserved here |
| 43  | Audit and retention             | H (H.6), reserved here     |
| 44  | Stytch Live                     | ST (ST.3), reserved here   |
| 45  | CI deploy policy                | CI (CI.2), reserved here   |

### 8.10 Not in round 2

- Cloudflare Access and a custom domain.
- The `__Host-` cookie prefix (it waits for a custom domain).
- Custom MAIL FROM.
- PRIORITIES 4.16 and 4.17.
- The audit branch.
- A per-workspace `[TEST]` setting.
