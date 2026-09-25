# Workspaces, API keys and webhooks: build plan

Written 2026-09-25 against `main` at `d9c01e8` (Stytch sign-in merged, real production D1 id
committed). Everything in "where things stand" was read from the code on that commit; nothing
on the AWS or Cloudflare side was checked from this machine.

This plan replaces the organisation / project / environment hierarchy of `docs/FEATURE_PLAN.md`
(decisions 18 to 20, section 10) with one flatter concept, the **workspace**, and turns FEATURE_PLAN
phase 4 (keys and webhooks) and phase 6 steps 3 to 5 (sending API, event ingestion, dispatcher) into
six slices that can each ship on their own. Where the two documents disagree, this one wins; the
older sections are marked as superseded rather than rewritten.

## 1. The question behind the request, answered first

"Do we need a webhook for each workspace?" There are two different things people call "the
webhook", and the answer differs:

| Direction                           | What it is                                                                                                                                           | Per workspace?                                                                                                                                                                               |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inbound, from Amazon SES to us**  | SES publishes delivery, bounce, complaint, open and click events to an SNS topic; SNS POSTs them to one URL on our Worker (`POST /api/webhooks/ses`) | **No. One URL for the whole platform.** Every event carries the message id and the tags we set at send time, so the Worker knows which workspace the message belongs to without a second URL |
| **Outbound, from us to a customer** | The thing the app backend, Attio automations or a client system registers to be told "this email bounced"; we sign it and retry it                   | **Yes, and more than one.** An endpoint belongs to exactly one workspace, has its own secret and its own list of event types, and only ever receives events for that workspace's messages    |
| **SES configuration set**           | Not a webhook, but the SES-side switch that turns events on. It also carries per-set reputation metrics and a per-set "sending enabled" flag         | **One per workspace, recommended.** It is what lets swarm.camp (transactional) and swarm.work (marketing) have separate reputations, and what lets one workspace be paused without the rest  |

So: one inbound route, N outbound endpoints per workspace, and one configuration set per workspace,
all feeding the same SNS topic.

## 2. Where things stand (verified on `d9c01e8`)

- **Tenancy.** None. `migrations/0001` says "single tenant for now"; `templates.slug` is unique
  globally; the header shows the constants `WORKSPACE = 'meridian-platform'` and
  `ENVIRONMENT = 'Local'` (`src/App.tsx:15-16`).
- **Identity.** `Identity` is `{ email }` only (`server/auth.ts:32`). The Stytch session token
  also carries `https://stytch.com/organization` (organisation id and slug) and the session's
  roles; the verifier reads none of it. Sign-in works by magic link; Google needs a claim template
  (`docs/STYTCH_LOG.md`).
- **Sending.** Only `POST /api/send-test`. The browser posts rendered HTML; the Worker checks
  the allow-list, caps recipients at 10, forces `[TEST]`, rate-limits in memory (5 per minute per
  isolate) and calls SESv2 `SendEmail` through `aws4fetch`. `ConfigurationSetName` is forwarded when
  `SES_CONFIGURATION_SET` is set, and it is set on no Worker. No message tags. **Nothing is
  persisted after a send**; there is a `console.log` line.
- **Events.** No configuration set, no SNS topic, no inbound route, no suppression check anywhere.
  Bounce and complaint rates are invisible (PRIORITIES section 1 and item 3.6).
- **Keys and webhooks.** `src/presentation/api/ApiKeysPage.tsx` is a 691-line browser-only mock
  behind a "Seeded UI" badge. `src/application/apiKeys.ts` already generates `st_<env>_<22 chars>`
  tokens. No table, no route.
- **Platform limits that shape the design.** The account `swarm-work-emailer` is on the
  **Workers Free plan** (`docs/DEPLOYMENT.md`), so **Cloudflare Queues are not available**. Cron
  Triggers and D1 are. The Worker exports only `fetch`; there is no `scheduled` handler.
- **How the server is built and tested.** Every dependency is injected through `createApp`
  (`server/app.ts:171`): stores are ports with a D1 adapter and an in-memory adapter, both run
  against one contract suite; D1 tests run the real migrations on `node:sqlite` in memory, not on
  miniflare. New tables get the same treatment, which is why each slice below lists a port, two
  adapters and a contract test.

## 3. Decisions

Defaults chosen so the work can start. Each has a "change this if". They become ADRs 32 to 38 in
`docs/DECISIONS.md` as each slice lands.

