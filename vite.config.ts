/// <reference types="vitest/config" />
import path from 'node:path'
import { readFileSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type PluginOption } from 'vite'

/**
 * Which React Email the studio compiles against, read from the installed
 * package so the number on screen is the version that actually ran.
 *
 * It is read from disk rather than imported: `@react-email/components@1.0.12`
 * exports only `"."`, so `import '@react-email/components/package.json'` is
 * refused. And it is read defensively, because a static import of a path inside
 * `node_modules` makes the whole config — `vite dev`, `vite build` and every
 * Vitest run — fail if the layout differs (a hoisted workspace root, pnpm,
 * Yarn PnP). One label on a strip is not worth that.
 */
function reactEmailVersion(): string {
  try {
    const url = new URL('./node_modules/@react-email/components/package.json', import.meta.url)
    return JSON.parse(readFileSync(url, 'utf8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * Two ways to run the API locally (docs/SENDING.md):
 *
 * - cloudflare (default): the Cloudflare plugin runs `worker/index.ts` in workerd
 *   next to Vite and routes /api/* to it. Same runtime as production; sending is
 *   disabled or dry-run (see .dev.vars.example).
 * - node (`STUDIO_RUNTIME=node`, e.g. `npm run dev:node`): Vite proxies /api/* to
 *   the Node send server (`npm run server`), which can talk to Amazon SES.
 */
type Runtime = 'cloudflare' | 'node'

function readEnv(mode: string): Record<string, string | undefined> {
  return { ...loadEnv(mode, process.cwd(), ''), ...process.env }
}

function runtimeOf(env: Record<string, string | undefined>): Runtime {
  return env.STUDIO_RUNTIME === 'node' ? 'node' : 'cloudflare'
}

// The browser talks to the local send server through this proxy, so the app
// never needs the server's address or any credentials. The target follows
// STUDIO_SEND_SERVER_URL, else STUDIO_SERVER_PORT from the environment or .env.
function sendServerUrl(env: Record<string, string | undefined>): string {
  if (env.STUDIO_SEND_SERVER_URL) return env.STUDIO_SEND_SERVER_URL
  return `http://127.0.0.1:${env.STUDIO_SERVER_PORT ?? '8787'}`
}

type ProxyRequest = { setHeader(name: string, value: string): void }

function isLoopbackAddress(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

function nodeProxy(env: Record<string, string | undefined>) {
  return {
    '/api': {
      target: sendServerUrl(env),
      changeOrigin: false,
      // If Vite is ever started with --host, requests from other machines get a
      // foreign Host header so the send server refuses them (it only serves localhost).
      configure(proxy: {
        on(event: 'proxyReq', listener: (proxyReq: ProxyRequest, req: IncomingMessage) => void): void
      }) {
        proxy.on('proxyReq', (proxyReq, req) => {
          if (!isLoopbackAddress(req.socket.remoteAddress))
            proxyReq.setHeader('host', 'remote-client.invalid')
        })
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = readEnv(mode)
  const runtime = runtimeOf(env)
  const plugins: PluginOption[] = [react(), tailwindcss()]
  // Vitest imports this config too; it needs neither the Worker nor workerd.
  if (runtime === 'cloudflare' && !process.env.VITEST) plugins.push(cloudflare())
  const proxy = runtime === 'node' ? nodeProxy(env) : undefined

  return {
    server: {
      // Pinned so the dev origin can never drift. Stytch validates the exact
      // origin (SDK authorized domains) and the exact callback URL (redirect
      // URLs), so a silent hop to 5174 after a stale server is left running
      // breaks sign-in with bad_domain_for_stytch_sdk. strictPort fails loudly
      // instead of incrementing.
      port: 5173,
      strictPort: true,
      // This studio is opened from another device over Tailscale, so the dev
      // server is reached by tailnet hostname, not localhost. Vite's host check
      // rejects non-IP hostnames by default; allow this tailnet through.
      // Drop this line if you only ever browse from the machine running vite.
      allowedHosts: ['.tailf983c1.ts.net'],
      proxy,
    },
    preview: { proxy },
    plugins,
    define: {
      __REACT_EMAIL_VERSION__: JSON.stringify(reactEmailVersion()),
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
        // Wire contracts shared by the app, the Node server and the Worker.
        '@shared': path.resolve(import.meta.dirname, './shared'),
      },
    },
    test: {
      // Default to Node; component tests opt into jsdom with a `@vitest-environment jsdom` docblock.
      environment: 'node',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts', 'shared/**/*.test.ts'],
      css: false,
      // Why a fork cap: the default is one worker per core, and on a 4-core dev
      // box with swap already full that races the jsdom suites out of memory --
      // workers then fail to start at all ("Timeout waiting for worker to
      // respond") and `npm run check` goes red for reasons unrelated to the code.
      // Two workers is slower but deterministic, which is what a phase gate needs.
      // (Top-level `maxWorkers`, not `poolOptions`: Vitest 4 removed the latter.)
      maxWorkers: 2,
    },
  }
})
