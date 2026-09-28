# Build lanes: what gets built next, in what order, and what can run side by side

Written 2026-09-29. Four planners (one per lane) drafted this against the code on `main` (`99b2ca8`)
plus open PR #25, and a reviewer checked every plan against the code and against the other plans.
The corrections the reviewer made are already applied below. `docs/PLATFORM_PLAN.md` says **what**
each slice is; this file says **how the next three weeks of it are sequenced**.

## 1. The short version

| Lane | What it is for, in plain words                                                                  | Size         | Can start                     |
| ---- | ----------------------------------------------------------------------------------------------- | ------------ | ----------------------------- |
| A    | Your dashboard and AWS work. No code                                                            | minutes each | now                           |
| U    | The UI agent's pull request: account menu, no primitives row, switcher on narrow screens        | half a day   | running now                   |
| B1   | Clean up the workspace feature that already shipped: lockout guard, email case, a build leak    | about 5.5 h  | after PR #25 merges           |
| B2   | Every test email leaves a record, a Logs page shows them, and a per-workspace do-not-email list | about 25 h   | after PR #25 merges           |
| C    | Three stand-alone tools the email-events and webhook slices will need later                     | about 4.5 h  | now (spike), then after #25   |
| D    | Real API keys, so the app backend or Attio can send through the studio                          | about 19 h   | first half now, rest after B2 |

Total hands-on work is about 55 hours. The longest chain is PR #25, then B2, then the second half of D:
about 37 hours. With lanes side by side that is roughly 5 to 6 working days; one lane at a time, about 8.

**None of these lanes makes production send real email.** That stays a separate decision (section 7).

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
   sign-in opens the studio instead of "carries no email address". 5 min.
3. **Second access key** on the IAM user `email-studio-ses` (profile `swarm-main`), for production's
   live sending. Only when you decide production goes live. 10 min.
4. **R2.** Parked as a placeholder until R2 is activated on the account (TECH_DEBT #48).
5. **SES events destination.** Waits for lane C's spike: then add an event destination (SNS or
   EventBridge) to the existing `my-first-configuration-set`. 20 min.

### Lane U: the UI agent (separate Opus 5.5 session, Herdr tab "ui-agent (opus 5.5)")

One draft PR against `main`:

1. Remove the code editor's Primitives row.
2. Replace the header's theme buttons, avatar and Sign out with one account dropdown: name, a dark/light
   switch, Sign out. System mode stops being a visible choice; ADR-29 gets an update note.
3. Make the workspace switcher (the only way to Settings and New workspace) reachable on screens
   narrower than 1280px. **Moved here from B1**, because it is the same header row.

### Lane B1: slice 1 follow-ups (one PR, three commits, about 5.5 h)

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

### Lane C: three stand-alone tools (about 4.5 h)

1. **Spike: can a Worker check an AWS SNS signature?** Built **outside** the repo (the repo's format and
   lint checks cover every folder). AWS's published example message has a fake signature, so make a
   test key and self-signed certificate with `openssl`, sign a message the SNS way, and ask a throwaway
   Worker to verify it. 1.5 h. See it: `verified: true` for the good message, `verified: false` for a
   tampered one. **Pass** means slice 0 uses SNS. **Fail** means slice 0 uses EventBridge (the plan's
   only fallback). The verdict goes into the C pull request's description.
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

1. **Move the send route into its own file, unchanged** (`server/sendRoutes.ts`), and pull the `[TEST]`
   rule into one function, `applyTestSubjectPrefix`. That function is where the prefix change you asked
   for will happen later. 2 h. See it: the same tests pass in their new file.
2. **Migration 0005 and the message store:** `email_messages` (one row per send: queued, then sent or
   failed) and `suppressions` (the per-workspace list). Store port, two adapters, one shared test suite.
   5 h. See it: `npx vitest run server/messageStore.test.ts` runs the suite on both adapters.
