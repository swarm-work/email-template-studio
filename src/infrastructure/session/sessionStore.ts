/**
 * Browser-session persistence for studio drafts.
 *
 * Uses `sessionStorage`, so edits survive a page refresh but are discarded
 * when the tab closes. The stored shape is validated on load with Zod: data
 * from storage is an untrusted boundary (`unknown` in, typed value out).
 * Infrastructure layer: it may use Zod and browser APIs, but holds no rules.
 */
import { z } from 'zod'
import type { EmailDocument, StudioMode } from '@/domain'

export const SESSION_STORAGE_KEY = 'email-template-studio:v1'

/**
 * The key is deliberately unchanged: every new field below has a `.default()`,
 * so a payload written by an older build still parses and the person keeps
 * their drafts. Unknown keys (such as the removed `localPublishes`) are
 * silently dropped, because `z.object` strips what it does not know.
 */

/**
 * Without a template we cannot know its kind, so an unreadable mode falls back
 * to code; `useStudio` clamps it against the selected template on the way in.
 * Written out rather than imported from `application/studioModes`, because
 * infrastructure must not depend on the application layer (docs/ARCHITECTURE.md).
 */
const FALLBACK_MODE: StudioMode = 'code'

/**
 * Tiptap JSON is structural. We only check that it is an object and hand it to
 * the domain as an EmailDocument; describing every node here would duplicate
 * the editor's own schema without catching anything useful.
 */
const documentSchema = z
  .record(z.string(), z.unknown())
  .transform((value) => value as unknown as EmailDocument)

const envelopeSchema = z.object({
  subject: z.string(),
  preheader: z.string(),
  replyTo: z.string(),
})

const draftSchema = z.object({
  baseRevision: z.number().int().nonnegative().default(0),
  baseVersionNumber: z.number().int().nonnegative().default(0),
  source: z.string(),
  payloadText: z.string(),
  document: documentSchema.nullable().default(null),
  envelope: envelopeSchema.nullable().default(null),
})

const persistedStateSchema = z.object({
  selectedId: z.string(),
  device: z.enum(['desktop', 'mobile']),
  mode: z.enum(['visual', 'code', 'preview']).default(FALLBACK_MODE).catch(FALLBACK_MODE),
  drafts: z.record(z.string(), draftSchema),
})

export type PersistedStudioState = z.infer<typeof persistedStateSchema>

export interface StudioSessionStore {
  load(): PersistedStudioState | null
  save(state: PersistedStudioState): void
  clear(): void
}

/** Minimal subset of the Web Storage API we rely on; makes tests easy. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function createSessionStore(storage: StorageLike | null): StudioSessionStore {
  return {
    load() {
      if (!storage) return null
      try {
        const raw = storage.getItem(SESSION_STORAGE_KEY)
        if (raw === null) return null
        const parsed = persistedStateSchema.safeParse(JSON.parse(raw))
        return parsed.success ? parsed.data : null
      } catch {
        return null
      }
    },
    save(state) {
      if (!storage) return
      try {
        storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(state))
      } catch {
        // Storage can be full or blocked (private mode). Losing persistence is acceptable.
      }
    },
    clear() {
      storage?.removeItem(SESSION_STORAGE_KEY)
    },
  }
}

/** Safe accessor: returns null when sessionStorage is unavailable (SSR, tests, locked-down browsers). */
export function getBrowserSessionStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}
