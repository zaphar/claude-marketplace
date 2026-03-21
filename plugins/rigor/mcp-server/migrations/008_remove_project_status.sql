-- Migration 008: Remove status and closed_at from project table
--
-- The project table previously carried its own status ('active'/'closed') and
-- closed_at columns. These are redundant with the iteration lifecycle —
-- iterations already have their own status and closed_at managed by
-- iteration_close. The project is a singleton (CHECK(id = 1)), so "is the
-- project open?" is semantically identical to "is there an active iteration?"
--
-- SQLite does not support ALTER TABLE DROP COLUMN for columns with constraints
-- or defaults in older versions, so we use the rename → create → copy → drop
-- pattern (same as migration 002).

-- NOTE: PRAGMA foreign_keys=OFF is handled by migrate.js before applying
-- this migration. It cannot be set inside a transaction (SQLite limitation).
-- The migration runner wraps the entire file in a transaction.

-- ============================================================
-- 1. project
--    Removed: status TEXT NOT NULL, closed_at TEXT
--    Kept:    CHECK(id = 1) on INTEGER PK
--    Indexes: none
-- ============================================================

ALTER TABLE project RENAME TO _old_project;

CREATE TABLE project (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  project_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  critic_model TEXT NOT NULL DEFAULT 'sonnet',
  notes TEXT NOT NULL DEFAULT '',
  artifacts_directory TEXT NOT NULL DEFAULT 'docs/sdlc'
);

INSERT INTO project (id, project_name, created_at, updated_at, critic_model, notes, artifacts_directory)
  SELECT id, project_name, created_at, updated_at, critic_model, notes, artifacts_directory
  FROM _old_project;

DROP TABLE _old_project;