3. **Sender learns message tags** (`studio_message`, `studio_workspace`) so later AWS events can be
   matched back to a row. It sends **no** configuration-set name unless the workspace names one (see
   decision 2 in section 6): `swarm.camp` already uses `my-first-configuration-set` by default, and IAM
   allows only that set. 1.5 h.
4. **`sendMessage()`**, the one function allowed to call AWS: check the do-not-email list, write the
   row, send, mark it sent or failed. 3 h.
5. **Switch the Send test button to the recorded path.** Server and browser change together: the route
   moves under the workspace, the header check becomes `x-studio-request`. 3 h. See it: send a test,
   it still works, and a row exists.
6. **History and do-not-email routes** (list, detail; admins can view and remove list entries). 2 h.
7. **Logs page** at `/w/<workspace>/logs`, with a "Logs" link in the header. Merges **after** lane U
   (same header file). 4 h. See it: your test send appears as a row.
8. **Docs and ADR-39.** 2 h.
9. **Rollout,** per environment: `npm run db:migrate:<env>`, **then** `npm run deploy:<env>`, dev first.
   Only staging (dry-run) will show a new row, because dev and production have sending off. 2 h.

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
   revoke, rotate), and replace the mock keys card with the real table. 6 h.
8. `POST /api/v1/emails` and the two read routes, calling `sendMessage()`; the per-key rate limit
   (binding, or the in-memory limiter if the probe says no); the new error codes. 5 h.
9. Rollout: `db:migrate:<env>` (0006), then `deploy:<env>`, dev first. 1.5 h.

## 4. Order of play

1. **Merge PR #25** (the deploy scripts and config). Every lane branches from the new `main`, because
   `main` squash-merges and a lane branched from #25's commit would carry it twice.
2. **Run side by side:** lane U (running), B1, C, B2 steps 1 to 6, and D's first half.
3. **Merge order:** U, then B1, then C (any time), then B2, then D's first half (rebased on B2), then
   D's second half.
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
  before its docs step. ADR numbers: B2 is ADR-39, D is ADR-40 (32 to 38 are reserved by
  `docs/PLATFORM_PLAN.md` section 3).

## 6. Decisions only you can make, most urgent first

1. **Merge PR #25 now?** Recommended yes: every lane depends on it.
2. **The workspace "SES configuration set" setting.** It is editable today, but IAM only allows the
   default set. Recommended: B2 ignores the field until it is needed, so a typo there cannot break
   sending. Alternative: honour it, and widen IAM each time a set is added.
3. **`409 slug-taken` reveals that a workspace slug exists.** Recommended: accept it (workspace names
   are not secret) and fix the docs. Alternative, later: auto-pick `acme-2`.
4. **Lane C spike:** test with a self-made certificate now (recommended), and if it fails go straight
   to EventBridge (the plan's only fallback).
5. **Who may create API keys?** Recommended: workspace admins only.

Later, not blocking anyone yet:

- API sends: are visual templates plus merge fields enough, or does the app backend need code
  templates with fresh data per send (a server-side rendering slice)?
- API sends need a from address IAM allows (today only `testing@swarm.camp`): widen it?
- When should production really send? Recommended: after B2 and D run on staging, then one checked,
  tagged live send.
- Open and click tracking is **on** account-wide in SES (VDM engagement metrics), so links in every
  email are rewritten. Keep it, or turn it off for `swarm.camp` transactional mail? This changes which
  events lane C's parser will actually see.
- When the `[TEST]` prefix goes: for everyone, or as a per-workspace setting? B2 builds the same seam
  either way.

## 7. What is deliberately not in these lanes

- **Production live sending:** operator steps, `docs/DEPLOYMENT.md` "Turning live sending on".
- **Retiring the legacy top-level Worker:** `docs/PRIORITIES.md` item 3.3.
- **R2:** parked until it is activated.
- **Slice 4's live route and slice 5's dispatcher:** they need B2's rows and the events destination
  from lane A step 5.
