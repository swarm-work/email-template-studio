# Stytch authentication: implementation plan

Verified 2026-09-22 against main at `e016a4a`, the commit that merged PR #11 (visual editor, revamped studio
UI, D1-backed templates) on 2026-09-19. Every file and line number below was read out of that commit. Where
something could not be checked from inside the repository — anything needing a Stytch dashboard, an AWS
session or a Cloudflare dashboard — section 8 says so.

**This supersedes `docs/reviews/2026-09-16-stytch-implementation-spec.md`**, which was written against
`fff2d96` and is six days and one large pull request out of date. That document is still worth reading for
its background on Stytch's two product families and its trap list; section 5 here records every place it is
now wrong. Note that it is **not on main** — it and the vendor comparison beside it live only on the
unmerged `review/sns-stytch` branch, so `git show review/sns-stytch:docs/reviews/...` is how to read them.

Read section 1 for what changes, section 3 for the work, and section 5 if you are holding the old spec.

## 1. What this changes, in one paragraph

Today every person who opens the deployed studio types the same shared password. The consequence is not
weak security so much as **no attribution**: `server/app.ts:441` writes `by shared-password` into the send
audit line, and — since PR #11 — `migrations/0001_create_templates.sql` writes the same literal string into
the `created_by` and `updated_by` columns of every template and every immutable version. After this work,
each person signs in with their swarm.work Google account and those columns name a human. Removing someone
becomes deleting one row in a dashboard rather than changing a password everyone shares.

## 2. Decisions already made

These are settled. They are recorded here so the work does not re-open them.

| #   | Decision                                                                                                                                                                                                                                              | Why it is not up for debate                                                                                                                                                                                                                                                                          |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **B2B, not Consumer**                                                                                                                                                                                                                                 | Irreversible at project creation. A Consumer session JWT carries no email claim, and both the send audit line and the D1 `created_by` column must name a person. B2B also gives native domain restriction (`email_allowed_domains` + `RESTRICTED` JIT provisioning); Consumer cannot do that at all. |
| 2   | **Verify the JWT inside the Worker** with WebCrypto against Stytch's public JWKS, mirroring `createAccessAuthenticator` (`server/auth.ts:331`). No Stytch secret in the Worker, no `stytch` Node SDK, no `@hono/stytch-auth`.                         |
| 3   | **`@stytch/react` v20 is one package.** `createStytchClient`, not `new StytchUIClient`. `@stytch/vanilla-js` is no longer needed.                                                                                                                     |
| 4   | **Keep the shared-password gate** as the rollback lever until Stytch has run in production for a week.                                                                                                                                                |
| 5   | **Stytch over Cloudflare Access.** Two earlier reviews recommended Access — `AUTH_REVIEW.md` and `docs/reviews/2026-09-16-stytch-review.md`, neither of which is on main. We are proceeding with Stytch anyway; the reason is recorded as **ADR-31**. |
| 6   | **`env.production` becomes the real production Worker** (`docs/PRIORITIES.md` item 3.2, Option A). Stytch's redirect URLs point at that Worker's hostname, and it decides which D1 database is production.                                            |
| 7   | **No separate sign-in allow-list.** Dropped — see section 2.1.                                                                                                                                                                                        |

### 2.1 Why there is no `STUDIO_ALLOWED_EMAILS`

The superseded spec proposed a second allow-list in the Worker, checked per request. It has been cut.

Stytch B2B already restricts sign-in to swarm.work addresses natively through `email_allowed_domains` plus
`RESTRICTED` JIT provisioning, which is one of the reasons decision 1 chose B2B. The allow-list's only
unique contribution was **revocation speed**: because the Worker verifies signatures locally against cached
JWKS and never calls Stytch, a person removed from the organisation keeps a working token for up to five
more minutes. A per-request allow-list closes that window instantly.

For an internal tool with a handful of users, a five-minute revocation window is not a threat worth a second
source of truth for "who may use this". This repository already demonstrates what that costs: the production
hostname is currently written down three different ways (`docs/PRIORITIES.md:26`). One place to add and
remove people — the Stytch dashboard — is worth more than five minutes of revocation latency.

**The five-minute lag is therefore an accepted property of this design, not an oversight.** ADR-31 records it
as such. If it ever stops being acceptable, the allow-list is about forty lines and can be added then.

### 2.2 The ADR is number 31, not 18