| #   | Topic                    | Decision                                                                                                                                                                                                                                                                                                                                                                                            | Change this if                                                                                                                                                                |
| --- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 32  | What a workspace is      | **One level, a row in `workspaces`.** It owns templates, API keys, webhook endpoints, messages, a default from-address, an allowed from-domain and (optionally) its own SES configuration set. It is the unit of isolation and of reputation. The first two are `swarm-camp` (transactional) and, later, `swarm-work` (marketing). No organisations, projects or environment rows.                  | You need the same key or endpoint to span several sending domains, or a client needs several isolated products. Then add a `projects` level above; nothing below changes.     |
| 33  | Where members come from  | **Stytch is the directory; D1 is the mapping.** `Identity` grows `organizationId` and `roles` from the Stytch token. A workspace with `stytch_organization_id` set treats every member of that organisation as a workspace `admin`. `workspace_members` rows add individual people (or lower a role) beyond that. Today every user is in the one Stytch organisation `swarm`, so no bootstrap step. | Clients will sign in themselves. Then one Stytch organisation per workspace and the discovery flow already built becomes the workspace switcher.                              |
| 34  | Deployment vs data       | dev / staging / production stay **separate Workers with separate D1** (as committed in `wrangler.jsonc`). "Test mode" for integrators is a **key mode**, not an environment row: `st_test_…` keys record the message and emit synthetic events but never call SES.                                                                                                                                  | Never for the first version; FEATURE_PLAN decision 19 already had the "change this if" pointing here.                                                                         |
| 35  | API key storage          | Token `st_<live\|test>_<32 base64url chars>` shown once. Store `SHA-256(token)` as hex, the first 12 characters as `prefix` for display, a `scope` (`send` or `full`), `last_used_at` (written at most once a minute), `revoked_at`, `expires_at` (set by rotate). Lookup is by hash, indexed. `Authorization: Bearer` only.                                                                        | A key must be shown again. It cannot be; that is the point of hashing. Rotate instead.                                                                                        |
| 36  | Inbound event transport  | **SES → SNS (HTTPS subscription) → `POST /api/webhooks/ses`**, one topic, one route, signature verified with `node:crypto` `X509Certificate` under `nodejs_compat`. Messages are attributed by SES message id and by the tags `studio_message` and `studio_workspace` set at send time.                                                                                                             | `X509Certificate` turns out unusable in workerd (slice 4 checks this first). Then SES → EventBridge API destination with a shared secret header, same route, no certificates. |
| 37  | Outbound delivery engine | **A D1 outbox plus a Cron Trigger, not Queues.** Storing an event inserts one `webhook_dispatches` row per subscribed endpoint; the request tries the first attempt immediately in `waitUntil`; a `scheduled` handler every minute retries what is due, with backoff 1 m, 5 m, 30 m, 2 h, 12 h, then `dead`. Every attempt is a row, so "why did my webhook not arrive" is a query.                 | The account moves to Workers Paid and dispatch volume makes the minute cron a bottleneck. Then the outbox row becomes a Queue message; the table stays as the log.            |
| 38  | Signature scheme         | **Standard Webhooks** (`webhook-id`, `webhook-timestamp`, `webhook-signature: v1,<base64 HMAC-SHA256(secret, id.timestamp.body)>`, secret `whsec_…`, 5-minute tolerance). Receivers can verify with an off-the-shelf library in every language, and it is the scheme Resend's users already know (Resend uses it under Svix header names).                                                          | You need one header only. Then FEATURE_PLAN's `Studio-Signature: t=…,v1=…`; same HMAC, less tooling.                                                                          |
| —   | Secrets at rest          | Webhook signing secrets are stored **in clear in D1** for now (an internal tool on a company account; documented in TECH_DEBT). Key tokens are never stored, only hashed.                                                                                                                                                                                                                           | Endpoints belong to people outside Swarm. Then AES-GCM under one Worker secret; about forty lines with WebCrypto.                                                             |
| —   | Rate limits              | The **Workers Rate Limiting binding** (`ratelimits` in `wrangler.jsonc`; supported by wrangler 4.130) keyed by API key id for `/api/v1/*`, replacing the per-isolate array for that path. The studio's own routes keep the in-memory limiter for now.                                                                                                                                               | The binding is refused on the Free plan at deploy time (unverified). Then a D1 counter table with a minute bucket.                                                            |

## 4. Data model

Conventions as in migration `0001`: ids are prefixed (`ws_`, `key_`, `msg_`, `evt_`, `whk_`,
`dsp_`), timestamps are ISO-8601 text, JSON columns are `TEXT` parsed with Zod on read. New tables
arrive one migration per slice so each slice is deployable alone.

