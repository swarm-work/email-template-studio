# Sending test emails

Test sends go through the Hono API in `server/`, which talks to Amazon SES. The browser only calls `/api/send-test`; it never sees AWS credentials.

## One sender, two runtimes

`server/sesSender.ts` signs its own SES requests with `aws4fetch`, so it runs unchanged in Node and in a Cloudflare Worker (ADR-16). Both adapters pick a sender through `server/createSender.ts`: disabled, dry-run, or live SES.

| Runtime              | Start with                            | `/api/*` is served by                                                      | Can send through SES? |
| -------------------- | ------------------------------------- | -------------------------------------------------------------------------- | --------------------- |
| Cloudflare (default) | `npm run dev`                         | `worker/index.ts` running in workerd next to Vite (the production runtime) | Yes, from `.dev.vars` |
| Node                 | `npm run dev:node` + `npm run server` | Vite proxies to `server/node.ts` on `127.0.0.1:8787`                       | Yes, from `.env`      |

```
Node runtime:
Browser (Vite, :5173) ──/api──▶ send server (Node, 127.0.0.1:8787) ──aws4fetch──▶ Amazon SES v2

Cloudflare runtime:
Browser (Vite, :5173) ──/api──▶ worker/index.ts in workerd ──aws4fetch──▶ Amazon SES v2

Deployed:
Browser ──/api──▶ Worker on Cloudflare ──aws4fetch──▶ Amazon SES v2
```

The only difference between the runtimes is where the variables come from: `.env` and `process.env` for Node, bindings for the Worker (`.dev.vars` locally, `vars` plus secrets when deployed).

`STUDIO_RUNTIME=node` in `.env` makes the Node runtime the default for `npm run dev` on that machine. The deployed Worker is described in `docs/DEPLOYMENT.md`.

## Guards

| Guard                 | Where                      | Effect                                                                                                                        |
| --------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `STUDIO_SEND_ENABLED` | `server/config.ts`         | Anything but `true` keeps the server in disabled mode; the UI says so.                                                        |
| Allow-list            | `server/app.ts`            | `SES_ALLOWED_RECIPIENTS` is the only set of addresses that can receive.                                                       |
| Subject prefix        | `server/app.ts`            | Every test subject starts with `[TEST]`.                                                                                      |
| Rate limit            | `server/app.ts`            | `STUDIO_SEND_RATE_LIMIT_PER_MINUTE` (default 5), sliding window.                                                              |
| HTML size cap         | `server/app.ts`            | 500 KB.                                                                                                                       |
| Authentication        | `server/auth.ts`           | Every `/api/*` route needs a verified Access JWT, a shared-password session cookie, or a fixed local identity. 401 otherwise. |
| Login throttle        | `server/app.ts`            | 10 password attempts per minute on `POST /api/session`.                                                                       |
| Host policy           | `server/app.ts`            | Node: Host and Origin must be localhost (`loopback`). Worker: Origin must equal Host (`same-origin`).                         |
| Loopback only         | `server/node.ts`           | The Node adapter binds to 127.0.0.1.                                                                                          |
| Dry run               | `STUDIO_SEND_DRY_RUN=true` | Full path, no AWS call, `dry-run-N` message ids. Needs no credentials at all.                                                 |
| Credentials           | `server/config.ts`         | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, required only for a live (non-dry-run) sender.                                 |
| IAM policy            | AWS, not this code         | The real backstop: scope the key to `ses:SendEmail` from one identity (`docs/DEPLOYMENT.md`).                                 |

## Notes

- Changing `STUDIO_SERVER_PORT` in `.env` is picked up by both the server and the Vite proxy (restart `npm run dev`).
- Do not run Vite with `--host` while the send server is enabled: the proxy would let other machines on your network reach the server (their requests still need a localhost `Origin`, but do not rely on that).
- Requires Node 22.18 or newer (`--env-file-if-exists` and running TypeScript directly).

## Setup

1. Verify a sender identity in SES (an email address or a domain) in the region you will use. Identities are **per region**.
2. While the account is in the SES sandbox, recipients must also be verified identities.
3. Copy `.env.example` to `.env` and fill in:
   - `AWS_REGION` (the region that holds your identities)
   - `SES_FROM_ADDRESS` (a verified identity)
   - `SES_ALLOWED_RECIPIENTS` (comma separated)
   - `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, once you set `STUDIO_SEND_DRY_RUN=false`

   Keys live in an AWS profile? Turn the profile into those variables:

   ```bash
   aws configure export-credentials --profile default --format env
   ```

   The profile chain itself is gone: the studio signs its own requests so that the same
   code works in a Worker, and a Worker cannot read `~/.aws` (ADR-16).

4. Run the two processes in two terminals:

```bash
npm run server      # send server, reads .env; prints mode/from/recipients on start
npm run dev:node    # the studio, proxying /api to the send server
```

5. In the studio: select a template, open **Send test email**, check the preflight line (sender verified, sandbox or not), pick a recipient, press **Send test**. The dialog shows the SES message id.

Rehearse without sending: `npm run server:dry-run`.

To exercise the exact code path that runs on Cloudflare, put the same values in `.dev.vars` (see `.dev.vars.example`) and run `npm run dev` instead. That is worth doing once before the first live deploy.

## Verifying from the command line

```bash
curl -s http://127.0.0.1:8787/api/send-test/status
curl -s -X POST http://127.0.0.1:8787/api/send-test \
  -H 'content-type: application/json' -H 'x-studio-send: 1' \
  -d '{"to":"you@example.com","subject":"Hello","html":"<p>Hi</p>","templateId":"manual"}'
```

## Common SES errors

Errors are reported with the AWS error type as the name, so the message reads like `MessageRejected: Email address is not verified.`

| Error type                                       | Meaning / fix                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `MessageRejected`                                | From or (in sandbox) To is not a verified identity in that region.                                |
| `AccessDeniedException`                          | The IAM key lacks `ses:SendEmail`, or a policy condition blocks this sender or recipient.         |
| `InvalidClientTokenId` / `SignatureDoesNotMatch` | The key pair is wrong, revoked, or the machine clock is skewed (SigV4 signatures are time-bound). |
| `ExpiredTokenException`                          | Temporary STS credentials ran out; export a fresh set including `AWS_SESSION_TOKEN`.              |
| `NotFoundException` on preflight                 | Neither the address nor its domain is an SES identity in that region.                             |
| `TooManyRequestsException`                       | SES send rate exceeded; the server's own limit is separate.                                       |

## What this is not

- Not a production sending path. No queue, retries, templates-as-a-service or tracking.
- Not authenticated yet. The Node adapter relies on binding to loopback; the deployed Worker relies on Host and Origin only, until Cloudflare Access lands (`docs/PLAN.md` phase 1, TECH_DEBT #19). Do not put a live SES key on a Worker that anyone can reach until then, unless the recipient allow-list is people you are happy for a stranger to email.