The superseded spec twice says to write this decision into `docs/DECISIONS.md` as ADR-18, on the basis that
the slot was reserved. **That slot was taken by PR #11**: `docs/DECISIONS.md:76` is now "ADR-18 Visual editing
with `@react-email/editor`", and the file runs to ADR-30 at `:274`. `docs/DECISIONS.md:38` states that
decisions 31 onwards are proposed in `docs/PLAN.md` section 1 and get a numbered record when the phase that
uses them lands. ADR-31 is the next free number and this is that phase.

## 3. The work

Eleven tasks, one pull request each. Never leave `npm run check` red. Every task is revertable to the one
before it.

| #       | Task                                                           | Done when                                                                                                                                                                                                                          |
| ------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T0**  | Record ADR-31 in `docs/DECISIONS.md`                           | The ADR states the Stytch-over-Access reasoning and names the five-minute revocation lag as accepted; `npm run format:check` passes                                                                                                |
| **T1**  | Create a B2B **TEST** project and decode one real session JWT  | A scratch note records the literal `iss`, whether `aud` is a string or a one-item array, what `sub` looks like, **the exact key holding the email address**, and the HTTP status of an unauthenticated `curl` against the JWKS URL |
| **T2**  | `createStytchAuthenticator` in `server/auth.ts`, plus tests    | `npm run check` green with roughly twenty new cases in `server/auth.test.ts`, and the diff touches no file under `src/`                                                                                                            |
| **T3**  | Type `VITE_STYTCH_PUBLIC_TOKEN` and plumb it through CI        | The variable is declared in `src/vite-env.d.ts`; a build with it unset **fails loudly** rather than shipping an undefined token                                                                                                    |
| **T4**  | Teach `scripts/check-worker-bundle.mjs` about `@stytch/react`  | The guard exits non-zero when a file outside its allow-list imports the package, and exits zero on current main                                                                                                                    |
| **T5**  | Browser gate branch and `/authenticate`, lazily mounted        | `npm run dev` with the Test project id opens the studio after a real magic-link click; with the id unset the password box still works                                                                                              |
| **T6**  | Prove the end-to-end suite is untouched                        | `npm run test:e2e` fully green **and** a new request assertion shows zero Stytch chunks fetched in the e2e build                                                                                                                   |
| **T7**  | Production, with the rollback rehearsed                        | The deployed studio signs in with a swarm.work Google account, and removing `STYTCH_PROJECT_ID` then redeploying brings the password box back — observed, not assumed                                                              |
| **T8**  | Sign-out control in `src/presentation/layout/GlobalHeader.tsx` | The header names the signed-in person; a failed `session.revoke()` is handled with `{ forceClear: true }` rather than left as an unhandled rejection                                                                               |
| **T9**  | Documentation                                                  | `docs/DEPLOYMENT.md`'s mode table, `docs/PLAN.md`, `README.md` and the D1 audit-column story are updated together                                                                                                                  |
| **T10** | Delete the shared-password gate                                | A week after T7. Roughly minus four hundred lines across seven files, in the same commit that removes the `STUDIO_PASSWORD` secret                                                                                                 |

**What can run in parallel.** T2, T3 and T4 touch disjoint files and can proceed together once T1 has
produced the claim literals. T8 and T9 can proceed together once T7 has landed. Everything else is a chain.
T0 can be written at any point and should be written first, so the reasoning is on the record before any
code lands.

**Two things T10 must not delete.** `readCookie` (`server/auth.ts:282`) sits inside the password block and
the Stytch authenticator needs it to pull `stytch_session_jwt` off the Cookie header. `createDisabledAuthenticator`
(`server/auth.ts:309`) is the fail-closed default.

### 3.1 T2 in detail: what is reused and what is new

`server/auth.ts` was **not touched by PR #11** — the diff between `fff2d96` and `e016a4a` for that file and
its test file is empty. This is the single largest piece of good news in this plan, because it means the
whole verification apparatus already exists and is already tested.

Reused unchanged from the Cloudflare Access implementation:

- the JWKS cache with collapsed concurrent refresh, and the unknown-`kid` refetch floor (`server/auth.ts:331` onwards)
- the RS256 pin and the signature verification
- `readCookie` (`server/auth.ts:282`)
- the expiry and not-before check with sixty seconds of skew (`server/auth.ts:477-482`)
- the test rig in `server/auth.test.ts` — a real RSA key pair and an injected `fetch`