```sql
-- 0004 (slice 1)
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,                   -- ws_<slug>
  slug TEXT NOT NULL UNIQUE,             -- URL segment: /w/<slug>/...
  name TEXT NOT NULL,
  stytch_organization_id TEXT,           -- members of this org are implicit admins (decision 33)
  default_from TEXT NOT NULL,            -- e.g. testing@swarm.camp
  allowed_from_domain TEXT NOT NULL,     -- e.g. swarm.camp; v1 sends must use it
  ses_configuration_set TEXT,            -- NULL = fall back to SES_CONFIGURATION_SET
  created_at TEXT NOT NULL, created_by TEXT NOT NULL
);
CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
  added_at TEXT NOT NULL, added_by TEXT NOT NULL,
  PRIMARY KEY (workspace_id, email)
);
INSERT INTO workspaces VALUES ('ws_swarm-camp', 'swarm-camp', 'swarm.camp', NULL,
  'testing@swarm.camp', 'swarm.camp', NULL, '<generated>', 'migration');
ALTER TABLE templates ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_swarm-camp'
  REFERENCES workspaces(id);
DROP INDEX templates_slug_unique;
CREATE UNIQUE INDEX templates_slug_unique ON templates (workspace_id, slug);

-- 0005 (slice 2)
CREATE TABLE email_messages (
  id TEXT PRIMARY KEY,                   -- msg_<ulid>; returned to API callers
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  kind TEXT NOT NULL CHECK (kind IN ('test', 'api')),
  mode TEXT NOT NULL CHECK (mode IN ('live', 'dry-run', 'test-key')),
  api_key_id TEXT,                       -- NULL for studio test sends
  idempotency_key TEXT,
  template_id TEXT, template_version INTEGER,
  from_address TEXT NOT NULL, to_addresses TEXT NOT NULL,   -- JSON array
  reply_to TEXT NOT NULL DEFAULT '[]', subject TEXT NOT NULL,
  provider_message_id TEXT,              -- SES MessageId; NULL until accepted
  current_status TEXT NOT NULL DEFAULT 'queued'
    CHECK (current_status IN ('queued','sent','delivered','delayed','bounced','complained','rejected','failed')),
  error TEXT,                            -- SES error text when failed
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX email_messages_idempotency ON email_messages (workspace_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX email_messages_provider ON email_messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX email_messages_recent ON email_messages (workspace_id, created_at DESC);
CREATE TABLE suppressions (              -- our copy; the SES account list is the backstop
  workspace_id TEXT NOT NULL, address TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('bounce', 'complaint', 'manual')),
  source_event_id TEXT, created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, address)
);

-- 0006 (slice 3)
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,                   -- key_<ulid>
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('live', 'test')),
  scope TEXT NOT NULL CHECK (scope IN ('send', 'full')),
  token_hash TEXT NOT NULL UNIQUE,       -- hex SHA-256 of the full token
  prefix TEXT NOT NULL,                  -- first 12 chars, for the table
  last_used_at TEXT, expires_at TEXT, revoked_at TEXT,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL
);

-- 0007 (slice 4)
CREATE TABLE message_events (
  id TEXT PRIMARY KEY,                   -- evt_<ulid>
  workspace_id TEXT NOT NULL, message_id TEXT NOT NULL REFERENCES email_messages(id),
  type TEXT NOT NULL,                    -- email.sent, email.delivered, ... (section 5.4)
  occurred_at TEXT NOT NULL, received_at TEXT NOT NULL,
  source_id TEXT NOT NULL UNIQUE,        -- SNS MessageId: replays are no-ops
  payload TEXT NOT NULL                  -- the SES event JSON, headers removed
);
CREATE INDEX message_events_by_message ON message_events (message_id, occurred_at);

-- 0008 (slice 5)
CREATE TABLE webhook_endpoints (
  id TEXT PRIMARY KEY,                   -- whk_<ulid>
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  url TEXT NOT NULL,                     -- https only
  description TEXT NOT NULL DEFAULT '',
  signing_secret TEXT NOT NULL,          -- whsec_<32 base64url chars>, in clear (section 3)
  event_types TEXT NOT NULL,             -- JSON array of section 5.4 names
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE webhook_dispatches (        -- the outbox AND the log (decision 37)
  id TEXT PRIMARY KEY,                   -- dsp_<ulid>; sent as webhook-id
  endpoint_id TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES message_events(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'dead')),
  attempt INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT,
  last_http_status INTEGER, last_error TEXT, last_response TEXT,   -- response cut to 4 KB
  last_latency_ms INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX webhook_dispatches_due ON webhook_dispatches (next_attempt_at) WHERE status = 'pending';
CREATE INDEX webhook_dispatches_by_endpoint ON webhook_dispatches (endpoint_id, created_at DESC);
```

Not in this plan: `domains`, `dns_records`, audit log, retention (FEATURE_PLAN phases 5 and 7).
They come after these six slices, and nothing here blocks them.

## 5. API surface

### 5.1 Studio routes (browser, Stytch session, `x-studio-request: 1` on mutations)

Existing template and upload routes move under the workspace: `/api/templates` becomes
`/api/workspaces/:workspace/templates` (and so on). `:workspace` is the slug. One middleware,
`requireWorkspace(role)`, resolves the slug, checks membership per decision 33, and puts
`{ workspace, role }` on the Hono context next to `identity`. `GET /media/:key` stays public.

