-- Migration 0001: the two tables the Template Studio stores templates in.
--
-- Applied with `npm run db:migrate` (local SQLite under .wrangler/state/v3) and
-- `npm run db:migrate:prod` (the real D1 database). Migrations are never rolled
-- back, so every later migration must stay readable by the deployed Worker.
--
-- The shape in one sentence: `templates` holds the mutable card you see in the
-- library, `template_versions` is an append-only history of its contents.

CREATE TABLE templates (
  -- 'tpl_<uuid>' for templates people create; 'tpl_<slug>' for the seeded starters.
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  -- CHECK is SQLite's equivalent of a Salesforce picklist: a row whose value is
  -- not in the list is refused by the database, not just by the API.
  category TEXT NOT NULL DEFAULT 'notification'
    CHECK (category IN ('onboarding', 'security', 'collaboration', 'billing', 'notification')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready', 'deprecated')),
  -- A JSON array of strings. SQLite has no array type and the tag list is small,
  -- so it travels as text and is parsed at the edge of the store.
  tags TEXT NOT NULL DEFAULT '[]',
  origin TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('user', 'starter')),
  -- Which row in template_versions is the current one. Joined through the unique
  -- index below rather than a foreign key, so the two tables have no cycle.
  current_version INTEGER NOT NULL DEFAULT 1,
  -- The optimistic-concurrency token: it bumps on EVERY write, including a
  -- metadata-only edit that creates no new version. A client sends the revision
  -- it read as `expectedRevision`; if the row has moved on, its write is refused
  -- with 409 instead of quietly overwriting someone else. (Apex SystemModstamp
  -- plays the same role in a Salesforce org.)
  revision INTEGER NOT NULL DEFAULT 1,
  -- Audit columns. Single tenant for now: `created_by` is the signed-in email,
  -- or the literal 'shared-password' when the password gate is what let them in.
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Slugs are the human-readable key used in URLs, so no two templates may share one.
-- The store turns a violation of this index into a 409 slug-taken.
CREATE UNIQUE INDEX templates_slug_unique ON templates (slug);
-- The library lists newest-edited first; this index is what makes that ordering cheap.
CREATE INDEX templates_recent ON templates (updated_at DESC);

-- Append-only: a save never updates a row here, it inserts the next version.
-- Deleting a template cascades, so history never outlives its template.
CREATE TABLE template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('code', 'visual')),
  -- The envelope: what the email says about itself before anyone opens it.
  subject TEXT NOT NULL DEFAULT '',
  preheader TEXT NOT NULL DEFAULT '',
  reply_to TEXT NOT NULL DEFAULT '',
  -- Exactly one of these is filled in, enforced by the CHECK at the bottom:
  -- `source` is React Email TSX, `document` is the visual editor's Tiptap JSON.
  source TEXT,
  document TEXT,
  -- Visual templates only: the theme name to hand back to the editor, because
  -- the editor does not store the theme inside the document itself.
  theme TEXT NOT NULL DEFAULT 'studio-v1',
  -- Exported in the browser when the version is saved, with {{merge fields}}
  -- still UNRESOLVED, so a send can substitute values without re-rendering.
  html TEXT NOT NULL DEFAULT '',
  plain_text TEXT NOT NULL DEFAULT '',
  -- Sample props (JSON) and the JSON Schema they are checked against.
  -- '{}' as a schema means "any object", which is the permissive default.
  props_sample TEXT NOT NULL DEFAULT '{}',
  props_schema TEXT NOT NULL DEFAULT '{}',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- One kind, one payload: a code version without source (or a visual version
  -- without a document) is a bug, and the database refuses to store it.
  CHECK (
    (kind = 'code' AND source IS NOT NULL) OR (kind = 'visual' AND document IS NOT NULL)
  )
);

-- Version numbers are per template and never reused, so (template, number) is unique.
-- It is also the index the "current version" lookup rides on.
CREATE UNIQUE INDEX template_versions_number ON template_versions (template_id, version_number);
