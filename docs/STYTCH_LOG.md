# Stytch sign-in: what broke, what we changed, what is still open

A running log of the work to make Stytch sign-in actually work, kept so the
changes can be audited against the problems they answer. Newest at the bottom
of each section. `docs/STYTCH_PLAN.md` is the plan; this file is what happened
when the plan met the real project. `docs/DECISIONS.md` ADR-31 is the why.

Everything here was observed on the **Test** project `swarm-internal` on
2026-09-23 and 2026-09-24, from a dev server on `http://localhost:5173`
(and, earlier, over Tailscale from a second device).

## 1. Where things stand (2026-09-24)

- **Email magic-link sign-in works end to end**: Stytch session, Worker accepts
  it, studio opens. It needs nothing in the Stytch dashboard beyond the
  Authorized Domain and Redirect URL.
- **Google sign-in reaches a Stytch session but the Worker refuses it**, because
  a default B2B session token carries no email address and Google's
  authentication factor does not either. It needs the project's **custom claim
  template** (section 4, decision 2). The template was added once and did not
  take effect; a fresh session minted afterwards still had no `email` claim, so
  it is not active in this environment.
- Sessions are currently **60 minutes**, not the planned 12 hours (decision 1).
- Merged today: PR #17 (production D1 id), #18 (dev port pinned), #19 (sign-in
  screen). This log ships with the branch `fix/stytch-sign-in`.

## 2. The issues, in the order they were hit

Each one was a different fault. None of them was the one before it.

| #   | What it looked like                                                                                                                                                                    | Root cause                                                                                                                                                                                                                                                                                                                                                     | Side                            | Fix                                                                                                                         | Status                                    |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | Vite: `Failed to resolve import "@react-email/editor/core"`                                                                                                                            | `node_modules` in the main checkout predated PR #11; the package was never installed there                                                                                                                                                                                                                                                                     | local env                       | `npm install`                                                                                                               | done                                      |
| 2   | Gate: "This studio is not available right now … requires you to sign in"                                                                                                               | The main checkout was 4 commits behind `origin/main` and **contained no Stytch code at all**; `STYTCH_PROJECT_ID` in `.dev.vars` was read by a Worker that did not know the variable (`/api/send-test/status` → `mode: "disabled"`)                                                                                                                            | local env                       | run from a checkout that has PR #14; later, pull                                                                            | done                                      |
| 3   | Console: `bad_domain_for_stytch_sdk`                                                                                                                                                   | Browser origin not in the project's SDK Authorized Domains. `vite --host` advertises 7 LAN/Tailscale origins; the one in use was not the one registered                                                                                                                                                                                                        | Stytch dashboard + dev setup    | register the exact origin; pin the port and allow the tailnet host (PR #18)                                                 | done                                      |
| 4   | Google: `no_match_for_provided_oauth_url` at start                                                                                                                                     | `/authenticate` not registered as a Redirect URL for the **Discovery** type (the app uses one URL for login, signup and discovery)                                                                                                                                                                                                                             | Stytch dashboard                | register it with all three types                                                                                            | done                                      |
| 5   | Google: "Looks like there was an error!"; `POST …/discovery/intermediate_sessions/exchange` → 400                                                                                      | `StytchSignIn.tsx` built the client in `useMemo`; React StrictMode runs `useMemo` initialisers twice in development, so **two Stytch clients** existed, each with its own session manager. Stytch warned about it in the console. First exchange to succeed came right after the fix (with sessions also lowered to 60 min in the same change, see decision 1) | **our code**                    | create the client once, at module scope                                                                                     | done, this branch                         |
| 6   | Sign-in "succeeds", nothing happens                                                                                                                                                    | `PasswordGate` probed the API once on mount and never again; the SDK gives no redirect of its own                                                                                                                                                                                                                                                              | **our code**                    | `callbacks.onEvent` → gate re-probes, leaves `/authenticate`, and if the API still refuses, shows its reason under the form | done, this branch                         |
| 7   | Gate: "…refused the session: Stytch session token carries no email address. Claims present: aud, exp, https://stytch.com/organization, https://stytch.com/session, iat, iss, nbf, sub" | The Worker looked in four claim paths that all depend on a **claim template** nobody had created (STYTCH_PLAN T1 was skipped). Decoding a real token showed the only address in it is `https://stytch.com/session.authentication_factors[].email_factor.email_address`, present for email factors only                                                         | **our code** + Stytch dashboard | Worker falls back to the email authentication factor (covers magic link / OTP); Google still needs the template             | fallback done, this branch; template open |

Things that were suspected and **ruled out, with evidence**, so nobody re-chases them:

- PKCE mismatch: the project bootstrap says `pkce_required_for_oauth: false`.
- "No organisation to land in": `create_organization_enabled: true`, and the token names `organization-test-3c48ecc8…`, slug `swarm`.
- StrictMode consuming the callback token twice: the SDK strips `token` from the URL synchronously before the network call (`createAuthUrlHandler.mjs:40-44`), so the second effect run finds nothing.
- The Worker rejecting the token at issue 5: the Worker had not been called yet.