| Method                | Path                                                            | Role                                      | Slice |
| --------------------- | --------------------------------------------------------------- | ----------------------------------------- | ----- |
| GET                   | `/api/workspaces`                                               | any                                       | 1     |
| POST                  | `/api/workspaces`                                               | any signed-in user; creator becomes admin | 1     |
| GET                   | `/api/workspaces/:workspace`                                    | member                                    | 1     |
| PATCH                 | `/api/workspaces/:workspace` (name, default_from, config set)   | admin                                     | 1     |
| GET/POST/DELETE       | `/api/workspaces/:workspace/members`                            | admin                                     | 1     |
| POST                  | `/api/workspaces/:workspace/send-test`                          | editor                                    | 2     |
| GET                   | `/api/workspaces/:workspace/messages?cursor=&status=&to=`       | member                                    | 2     |
| GET                   | `/api/workspaces/:workspace/messages/:id` (with its events)     | member                                    | 2, 4  |
| GET / DELETE          | `/api/workspaces/:workspace/suppressions[/:address]`            | admin                                     | 2     |
| GET/POST              | `/api/workspaces/:workspace/api-keys`                           | admin                                     | 3     |
| POST                  | `/api/workspaces/:workspace/api-keys/:id/revoke`, `…/rotate`    | admin                                     | 3     |
| GET/POST/PATCH/DELETE | `/api/workspaces/:workspace/webhooks[/:id]`                     | admin                                     | 5     |
| POST                  | `/api/workspaces/:workspace/webhooks/:id/test`                  | admin                                     | 5     |
| GET                   | `/api/workspaces/:workspace/webhooks/:id/dispatches`            | member                                    | 5     |
| POST                  | `/api/workspaces/:workspace/webhooks/:id/dispatches/:dsp/retry` | admin                                     | 5     |

### 5.2 Public API (`Authorization: Bearer st_…`; the key names the workspace)

