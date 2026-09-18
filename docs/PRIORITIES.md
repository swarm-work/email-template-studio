# Priorities: what to do next

Verified 2026-09-15 against main at `76a766a`, the live Cloudflare account `swarm-work-emailer`, and the GitHub repository `swarm-work/email-template-studio`. Every item below was checked on the current checkout or a live endpoint; where something could not be checked (mostly anything on the AWS side, because the local AWS session had expired) section 9 says so.

How it was produced: seven independent readers (sending path, auth surface, product state, environments and CI, the unmerged audit branch, documentation truth, and a run of every check) raised 127 candidate items; these were merged to 61, of which 16 were dropped as already done; 45 were then attacked by two adversarial reviewers each (one re-checking the evidence, one attacking severity and effort), 1 was refuted; three judges ranked the survivors from different angles (risk first, business value first, sequencing first); one synthesis reconciled them. Section 10 records where the judges disagreed.

Read section 1 (state), then section 2 (decisions only you can make), then work through section 3 in order.

## 1. Where things stand

The application is in better shape than the documentation says, and the operational setup is in worse shape.

The code on main is real, tested and deployed. Cloudflare Access JWT verification plus a shared-password gate enforce on every `/api/*` route, the SES sender was rewritten with `aws4fetch` so the Worker signs AWS requests at the edge, and 146 unit tests pass. The live Worker enforces this: `https://email-template-studio.swarm-work-emailer.workers.dev/api/send-test/status` answers `401 {"mode":"password"}` to an anonymous caller.

