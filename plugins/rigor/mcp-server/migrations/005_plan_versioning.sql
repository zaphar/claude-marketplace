-- Migration 005: Plan versioning
--
-- Adds plan_version and superseded_at columns to work_item so that replanning
-- mid-implementation retires old work items (superseded) instead of deleting
-- them, preserving full history. The plan_overview table is recreated with a
-- plan_version column and its UNIQUE constraint widened from (iteration_id) to
-- (iteration_id, plan_version), allowing multiple plan versions per iteration.
--
-- NOTE: PRAGMA foreign_keys=OFF and PRAGMA legacy_alter_table=ON are handled
-- by migrate.js before applying this migration.  The migration runner wraps
-- the entire file in a transaction.

-- ============================================================
-- 1. work_item — add plan_version, superseded_at columns and
--    widen UNIQUE from (iteration_id, name) to
--    (iteration_id, plan_version, name) via rename-create-copy-drop
-- ============================================================

ALTER TABLE work_item RENAME TO _old_work_item;

CREATE TABLE IF NOT EXISTS work_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  phase_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  work_type TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  plan_version INTEGER NOT NULL DEFAULT 1,
  superseded_at TEXT,
  complexity TEXT,
  review_checkpoint INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  entry_criteria JSON NOT NULL DEFAULT '[]',
  exit_criteria JSON NOT NULL DEFAULT '[]',
  checkpoint_focus JSON NOT NULL DEFAULT '[]',
  critical_path_sequence INTEGER,
  work_order INTEGER,
  risks JSON,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  UNIQUE(iteration_id, plan_version, name)
);

INSERT INTO work_item (id, iteration_id, phase_number, name, work_type, goal, status, plan_version, superseded_at, complexity, review_checkpoint, notes, entry_criteria, exit_criteria, checkpoint_focus, critical_path_sequence, work_order, risks, created_at, updated_at)
  SELECT id, iteration_id, phase_number, name, work_type, goal, status, 1, NULL, complexity, review_checkpoint, notes, entry_criteria, exit_criteria, checkpoint_focus, critical_path_sequence, work_order, risks, created_at, updated_at
  FROM _old_work_item;

DROP TABLE _old_work_item;

-- Recreate the iteration_id index dropped by the rename-create-copy-drop
CREATE INDEX idx_work_item_iteration_id ON work_item(iteration_id);

-- ============================================================
-- 2. plan_overview — widen UNIQUE from (iteration_id) to
--    (iteration_id, plan_version) using rename-create-copy-drop
-- ============================================================

ALTER TABLE plan_overview RENAME TO _old_plan_overview;

CREATE TABLE IF NOT EXISTS plan_overview (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  plan_version INTEGER NOT NULL DEFAULT 1,
  strategy TEXT NOT NULL,
  rationale TEXT NOT NULL,
  phase_one_approach TEXT,
  assumptions JSON NOT NULL DEFAULT '[]',
  risks JSON,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, plan_version)
);

INSERT INTO plan_overview (id, iteration_id, plan_version, strategy, rationale, phase_one_approach, assumptions, risks, created_at)
  SELECT id, iteration_id, 1, strategy, rationale, phase_one_approach, assumptions, risks, created_at
  FROM _old_plan_overview;

DROP TABLE _old_plan_overview;