| Method | Path                 | Notes                                                                                                                                                                                                                                                          |
| ------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/v1/emails`     | Body `{ from?, to, subject?, html?, text?, reply_to?, template?, data?, tags? }`. Either `html` or `template`. `from` defaults to the workspace's `default_from` and must be on `allowed_from_domain`. Optional `Idempotency-Key` header. Answers `202 { id }` |
| GET    | `/api/v1/emails/:id` | The message and its events                                                                                                                                                                                                                                     |
| GET    | `/api/v1/emails?…`   | Same filters as the studio list                                                                                                                                                                                                                                |

Errors reuse `apiErrorSchema`; new codes `invalid-api-key`, `key-revoked`, `scope-insufficient`,
`from-not-allowed`, `recipient-suppressed`, `rate-limited`, `template-not-sendable`.

**What `template` can do on the server.** Template versions store rendered `html` and
`plain_text` with merge fields unresolved (ADR-25, ADR-26). So a v1 send with `template` and
`data` substitutes `{{key}}` on the server and sends. That covers visual templates and any code
template whose variability is expressed as merge fields. A **code template that needs new React
props per send cannot be rendered in the Worker today** (the TSX pipeline runs in a browser
worker, and pulling `sucrase` plus `@react-email/render` into the Worker is a bundle-size decision,
TECH_DEBT). Such a template answers `template-not-sendable`; the caller sends `html` instead.
Decide whether that limitation is acceptable before slice 3 is done (section 8, question 3).

### 5.3 Inbound

`POST /api/webhooks/ses`: no session, no CSRF header, exempt from the authenticator the way
`/api/session` is. Accepts SNS `SubscriptionConfirmation` (confirms only when `TopicArn` equals
the `SNS_TOPIC_ARN` var), `Notification`, and `UnsubscribeConfirmation` (logged). Always answers
`200` once the signature is valid, even for unknown messages, so SNS stops retrying; invalid
signatures answer `403`.

### 5.4 Event types and payload

| SES `eventType`  | Ours                     | Sets `current_status`                                          |
| ---------------- | ------------------------ | -------------------------------------------------------------- |
| Send             | `email.sent`             | `sent`                                                         |
| Delivery         | `email.delivered`        | `delivered`                                                    |
| DeliveryDelay    | `email.delivery_delayed` | `delayed`                                                      |
| Bounce           | `email.bounced`          | `bounced` (+ suppression row when `bounceType` is `Permanent`) |
| Complaint        | `email.complained`       | `complained` (+ suppression row)                               |
| Reject           | `email.rejected`         | `rejected`                                                     |
| Open             | `email.opened`           | unchanged                                                      |
| Click            | `email.clicked`          | unchanged                                                      |
| RenderingFailure | `email.failed`           | `failed`                                                       |

Outbound body, the same for every type:

```json
{
  "id": "evt_01J…",
  "type": "email.bounced",
  "created_at": "2026-09-25T04:12:09Z",
  "data": {
    "email_id": "msg_01J…",
    "workspace": "swarm-camp",
    "from": "no-reply@swarm.camp",
    "to": ["person@example.com"],
    "subject": "Your invoice",
    "template": "invoice-issued",
    "tags": { "engagement": "eng_42" },
    "bounce": { "type": "Permanent", "sub_type": "General", "diagnostic": "550 5.1.1 …" }
  }
}
```

Headers: `webhook-id: dsp_…`, `webhook-timestamp: <unix seconds>`,
`webhook-signature: v1,<base64>`, `content-type: application/json`, `user-agent: swarm-studio-webhooks/1`.
Documented with a verification snippet in Node, Python and cURL in `docs/WEBHOOKS.md` (slice 5),
which PRIORITIES already lists as a dangling reference.

## 6. The six slices

Each slice is one pull request, deployable on its own, and leaves `npm run check` and the
Playwright suite green. Sizes use the repository's S / M / L scale. Order matters: every table after
slice 1 carries `workspace_id`, and slices 4 and 5 attach to rows slice 2 creates.

### Slice 0: AWS and Cloudflare prerequisites (S, operations, no code)

Blocks slices 2 and 4. All of it is PRIORITIES 3.3 and 3.6 restated; do it in one AWS session.

1. Settle **which Worker is production** (PRIORITIES decision 1). SNS needs one stable HTTPS URL
   and it must be the Worker that sends. Today that is the unnamed top-level Worker.
2. `aws sesv2 put-account-suppression-attributes --suppressed-reasons BOUNCE COMPLAINT`.
3. Create configuration set `studio-swarm-camp` (and `studio-swarm-camp-staging`) with reputation
   metrics on. Create SNS topic `studio-ses-events` (SignatureVersion 2, so the Worker verifies with
   SHA-256, not SHA-1). Add an event destination on each set for all nine event types to that topic.
   The HTTPS subscription itself is created in slice 4, once the route exists.
4. IAM: add `ses:SendEmail` on `configuration-set/studio-swarm-camp*` (PRIORITIES 4.9) and widen
   `ses:FromAddress` from the single `testing@swarm.camp` to the addresses production will use
   (decision 6 in PRIORITIES section 2). Commit the result as `infra/ses-policy.json`; delete the
   stray copy at the repository root.
5. Set `SES_CONFIGURATION_SET` on the production and staging Workers and redeploy. From this
   moment SES emits events, even though nothing receives them yet; that is the point.

**Done when:** one test send appears in the configuration set's CloudWatch metrics and the SNS
topic shows one undelivered message per event.

### Slice 1: workspaces (M)

> **Built 2026-09-25** on the branch `feat/workspaces` (ADR-32, ADR-33). Two deviations from the
> table below: members are read from the Stytch organisation _slug_ rather than the id, because the
> id differs between Stytch's Test and Live projects; and the developer and password identities are
> admins of every workspace, so `npm run dev` and Playwright need no bootstrap row.

The foundation. Nothing user-visible changes except a real name in the header and a URL segment.

| Task                                                                                                                                                                                                                                       | Where                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Migration `0004` (section 4), plus the seed migrations re-generated so starters carry `workspace_id` (`scripts/generate-seed-migration.mjs`; the drift test in `seedMigration.test.ts` enforces it)                                        | `migrations/`                                                                                                                    |
| `Identity` gains `organizationId?` and `roles: string[]`, read from `https://stytch.com/organization` and the session claim; developer and password modes leave them empty                                                                 | `server/auth.ts`, `server/stytchAuth.test.ts`                                                                                    |
| `WorkspaceStore` port (`list(email, organizationId)`, `getBySlug`, `create`, `update`, `members`), `D1WorkspaceStore`, `InMemoryWorkspaceStore`, one contract suite                                                                        | `server/workspaceStore.ts`, `server/d1WorkspaceStore.ts`, `server/inMemoryWorkspaceStore.ts`, `server/workspaceStoreContract.ts` |
| `requireWorkspace(role)` middleware: slug → workspace → role (implicit admin via Stytch organisation, else `workspace_members`, else 404, not 403, so slugs are not enumerable). Sets `workspace` and `role` on the context                | `server/workspaceRoutes.ts`                                                                                                      |
| Template and upload routes move under `/api/workspaces/:workspace/`; `TemplateStore` methods take `workspaceId`; slug uniqueness becomes per workspace (`slug-taken` unchanged)                                                            | `server/templateRoutes.ts`, `server/uploadRoutes.ts`, `server/templateStore.ts`, both adapters                                   |
| Shared contracts: `workspaceSchema`, `workspaceListResponse`, `createWorkspaceRequest`, `memberSchema`                                                                                                                                     | `shared/workspaceContracts.ts`                                                                                                   |
| Client: add `react-router` (FEATURE_PLAN decision 15, now needed); routes `/w/:slug/templates[/:id]`, `/w/:slug/settings`; `useWorkspace()` reads the slug; `/` redirects to the last workspace in `localStorage` or the first in the list | `src/App.tsx`, `src/presentation/workspace/`                                                                                     |
| Header: replace the constants with the workspace switcher (list from `GET /api/workspaces`) and the signed-in email                                                                                                                        | `src/presentation/layout/GlobalHeader.tsx`                                                                                       |
| Settings page: General (name, default from, configuration set) and Members tabs                                                                                                                                                            | `src/presentation/workspace/WorkspaceSettingsPage.tsx`                                                                           |