Four Workers now run on the `swarm-work-emailer` account and the naming is inverted. The unnamed top-level Worker `email-template-studio` is the real production: live SES sending, dry-run off, holding `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `STUDIO_PASSWORD` as secrets. The three Workers named `-dev`, `-staging` and `-production` hold no secrets at all and answer `401 {"mode":"disabled"}`: they serve the full studio UI publicly while refusing every API call. So `npm run deploy` (the command the README advertises, with no `--env`) targets the live sender, and a kill switch aimed at "production" during an incident would hit the wrong script. The configuration those three Workers were deployed from on 2026-09-15 exists only as an uncommitted change to `wrangler.jsonc`.

The sending rules from the SES production-access request are not implemented anywhere. No file mentions suppression. `server/app.ts` has four routes and none is an inbound webhook for SNS. `SES_CONFIGURATION_SET` is supported by the code and set on no Worker, so SES emits no event stream at all, right after production access was granted and right when AWS starts judging bounce and complaint rates you cannot see.

CI has been red since 2026-09-11 for one reason: `prettier --check` fails on nine tracked files. That step runs before Playwright, so the browser suite has not run since 2026-09-10, and neither the auth middleware (PR #3) nor the password gate and API Keys page (PR #4) has been verified end to end. There is no `CLOUDFLARE_API_TOKEN` secret, so nothing auto-deploys; there are no GitHub Environments and no branch protection; the `CLOUDFLARE_ACCOUNT_ID` repository variable still names the retired personal account. A stale Worker on that personal account is still online and answers `/api/send-test/status` with HTTP 200 and no credential. Locally, `npm run dev` returns 500 on every `/api/*` call because the AWS keys in `.dev.vars` are spelled in lowercase, and every `npm run build` copies that file, credentials included, into `dist/email_template_studio/.dev.vars`.

### Done since the plans were written

- PLAN phase 0: the studio is one Cloudflare Worker with static assets (`wrangler.jsonc`, `worker/index.ts`, `tsconfig.worker.json`, `.github/workflows/ci.yml`). Its exit criterion "CI green on main" is not met.
- PLAN phase 1 step 4: the AWS SDK is gone; `server/sesSender.ts` signs SES v2 REST calls with `aws4fetch` (ADR-16), with unit tests that need no AWS account.
- PLAN phase 1 steps 2 and 3: Access JWT verification and a mandatory identity on every `/api/*` route, failing closed (`server/auth.ts`, `server/app.ts`), 43 auth test cases.
- Beyond the plan: a shared-password gate (`POST`/`DELETE /api/session`, HMAC session cookie, login throttle, `src/presentation/auth/PasswordGate.tsx`) because Access still needs a custom domain.
- PLAN phase 1 step 5: the scoped IAM policy exists as `ses-policy.json` (send only from `testing@swarm.camp` to `echo@swarm.work`), still untracked.
- Live SES sending is on and deployed on the top-level Worker.
- One sender factory (`server/createSender.ts`) shared by the Node adapter and the Worker.
- HANDOVER part A: the repository moved to `swarm-work`. The visibility half (private) was not done.
- HANDOVER B3: the Cloudflare account is pinned in `wrangler.jsonc`; dev, staging and production environments were written and deployed, uncommitted.
- FEATURE_PLAN phase 4, started early as a browser-only mock: the API Keys page and product navigation (PR #4).
- Tech-debt rows paid but not struck off: #3, #12, #15, #18, #21.

## 2. Decisions only you can make

Answer these first; the first one gates the whole environments block.

1. **Which Worker is production?** Option A (recommended): make `env.production` the real live sender, move the AWS keys and `STUDIO_PASSWORD` secrets onto it, and flip the top-level vars to dry-run so a bare `wrangler deploy` and `npm run dev` are both harmless. Option B: rename `env.production` back to `email-template-studio` per `docs/HANDOVER.md` and delete `email-template-studio-production`.
2. **Does the repository stay public?** It is public today; HANDOVER decided "private, or internal". Currently published: the previous owner's personal Cloudflare account id and Gmail-login wording, the personal `workers.dev` hostname (live and unauthenticated), and the full live-send configuration with its single allow-listed recipient. This gates pushing the audit branch and the documentation scrub.
3. **Can you still log in to the personal Cloudflare account `0f95923f…`?** The retired Worker there is online and unauthenticated. The current wrangler login cannot see that account. If it is unreachable, that is a bigger finding than the Worker and belongs in HANDOVER.
4. **Three deployed environments, or two?** Each one you keep needs its own password or Access policy, its own sender configuration and a place in the rollback runbook. For one developer, dev plus production may be enough.
5. **What is the production sender address?** Suggested: `no-reply@mail.swarm.camp` with a custom MAIL FROM subdomain, keeping `testing@swarm.camp` for staging. This needs DNS records and takes days to verify, so decide early.
6. **Long-lived IAM user keys for the Worker, yes or no?** HANDOVER says "ask before creating a static key". The Worker cannot refresh temporary STS credentials, so the options are a long-lived key with 90-day rotation, or accepting that sending stops when a token expires. If yes, who owns and rotates it?
7. **Is there a second repository admin?** Branch protection with "require 1 approval" deadlocks a solo maintainer. Without one, require the `check` status and block force pushes only.
8. **Which swarm.camp email is the first real template?** Invitation, billing notice, contract, or engagement update. Start with the one sent most often.
9. **Which mailbox receives bounce and complaint alarms and SNS confirmations?** It must be read promptly; these alerts protect the production access.

## 3. Now: this week, in this order

Sizes: S is a day or less, M about a week, L two to three weeks, for one developer learning as they go. The first five together are about one evening.

| #   | Item                                                                                            | Size | Area         |
| --- | ----------------------------------------------------------------------------------------------- | ---- | ------------ |
| 1   | Ignore `.claude/worktrees`, `.vite` and the ngrok tarball in `.gitignore` and `.prettierignore` | S    | code-quality |
| 2   | Run Prettier on the nine tracked files so CI goes green and Playwright runs again               | S    | ci-cd        |
| 3   | Add `format:check` to `npm run check` so the local gate matches CI                              | S    | process      |
| 4   | Stop `npm run build` copying `.dev.vars` with live AWS credentials into `dist/`                 | S    | security     |
| 5   | Fix `.dev.vars` key casing and add `STUDIO_DEV_IDENTITY` so `npm run dev` works                 | S    | environments |
| 6   | Move live-sending settings off the top-level target and end the production naming inversion     | M    | environments |
| 7   | Commit the `wrangler.jsonc` dev/staging/production block that is already deployed               | S    | environments |
| 8   | Create an SES configuration set per environment and set `SES_CONFIGURATION_SET`                 | M    | sending      |

### 3.1 Ignore the worktree, the Vite cache and the tarball

**Why first.** Running `npm run format` today would rewrite files inside another branch's live worktree under `.claude/worktrees/`, and `git add -A` would commit that worktree and the Vite cache into main. `npx prettier --check .` reports 19 files locally against 9 in CI; the extra ten are the worktree copy and `.vite/deps/_metadata.json`.

**How.** Append `.claude/worktrees/`, `.vite/` and `*.tgz` to `.gitignore`, and `.claude/` plus `.vite/` to `.prettierignore`. Re-run the check and confirm the count is exactly 9.

### 3.2 Format the nine files and turn CI green

**Why.** The failing step is `npm run format:check`; the nine files are `docs/DEPLOYMENT.md`, `docs/SENDING.md`, `docs/TECH_DEBT.md`, `server/app.ts`, `server/app.test.ts`, `server/auth.ts`, `server/auth.test.ts`, `src/presentation/auth/PasswordGate.tsx` and its test. Pure whitespace, no behaviour change. Green CI does not start deploying anything: there is no `CLOUDFLARE_API_TOKEN`, so the deploy job still skips.

**How.** After 3.1: `npm run format`, confirm `git diff --stat` touches only those nine files, commit, push.

### 3.3 Make `npm run check` include the format check

**Why.** `npm run check` is what the README tells you to run before pushing, and it omits the one check that has been red for days. There are no git hooks, which is how PRs #3 and #4 both landed red.

**How.** In `package.json` set `"check": "npm run typecheck && npm run lint && npm run format:check && npm run test"`, collapse CI to the single `npm run check` step, update the README scripts table. Same pull request as 3.2.

### 3.4 Keep credentials out of `dist/`

**Why.** `dist/email_template_studio/.dev.vars` exists after every build (1297 bytes on 2026-09-15) and holds the real AWS access key, secret and session token. `dist/` is git-ignored, but it is exactly what gets zipped, attached to a bug report or uploaded as an artifact. The plan is to replace today's expiring token with a long-lived key, at which point every build copies a permanent credential. `playwright.config.ts` already deletes the file in one place; `npm run deploy` does not.

**How.** `"build": "npm run cf:types && tsc -b && vite build && rm -f dist/email_template_studio/.dev.vars"`, drop the now-redundant `rm` from `playwright.config.ts`, add `dist/**/.dev.vars` to `.gitignore`. Treat the current credentials as needing rotation regardless.

### 3.5 Make local development work again

**Why.** `.dev.vars` spells the AWS keys in lowercase; `server/config.ts` only knows the uppercase names, so with sending enabled and dry-run off the send routes report a misconfigured server (before phase 7a that was a 500 on every `/api/*` call; the Worker now switches sending off and leaves the rest of the API working). The password gate cannot be tested locally either. The dangerous wrong fix is reaching for the production key.

**How.** Uppercase `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN` in `.dev.vars`, add `STUDIO_DEV_IDENTITY=echo@swarm.work`, set `STUDIO_SEND_DRY_RUN=true` for day-to-day work. Then `curl localhost:5173/api/send-test/status` should return 200 with your identity. Make the failure explain itself: in `server/config.ts`, detect a lowercase `aws_access_key_id` and throw a `ConfigError` naming the uppercase spelling. Update `.dev.vars.example` and the README quick start.

### 3.6 Name production correctly

**Why.** Three consequences of one root cause: `npm run deploy` deploys the live sender with no `--env`; `npm run dev` inherits the same top-level vars, so a local server with credentials present is a live sender while the README promises sending is off; a rollback or kill switch applied to "production" would hit the wrong Worker. You cannot safely operate a live sender you cannot name.

**How.** Pick option A or B from section 2. Replace the bare `deploy` script with `deploy:dev`, `deploy:staging`, `deploy:production` that set `CLOUDFLARE_ENV` at build time (the Vite plugin resolves the environment during `vite build`, not during `wrangler deploy`). Do it in the same commit as 3.7 so the inverted configuration is never the reviewed baseline.

### 3.7 Commit the environments block

**Why.** Three Workers have served the internet since 2026-09-15 from configuration that exists only in one working tree. Nobody can review, reproduce or roll them back, and a `git checkout wrangler.jsonc` destroys the only record of what is live. This is also where the configuration set and per-environment sender go next.

**How.** One small pull request: `wrangler.jsonc`, plus the `docs/DEPLOYMENT.md` environments table rewritten against the real Workers with their send posture and auth posture. Resolve `STUDIO_ENVIRONMENT` before committing: either read it in `server/config.ts` and surface it, or delete it, since no code reads it today. Commit `ses-policy.json` separately (item 4.9).

### 3.8 Create SES configuration sets

**Why.** This is the one item whose damage is irreversible. Without a configuration set, SES emits no bounce, complaint, rejection or delivery events, and AWS revokes production access on rates you cannot see. Everything downstream (SNS, suppression, alarms, the delivery log) depends on this one setting. The code already forwards `SES_CONFIGURATION_SET`; nothing sets it.

**How.** Step zero is a fresh AWS session for `swarm-dev-internal-tools`. Confirm reality with `aws sesv2 get-account` and `aws sesv2 get-email-identity --email-identity swarm.camp` in `ap-southeast-2`. Create `studio-transactional-production` and `studio-transactional-staging` with reputation metrics enabled, add `SES_CONFIGURATION_SET` to the relevant vars blocks, redeploy, send one test and check the set's metrics. In the same session enable the account-level suppression list for BOUNCE and COMPLAINT (the no-code half of item 4.10).

## 4. Next: the following two to three weeks, in order

| #    | Item                                                                                              | Size | Area     |
| ---- | ------------------------------------------------------------------------------------------------- | ---- | -------- |
| 4.1  | Read the Playwright result that green CI now produces, and fix what broke                         | S    | ci-cd    |
| 4.2  | Give the deployed dev/staging/production Workers an auth mode, or take them down                  | S    | security |
| 4.3  | Delete the retired personal-account Worker that still serves a public, unauthenticated build      | S    | security |
| 4.4  | Decide and record whether the repository stays public, and scrub personal identifiers             | S    | security |
| 4.5  | Push the audit branch and open a draft pull request                                               | S    | process  |
| 4.6  | Point `CLOUDFLARE_ACCOUNT_ID` at `swarm-work-emailer`, or delete the variable                     | S    | ci-cd    |
| 4.7  | Rewrite README, DEPLOYMENT and HANDOVER against what is actually deployed                         | M    | docs     |
| 4.8  | Write down the swarm.camp / swarm.work sending rules and the suppression requirement              | M    | docs     |
| 4.9  | Track `ses-policy.json` (account id as a placeholder) and add a configuration-set condition       | S    | security |
| 4.10 | Put one suppression check in front of every send path and enable the SES suppression list         | M    | sending  |
| 4.11 | Add bounce and complaint rate alarms once the configuration set emits metrics                     | S    | ops      |
| 4.12 | Give production a real transactional sender identity instead of `testing@swarm.camp`              | M    | sending  |
| 4.13 | Enable Dependabot and secret scanning, and add `npm audit` to CI                                  | S    | security |
| 4.14 | Create a GitHub Environment `production` with a required reviewer, before any deploy token exists | S    | ci-cd    |
| 4.15 | Protect main with a ruleset requiring a pull request and the `check` job                          | S    | ci-cd    |
| 4.16 | Cherry-pick `docs/JS_LEARNING_PATH.md` from the audit branch, ahead of the rest of it             | S    | docs     |

Notes that change how you do them:

- **4.1** costs nothing: Playwright sits in the same CI job right after the format step, so it runs on the next push after 3.2. Expect failures around the password gate in specs that assume the studio renders immediately; fix the specs or the e2e identity path, do not skip them.
- **4.2** All three env Workers answer `401 {"mode":"disabled"}` and `wrangler secret list --env <name>` is empty for each. Keep one usable (`openssl rand -base64 24`, then `npx wrangler secret put STUDIO_PASSWORD --env staging`) and take the others off `workers.dev` (`"workers_dev": false`) or delete them.
- **4.3** `https://email-template-studio.jerichodelrosario35.workers.dev/api/send-test/status` returns HTTP 200 with no credential, a response shape only pre-auth code produces. Follow HANDOVER B7; if the personal account is unreachable, record that instead. Update `README.md` and `docs/DEPLOYMENT.md` in the same change.
- **4.4** gates 4.5 and 4.7, so answer question 2 first.
- **4.5** Push as `docs/weekend-audit-plan`, leave it a draft until corrected (item 5, `correct-audit-docs`). Its own Prettier commit already formatted its files.
- **4.6** `gh variable set CLOUDFLARE_ACCOUNT_ID --repo swarm-work/email-template-studio --body d0fa6b3d72170539438800a907ec5323`, or delete it and rely on `wrangler.jsonc`. Say which in DEPLOYMENT.
- **4.7** The dangerous lines first: `README.md` line 7 and `docs/DEPLOYMENT.md` lines 13 to 14 say sending is off and there is no authentication; both are the opposite of reality. Then the two tables, the wrangler header comments, and HANDOVER's claim that `routes` is non-inheritable (it is inheritable in wrangler 4.130; an inherited custom domain would move it away from the top-level Worker). Add a "last verified" date to every present-tense document.
- **4.8** is the specification 4.10 is built against. Add `docs/SENDING_POLICY.md`: identity per domain, what each may send, volume, the configuration-set to SNS to backend path, suppression as a precondition of every send, who owns the decision.
- **4.9** Move to `infra/ses-policy.json`, replace the account id with a placeholder substituted at deploy, add `ses:ConfigurationSetName` to the send statement once the set exists, and verify what is actually attached to the IAM user.
- **4.10** One `server/suppression.ts` exporting `isSuppressed(address)`, injected into `createApp`, called once in `server/app.ts` right after the allow-list check, returning 403 `recipient-suppressed`. Back it with the SES suppression API now.
- **4.11** CloudWatch alarms on `Reputation.BounceRate` (5%) and `Reputation.ComplaintRate` (0.1%) for the set, plus a daily send-count ceiling.
- **4.12** Start the DNS half on day one: verify `mail.swarm.camp` with DKIM, custom MAIL FROM, SPF and DMARC. Move `SES_FROM_ADDRESS` and the IAM `ses:FromAddress` condition in lockstep. Adding the zone to the `swarm-work-emailer` account is also the prerequisite for Cloudflare Access.
- **4.13** Dependabot alerts are confirmed disabled. Two toggles plus a `.github/dependabot.yml` with monthly npm and actions schedules.
- **4.14** Before the token: environments `production` and `staging`, a required reviewer on production, `environment:` on the deploy job, the token as an environment secret scoped to edit Workers on account `d0fa6b3d…` only.
- **4.15** After 3.2 lands, or the required check can never pass. Do not require approvals until a second admin exists.
- **4.16** `git checkout worktree-weekend-audit-plan -- docs/JS_LEARNING_PATH.md` on a fresh branch. Fix its hour-one instruction, which currently leads to the 500 from item 3.5.

## 5. Later: when the above is done or there is slack

| Item                                                                                       | Size | Area         | Why it waits                                                                                                                             |
| ------------------------------------------------------------------------------------------ | ---- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Put Cloudflare Access on a real hostname in front of the live-sending Worker               | L    | security     | Access cannot protect `*.workers.dev`; do it with the DNS work in 4.12. Put `routes` inside each env block.                              |
| Share one wire contract between `server/app.ts` and the browser's `emailProvider.ts`       | M    | code-quality | Two hand-written schemas already drift (`user`, `rateLimitPerMinute` are dropped by the client). Good typed-boundary practice.           |
| Show the real environment and signed-in user in the header instead of the literal "Local"  | M    | product      | All four deployed Workers say "Local" (`src/App.tsx` lines 29 and 42). `STUDIO_ENVIRONMENT` exists for this and nothing reads it.        |
| Fix studio copy claiming everything is local and no email is sent                          | M    | product      | `PageHeader.tsx` and `AppFooter.tsx` contradict live behaviour; drive copy from the status response. Fold in making Send primary.        |
| Build `POST /api/webhooks/ses` and verify the SNS signature                                | L    | sending      | The largest new code; needs the configuration set and the contract refactor first. Exempt from the authenticator like the session route. |
| Decide and document the credential type and rotation for the Worker's AWS keys             | S    | security     | Answers HANDOVER's open question. One IAM user per sending environment, 90-day rotation, named owner.                                    |
| Replace the in-memory send and login rate limiters with a Cloudflare rate-limiting binding | M    | sending      | Per-isolate counters reset on cold start; bounded today by low volume and a person in the loop. Access makes the login one moot.         |
| Add a real transactional send path alongside the test-send dialog                          | M    | sending      | The smallest slice that does real work: recipient validated and suppression-checked, subject verbatim, type-to-confirm. No D1 needed.    |
| Add the real swarm.camp transactional templates to the registry                            | M    | product      | The library holds three fictional samples. Code-only templates are enough at under 100 emails a month.                                   |
| Write tests for `worker/index.ts` and `server/createSender.ts`                             | S    | code-quality | The sender factory is the no-send guarantee's enforcement point and has no test. Add `worker/**/*.test.ts` to the Vitest include.        |
| Make the CI deploy job environment-aware via `CLOUDFLARE_ENV` at build time                | M    | ci-cd        | `--env` on deploy alone does not work with the Vite plugin. Nothing deploys automatically today, so this waits for the token.            |
| Add a post-deploy smoke check to the deploy job                                            | S    | ci-cd        | Would have caught the three unauthenticated env Workers the day they shipped.                                                            |
| Write and rehearse a per-environment rollback procedure                                    | S    | ops          | Documented commands carry no `--env`; rehearse once on staging and record the kill switch and its target Worker.                         |
| Correct the audit-branch documents before merging them                                     | M    | docs         | Six claims in STATE_OF_THE_REPO are now false; add a "what changed since" section, fix section 4 rows plus 5.1 and 5.7 only.             |
| Update the technical-debt register                                                         | S    | docs         | Rows #3, #12, #15, #18, #20 are paid; #21 is false since ADR-16; #15 contradicts #19; two size figures drifted.                          |
| Fix the stale AWS-SDK paragraphs in ARCHITECTURE.md and the contradiction in SENDING.md    | S    | docs         | ARCHITECTURE still describes credentials from a developer profile; SENDING says both "authenticated" and "not authenticated yet".        |
| Document the API Keys page, navigation and sign-in screen in README and ARCHITECTURE       | S    | docs         | A shipped product surface is invisible in the entry documents, and nothing there says the keys are a mock.                               |
| Stop keying the session HMAC with the password itself, and give sessions an id             | M    | security     | One captured cookie allows offline brute force of the password that also unlocks live sending. Hardens a gate Access will replace.       |
| Add a sign-out control (`DELETE /api/session` exists but nothing calls it)                 | S    | product      | A 12-hour session with no way to end it on a shared browser.                                                                             |
| Harden the session cookie with the `__Host-` prefix                                        | S    | security     | Worth doing when a custom domain exists.                                                                                                 |
| Introduce a message stream so the transactional-only rule is enforceable in code           | L    | product      | When `POST /api/v1/emails` is built, make `stream` a required field validated against a config map. Keep the `[TEST]` prefix until then. |
| Record the deferral of FEATURE_PLAN phase 0 (router, query, repositories, seed)            | S    | process      | None of it sends an email. A dated note stops it being re-litigated.                                                                     |
| Add coverage reporting so untested modules surface automatically                           | S    | code-quality | `@vitest/coverage-v8`, no CI threshold yet.                                                                                              |
| Delete the stray ngrok tarball and prune the merged remote branches                        | S    | code-quality | Five merged branches sit on the public remote. Verify with `git branch -r --merged main` first.                                          |
| Pin `wranglerVersion` in the wrangler-action step                                          | S    | ci-cd        | The deploy action installs its own unpinned wrangler.                                                                                    |
| Stop `cancel-in-progress` from cancelling an in-flight deploy                              | S    | ci-cd        | Move `concurrency` to the check job only.                                                                                                |
| Pin the Node version with `.nvmrc` and align `engines` with CI                             | S    | code-quality | Three Node versions are in play (CI 24, engines >=22.18, this machine 26).                                                               |
| Fix stale cross-references and small README gaps                                           | S    | docs         | FEATURE_PLAN cites PLAN as on a branch; README omits three scripts and one doc; WEBHOOKS.md and OPERATIONS.md are referenced but absent. |
| Correct or retire `.claude/agents/ui-overflow-fixer.md`                                    | S    | process      | Claims a send server on port 8790 that Playwright does not start; hard-codes commit trailers.                                            |
| Remove the two dead `eslint-disable` comments                                              | S    | code-quality | The project lints with oxlint.                                                                                                           |
| Add template search and download-HTML to the studio                                        | S    | product      | Slack-time practice; revisit search at about ten templates.                                                                              |

## 6. Dropped, and why

- **Defer infra/core OpenTofu until the SES event pipeline works.** Unanimous. Its whole action is "do not build this yet", which ordering already expresses. Keep the useful sentences inside INFRASTRUCTURE_PLAN when correcting the audit docs.
- **Split `ApiKeysPage.tsx` (714 lines of mock data).** Do not refactor mock code; FEATURE_PLAN phase 4 replaces it, and the split falls out of that work.
- **Refresh the stale counts in `docs/ASSESSMENT.md`.** It is a dated snapshot that will rot again. The one-line "snapshot, not maintained" header is folded into the cross-references item.
- **Say less in the unauthenticated 401 body.** The verbose message appears only in auth mode `disabled`, which item 4.2 removes from every deployed Worker.
- **Demote the simulated Publish button.** The dialog is already honestly labelled "Simulated"; the two-button reorder is folded into the studio-copy item.

## 7. The audit branch

Push it this week as a draft pull request and do not merge it until corrected, but cherry-pick `docs/JS_LEARNING_PATH.md` out of it now (item 4.16).

The branch `worktree-weekend-audit-plan` (four commits, about 3,238 lines) exists only on this laptop. It holds `docs/STATE_OF_THE_REPO.md`, `docs/INFRASTRUCTURE_PLAN.md`, `docs/JS_LEARNING_PATH.md` and eight rescued audit files under `docs/archive/`, including the plan the three environment Workers were built from. Settle the visibility question first, because two of its sections quote Cloudflare account ids. Then correct it surgically: add a "What changed since this was written" section naming the four superseding events (production access granted, three environment Workers deployed on 2026-09-15, repository transferred, repository public), edit only section 4 rows plus 5.1 and 5.7, repoint INFRASTRUCTURE_PLAN section 5 at `docs/archive/`, replace its SES deferral with the now-overdue configuration-set and SNS work, and add a README to the archive folder naming the two findings known to be wrong (its item 19 rated "no authentication" as P0 by reading `docs/DEPLOYMENT.md` rather than `server/auth.ts`). Then fold surviving findings into `docs/TECH_DEBT.md` so there is one register.

## 8. Refuted during verification

- "Make it obvious the API Keys page is a mock": already true. The page carries a "Seeded UI" badge beside the heading, a sub-headline on every card, and "Placeholder endpoint" badges on the snippets. The residual concern (README and ARCHITECTURE do not mention the page) survives in section 5.

## 9. Not verified from this machine

- Anything on the AWS side: whether production access is actually granted, which identities are verified, whether any configuration set or account-level suppression list exists, whether `ses-policy.json` is the policy attached to the sending user, and whether DKIM, SPF, DMARC or a custom MAIL FROM exist for swarm.camp. Cause: the `swarm-dev-internal-tools` session token had expired.
- Whether the personal Cloudflare account `0f95923f…` is still reachable to delete its Worker.
- Whether `wrangler deploy` uploads `dist/email_template_studio/.dev.vars`. It should not; confirming needs a deploy. Rotate the credentials regardless.
- The entropy of `STUDIO_PASSWORD` on the top-level Worker (names only are listable).
- Whether the Playwright suite passes today; it has not run since 2026-09-10.
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
