/**
 * The workspace routes, and the middleware every workspace-scoped route sits
 * behind.
 *
 * Server layer: Hono + Zod + the WorkspaceStore port; no D1, no Node, nothing
 * under `src/`. Registered by `createApp` AFTER the auth middleware, so every
 * handler here already has a named caller.
 *
 * Two jobs:
 *   1. `requireWorkspace(role)`: turns `/api/workspaces/:workspace/...` into a
 *      `workspace` and a `role` on the Hono context, or ends the request. It
 *      is what keeps the template and upload routes free of any access logic.
 *   2. The routes that manage workspaces themselves: list, create, read,
 *      settings, members.
 */
import type { Context, Hono, MiddlewareHandler } from 'hono'
import type { Identity } from './auth.ts'
import { apiError, checkMutationHeaders, issuesOf, readJsonBody } from './http.ts'
import type { WriteContext } from './templateStore.ts'
import { roleAllows, roleFor } from './workspaceAccess.ts'
import type { StoredMember, StoredWorkspace, WorkspaceRole, WorkspaceStore } from './workspaceStore.ts'
import { workspaceIdFor } from './workspaceStore.ts'
import { slugify } from '../shared/templateContracts.ts'
import type { MemberDto, WorkspaceDto } from '../shared/workspaceContracts.ts'
import {
  createWorkspaceRequest,
  putMemberRequest,
  updateWorkspaceRequest,
  WORKSPACES_API_PATH,
} from '../shared/workspaceContracts.ts'

/**
 * The Hono context this app carries. `identity` is set by the auth
 * middleware; `workspace` and `role` by `requireWorkspace` below, so they are
 * only present on routes registered under `/api/workspaces/:workspace`.
 */
export type StudioEnv = {
  Variables: { identity: Identity; workspace: StoredWorkspace; role: WorkspaceRole }
}
type StudioApp = Hono<StudioEnv>
type RouteContext = Context<StudioEnv>

/** The route pattern one workspace lives under. */
export const WORKSPACE_ROUTE = `${WORKSPACES_API_PATH}/:workspace`

export interface WorkspaceRouteDependencies {
  /** `null` (or absent) means "no database is bound", and every route answers 503. */
  readonly workspaceStore?: WorkspaceStore | null
  /** Injectable clock, so tests can assert exact audit timestamps. */
  readonly now?: () => number
}