Genuinely new: the JWKS URL, and a Stytch version of `checkClaims` (`server/auth.ts:469`) carrying the `iss`
and `aud` literals that T1 produces.

Three rules that are easy to get wrong:

1. **Half-configured Stytch must return `{ mode: 'none', reason }`**, the way the half-Access guard already
   does in `loadAuthConfig` (`server/auth.ts:95`). Never throw — a thrown `ConfigError` becomes an HTTP 500,
   which the browser gate cannot interpret, and the result is a dead screen with no way in.
2. **Reject an empty `sub`.** Stytch's own SDK reads `sub: payload.sub || ''`, so a subject-less token would
   write an empty string into a `NOT NULL` audit column.
3. **Read only the claims you name.** Never spread the token payload into `Identity`; everything top-level
   you did not put there yourself is untrusted input.

Use a **mutable clock** in the cache test. A frozen `now: () => NOW_MS` makes `now() - fetchedAt` permanently
zero, so the staleness branch never fires and the test passes while asserting nothing.

### 3.2 Two exhaustive switches, and two more places that know the modes

Adding a fifth mode breaks the typecheck in two places at once, which is why T2 cannot be staged as "server
first, adapter later":

- `server/auth.ts:163` — `createAuthenticator`, cases at `:165-172`, no `default`
- `server/node.ts:97` — `describeAuth`, cases at `:98-104`, no `default`

Two further places know the mode list but will not fail the build:

- `src/presentation/auth/PasswordGate.tsx:53` only special-cases `'password'`. Ship the server without the
  browser branch and the studio locks with no way in, and it will look like a server bug.
- `docs/DEPLOYMENT.md:74-81` is the documented four-mode table. Miss it and the runbook lies during an
  incident.

## 4. Configuration

| Value                      | Where it lives                                       | Secret? | Notes                                                              |
| -------------------------- | ---------------------------------------------------- | ------- | ------------------------------------------------------------------ |
| `STYTCH_PROJECT_ID` (Live) | `wrangler.jsonc`, in the `env.production` vars block | No      | Public; it appears in the JWKS URL                                 |
| `STYTCH_PROJECT_ID` (Test) | `.dev.vars`, git-ignored                             | No      | Overrides the committed value locally                              |
| `VITE_STYTCH_PUBLIC_TOKEN` | **The build environment, not a Worker var**          | No      | See the trap below                                                 |
| Stytch project **secret**  | Nowhere in this repository                           | **Yes** | Only needed for revocation and GDPR deletion. Decide who holds it. |

**The public-token trap.** Vite inlines `VITE_`-prefixed values into the browser bundle **at build time**. A
wrangler `var` cannot deliver one. The CI deploy job runs `npm run build` with no `VITE_` environment, so the
first CI deploy after the Cloudflare token is armed would ship a bundle with an undefined token over a working
one. Add it as a GitHub Actions repository variable and reference it in the build step; the precedent exists,
since the workflow already uses `vars.CLOUDFLARE_ACCOUNT_ID`. Locally, use `.env.local`.

**To keep local development on `STUDIO_DEV_IDENTITY`** instead of Stytch, put a bare `STYTCH_PROJECT_ID=`
with no value in `.dev.vars`. `clean()` (`server/auth.ts:136`) treats an empty string as unset.

**The end-to-end build is unaffected by construction, on the server side.** `vars` is a non-inheritable
wrangler key, so `env.e2e` fully replaces the top-level block and continues to see only
`STUDIO_DEV_IDENTITY`. This is still true on `e016a4a`. It says nothing about the browser bundle — see risk 1.

## 5. What the 2026-09-16 spec gets wrong

### 5.1 Line numbers that moved

| The spec cites                                               | Current main                                                                            |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `server/app.ts:357`, the send audit line                     | **`server/app.ts:441`**; the refusal line is `:358`                                     |
| `server/app.ts:150`, returning `mode`                        | **`server/app.ts:194`**                                                                 |
| `server/app.ts:487-498`, the session cookie flags            | **`server/app.ts:586-600`**                                                             |
| `server/node.ts:82`, the second exhaustive switch            | **`server/node.ts:97`**                                                                 |
| `src/presentation/auth/PasswordGate.tsx:51` and `:61-69`     | **`:53`** and **`:63`**                                                                 |
| `src/App.tsx:17`, the page switch                            | **`src/App.tsx:23`**                                                                    |
| `src/presentation/layout/GlobalHeader.tsx:19`, `:43`, `:121` | props at **`:21`**, destructuring at **`:70-72`**, the avatar cluster at **`:179-185`** |
| `e2e/studio.spec.ts:48`, the console assertion               | **`e2e/studio.spec.ts:132-134`**                                                        |
| `server/auth.ts:470`, `checkClaims`                          | **`server/auth.ts:469`**                                                                |
| `docs/DECISIONS.md:25` reserves ADR-18                       | ADR-18 is taken; use **ADR-31** (section 2.2)                                           |
| `docs/PRIORITIES.md:137` and `:40`                           | **`:158`** and **`:62`**                                                                |