## 3. What this branch changes, file by file

| File                                     | Change                                                                                                                                                                                                                                                                                                                                                      | Answers                 |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `src/presentation/auth/StytchSignIn.tsx` | Client created once at module scope (was `useMemo` in the component). `callbacks.onEvent` reports the session-creating events (`B2B_DISCOVERY_INTERMEDIATE_SESSION_EXCHANGE`, `…ORGANIZATIONS_CREATE`, and the three non-discovery authenticate events) through a new `onSignedIn` prop. `SESSION_DURATION_MINUTES` is 60 with the reason written above it. | issues 5, 6; decision 1 |
| `src/presentation/auth/PasswordGate.tsx` | `onStytchSignedIn`: `replaceState` off `/authenticate`, re-probe; the API stays the only thing that opens the gate. The `stytch` state now keeps the API's message, shown only after a sign-in attempt, with a **Sign out of Stytch and try again** button (revoke with `forceClear`, reload) because a refused session can only be replaced, not repaired. | issues 6, 7             |
| `server/auth.ts`                         | `emailFromAuthenticationFactors`: after the four explicit paths, read `https://stytch.com/session.authentication_factors[].email_factor.email_address`. Template claim still wins. Refusal message now says the factor was tried too.                                                                                                                       | issue 7                 |
| `server/stytchAuth.test.ts`              | Three tests built from the real token's shape: reads the factor; prefers a top-level `email`; still refuses a Google-only factor.                                                                                                                                                                                                                           | issue 7                 |
| `docs/STYTCH_LOG.md`                     | this file                                                                                                                                                                                                                                                                                                                                                   | —                       |

Unchanged on purpose: the lazy seam (`StytchSignIn.tsx` and `stytchSignOut.ts` are still the only modules naming `@stytch/react`; the build guard confirms it), the Discovery flow, the products, the three redirect URLs, the password gate as rollback.

## 4. Decisions to align on

1. **Session length: 60 minutes or 12 hours?** 12 was the design (parity with the password gate). 60 is what works today. Whether the project's dashboard ceiling was _also_ a cause of issue 5 is unknown: the ceiling and the double client were changed in the same step. To settle it: raise the dashboard maximum to ≥ 720, set the constant back to `12 * 60`, sign in once, watch the `exchange` call.
2. **Google sign-in needs the claim template.** Session JWT template body, in the **Test** environment of `swarm-internal`: `{ "email": {{ member.email_address }} }`. Templates apply to sessions created after they are saved. A token minted at `04:46:31Z` on 2026-09-24, after the template was reportedly added, had no `email`, so the template is not active: re-check environment, project and that it saved. Until then Google sign-in cannot work, by construction — `google_oauth_factor` carries `email_id`, never the address (Stytch API reference).
3. **Keep the factor fallback?** Recommended yes. It is Stytch-signed data naming the address Stytch itself delivered a link to, and it removes a hard dependency on a dashboard setting for the email flows. It does not weaken anything: the token is signature-verified before it runs.
4. **Organisation configuration is unverified.** The org `swarm` exists. Whether it has `email_allowed_domains: ["swarm.work"]` and RESTRICTED JIT provisioning, which ADR-31 relies on to keep sign-in to the team, has not been checked in the dashboard.
5. **Two small things noticed, not changed:** `src/App.tsx:47` probes the status route outside the gate (six 401s in the dev console on every locked load; harmless); `PasswordGate.tsx` treats any visit to `/authenticate` as mid-flow by pathname alone.

## 5. Verification, as of this commit

- `npx vitest run src/presentation/auth` — 8 passed / 8
- `npx vitest run server/stytchAuth.test.ts server/auth.test.ts` — 84 passed / 84 (81 existing + 3 new)
- `npm run typecheck` — 0 errors; `oxlint` and `prettier --check` clean on changed files
- `npm run build` — Worker bundle check and Stytch split check pass
- Live: a magic-link sign-in on the dev server was accepted by the Worker after the factor fallback; the session token was decoded locally and its claims are the ones listed under issue 7

## 6. How this was diagnosed, for next time

- `curl http://localhost:5173/api/send-test/status` tells you the Worker's auth **mode** without a browser. `disabled` means the Worker has no auth configured — check which checkout you are running.
- Stytch's public bootstrap (`GET https://test.stytch.com/sdk/v1/projects/bootstrap/<public token>` with `X-SDK-Parent-Host: <origin>`) tells you whether an **origin** is authorised, and reports `pkce_required_for_oauth`, `create_organization_enabled`, `opaque_errors`.
- The **request URL of the 400** names the failing step: `oauth/discovery/authenticate`, `intermediate_sessions/exchange`, or `organizations/create`.
- The gate's own refusal message lists the **claims the token carries**. Paste the `stytch_session_jwt` cookie into a base64 decoder to see the full payload; `https://stytch.com/session.started_at` says whether the session predates a dashboard change.