**Done when:** two workspaces exist locally; a template created in one is a 404 in the other; the
Playwright suite passes with the studio at its new URL; `docs/ARCHITECTURE.md` shows the workspace
middleware in the request path; ADR-32 and ADR-33 are recorded.

**Learning notes:** middleware and context values in Hono; why 404 instead of 403 for foreign
workspaces; `ALTER TABLE … ADD COLUMN` with a default versus a table rebuild in SQLite; React Router
in library mode.

### Slice 2: one recorded send path (M)

Every send, test or API, goes through one function and leaves a row. This is PRIORITIES 4.10 (one
suppression check in front of every send) and the "real transactional send path" from its section 5.

| Task                                                                                                                                                                                                                                                               | Where                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Migration `0005`: `email_messages`, `suppressions`                                                                                                                                                                                                                 | `migrations/`                                                                          |
| `MessageStore` port and adapters with the contract suite; `SuppressionStore` folded into the same file (two tables, one port)                                                                                                                                      | `server/messageStore.ts`, `server/d1MessageStore.ts`, `server/inMemoryMessageStore.ts` |
| `sendMessage()` application service: validate → suppression check (`recipient-suppressed`) → insert `queued` row → call `EmailSender.send` with `configurationSet` from the workspace and tags `studio_message`, `studio_workspace` → update to `sent` or `failed` | `server/sendMessage.ts`, `server/sendMessage.test.ts`                                  |
| `EmailSender.send` gains `tags` and a per-call `configurationSet`; `sesSender` sends `EmailTags`                                                                                                                                                                   | `server/emailSender.ts`, `server/sesSender.ts`                                         |
| `/api/send-test` moves under the workspace and calls `sendMessage` with `kind: 'test'`; its guards (allow-list, 10 recipients, `[TEST]`, rate limit) stay in the route, in front                                                                                   | `server/app.ts` → `server/sendRoutes.ts`                                               |
| Messages list and detail routes; the send-test response and status schemas move into `shared/` (they drift today, PRIORITIES section 5)                                                                                                                            | `server/messageRoutes.ts`, `shared/messageContracts.ts`                                |
| A **Logs** page: table of messages with status badge, recipient search and status filter in URL search params; a detail drawer                                                                                                                                     | `src/presentation/logs/`                                                               |

**Done when:** every test send is a row; a manually inserted suppression makes the send dialog
refuse with a clear sentence; the SES request body in `sesSender.test.ts` shows the two tags and the
workspace's configuration set; the Logs page lists the sends made in the Playwright run.

**Learning notes:** the outbox idea starts here (write the row before the side effect); why the
message id is ours and the SES id is a column; what a message tag is for.

### Slice 3: API keys and `POST /api/v1/emails` (M)

The slice that unblocks the app backend and Attio.

| Task                                                                                                                                                                                                                                                                                                               | Where                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Migration `0006`: `api_keys`                                                                                                                                                                                                                                                                                       | `migrations/`                                              |
| `ApiKeyStore` port and adapters; `createApiKeyToken` moves from `src/application/apiKeys.ts` to `shared/` (the browser only ever displays what the server minted)                                                                                                                                                  | `server/apiKeyStore.ts` and adapters, `shared/apiKeys.ts`  |
| `createApiKeyAuthenticator`: `Bearer` → SHA-256 → lookup → revoked / expired checks → `{ identity: { email: 'key:<id>' }, workspace, scope }`; a second `Authenticator` instance mounted on `/api/v1/*` only. `last_used_at` written when older than a minute                                                      | `server/apiKeyAuth.ts`, `server/apiKeyAuth.test.ts`        |
| `ratelimits` binding in `wrangler.jsonc` (for example 60 per minute per key), injected as a port so tests use a fake; per-isolate array remains for studio routes                                                                                                                                                  | `wrangler.jsonc`, `worker/index.ts`, `server/rateLimit.ts` |
| `POST /api/v1/emails`: Zod body from section 5.2, `from` domain check, `Idempotency-Key` (unique index; on conflict return the existing row with `200`), template lookup + merge-field substitution, `sendMessage` with `kind: 'api'`. Test-mode keys skip SES and mark the message `sent` with `mode: 'test-key'` | `server/v1Routes.ts`, `server/v1Routes.test.ts`            |
| `GET /api/v1/emails/:id`, `GET /api/v1/emails`                                                                                                                                                                                                                                                                     | same                                                       |
| Key management routes (create returns the token once; revoke; rotate = create same name and scope, old key `expires_at = now + 24 h`)                                                                                                                                                                              | `server/apiKeyRoutes.ts`                                   |
| Replace the mock `ApiKeysPage` keys card with the real table and the generate dialog; the webhook cards stay mocked until slice 5 (PRIORITIES section 6 said not to refactor the mock, and this is the replacement it was waiting for)                                                                             | `src/presentation/api/`                                    |
| `docs/API.md`: authentication, the send request, idempotency, errors, cURL and Node examples with the real base URL                                                                                                                                                                                                | `docs/API.md`                                              |