Every other `server/auth.ts` reference in the spec is still correct, because that file did not change.

### 5.2 Substantive changes the spec cannot know about

**Identity is persisted now, not just logged.** `migrations/0001_create_templates.sql` declares `created_by`
and `updated_by` as `NOT NULL` on both `templates` and `template_versions`, and
`server/templateRoutes.ts:122, 168, 189, 235` writes `c.get('identity').email` on create, update, version and
delete. The email claim decision governs stored rows, not one console line — which makes decision 1 more
load-bearing than the argument originally given for it.

**A build guard exists.** `scripts/check-worker-bundle.mjs` is chained into `npm run build` and enforces a
named allow-list of the six modules permitted to import `@react-email/editor`, plus a rule that nothing under
`server/`, `shared/` or `worker/` may even name it. This is the right structure to copy for Stytch (T4). It
will not catch Stytch on its own.

**`src/vite-env.d.ts` is new** and declares `ImportMetaEnv` with a single `VITE_DATA_MODE` member. It is the
obvious home for a typed `VITE_STYTCH_PUBLIC_TOKEN` (T3).

**`wrangler.jsonc` grew `d1_databases` and `r2_buckets`**, repeated under `env.e2e` with separate ids because
bindings are not inherited by a named environment (`docs/DEPLOYMENT.md:59`). Any new environment block needs
its own copies of both, or the Worker boots with no database and every template route answers
`503 storage-unavailable`.

**The end-to-end suite is much larger.** Five spec files and 58 Playwright tests (`docs/PRIORITIES.md:22`),
not ten tests in one file.

## 6. First verifiable step

The spec says to decode a real Stytch TEST-project JWT before writing any code, because `checkClaims` does a
strict `!==` on `iss` and a wrong literal is a silent total lockout that reads like a broken signature. That
is right, and it stands. Three refinements.

