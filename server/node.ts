/**
 * Local send server entry point. Run with `npm run server` (reads .env if present).
 * Binds to 127.0.0.1 only: this is a developer-machine tool, not a public service.
 *
 * Templates are kept IN MEMORY here, seeded from the same starter data migration
 * 0002 writes into D1. Restarting the process loses every edit; `npm run dev`
 * runs the Worker against the real local D1 instead (docs/SENDING.md).
 */
import { serve } from '@hono/node-server'
import { createApp } from './app.ts'
import { InMemoryTemplateStore } from './inMemoryTemplateStore.ts'
import { InMemoryWorkspaceStore } from './inMemoryWorkspaceStore.ts'
import { readStarterSeed } from './starterSeed.ts'
import { DEFAULT_WORKSPACE, DEFAULT_WORKSPACE_CTX } from './workspaceStore.ts'
import type { AuthConfig } from './auth.ts'
import { createAuthenticator, loadAuthConfig } from './auth.ts'
import type { SendServerConfig } from './config.ts'
import { ConfigError, loadConfig, loadFeatures } from './config.ts'
import { createSender } from './createSender.ts'

/**
 * This adapter binds to 127.0.0.1 and keeps the loopback Host/Origin rule, so
 * the only caller it can ever have is someone already on this machine. Naming
 * that caller is therefore a formality rather than a security boundary, and a
 * default identity keeps `npm run server` working with no extra setup. Set
 * STUDIO_DEV_IDENTITY in .env to use your own address instead.
 */
const DEFAULT_LOCAL_IDENTITY = 'developer@localhost'

/** Said out loud at start-up, because losing work to a restart should never be a surprise. */
const STORAGE_BANNER = 'storage: in-memory (restarts lose everything; use npm run dev for the real D1)'

function main(): void {
  let config
  let sender
  try {
    config = loadConfig(process.env)
    sender = createSender(config)
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`\n${error.message}\n`)
      process.exit(1)
    }
    throw error
  }

  const authConfig = loadAuthConfig({
    ...process.env,
    STUDIO_DEV_IDENTITY: process.env.STUDIO_DEV_IDENTITY ?? DEFAULT_LOCAL_IDENTITY,
  })
  const authenticator = createAuthenticator(authConfig)

  const app = createApp({
    config,
    sender,
    hostPolicy: 'loopback',
    authenticator,
    passwordGate: authConfig.mode === 'password' ? { password: authConfig.password } : undefined,
    templateStore: new InMemoryTemplateStore(readStarterSeed()),
    // The same single workspace migration 0004 creates, so the starters have
    // a home here too. The developer identity is an admin of it (ADR-33).
    workspaceStore: new InMemoryWorkspaceStore([{ input: DEFAULT_WORKSPACE, ctx: DEFAULT_WORKSPACE_CTX }]),
    // No R2 here, so `POST /api/uploads` answers 503 and the visual editor
    // offers no image button in this runtime.
    objectStore: null,
    features: loadFeatures(process.env),
  })
  const server = serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (info) => {
    const base = `http://127.0.0.1:${info.port}`
    if (config.enabled && sender) {
      console.log(
        `Send server listening on ${base}\n  mode: ${sender.mode}\n  identity: ${describeAuth(authConfig)}\n  region: ${config.region}\n  from: ${config.from}\n  recipients: ${describeRecipientPolicy(config)}\n  rate limit: ${config.rateLimitPerMinute}/min\n  ${STORAGE_BANNER}`,
      )
      void sender.preflight(config.from).then((result) => {
        console.log(`  preflight: ${result.ok ? 'OK' : 'PROBLEM'} - ${result.message}`)
      })
    } else {
      const reason = config.enabled ? 'no sender configured' : config.reason
      console.log(`Send server listening on ${base} with sending DISABLED (${reason})\n  ${STORAGE_BANNER}`)
    }
  })
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `\nPort ${config.port} is already in use. Stop the other process or set STUDIO_SERVER_PORT in .env (the Vite proxy follows it).\n`,
      )
      process.exit(1)
    }
    throw error
  })
}

/** One line for the banner, so it is obvious at a glance how open sending is. */
function describeRecipientPolicy(config: Extract<SendServerConfig, { enabled: true }>): string {
  return config.recipientPolicy === 'any'
    ? 'any address (SES_ALLOWED_RECIPIENTS=*)'
    : config.allowedRecipients.join(', ')
}

/** One line for the startup banner, so it is obvious who requests will act as. */
function describeAuth(authConfig: AuthConfig): string {
  switch (authConfig.mode) {
    case 'cloudflare-access':
      return `Cloudflare Access (${authConfig.teamDomain})`
    case 'stytch':
      return `Stytch (${authConfig.projectId})`
    case 'password':
      return 'shared password (STUDIO_PASSWORD)'
    case 'developer':
      return `${authConfig.email} (local developer identity)`
    case 'none':
      return `NONE - the API will refuse every request (${authConfig.reason})`
  }
}

main()
