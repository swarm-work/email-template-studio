-- Migration 0004: workspaces, and every template now belongs to one.
--
-- A workspace is the unit of isolation (docs/PLATFORM_PLAN.md, ADR-32): it owns
-- templates today, and API keys, webhook endpoints and messages in the slices
-- that follow. There is deliberately no organisation / project / environment
-- hierarchy above it.
--
-- Who may enter a workspace is decided in two places (ADR-33):
--   * `stytch_organization_slug`: every member of that Stytch organisation is
--     an admin. The SLUG rather than the id, because the id differs between
--     Stytch's Test and Live environments while the slug is what the team chose.
--   * `workspace_members`: named people, with a role, for anyone outside that
--     organisation or anyone who should have less than admin.
-- A caller who matches neither is told the workspace does not exist (404), so
-- slugs cannot be enumerated.

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,                 -- ws_<slug>
  slug TEXT NOT NULL,                  -- the URL segment: /w/<slug>/...
  name TEXT NOT NULL,
  stytch_organization_slug TEXT,       -- NULL: only the members table admits people
  default_from TEXT NOT NULL,          -- the address sends use when none is given
  allowed_from_domain TEXT NOT NULL,   -- sends may only come from this domain (slice 3)
  ses_configuration_set TEXT,          -- NULL: fall back to SES_CONFIGURATION_SET (slice 2)
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX workspaces_slug_unique ON workspaces (slug);

CREATE TABLE workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'editor')),
  added_by TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, email)
);

CREATE INDEX workspace_members_by_email ON workspace_members (email);

-- The one workspace everything made so far belongs to. Its values are mirrored
-- by DEFAULT_WORKSPACE in server/workspaceStore.ts, and a test keeps the two in
-- step. The Stytch organisation `swarm` is the one sign-in already lands in
-- (docs/STYTCH_LOG.md), so nobody has to be added by hand after this runs.
INSERT INTO workspaces (id, slug, name, stytch_organization_slug, default_from, allowed_from_domain,
  ses_configuration_set, created_by, created_at, updated_by, updated_at)
VALUES ('ws_swarm-camp', 'swarm-camp', 'swarm.camp', 'swarm', 'testing@swarm.camp', 'swarm.camp',
  NULL, 'migration', '2026-09-25T00:00:00.000Z', 'migration', '2026-09-25T00:00:00.000Z');

-- Every existing template (the starters from 0002 and 0003, and anything made
-- since) lands in that workspace through the DEFAULT.
--
-- No REFERENCES clause on purpose: SQLite only lets ADD COLUMN carry a foreign
-- key when the default is NULL, and rebuilding the table to get one would have
-- to drop `templates`, which ON DELETE CASCADE would answer by deleting every
-- version. The store is the guard instead - a template is only ever created
-- through a workspace the middleware has already resolved.
ALTER TABLE templates ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'ws_swarm-camp';

-- A slug now only has to be unique within its workspace, and the library list
-- is always read for one workspace, so both indexes gain the column.
DROP INDEX templates_slug_unique;
CREATE UNIQUE INDEX templates_slug_unique ON templates (workspace_id, slug);

DROP INDEX templates_recent;
CREATE INDEX templates_recent ON templates (workspace_id, updated_at DESC);
