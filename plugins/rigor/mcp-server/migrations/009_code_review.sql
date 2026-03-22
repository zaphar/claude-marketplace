-- Migration 009: Add code review tables
--
-- Adds three tables for the holistic code review feature:
--   - code_review_run:          one-per-execution review run linked to an iteration
--   - code_review_finding:      structured diagnostic findings linked to a run
--   - code_review_finding_file: junction table for cross-cutting findings spanning
--                                multiple files
--
-- This is a pure additive migration (CREATE TABLE IF NOT EXISTS), no existing
-- tables are altered.

-- NOTE: PRAGMA foreign_keys=OFF is handled by migrate.js before applying
-- this migration. It cannot be set inside a transaction (SQLite limitation).
-- The migration runner wraps the entire file in a transaction.

-- ============================================================
-- 1. code_review_run
-- ============================================================

CREATE TABLE IF NOT EXISTS code_review_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  discovery_path TEXT NOT NULL,
  partitions_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'in_progress',
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

-- ============================================================
-- 2. code_review_finding
-- ============================================================

CREATE TABLE IF NOT EXISTS code_review_finding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES code_review_run(id) ON DELETE CASCADE,
  tier TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  impact_level TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 3. code_review_finding_file
-- ============================================================

CREATE TABLE IF NOT EXISTS code_review_finding_file (
  finding_id INTEGER NOT NULL REFERENCES code_review_finding(id) ON DELETE CASCADE,
  file TEXT NOT NULL,
  PRIMARY KEY (finding_id, file)
);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_code_review_run_iteration_id
  ON code_review_run(iteration_id);
CREATE INDEX IF NOT EXISTS idx_code_review_finding_run_id
  ON code_review_finding(run_id);