**Done when:** a key created in the UI sends a real email through cURL from another machine; the
same request twice with one `Idempotency-Key` yields one row; a revoked key gets `invalid-api-key`;
a `st_test_` key produces a row and no SES call; the IAM policy from slice 0 permits the `from`.

**Learning notes:** hashing versus encryption (why the token cannot be shown again); Bearer
tokens and why they never go in a URL; idempotency as a database constraint; why looking a hash up
by index needs no constant-time comparison.

### Slice 4: SES events in (M)

**First verifiable step, before anything else in the slice:** a ten-line route in a scratch
Worker that does `new X509Certificate(pem).publicKey` under `nodejs_compat` and verifies one
recorded SNS message. If workerd refuses, switch decision 36 to EventBridge before writing the store.

| Task                                                                                                                                                                                                                                                                                                                                                                              | Where                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Migration `0007`: `message_events`                                                                                                                                                                                                                                                                                                                                                | `migrations/`                                                      |
| `verifySnsMessage(body, fetchCert)`: checks `SigningCertURL` is `https://sns.<region>.amazonaws.com/….pem`, caches the certificate one hour, builds the canonical string per message type, verifies with `crypto.verify('sha256', …)`                                                                                                                                             | `server/sns.ts`, `server/sns.test.ts` with a recorded real message |
| `parseSesEvent(json)`: Zod schema for the nine event types → `{ type, providerMessageId, tags, occurredAt, detail }`                                                                                                                                                                                                                                                              | `server/sesEvents.ts`, tests with one fixture per type             |
| `POST /api/webhooks/ses`: verify → confirm subscription if the topic matches → look up the message by `provider_message_id` (fall back to the `studio_message` tag) → insert event (`source_id` unique, replay is a `200` no-op) → update `current_status` → insert suppression on permanent bounce or complaint → enqueue dispatches (slice 5 fills this in; until then a no-op) | `server/sesWebhookRoute.ts`                                        |
| Studio: the message detail shows its events as a timeline; the Logs status badges become real                                                                                                                                                                                                                                                                                     | `src/presentation/logs/`                                           |
| Subscribe the SNS topic to the production URL, confirm, send one test email, watch the row appear                                                                                                                                                                                                                                                                                 | operations, `docs/DEPLOYMENT.md`                                   |
| CloudWatch alarms on the set's bounce (5 %) and complaint (0.1 %) rates to the mailbox from PRIORITIES decision 10                                                                                                                                                                                                                                                                | operations (PRIORITIES 4.11)                                       |

**Done when:** a bounce to the SES mailbox simulator (`bounce@simulator.amazonses.com`) shows up
as `email.bounced` on the message within a minute, adds a suppression row, and the next send to
that address is refused in the studio.

**Learning notes:** what an SNS subscription confirmation is and why the topic ARN check matters;
idempotent consumers; why the route answers `200` for messages it does not know.

### Slice 5: webhooks out (L)

| Task                                                                                                                                                                                                            | Where                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Migration `0008`: `webhook_endpoints`, `webhook_dispatches`                                                                                                                                                     | `migrations/`                                                                         |
| `WebhookStore` port and adapters: endpoints CRUD, `enqueue(eventId)` (one dispatch per active endpoint subscribed to the type), `claimDue(now, limit)`, `recordAttempt(...)`                                    | `server/webhookStore.ts` and adapters                                                 |
| `signWebhook(secret, id, timestamp, body)` and `verifyWebhook(...)`, both exported, the second one copied verbatim into `docs/WEBHOOKS.md` as the Node snippet                                                  | `shared/webhookSignature.ts`, tests with the Standard Webhooks published test vectors |
| `deliverDispatch(dispatch)`: POST with a 10 s timeout, records status, latency, first 4 KB of the response; success on 2xx; otherwise `next_attempt_at` from the backoff table; `dead` after attempt 5          | `server/webhookDispatcher.ts`, tests with a fake `fetch`                              |
| Hook into slice 4's route: after the event is stored, `enqueue`, then `c.executionCtx.waitUntil(deliverDue())` for the immediate attempt                                                                        | `server/sesWebhookRoute.ts`                                                           |
| `scheduled` handler: `triggers.crons: ["* * * * *"]`; each run claims up to 50 due dispatches and delivers them; documented as the first `scheduled` export in `worker/index.ts`                                | `worker/index.ts`, `wrangler.jsonc`                                                   |
| Routes: endpoint CRUD, `…/test` (synthesises an `email.delivered` event for a fake message and dispatches it), dispatch list, retry                                                                             | `server/webhookRoutes.ts`                                                             |
| Studio: replace the remaining mock cards with the endpoint list, add/edit dialog (https only, event-type toggles, secret shown with reveal and copy), the dispatch log with a row expander showing the response | `src/presentation/api/`                                                               |
| `docs/WEBHOOKS.md`: event types, payload, headers, verification in Node, Python and cURL, retry schedule, how to replay                                                                                         | `docs/WEBHOOKS.md`                                                                    |

