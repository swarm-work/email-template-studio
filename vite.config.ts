/// <reference types="vitest/config" />
import path from 'node:path'
import type { IncomingMessage } from 'node:http'
import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type PluginOption } from 'vite'
import pkg from './package.json' with { type: 'json' }

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
    server: { proxy },
    preview: { proxy },
    plugins,
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
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
    },
  }
})
