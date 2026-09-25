/**
 * The wire contract for the workspace API (`/api/workspaces`): request and
 * response schemas shared by the server (to validate what arrives) and the
 * browser (to validate what comes back). Zod only, like templateContracts.ts.
 *
 * A workspace is the unit of isolation (ADR-32). Its slug is the URL segment
 * the studio lives under (`/w/<slug>/...`) and the one the API is addressed by
 * (`/api/workspaces/<slug>/...`).
 */
import { z } from 'zod'
import { MAX_NAME_LENGTH, MAX_SLUG_LENGTH, slugSchema } from './templateContracts.ts'

/** The two roles a workspace knows. Admins can do everything editors can (ADR-33). */
export const workspaceRoleSchema = z.enum(['admin', 'editor'])

/** Where the API for one workspace lives. Same origin, so the session cookie travels. */
export const WORKSPACES_API_PATH = '/api/workspaces'

/** `/api/workspaces/<slug>` plus an optional suffix such as `/templates`. */
export function workspaceApiPath(slug: string, suffix = ''): string {
  return `${WORKSPACES_API_PATH}/${encodeURIComponent(slug)}${suffix}`
}

/**
 * A sending domain: lower-case labels joined by dots, at least one dot. The
 * v1 sending API (slice 3) will only accept a `from` on this domain.
 */
export const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/
export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(DOMAIN_PATTERN, 'Use a domain such as swarm.camp')

/** A Stytch organisation slug: what the team typed when creating it. */
const organizationSlugSchema = z.string().trim().min(1).max(MAX_SLUG_LENGTH)

/** An SES configuration set name: letters, numbers, hyphens and underscores. */
const configurationSetSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, 'Letters, numbers, hyphens and underscores only')

/** One workspace as the API returns it, with the caller's role in it. */
export const workspaceSchema = z.object({
  id: z.string().min(1),
  slug: slugSchema,
  name: z.string(),
  stytchOrganizationSlug: z.string().nullable(),
  defaultFrom: z.string(),
  allowedFromDomain: z.string(),
  sesConfigurationSet: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedBy: z.string(),
  updatedAt: z.string(),
  /** What the CALLER may do here. Another person's answer may differ. */
  role: workspaceRoleSchema,
})

export const memberSchema = z.object({
  email: z.email(),
  role: workspaceRoleSchema,
  addedBy: z.string(),
  addedAt: z.string(),
})

/**
 * The request bodies are `strictObject`, for the reason templateContracts.ts
 * gives: an unknown key is a 400 naming the key, not something silently dropped.
 */
export const createWorkspaceRequest = z.strictObject({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  /** Derived from the name when absent. */
  slug: slugSchema.optional(),
  defaultFrom: z.email(),
  /** Defaults to the domain of `defaultFrom`. */
  allowedFromDomain: domainSchema.optional(),
  /**
   * Defaults to the creator's own organisation, so a workspace made by someone
   * on the team is open to the team. Send `null` for a members-only workspace.
   */
  stytchOrganizationSlug: organizationSlugSchema.nullable().optional(),
})

export const updateWorkspaceRequest = z.strictObject({
  name: z.string().trim().min(1).max(MAX_NAME_LENGTH).optional(),
  defaultFrom: z.email().optional(),
  allowedFromDomain: domainSchema.optional(),
  /** `null` clears it: from then on only named members may enter. */
  stytchOrganizationSlug: organizationSlugSchema.nullable().optional(),
  /** `null` clears it: sends fall back to the server-wide configuration set. */
  sesConfigurationSet: configurationSetSchema.nullable().optional(),
})

export const putMemberRequest = z.strictObject({ role: workspaceRoleSchema })

export const workspaceListResponse = z.object({ workspaces: z.array(workspaceSchema) })
export const workspaceResponse = z.object({ workspace: workspaceSchema })
export const memberListResponse = z.object({ members: z.array(memberSchema) })
export const memberResponse = z.object({ member: memberSchema })
export const memberRemovedResponse = z.object({ status: z.literal('removed'), email: z.email() })

export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>
export type WorkspaceDto = z.infer<typeof workspaceSchema>
export type MemberDto = z.infer<typeof memberSchema>
export type CreateWorkspaceRequest = z.infer<typeof createWorkspaceRequest>
export type UpdateWorkspaceRequest = z.infer<typeof updateWorkspaceRequest>
