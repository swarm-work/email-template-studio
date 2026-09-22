# Priorities: what to do next

Verified 2026-09-15 against main at `76a766a`, the live Cloudflare account `swarm-work-emailer`, and the GitHub repository `swarm-work/email-template-studio`, then **re-checked against the code on 2026-09-19**, at the end of the visual-editor and persistence work. Every item below was checked on the current checkout or a live endpoint; where something could not be checked (anything on the AWS side, because the local AWS session had expired, and anything that needs a Cloudflare dashboard) section 9 says so.

**What changed on 2026-09-19.** The studio was rebuilt: two template kinds, a visual canvas, merge
fields, a plain-text part, reply-to, and templates and their immutable versions in Cloudflare D1
(nine phases; `docs/ROADMAP.md` M3 is delivered). Three consequences for this list. Items 1 to 3 of
section 3 are done and have been removed. **The list has a new head: there is data now**, so "move
off this account" stopped being a tidy-up and became a migration with a freeze window. And the
studio's own backlog items here — template search, download HTML, creating a template from the UI,
the read-only description and tags, demoting the simulated Publish — are all done, so they have gone
from sections 5 and 6 rather than being left to be re-planned.

How it was produced: seven independent readers (sending path, auth surface, product state, environments and CI, the unmerged audit branch, documentation truth, and a run of every check) raised 127 candidate items; these were merged to 61, of which 16 were dropped as already done; 45 were then attacked by two adversarial reviewers each (one re-checking the evidence, one attacking severity and effort), 1 was refuted; three judges ranked the survivors from different angles (risk first, business value first, sequencing first); one synthesis reconciled them. Section 10 records where the judges disagreed.

Read section 1 (state), then section 2 (decisions only you can make), then work through section 3 in order. Where this file and `docs/ROADMAP.md` disagree about ordering, this file wins (`ROADMAP.md:5`).

## 1. Where things stand

The application is in better shape than the documentation says, and the operational setup is in worse shape. That gap got wider on 2026-09-19: the application grew a great deal and the operational setup did not move at all.

The code is real, tested and deployed. Cloudflare Access JWT verification plus a shared-password gate enforce on every `/api/*` route, the SES sender was rewritten with `aws4fetch` so the Worker signs AWS requests at the edge, and the live Worker enforces this: `https://email-template-studio.swarm-work-emailer.workers.dev/api/send-test/status` answered `401 {"mode":"password"}` to an anonymous caller on 2026-09-15. On 2026-09-19 the branch runs **755 unit and component tests and 58 Playwright tests, all green**, and `npm run check` passes.

**The studio now has a database, and it is on the account this document says to move off.** Templates and their immutable versions live in D1 (`STUDIO_DB`), uploaded images in R2 (`STUDIO_ASSETS`), both bound in `wrangler.jsonc` and both on the account it pins. `docs/HANDOVER.md`'s "nothing has to be migrated yet, doing it now is an afternoon" is no longer true and has been marked superseded. The `database_id` in `wrangler.jsonc` is still the `00000000-…-0000000000d1` placeholder, so **no remote database exists yet**: the studio has only ever run against local D1 under `.wrangler/state/v3`. Creating it on the right account, before there is anything to export, is the cheapest this will ever be.

