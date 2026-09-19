/**
 * The HTTP adapter, run against the REAL API.
 *
 * `fetch` is replaced with a call straight into the Hono app (`app.request`),
 * backed by the server's own in-memory store. Nothing is served over a socket,
 * so this is still a fast unit test — but every request goes through the real
 * middleware, the real Zod validation and the real routes, which is what makes
 * "both adapters behave the same" a fact rather than a hope.
 *
 * It is the ONE file that reaches across the src/server project boundary, and
 * it pays for that: `tsconfig.app.json` excludes `*.contract.test.ts`, because
 * pulling `server/` into the browser program type-checks Worker code against
 * the DOM's lib and fails on things that are correct where they live. Vitest
 * does not type-check, so the test itself still runs. ADR-27 records the trade.
 */
import { createApp } from '../../../server/app.ts'
import { createDeveloperAuthenticator } from '../../../server/auth.ts'
import { InMemoryTemplateStore } from '../../../server/inMemoryTemplateStore.ts'
import type { SendServerConfig } from '../../../server/config.ts'
import { createHttpTemplateRepository } from './httpTemplateRepository'
import { describeTemplateRepository } from './templateRepositoryContract'

/** Sending plays no part here; only the template routes are exercised. */
const config: SendServerConfig = { enabled: false, port: 8787, reason: 'not under test' }

/** The app refuses a foreign Host, so every request has to claim the loopback one. */
const HOST = '127.0.0.1:8787'

describeTemplateRepository('HttpTemplateRepository', () => {
  const app = createApp({
    config,
    sender: null,
    authenticator: createDeveloperAuthenticator('tester@example.test'),
    templateStore: new InMemoryTemplateStore(),
  })

  const fetchImpl: typeof fetch = async (input, init) =>
    app.request(new URL(String(input), `http://${HOST}`).toString(), {
      ...init,
      headers: { ...(init?.headers as Record<string, string> | undefined), host: HOST },
    })

  return createHttpTemplateRepository({ fetchImpl })
})