/** A z.email() check without importing zod here for one line. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function registerWorkspaceRoutes(app: StudioApp, deps: WorkspaceRouteDependencies): void {
  const { workspaceStore = null, now = () => Date.now() } = deps

  const contextFor = (email: string): WriteContext => ({ by: email, at: new Date(now()).toISOString() })

  // -------------------------------------------------------------------------
  // The middleware. Registered for both the bare workspace path and everything
  // under it, before any workspace-scoped route, so `c.get('workspace')` is
  // always there by the time a handler runs.
  //
  // The minimum role here is `editor`: every route under a workspace needs at
  // least that. Routes that need `admin` say so with `requireAdmin(c)`.
  // -------------------------------------------------------------------------
  const guard = requireWorkspace(workspaceStore)
  app.use(WORKSPACE_ROUTE, guard)
  app.use(`${WORKSPACE_ROUTE}/*`, guard)

  /** Every workspace the caller may enter, with their role in each. */
  app.get(WORKSPACES_API_PATH, async (c) => {
    if (!workspaceStore) return storageUnavailable(c)
    const identity = c.get('identity')
    const [workspaces, memberships] = await Promise.all([
      workspaceStore.list(),
      workspaceStore.membershipsOf(identity.email),
    ])
    const visible: WorkspaceDto[] = []
    for (const workspace of workspaces) {
      const membership = memberships.find((member) => member.workspaceId === workspace.id) ?? null
      const role = roleFor(workspace, membership, identity)
      if (role) visible.push(toWorkspaceDto(workspace, role))
    }
    return c.json({ workspaces: visible })
  })

  /** Anyone signed in may create a workspace; the creator becomes its first admin. */
  app.post(WORKSPACES_API_PATH, async (c) => {
    if (!workspaceStore) return storageUnavailable(c)
    const refused = checkMutationHeaders(c)
    if (refused) return refused
    const read = await readJsonBody(c)
    if ('response' in read) return read.response
    const parsed = createWorkspaceRequest.safeParse(read.body)
    if (!parsed.success) return badRequest(c, 'Invalid workspace.', parsed.error)

    const request = parsed.data
    const slug = request.slug ?? slugify(request.name)
    if (slug === '') return badRequest(c, 'That name does not produce a usable slug; send one explicitly.')

    // Checked before the insert, and again by the store's unique index: the id
    // is derived from the slug, so a taken slug is also a taken primary key,
    // and a primary-key clash is not something a store can politely refuse.
    if (await workspaceStore.getBySlug(slug)) {
      return apiError(c, 409, 'slug-taken', 'Another workspace already uses that slug.')
    }

    const identity = c.get('identity')
    const ctx = contextFor(identity.email)
    const outcome = await workspaceStore.create(
      {
        id: workspaceIdFor(slug),
        slug,
        name: request.name,
        // Absent: inherit the creator's organisation, so a workspace made by
        // someone on the team is open to the team. Explicit null: members only.
        stytchOrganizationSlug:
          request.stytchOrganizationSlug === undefined
            ? (identity.organization?.slug ?? null)
            : request.stytchOrganizationSlug,
        defaultFrom: request.defaultFrom,
        allowedFromDomain: request.allowedFromDomain ?? domainOf(request.defaultFrom),
        sesConfigurationSet: null,
      },
      ctx,
    )
    if (outcome.status === 'slug-taken') {
      return apiError(c, 409, 'slug-taken', 'Another workspace already uses that slug.')
    }
    if (outcome.status !== 'saved')
      return apiError(c, 500, 'unexpected', 'The workspace could not be created.')

    // Named explicitly, so the creator keeps access even if the organisation
    // is cleared later, and so a 'server' identity's workspace has a real row.
    await workspaceStore.putMember(outcome.workspace.id, identity.email, 'admin', ctx)
    console.log(`[workspaces] created ${outcome.workspace.id} by ${identity.email}`)
    return c.json({ workspace: toWorkspaceDto(outcome.workspace, 'admin') }, 201)
  })

  app.get(WORKSPACE_ROUTE, (c) => {
    return c.json({ workspace: toWorkspaceDto(c.get('workspace'), c.get('role')) })
  })

  app.patch(WORKSPACE_ROUTE, async (c) => {
    if (!workspaceStore) return storageUnavailable(c)
    const refused = requireAdmin(c) ?? checkMutationHeaders(c)
    if (refused) return refused
    const read = await readJsonBody(c)
    if ('response' in read) return read.response
    const parsed = updateWorkspaceRequest.safeParse(read.body)
    if (!parsed.success) return badRequest(c, 'Invalid workspace settings.', parsed.error)

    const identity = c.get('identity')
    const outcome = await workspaceStore.update(
      c.get('workspace').id,
      parsed.data,
      contextFor(identity.email),
    )
    if (outcome.status !== 'saved') return notFound(c)
    console.log(`[workspaces] updated ${outcome.workspace.id} by ${identity.email}`)
    return c.json({ workspace: toWorkspaceDto(outcome.workspace, c.get('role')) })
  })

  app.get(`${WORKSPACE_ROUTE}/members`, async (c) => {
    if (!workspaceStore) return storageUnavailable(c)
    const refused = requireAdmin(c)
    if (refused) return refused
    const members = await workspaceStore.listMembers(c.get('workspace').id)
    return c.json({ members: members.map(toMemberDto) })
  })

  app.put(`${WORKSPACE_ROUTE}/members/:email`, async (c) => {
    if (!workspaceStore) return storageUnavailable(c)
    const refused = requireAdmin(c) ?? checkMutationHeaders(c)
    if (refused) return refused
    const email = c.req.param('email').trim()
    if (!looksLikeEmail(email)) return badRequest(c, 'The member must be named by an email address.')
    const read = await readJsonBody(c)
    if ('response' in read) return read.response
    const parsed = putMemberRequest.safeParse(read.body)
    if (!parsed.success) return badRequest(c, 'Invalid member.', parsed.error)

    const workspace = c.get('workspace')
    if (parsed.data.role === 'editor') {
      const problem = await lastAdminProblem(workspaceStore, workspace, email)
      if (problem) return apiError(c, 409, 'last-admin', problem)
    }
    const identity = c.get('identity')
    const member = await workspaceStore.putMember(
      workspace.id,
      email,
      parsed.data.role,
      contextFor(identity.email),
    )
    if (!member) return notFound(c)
    console.log(`[workspaces] ${workspace.id} member ${email} is now ${member.role}, by ${identity.email}`)
    return c.json({ member: toMemberDto(member) })
  })

  app.delete(`${WORKSPACE_ROUTE}/members/:email`, async (c) => {
    if (!workspaceStore) return storageUnavailable(c)
    const refused = requireAdmin(c) ?? checkMutationHeaders(c, null)
    if (refused) return refused
    const email = c.req.param('email').trim()
    const workspace = c.get('workspace')
    const problem = await lastAdminProblem(workspaceStore, workspace, email)
    if (problem) return apiError(c, 409, 'last-admin', problem)

    const result = await workspaceStore.removeMember(workspace.id, email)
    if (result === 'not-found') return apiError(c, 404, 'not-found', 'No named member with that address.')
    console.log(`[workspaces] ${workspace.id} member ${email} removed by ${c.get('identity').email}`)
    return c.json({ status: 'removed' as const, email })
  })
}