**Done when:** an endpoint pointed at a request-catcher receives a signed test event; the Node
snippet in WEBHOOKS.md verifies it; stopping the catcher produces attempts 1 to 5 with the documented
gaps and then `dead`; retry from the UI delivers it; an endpoint in workspace A never receives an
event from workspace B (a unit test asserts this by construction of `enqueue`).

**Learning notes:** HMAC and replay windows; at-least-once delivery and why receivers must be
idempotent on `webhook-id`; `waitUntil`; Cron Triggers and the `scheduled` handler; backoff.

### Slice 6: hardening (S, continuous, starts after slice 3)

- Audit table `audit_log(workspace_id, actor, action, subject_id, at, ip)` written by key,
  webhook, member and workspace mutations (FEATURE_PLAN phase 7).
- Retention: the same cron prunes `message_events` older than 90 days and dispatches older than 30.
- An endpoint that is `dead` on its last 20 dispatches is switched inactive, with a banner.
- Make the `[TEST]` prefix a per-workspace setting once a real transactional workspace exists.
- Move the studio's remaining in-memory limiters to the binding if slice 3 proved it works on the plan.

## 7. Risks

| Risk                                                                                                   | Mitigation                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `X509Certificate` unavailable or different in workerd                                                  | Slice 4's first verifiable step; EventBridge fallback already named in decision 36                                                         |
| The Rate Limiting binding is refused on the Free plan                                                  | Deploy the binding alone as the first commit of slice 3; fall back to a D1 minute-bucket counter                                           |
| Moving routes under `/api/workspaces/:workspace` touches every client call                             | Do it in slice 1 with nothing else in the PR; `httpTemplateRepository.ts` has one base URL to change; the Playwright suite proves the rest |
| SNS subscription confirmation arrives before the route is deployed, or to the wrong Worker             | Slice 0 settles the production Worker; the route confirms only the configured `SNS_TOPIC_ARN`                                              |
| The `[TEST]` prefix and the 10-recipient cap are studio guards and must not leak into `/api/v1/emails` | They live in the send-test route, not in `sendMessage`; the v1 route test asserts a subject is sent verbatim                               |
| The IAM policy's `ses:FromAddress` condition silently refuses v1 sends from a new address              | Slice 0 step 4; `sendMessage` stores the SES error text on the row and the Logs page shows it                                              |
| A code template's props cannot be rendered server-side                                                 | `template-not-sendable` with a clear message; decision recorded in section 8                                                               |
| Two workspaces share one configuration set at first                                                    | Fine for volume; events still attribute by tag. Give the marketing workspace its own set before the first marketing send                   |

## 8. Questions for you (each changes the work; none blocks slice 0 or 1)

1. **Is a workspace a sending domain, or a client?** The plan assumes the former (`swarm-camp`,
   `swarm-work`), and a client engagement is a `tags` value on the message. If clients need
   isolated keys and endpoints, the answer is "one workspace per client on the swarm.camp domain",
   and the plan still holds; only the first rows in `0004` change.
2. **Who may create keys and endpoints?** The plan says workspace admins, and every Swarm
   staff member is an admin today through the Stytch organisation. Say if editors should too.
3. **Is "visual templates and merge fields only" acceptable for server-side sends** (section
   5.2)? If the app backend needs React props per send, server-side rendering becomes a slice of
   its own between 3 and 4.
4. **Which event types matter to the app backend and Attio first?** Delivered, bounced and
   complained are enough for suppression and invoices; opens and clicks need tracking turned on in
   the configuration set, which rewrites links in every email. The plan leaves tracking off.
5. **The alarm mailbox** (PRIORITIES decision 10) is still unanswered and slice 4 needs it.

## 9. Documents to keep in step

- `docs/FEATURE_PLAN.md`: decisions 18 to 20 and section 10 are superseded by sections 3 and 4
  here; phase 4 and phase 6 steps 3 to 5 are replaced by slices 3 to 5. A note at the top of that
  file points here.
- `docs/PRIORITIES.md`: items 3.6, 4.9, 4.10, 4.11 and the three section 5 rows (`/api/webhooks/ses`,
  real send path, header constants) are absorbed by slices 0, 2 and 4.
- `docs/ROADMAP.md`: M5 and M6 now point at this plan.
- `docs/DECISIONS.md`: ADR-32 to ADR-38 as each slice lands.
- `docs/ARCHITECTURE.md`: the workspace middleware (slice 1), the send path diagram (slice 2), the
  event path diagram (slices 4 and 5).
- `docs/LEARNING.md`: the learning notes above, one entry per slice.
- `docs/TECH_DEBT.md`: signing secrets in clear; code templates not renderable server-side;
  studio routes still on the in-memory limiter.
- New: `docs/API.md` (slice 3), `docs/WEBHOOKS.md` (slice 5).