**Still true on 2026-09-19, unchanged:** four Workers run on the `swarm-work-emailer` account and the naming is inverted. The unnamed top-level Worker `email-template-studio` is the real production: live SES sending, dry-run off, holding `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `STUDIO_PASSWORD` as secrets. The three Workers named `-dev`, `-staging` and `-production` hold no secrets at all and answer `401 {"mode":"disabled"}`: they serve the full studio UI publicly while refusing every API call. So `npm run deploy` (the command the README advertises, with no `--env`) targets the live sender, and a kill switch aimed at "production" during an incident would hit the wrong script. The configuration those three Workers were deployed from is committed now (PR #13): `wrangler.jsonc` holds `env.dev`, `env.staging` and `env.production`, each with its own `d1_databases` and `r2_buckets` block, because bindings are not inherited by a named environment. **The account is settled.** On 2026-09-22 `npx wrangler whoami` named `d0fa6b3d72170539438800a907ec5323` as **`swarm-work-emailer`**. Section 1 here was right; `docs/DEPLOYMENT.md` and `docs/HANDOVER.md` called it a personal account and were wrong. Both are corrected. The personal account is a separate thing entirely: it still serves one stale, unauthenticated Worker (item 4.3).

The sending rules from the SES production-access request are not implemented anywhere. No file mentions suppression. `server/app.ts` has four routes and none is an inbound webhook for SNS. `SES_CONFIGURATION_SET` is supported by the code and set on no Worker, so SES emits no event stream at all, right after production access was granted and right when AWS starts judging bounce and complaint rates you cannot see.

**The CI chain is unblocked.** The formatting failure is fixed, `npm run check` runs `format:check` too, and the workflow is one `npm run check` step followed by Playwright, with a `d1 migrations apply --remote` step before any deploy. What has not changed: there is no `CLOUDFLARE_API_TOKEN` secret, so nothing auto-deploys and the migrate step has never run; there are no GitHub Environments and no branch protection; the `CLOUDFLARE_ACCOUNT_ID` repository variable is `0f95923f7c5505d2e3261d3a788d68e0` (`gh variable list`, 2026-09-22), which is neither the account `wrangler.jsonc` pins nor any account the current login can see, so the first CI deploy after that token is armed would target an unverified account. A stale Worker on that personal account was still online on 2026-09-15 and answered `/api/send-test/status` with HTTP 200 and no credential.

Two local problems remain, both verified on this checkout on 2026-09-19. `npm run build` still copies `.dev.vars` — AWS credentials included — into `dist/email_template_studio/.dev.vars`: only `playwright.config.ts` deletes it, `npm run deploy` does not. And `npm run dev` inherits the top-level `vars`, which say sending is **enabled and not a dry run**, so whether a local dev server is a live sender depends entirely on what is in an untracked file. The Worker no longer 500s when that file is wrong — a bad send configuration now only disables sending, and templates, uploads and previews keep working — but "sending is off locally" is a promise the configuration does not make.

### Done since the plans were written

- PLAN phase 0: the studio is one Cloudflare Worker with static assets (`wrangler.jsonc`, `worker/index.ts`, `tsconfig.worker.json`, `.github/workflows/ci.yml`). Its exit criterion "CI green on main" is met on this branch: `npm run check` and `npm run test:e2e` both pass.
- PLAN phase 1 step 4: the AWS SDK is gone; `server/sesSender.ts` signs SES v2 REST calls with `aws4fetch` (ADR-16), with unit tests that need no AWS account.
- PLAN phase 1 steps 2 and 3: Access JWT verification and a mandatory identity on every `/api/*` route, failing closed (`server/auth.ts`, `server/app.ts`), 43 auth test cases.
- Beyond the plan: a shared-password gate (`POST`/`DELETE /api/session`, HMAC session cookie, login throttle, `src/presentation/auth/PasswordGate.tsx`) because Access still needs a custom domain.
- PLAN phase 1 step 5: the scoped IAM policy exists, and is now tracked, as `infra/ses-policy.json` (send only from `testing@swarm.camp` to `echo@swarm.work`). The account id in it and the `ses:ConfigurationSetName` condition are still item 4.9.
- Live SES sending is on and deployed on the top-level Worker.
- One sender factory (`server/createSender.ts`) shared by the Node adapter and the Worker.
- HANDOVER part A: the repository moved to `swarm-work`. The visibility half (private) was not done.
- HANDOVER B3: the Cloudflare account is pinned in `wrangler.jsonc`; dev, staging and production environments were written and deployed, uncommitted.
- FEATURE_PLAN phase 4, started early as a browser-only mock: the API Keys page and product navigation (PR #4).
- Tech-debt register re-checked row by row on 2026-09-19. Struck through in `docs/TECH_DEBT.md`: #10 (dark theme), #12 (e2e server reuse), #29 (prettier as a devDependency) and #31 (read-only description and tags); #21 lost its first half (the Worker can send email) and keeps the rest. **#3, #15 and #18 were re-checked and remain open** — #3 became measured fact in #34 (two `@react-email/render` copies really do ship), #15 (fixed local identity on the send server) and #18 (Vite `--host`) are unchanged. Row numbers are declared permanent because ADRs and code comments cite them.

**Since 2026-09-15, on the `worktree-visual-editor-studio` branch** (nine phases, one plan):

- **ROADMAP M3 is delivered.** Templates and immutable versions in D1 behind `/api/templates` with optimistic concurrency (ADR-21, ADR-22), an R2-backed image store, wrangler migrations including a generated starter seed with a drift test, and a `TemplateRepository` port with HTTP and in-memory adapters (ADR-20, ADR-27).
- **A second template kind.** A visual canvas on `@react-email/editor` behind `React.lazy` and a `STUDIO_VISUAL_EDITOR` rollback flag (ADR-18), `{{merge field}}` chips that export as literal tokens and resolve for the preview and the send (ADR-26), and a one-way conversion to React Email TSX that refuses rather than guesses (ADR-28).
- **The studio itself was rebuilt**: an app shell with a library screen, three modes (Visual, Code, Preview), an envelope panel, a status bar, keyboard shortcuts, a render report and a light/dark theme toggle that deliberately never themes the email (ADR-29).
- **Sending got the rest of an email**: a plain-text part from the same render and a reply-to address, both through to SES.
- **Items 1 to 3 of section 3 below are done** (the ignore files, the formatting, `format:check` inside `npm run check`), which is what unblocked CI. **Items 4 to 8 are not**, and are now section 3's whole list.
- Documentation: `README.md`, `ROADMAP.md`, `PLAN.md`, `FEATURE_PLAN.md`, `TECH_DEBT.md`, `DECISIONS.md` (ADR-18 to ADR-30), `LEARNING.md`, `ASSESSMENT.md` and `HANDOVER.md` were all corrected against the code on 2026-09-19. `DEPLOYMENT.md` was **not**: its "where it runs today" table needs facts only a dashboard can confirm (item 4.7).

## 2. Decisions only you can make

Answer these first; the first one gates the whole environments block, and the third one gates everything to do with the database.

1. **Which Worker is production?** Option A (recommended): make `env.production` the real live sender, move the AWS keys and `STUDIO_PASSWORD` secrets onto it, and flip the top-level vars to dry-run so a bare `wrangler deploy` and `npm run dev` are both harmless. Option B: rename `env.production` back to `email-template-studio` per `docs/HANDOVER.md` and delete `email-template-studio-production`. **This now also decides where the database lives**: each named environment needs its own `d1_databases` block (bindings are not inherited), so the answer here is the answer to "which D1 is production" too.
2. **Does the repository stay public?** It is public today; HANDOVER decided "private, or internal". Currently published: the previous owner's personal Cloudflare account id and Gmail-login wording, the personal `workers.dev` hostname (live and unauthenticated), and the full live-send configuration with its single allow-listed recipient. This gates pushing the audit branch and the documentation scrub.
3. ~~**Whose account is `d0fa6b3d72170539438800a907ec5323`?**~~ **Answered 2026-09-22**: it is **`swarm-work-emailer`**, per `npx wrangler whoami`. Section 1 of this file was right and the two runbooks were wrong; both are corrected. Creating the remote database there is therefore the right next step, not a migration — and nothing has been created yet, so it is still free (`npx wrangler d1 list` returned nothing on 2026-09-22).
4. **Can you still log in to the personal Cloudflare account `0f95923f…`?** The retired Worker there is online and unauthenticated. The current wrangler login cannot see that account. If it is unreachable, that is a bigger finding than the Worker and belongs in HANDOVER.
5. **Three deployed environments, or two?** Each one you keep needs its own password or Access policy, its own sender configuration and a place in the rollback runbook. For one developer, dev plus production may be enough.
6. **What is the production sender address?** Suggested: `no-reply@mail.swarm.camp` with a custom MAIL FROM subdomain, keeping `testing@swarm.camp` for staging. This needs DNS records and takes days to verify, so decide early.
7. **Long-lived IAM user keys for the Worker, yes or no?** HANDOVER says "ask before creating a static key". The Worker cannot refresh temporary STS credentials, so the options are a long-lived key with 90-day rotation, or accepting that sending stops when a token expires. If yes, who owns and rotates it?
8. **Is there a second repository admin?** Branch protection with "require 1 approval" deadlocks a solo maintainer. Without one, require the `check` status and block force pushes only.
9. **Which swarm.camp email is the first real template?** Invitation, billing notice, contract, or engagement update. Start with the one sent most often.
10. **Which mailbox receives bounce and complaint alarms and SNS confirmations?** It must be read promptly; these alerts protect the production access.

## 3. Now: this week, in this order

Sizes: S is a day or less, M about a week, L two to three weeks, for one developer learning as they go.

Items 1 to 3 of the 2026-09-15 list (the ignore files, running Prettier, adding `format:check` to
`npm run check`) are **done** and have been removed. What is left is what was already the hard half,
plus two items the persistence work created.

| #   | Item                                                                                        | Size | Area         |
| --- | ------------------------------------------------------------------------------------------- | ---- | ------------ |
| 1   | Stop `npm run build` copying `.dev.vars` with live AWS credentials into `dist/`             | S    | security     |
| 2   | Settle whose Cloudflare account this is, then create the real D1 database on it             | S    | environments |
| 3   | Move live-sending settings off the top-level target and end the production naming inversion | M    | environments |
| 4   | Commit the `wrangler.jsonc` dev/staging/production block that is already deployed           | S    | environments |
| 5   | Prove `RETURNING` and a 500 KB bound parameter against **remote** D1 (TECH_DEBT #28)        | S    | data         |
| 6   | Create an SES configuration set per environment and set `SES_CONFIGURATION_SET`             | M    | sending      |
| 7   | Rehearse the D1 backup and restore once, before there is anything worth losing              | S    | ops          |

### 3.1 Keep credentials out of `dist/`

**Why.** `dist/email_template_studio/.dev.vars` exists after every build and holds the real AWS access key, secret and session token. The directory is ignored by version control, but it is exactly what gets zipped, attached to a bug report or uploaded as an artifact. The plan is to replace today's expiring token with a long-lived key, at which point every build copies a permanent credential. `playwright.config.ts` already deletes the file in one place; `npm run deploy` does not. Still true on 2026-09-19.

**How.** Add the removal to the build script itself — `"build": "npm run cf:types && tsc -b && vite build && rm -f dist/email_template_studio/.dev.vars && node scripts/check-worker-bundle.mjs"` — drop the now-redundant `rm` from `playwright.config.ts`, and add `dist/**/.dev.vars` to `.gitignore` as a belt. Treat the current credentials as needing rotation regardless.

### 3.2 Settle the account, then create the database

**Why first among the environment items.** The studio has a D1 binding and an R2 binding, and neither has ever pointed at a real remote resource: `database_id` in `wrangler.jsonc` is the literal placeholder `00000000-0000-4000-8000-0000000000d1`. So today the migration is free — there are no rows to export. Every week that a remote database exists on the wrong account, it is not. Section 2 item 3 is the blocker: three documents disagree about whose account `d0fa6b3d…` is.

**How.** `npx wrangler whoami`, and read the account name against `docs/DEPLOYMENT.md` and `docs/HANDOVER.md`; correct whichever is wrong in the same change. Then `npx wrangler d1 create email-template-studio` and `npx wrangler r2 bucket create email-template-studio-assets`, paste the id over the placeholder, `npm run cf:types`, and run `npm run db:migrate:prod` once. If the answer is "this is the wrong account", stop and do B1 to B3 of `docs/HANDOVER.md` first; that is the whole point of doing this before there is data.

### 3.3 Name production correctly

**Why.** Three consequences of one root cause: `npm run deploy` deploys the live sender with no `--env`; `npm run dev` inherits the same top-level vars, so a local server with credentials present is a live sender while the README says sending is off; a rollback or kill switch applied to "production" would hit the wrong Worker. You cannot safely operate a live sender you cannot name. Persistence adds a fourth: an environment with no `d1_databases` block of its own has **no database at all**, because bindings are not inherited by a named environment — the template routes would answer 503 on a Worker that otherwise looks healthy.

**How.** Pick option A or B from section 2. Replace the bare `deploy` script with `deploy:dev`, `deploy:staging`, `deploy:production` that set `CLOUDFLARE_ENV` at build time (the Vite plugin resolves the environment during `vite build`, not during `wrangler deploy`). Give every environment its own `d1_databases` and `r2_buckets` blocks, the way `env.e2e` already has. Do it in the same change as 3.4 so the inverted configuration is never the reviewed baseline.

### 3.4 Commit the environments block

**Why.** Three Workers have served the internet since 2026-09-15 from configuration that exists only in one working tree. Nobody can review, reproduce or roll them back, and discarding local changes to `wrangler.jsonc` destroys the only record of what is live. This is also where the configuration set, the per-environment sender and the per-environment database go next.

**How.** One small pull request: `wrangler.jsonc`, plus the `docs/DEPLOYMENT.md` environments table rewritten against the real Workers with their send posture, auth posture and D1 binding. Resolve `STUDIO_ENVIRONMENT` before committing: either read it in `server/config.ts` and surface it, or delete it, since no code reads it today. `infra/ses-policy.json` is tracked now, so the first half of item 4.9 is done.

### 3.5 Prove the two D1 assumptions against remote

**Why.** `docs/TECH_DEBT.md` #28: `RETURNING` and a 500 KB bound parameter were both proven against workerd's **local** SQLite through the real binding, because no Cloudflare credentials were available in the phase that needed them. If remote D1 differs on the size question, a large template fails to save in production and in no test. The store never depends on `RETURNING`, so only the size question can actually bite — but a 500 KB `html` column is exactly what a long visual template produces.

**How.** After 3.2, with a remote database in place: save one deliberately large template through the deployed studio (or `npx wrangler d1 execute STUDIO_DB --remote` with a 500 KB parameter), and record the result in the "Verified on local D1" table in `docs/DEPLOYMENT.md`, changing its title. If it fails, the fallback is already written down: move `html` and `plain_text` to R2 and keep a key in the row.

### 3.6 Create SES configuration sets

**Why.** This is the one item whose damage is irreversible. Without a configuration set, SES emits no bounce, complaint, rejection or delivery events, and AWS revokes production access on rates you cannot see. Everything downstream (SNS, suppression, alarms, the delivery log) depends on this one setting. The code already forwards `SES_CONFIGURATION_SET`; nothing sets it.

**How.** Step zero is a fresh AWS session for `swarm-dev-internal-tools`. Confirm reality with `aws sesv2 get-account` and `aws sesv2 get-email-identity --email-identity swarm.camp` in `ap-southeast-2`. Create `studio-transactional-production` and `studio-transactional-staging` with reputation metrics enabled, add `SES_CONFIGURATION_SET` to the relevant vars blocks, redeploy, send one test and check the set's metrics. In the same session enable the account-level suppression list for BOUNCE and COMPLAINT (the no-code half of item 4.10).

### 3.7 Rehearse the backup once

**Why.** `docs/DEPLOYMENT.md` documents `wrangler d1 export --remote` and D1 Time Travel, and neither has ever been run. A restore procedure nobody has performed is a paragraph, not a procedure — and the moment real templates exist, somebody's afternoon of work is in there. Doing it while the database holds four seeded starters costs nothing and tells you whether the commands are right.

**How.** After 3.2: `npx wrangler d1 export STUDIO_DB --remote --output backup.sql`, recreate a scratch database from it, and check the starters come back with their versions intact. Write the elapsed time and the exact commands into the rollback section of `docs/DEPLOYMENT.md`, and add "export before every migration" to the pre-deploy checklist.

## 4. Next: the following two to three weeks, in order

| #    | Item                                                                                                | Size | Area     |
| ---- | --------------------------------------------------------------------------------------------------- | ---- | -------- |
| 4.1  | ~~Read the Playwright result that green CI now produces, and fix what broke~~ — done: 58 specs pass | S    | ci-cd    |
| 4.2  | Give the deployed dev/staging/production Workers an auth mode, or take them down                    | S    | security |
| 4.3  | Delete the retired personal-account Worker that still serves a public, unauthenticated build        | S    | security |
| 4.4  | Decide and record whether the repository stays public, and scrub personal identifiers               | S    | security |
| 4.5  | Push the audit branch and open a draft pull request                                                 | S    | process  |
| 4.6  | Point `CLOUDFLARE_ACCOUNT_ID` at `swarm-work-emailer`, or delete the variable                       | S    | ci-cd    |
| 4.7  | Rewrite README, DEPLOYMENT and HANDOVER against what is actually deployed                           | M    | docs     |
| 4.8  | Write down the swarm.camp / swarm.work sending rules and the suppression requirement                | M    | docs     |
| 4.9  | Replace the account id in `infra/ses-policy.json` and add a configuration-set condition             | S    | security |
| 4.10 | Put one suppression check in front of every send path and enable the SES suppression list           | M    | sending  |
| 4.11 | Add bounce and complaint rate alarms once the configuration set emits metrics                       | S    | ops      |
| 4.12 | Give production a real transactional sender identity instead of `testing@swarm.camp`                | M    | sending  |
| 4.13 | Enable Dependabot and secret scanning, and add `npm audit` to CI                                    | S    | security |
| 4.14 | Create a GitHub Environment `production` with a required reviewer, before any deploy token exists   | S    | ci-cd    |
| 4.15 | Protect main with a ruleset requiring a pull request and the `check` job                            | S    | ci-cd    |
| 4.16 | Cherry-pick `docs/JS_LEARNING_PATH.md` from the audit branch, ahead of the rest of it               | S    | docs     |
| 4.17 | Teach the converter the five block types it refuses, one at a time (TECH_DEBT #43)                  | M    | product  |

Notes that change how you do them:

- **4.1** is done. The suite runs in the same CI job right after `npm run check`; the password gate is handled by a fixed `STUDIO_DEV_IDENTITY` in the `e2e` environment, and the suite grew from 8 specs to 58 — the D1 routes, the visual editor, merge fields, conversion, the README's screenshots and the rule that the email never goes dark. It needs a local database, so `npm run db:migrate:e2e` is part of the Playwright `webServer` command.
- **4.2** All three env Workers answer `401 {"mode":"disabled"}` and `wrangler secret list --env <name>` is empty for each. Keep one usable (`openssl rand -base64 24`, then `npx wrangler secret put STUDIO_PASSWORD --env staging`) and take the others off `workers.dev` (`"workers_dev": false`) or delete them.
- **4.3** `https://email-template-studio.jerichodelrosario35.workers.dev/api/send-test/status` returns HTTP 200 with no credential, a response shape only pre-auth code produces. Follow HANDOVER B7; if the personal account is unreachable, record that instead. Update `README.md` and `docs/DEPLOYMENT.md` in the same change.
- **4.4** gates 4.5 and 4.7, so answer question 2 first.
- **4.5** Push as `docs/weekend-audit-plan`, leave it a draft until corrected (item 5, `correct-audit-docs`). Its own Prettier commit already formatted its files.
- **4.6** `gh variable set CLOUDFLARE_ACCOUNT_ID --repo swarm-work/email-template-studio --body d0fa6b3d72170539438800a907ec5323`, or delete it and rely on `wrangler.jsonc`. Say which in DEPLOYMENT.
- **4.7** `README.md` was rewritten on 2026-09-19 and `docs/HANDOVER.md`'s "there is no data" section marked superseded, so what is left is **`docs/DEPLOYMENT.md`** — which nobody could correct from a checkout. Its "where it runs today" table still says sending is disabled and calls the pinned account personal; both need a dashboard to settle (section 2, item 3). Then the wrangler header comments, and HANDOVER's claim that `routes` is non-inheritable (it is inheritable in wrangler 4.130; an inherited custom domain would move it away from the top-level Worker). Add a "last verified" date to every present-tense document — `README.md`, `ROADMAP.md` and `TECH_DEBT.md` have one now.
- **4.8** is the specification 4.10 is built against. Add `docs/SENDING_POLICY.md`: identity per domain, what each may send, volume, the configuration-set to SNS to backend path, suppression as a precondition of every send, who owns the decision.
- **4.9** The move to `infra/ses-policy.json` is done. What is left: replace the account id with a placeholder substituted at deploy, add `ses:ConfigurationSetName` to the send statement once 3.6 has created the set, and verify what is actually attached to the IAM user.
- **4.10** One `server/suppression.ts` exporting `isSuppressed(address)`, injected into `createApp`, called once in `server/app.ts` right after the allow-list check, returning 403 `recipient-suppressed`. Back it with the SES suppression API now.
- **4.11** CloudWatch alarms on `Reputation.BounceRate` (5%) and `Reputation.ComplaintRate` (0.1%) for the set, plus a daily send-count ceiling.
- **4.12** Start the DNS half on day one: verify `mail.swarm.camp` with DKIM, custom MAIL FROM, SPF and DMARC. Move `SES_FROM_ADDRESS` and the IAM `ses:FromAddress` condition in lockstep. Adding the zone to the `swarm-work-emailer` account is also the prerequisite for Cloudflare Access.
- **4.13** Dependabot alerts are confirmed disabled. Two toggles plus a `.github/dependabot.yml` with monthly npm and actions schedules.
- **4.14** Before the token: environments `production` and `staging`, a required reviewer on production, `environment:` on the deploy job, the token as an environment secret scoped to edit Workers on account `d0fa6b3d…` only.
- **4.15** After 3.2 lands, or the required check can never pass. Do not require approvals until a second admin exists.
- **4.16** Take `docs/JS_LEARNING_PATH.md` off the `worktree-weekend-audit-plan` branch onto a fresh one. Fix its hour-one instruction, which predates both the send-configuration fix and `npm run db:migrate`: the first command anybody runs now is the migration, not the dev server. Read it beside `docs/LEARNING.md`, which has an index and a section per phase since 2026-09-19.
- **4.17** `documentToTsx` refuses bullet and numbered lists, column rows, tables, blockquotes and code blocks, and the shipped `Product launch` starter contains a two-column row — so the first conversion most people try is refused, by design (ADR-28, TECH_DEBT #43). One node at a time, each with its own golden fixture, guarantee case and fidelity case; the intended mapping for all five is already written down.

## 5. Later: when the above is done or there is slack

Four rows were removed on 2026-09-19 because the work is done: template search and download-HTML, the
studio copy claiming everything is local (`PageHeader.tsx` no longer exists and the footer reads the
send server's status), updating the technical-debt register, and recording the deferral of
FEATURE_PLAN phase 0 — which is now written into `docs/FEATURE_PLAN.md` §1 and §4, decision by
decision. The README half of "fix stale cross-references" is done too; the ARCHITECTURE and
DEPLOYMENT half is not.

| Item                                                                                       | Size | Area         | Why it waits                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------ | ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Put Cloudflare Access on a real hostname in front of the live-sending Worker               | L    | security     | Access cannot protect `*.workers.dev`; do it with the DNS work in 4.12. Put `routes` inside each env block.                                                                     |
| Share one wire contract between `server/app.ts` and the browser's `emailProvider.ts`       | M    | code-quality | Two hand-written schemas already drift (`user`, `rateLimitPerMinute` are dropped by the client). Good typed-boundary practice.                                                  |
| Show the real environment and signed-in user in the header instead of the literal "Local"  | M    | product      | Still `src/App.tsx`: `WORKSPACE` and `ENVIRONMENT` are constants and the avatar names the workspace, not the person. `STUDIO_ENVIRONMENT` exists for this and nothing reads it. |
| Build `POST /api/webhooks/ses` and verify the SNS signature                                | L    | sending      | The largest new code; needs the configuration set and the contract refactor first. Exempt from the authenticator like the session route.                                        |
| Decide and document the credential type and rotation for the Worker's AWS keys             | S    | security     | Answers HANDOVER's open question. One IAM user per sending environment, 90-day rotation, named owner.                                                                           |
| Replace the in-memory send and login rate limiters with a Cloudflare rate-limiting binding | M    | sending      | Per-isolate counters reset on cold start; bounded today by low volume and a person in the loop. Access makes the login one moot.                                                |
| Add a real transactional send path alongside the test-send dialog                          | M    | sending      | The smallest slice that does real work: recipient validated and suppression-checked, subject verbatim, type-to-confirm. No D1 needed.                                           |
| Add the real swarm.camp transactional templates to the registry                            | M    | product      | The library holds three fictional samples. Code-only templates are enough at under 100 emails a month.                                                                          |
| Write tests for `worker/index.ts` and `server/createSender.ts`                             | S    | code-quality | The sender factory is the no-send guarantee's enforcement point and has no test. Add `worker/**/*.test.ts` to the Vitest include.                                               |
| Make the CI deploy job environment-aware via `CLOUDFLARE_ENV` at build time                | M    | ci-cd        | `--env` on deploy alone does not work with the Vite plugin. Nothing deploys automatically today, so this waits for the token.                                                   |
| Add a post-deploy smoke check to the deploy job                                            | S    | ci-cd        | Would have caught the three unauthenticated env Workers the day they shipped.                                                                                                   |
| Write and rehearse a per-environment rollback procedure                                    | S    | ops          | Documented commands carry no `--env`; rehearse once on staging and record the kill switch and its target Worker.                                                                |
| Correct the audit-branch documents before merging them                                     | M    | docs         | Six claims in STATE_OF_THE_REPO are now false; add a "what changed since" section, fix section 4 rows plus 5.1 and 5.7 only.                                                    |
| Fix the stale AWS-SDK paragraphs in ARCHITECTURE.md and the contradiction in SENDING.md    | S    | docs         | ARCHITECTURE still describes credentials from a developer profile; SENDING says both "authenticated" and "not authenticated yet".                                               |
| Document the API Keys page, navigation and sign-in screen in README and ARCHITECTURE       | S    | docs         | A shipped product surface is invisible in the entry documents, and nothing there says the keys are a mock.                                                                      |
| Stop keying the session HMAC with the password itself, and give sessions an id             | M    | security     | One captured cookie allows offline brute force of the password that also unlocks live sending. Hardens a gate Access will replace.                                              |
| Add a sign-out control (`DELETE /api/session` exists but nothing calls it)                 | S    | product      | A 12-hour session with no way to end it on a shared browser.                                                                                                                    |
| Harden the session cookie with the `__Host-` prefix                                        | S    | security     | Worth doing when a custom domain exists.                                                                                                                                        |
| Introduce a message stream so the transactional-only rule is enforceable in code           | L    | product      | When `POST /api/v1/emails` is built, make `stream` a required field validated against a config map. Keep the `[TEST]` prefix until then.                                        |
| Add coverage reporting so untested modules surface automatically                           | S    | code-quality | `@vitest/coverage-v8`, no CI threshold yet.                                                                                                                                     |
| Delete the stray ngrok tarball and prune the merged remote branches                        | S    | code-quality | Five merged branches sit on the public remote. Verify with `git branch -r --merged main` first.                                                                                 |
| Pin `wranglerVersion` in the wrangler-action step                                          | S    | ci-cd        | The deploy action installs its own unpinned wrangler.                                                                                                                           |
| Stop `cancel-in-progress` from cancelling an in-flight deploy                              | S    | ci-cd        | Move `concurrency` to the check job only.                                                                                                                                       |
| Pin the Node version with `.nvmrc` and align `engines` with CI                             | S    | code-quality | Three Node versions are in play (CI 24, engines >=22.18, this machine 26).                                                                                                      |
| Fix the remaining stale cross-references                                                   | S    | docs         | FEATURE_PLAN cites PLAN as on a branch; `WEBHOOKS.md` and `OPERATIONS.md` are referenced but absent. The README half is done.                                                   |
| Correct or retire `.claude/agents/ui-overflow-fixer.md`                                    | S    | process      | Claims a send server on port 8790 that Playwright does not start; hard-codes commit trailers.                                                                                   |
| Remove the two dead `eslint-disable` comments                                              | S    | code-quality | The project lints with oxlint.                                                                                                                                                  |

## 6. Dropped, and why

- **Defer infra/core OpenTofu until the SES event pipeline works.** Unanimous. Its whole action is "do not build this yet", which ordering already expresses. Keep the useful sentences inside INFRASTRUCTURE_PLAN when correcting the audit docs.
- **Split `ApiKeysPage.tsx` (714 lines of mock data).** Do not refactor mock code; FEATURE_PLAN phase 4 replaces it, and the split falls out of that work.
- **Refresh the stale counts in `docs/ASSESSMENT.md`.** It is a dated snapshot that will rot again. The one-line "snapshot, not maintained" header is folded into the cross-references item.
- **Say less in the unauthenticated 401 body.** The verbose message appears only in auth mode `disabled`, which item 4.2 removes from every deployed Worker.
- **Demote the simulated Publish button.** Overtaken on 2026-09-19: the simulated publish, its dialog and its reducer action were **deleted** in phase 2 of the visual-editor work rather than demoted. `Save template` is the studio's one primary action, and a real publish is milestone M4 (`docs/ROADMAP.md`).

## 7. The audit branch

Push it this week as a draft pull request and do not merge it until corrected, but cherry-pick `docs/JS_LEARNING_PATH.md` out of it now (item 4.16).

The branch `worktree-weekend-audit-plan` (four commits, about 3,238 lines) exists only on this laptop. It holds `docs/STATE_OF_THE_REPO.md`, `docs/INFRASTRUCTURE_PLAN.md`, `docs/JS_LEARNING_PATH.md` and eight rescued audit files under `docs/archive/`, including the plan the three environment Workers were built from. Settle the visibility question first, because two of its sections quote Cloudflare account ids. Then correct it surgically: add a "What changed since this was written" section naming the four superseding events (production access granted, three environment Workers deployed on 2026-09-15, repository transferred, repository public), edit only section 4 rows plus 5.1 and 5.7, repoint INFRASTRUCTURE_PLAN section 5 at `docs/archive/`, replace its SES deferral with the now-overdue configuration-set and SNS work, and add a README to the archive folder naming the two findings known to be wrong (its item 19 rated "no authentication" as P0 by reading `docs/DEPLOYMENT.md` rather than `server/auth.ts`). Then fold surviving findings into `docs/TECH_DEBT.md` so there is one register.

## 8. Refuted during verification

- "Make it obvious the API Keys page is a mock": already true. The page carries a "Seeded UI" badge beside the heading, a sub-headline on every card, and "Placeholder endpoint" badges on the snippets. The residual concern (README and ARCHITECTURE do not mention the page) survives in section 5.

## 9. Not verified from this machine

Re-checked on 2026-09-19: everything below is still unverified, minus one line and plus two.

- Anything on the AWS side: whether production access is actually granted, which identities are verified, whether any configuration set or account-level suppression list exists, whether `ses-policy.json` is the policy attached to the sending user, and whether DKIM, SPF, DMARC or a custom MAIL FROM exist for swarm.camp. Cause: the `swarm-dev-internal-tools` session token had expired.
- Whether the personal Cloudflare account `0f95923f…` is still reachable to delete its Worker.
- Whether `wrangler deploy` uploads `dist/email_template_studio/.dev.vars`. It should not; confirming needs a deploy. Rotate the credentials regardless.
- The entropy of `STUDIO_PASSWORD` on the top-level Worker (names only are listable).
- ~~Whether the Playwright suite passes today~~ — it does: 58 specs, green against the production build on 2026-09-19.
- **Which account `d0fa6b3d72170539438800a907ec5323` actually belongs to.** `docs/DEPLOYMENT.md` and `docs/HANDOVER.md` say a personal one, section 1 here says `swarm-work-emailer`, and D1 and R2 are both bound to it. Needs `npx wrangler whoami` against a live login.
- **Whether any remote D1 database or R2 bucket exists at all.** `wrangler.jsonc` still carries the placeholder `database_id`, so on the evidence in the repository: no.
- Whether GitHub secret scanning and push protection are on (the API returned 404); check in Settings.
- Whether an organisation-level Actions secret supplies a Cloudflare token (only repository secrets were listed, and there are none).

## 10. Where the judges disagreed

All three put the same four items in their top eight (the ignore-file fix, the format fix, the naming inversion, committing the environments) and all three named the naming inversion as the item with the worst consequences.

- **Top of the list.** Risk led with the credentials in `dist/`, business value led with the broken local server, sequencing led with the CI chain. All four are small and together about one evening, so the order runs CI chain, then the two one-line safety fixes, then the wrangler pair, then the configuration set. The only hard constraints: 3.1 before 3.2 (or the formatter rewrites another branch's worktree), and 3.6 before 3.7 (so the inverted configuration is never the reviewed baseline).
- **Reading the Playwright result** ranked fourth, ninth and eighteenth; resolved as first in "next" because it costs no slot.
- **`format:check` in `npm run check`** was only in one judge's top eight; kept there because it belongs in the same pull request and is the only thing preventing a repeat.
- **Retiring the old Worker** ranked seventh, fourteenth and twenty-sixth; placed third in "next" because it may be blocked on an account this login cannot see, and it cannot send.
- **Sender identity** was moved earlier by the business judge despite its dependency on the IAM policy item; the dependency is kept in the order but the DNS half should start on day one.
- **Cloudflare Access** ranked fifteenth, seventeenth and thirty-second; all agreed it is the strongest security improvement and impossible today.
- **Rate-limiting binding** was marked high severity and demoted by all three: Access will put a real identity in front of the login throttle, and the send limiter's weakness is bounded by volume.
