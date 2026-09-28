/**
 * Cloudflare Worker entry point.
 *
 * The same Hono app as the Node send server (`server/app.ts`), hosted in a
 * Worker. Static files (the built studio) are served by Cloudflare's assets
 * layer; only `/api/*` and `/media/*` (uploaded images) reach this code
 * (see `run_worker_first` in wrangler.jsonc).
 *
 * Runtime differences from `server/node.ts`:
 * - templates live in D1 (`STUDIO_DB`) and uploaded images in R2 (`STUDIO_ASSETS`);
 *   the Node server keeps templates in memory and refuses uploads
 * - configuration comes from Worker bindings (`vars` and secrets in wrangler.jsonc,
 *   `.dev.vars` locally), not from process.env
 * - AWS credentials must be Worker secrets: an isolate has no `~/.aws` to read
 * - the host policy is `same-origin`: the Worker answers on a public hostname
 *
 * Live Amazon SES sending works here as of the aws4fetch sender (docs/SENDING.md);
 * it is switched on per environment with STUDIO_SEND_ENABLED and three secrets.
 */
import { createApp } from '../server/app.ts'
import { createAuthenticator, loadAuthConfig } from '../server/auth.ts'
import type { SendServerConfig } from '../server/config.ts'
import { ConfigError, loadConfig, loadFeatures } from '../server/config.ts'
import { createSender } from '../server/createSender.ts'
import type { EmailSender } from '../server/emailSender.ts'
import { D1TemplateStore } from '../server/d1TemplateStore.ts'
import { D1WorkspaceStore } from '../server/d1WorkspaceStore.ts'

type App = ReturnType<typeof createApp>

/** Built once per isolate; Workers reuse an isolate across many requests. */
let cached: App | null = null

/** Only string bindings (`vars` and secrets) are configuration; D1, queues etc. are not. */
function variablesOf(env: Env): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => typeof value === 'string'))
}

function buildApp(env: Env): App {
  const variables = variablesOf(env)
  // A broken SEND configuration only disables sending. Templates, uploads and
  // the public /media/ route have nothing to do with SES, and answering every
  // request with one 500 would make a rotated AWS secret look like a total
  // outage - including images already delivered in someone's inbox.
  let config: SendServerConfig
  let sender: EmailSender | null
  try {
    config = loadConfig(variables)
    sender = createSender(config)
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    console.error(`[worker] sending is disabled: ${error.message}`)
    config = { enabled: false, port: 0, reason: error.message }
    sender = null
  }
  // Cloudflare Access in production; a shared password where Access is not set
  // up yet; a fixed developer identity for `npm run dev` and the Playwright
  // suite; otherwise an authenticator that refuses everything.
  const authConfig = loadAuthConfig(variables)
  return createApp({
    config,
    sender,
    hostPolicy: 'same-origin',
    authenticator: createAuthenticator(authConfig),
    // Only the password mode gets a sign-in route.
    passwordGate: authConfig.mode === 'password' ? { password: authConfig.password } : undefined,
    // The bindings are what prove the resources exist. Without them the
    // template routes answer 503 and uploads answer 503, rather than the
    // Worker refusing to boot: sending must keep working either way.
    templateStore: env.STUDIO_DB ? new D1TemplateStore(env.STUDIO_DB) : null,
    workspaceStore: env.STUDIO_DB ? new D1WorkspaceStore(env.STUDIO_DB) : null,
    objectStore: env.STUDIO_ASSETS ?? null,
    // The rollback switch: STUDIO_VISUAL_EDITOR="false" in wrangler.jsonc turns
    // the visual canvas off for everyone without rebuilding the app.
    features: loadFeatures(variables),
  })
}

export default {
  async fetch(request, env, ctx) {
    cached ??= buildApp(env)
    return cached.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