**Do the cheaper check first.** The thing that could change the _design_ is not the `iss` literal but whether
the JWKS endpoint needs credentials — if it does, a Stytch secret enters the Worker and decision 2 collapses.
That needs a project id and no sign-in at all:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://test.stytch.com/v1/b2b/sessions/jwks/<project_id>
```

Run it the moment the project exists. It also settles which B2B JWKS path is correct.

**Then still decode one real token**, because the key holding the email address depends on the claim-template
configuration and no documentation page substitutes for looking. That claim is what decision 1 was made for
and what now writes a `NOT NULL` column.

**And make being wrong loud, regardless.** Have the Stytch authenticator put the received `iss` next to the
expected one in its rejection reason. `server/app.ts:194` already returns `result.reason` in the 401 body, so
a mismatch would read `expected "..." got "..."` instead of looking like a signature failure. Derive the
issuer from the project id rather than storing a second literal, so there is one source of truth. This turns
the spec's "you would lose a day" into a thirty-second fix permanently, and is worth building even though T1
will have produced the right value.

## 7. Risks

1. **The end-to-end blast radius, and why wrangler config does not contain it.** Each of the five spec files
   keeps its own console-error collector — `e2e/studio.spec.ts:132`, `e2e/templates.spec.ts:150`,
   `e2e/theme.spec.ts:50`, `e2e/visual.spec.ts:81`, `e2e/screenshots.spec.ts:43` — and each fails its tests
   on any unexpected browser console
   error. The spec argues the e2e build is safe because `vars` is non-inheritable. That is true of the
   **Worker** and irrelevant to the **browser**: `VITE_STYTCH_PUBLIC_TOKEN` is inlined by Vite at build time,
   and `playwright.config.ts:44` builds the application itself and serves `vite preview` with
   `reuseExistingServer: false`. If the token is present in the build environment, the SDK ships into that
   bundle whatever `wrangler.jsonc` says. **Assert it rather than assuming it**: `e2e/visual.spec.ts:94-107`
   already does exactly this for the editor chunk, with an `EDITOR_CHUNK` regex at `:22` and a request
   listener asserting an empty array. A Stytch twin is about ten lines and turns T6 into a real gate.

2. **`e2e/screenshots.spec.ts` regenerates the README images** from the production build (`README.md:5`). A
   sign-in wall in front of the studio means those five specs either capture a login screen or fail, and the
   README silently starts lying. The e2e identity path must be settled before T6, not after. The intended
   answer is that `env.e2e` keeps `STUDIO_DEV_IDENTITY` and never receives a Stytch project id.

3. **The five-minute token now expires on a write path.** Before PR #11 an expired token meant a failed send.
   Now it means a refused template save (`server/templateRoutes.ts:168`), with revision-based optimistic
   concurrency directly behind it. The spec's "it randomly logs me out" trap is a lost-work bug here. Do not
   widen `CLOCK_SKEW_SECONDS` (`server/auth.ts:66`) to paper over it — sixty seconds was nothing against a
   long Access token but is twenty per cent of a Stytch JWT. Fix the browser-side refresh instead.

4. **Existing D1 rows say `shared-password`** and there is no backfill story. T9 must decide whether to leave
   them, annotate them, or migrate them.

5. **The bundle guard will not catch Stytch** until T4 extends it, and `npm run build` is where that would be
   caught. A static `@stytch/react` import from an eagerly loaded module passes the current guard silently and
   lands in the first download. Do T4 in the same pull request that adds the dependency.

6. **Rehearsing the rollback is itself a risky operation.** The lever is a variable change plus
   `npm run deploy`, and with no `--env` that command targets the live SES sender (`docs/PRIORITIES.md:26`).
   Decision 6 fixes this by making `env.production` real and flipping the top-level vars to dry-run, which is
   why decision 6 should land before T7. Until it does, rehearse on `env.e2e` or a named environment.

7. **Peer-dependency compatibility is unverified.** `package.json` pins react `^19.2.8`, vite `^8.2.2`,
   typescript `~6.0.2` and vitest `^5.0.0`. The spec verified the shipped types of `@stytch/react@20.3.0`,
   not that it installs against this tree. The first action of T5 is
   `npm install --dry-run @stytch/react@^20.3.0`; stop if it asks for `--legacy-peer-deps`.

8. **Stytch's cookies are not `HttpOnly` and are `SameSite=Lax`.** Today's password cookie is `HttpOnly` and
   `SameSite=Strict` (`server/app.ts:586-600`) and `docs/DEPLOYMENT.md` sells it on exactly that. This is a
   real reduction in defence in depth. Recovering `HttpOnly` requires a Stytch custom domain, which is the
   same DNS work Cloudflare Access is waiting on. What protects the send route meanwhile is the
   `x-studio-send: 1` header requirement (`server/app.ts:48`) and the JSON content type, neither of which a
   cross-site form can set. Keep both.

9. **If Stytch is down**, existing sessions die within five minutes and nobody can sign in. Cloudflare Access
   adds no such failure domain, because Cloudflare already serves the Worker. This is a cost of decision 5 and
   belongs in ADR-31.

## 8. What could not be verified from inside the repository

Do not treat these as settled.

1. **Whether the JWKS endpoint truly needs no credentials.** Stytch's API reference documents basic auth for
   it; all three of Stytch's own SDKs fetch it anonymously. Section 6 settles it with one `curl`. If it does
   need auth, `AuthenticatorOptions` (`server/auth.ts:155`) must grow a headers parameter and a Stytch secret
   enters the Worker, which changes the whole design.
2. **The exact B2B JWKS path and the claim literals.** T1 settles both.
3. **Whether the B2B login component completes the token exchange at the redirect URL.** Test it.
4. **The dashboard's default `max_session_duration_minutes`**, which is a ceiling that silently truncates a
   larger request. Check it before asking for 720 minutes.
5. **Whether `vite/client`'s `ImportMetaEnv` still carries an index signature.** If it does, an untyped
   `import.meta.env.VITE_STYTCH_PUBLIC_TOKEN` still compiles as `any` and T3 cannot rely on the compiler
   alone. `node_modules` was not installed when this was written.
6. **The live Cloudflare and Stytch dashboard state**, and anything on the AWS side.