/**
 * Resolves `:workspace` and decides whether the caller may enter it.
 *
 * Exported for the tests, and because it is the one piece of access logic
 * the whole API has: a route that is registered under WORKSPACE_ROUTE cannot
 * run without passing through here first.
 */
export function requireWorkspace(workspaceStore: WorkspaceStore | null): MiddlewareHandler<StudioEnv> {
  return async (c, next) => {
    if (!workspaceStore) return storageUnavailable(c)
    const slug = c.req.param('workspace')
    const workspace = slug ? await workspaceStore.getBySlug(slug) : null
    if (!workspace) return notFound(c)

    const identity = c.get('identity')
    const memberships = await workspaceStore.membershipsOf(identity.email)
    const membership = memberships.find((member) => member.workspaceId === workspace.id) ?? null
    const role = roleFor(workspace, membership, identity)
    // Not 403: someone who may not enter is not told the workspace exists.
    if (!role) return notFound(c)

    c.set('workspace', workspace)
    c.set('role', role)
    await next()
  }
}

/** The 403 an editor gets on an admin-only route, or null to carry on. */
export function requireAdmin(c: RouteContext) {
  if (roleAllows(c.get('role'), 'admin')) return null
  return apiError(c, 403, 'forbidden', 'Only a workspace admin can do that.')
}

/**
 * The lockout guard. A workspace that admits people only through its members
 * table must always keep one admin, or nobody could ever add another. A
 * workspace with an organisation is exempt: every organisation member is an
 * admin already.
 */
async function lastAdminProblem(
  store: WorkspaceStore,
  workspace: StoredWorkspace,
  email: string,
): Promise<string | null> {
  if (workspace.stytchOrganizationSlug !== null) return null
  const members = await store.listMembers(workspace.id)
  const target = members.find((member) => member.email === email)
  if (!target || target.role !== 'admin') return null
  const otherAdmins = members.filter((member) => member.role === 'admin' && member.email !== email)
  if (otherAdmins.length > 0) return null
  return `${email} is the only admin of this workspace. Make someone else an admin first.`
}

function storageUnavailable(c: Context) {
  return apiError(c, 503, 'storage-unavailable', 'No workspace database is configured for this server.')
}

function notFound(c: Context) {
  return apiError(c, 404, 'not-found', 'No workspace with that slug.')
}

function badRequest(c: Context, message: string, error?: Parameters<typeof issuesOf>[0]) {
  return apiError(c, 400, 'bad-request', message, error ? { issues: issuesOf(error) } : {})
}

/** The part after the @. The request schema has already checked there is one. */
function domainOf(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase()
}

/** Written out field by field so a new column cannot reach the wire by accident. */
function toWorkspaceDto(workspace: StoredWorkspace, role: WorkspaceRole): WorkspaceDto {
  return {
    id: workspace.id,
    slug: workspace.slug,
    name: workspace.name,
    stytchOrganizationSlug: workspace.stytchOrganizationSlug,
    defaultFrom: workspace.defaultFrom,
    allowedFromDomain: workspace.allowedFromDomain,
    sesConfigurationSet: workspace.sesConfigurationSet,
    createdBy: workspace.createdBy,
    createdAt: workspace.createdAt,
    updatedBy: workspace.updatedBy,
    updatedAt: workspace.updatedAt,
    role,
  }
}

function toMemberDto(member: StoredMember): MemberDto {
  return { email: member.email, role: member.role, addedBy: member.addedBy, addedAt: member.addedAt }
}
