-- Migration 002: Remove CHECK constraints from TEXT columns
--
-- SQLite does not support ALTER TABLE DROP CONSTRAINT. To remove CHECK
-- constraints, each affected table is recreated using the rename → create →
-- copy → drop pattern. The CHECK(id = 1) on project's INTEGER PRIMARY KEY
-- is intentionally preserved — only TEXT-column CHECKs are removed.
--
-- Affected tables (18):
--   project, iteration, phase, revision, requirement, data_exchange,
--   nonfunctional_requirement, adr, requirement_trace, work_item,
--   plan_external_dependency, implementation_requirement_status,
--   implementation_component_status, implementation_blocker, test_report,
--   security_audit_finding, performance_audit_finding, blocker

-- NOTE: PRAGMA foreign_keys=OFF is handled by migrate.js before applying
-- this migration. It cannot be set inside a transaction (SQLite limitation).
-- The migration runner wraps the entire file in a transaction.

-- ============================================================
-- 1. project
--    Removed: CHECK(status IN ('active', 'closed'))
--    Kept:    CHECK(id = 1) on INTEGER PK
--    Indexes: none
-- ============================================================

ALTER TABLE project RENAME TO _old_project;

CREATE TABLE project (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  project_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL,
  closed_at TEXT,
  critic_model TEXT NOT NULL DEFAULT 'sonnet',
  notes TEXT NOT NULL DEFAULT ''
);

INSERT INTO project SELECT * FROM _old_project;
DROP TABLE _old_project;

-- ============================================================
-- 2. iteration
--    Removed: CHECK(status IN ('active', 'closed'))
--    Indexes: idx_iteration_status
-- ============================================================

ALTER TABLE iteration RENAME TO _old_iteration;

CREATE TABLE iteration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  notes TEXT NOT NULL DEFAULT ''
);

INSERT INTO iteration SELECT * FROM _old_iteration;
DROP TABLE _old_iteration;

CREATE INDEX idx_iteration_status ON iteration(status);

-- ============================================================
-- 3. phase
--    Removed: CHECK(name IN (...)), CHECK(status IN (...))
--    Kept:    UNIQUE(iteration_id, name) — referenced by blocker and
--             project_lesson composite FKs
--    Indexes: none (iteration_id is leftmost in UNIQUE)
-- ============================================================

ALTER TABLE phase RENAME TO _old_phase;

CREATE TABLE phase (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  approved_by TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, name)
);

INSERT INTO phase SELECT * FROM _old_phase;
DROP TABLE _old_phase;

-- ============================================================
-- 4. revision
--    Removed: CHECK(status IN ('draft', 'submitted', 'approved', 'rejected'))
--    Indexes: idx_revision_phase_id
-- ============================================================

ALTER TABLE revision RENAME TO _old_revision;

CREATE TABLE revision (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id INTEGER NOT NULL REFERENCES phase(id) ON DELETE CASCADE,
  producer_agent TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'draft',
  critic_agent TEXT,
  critic_feedback TEXT,
  reviewed_at TEXT
);

INSERT INTO revision SELECT * FROM _old_revision;
DROP TABLE _old_revision;

CREATE INDEX idx_revision_phase_id ON revision(phase_id);

-- ============================================================
-- 5. requirement
--    Removed: CHECK(priority IN ('must-have', 'should-have', 'nice-to-have'))
--    Indexes: idx_requirement_iteration_id
-- ============================================================

ALTER TABLE requirement RENAME TO _old_requirement;

CREATE TABLE requirement (
  id TEXT PRIMARY KEY,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  rationale TEXT,
  priority TEXT NOT NULL,
  category TEXT NOT NULL,
  acceptance_criteria JSON NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

INSERT INTO requirement SELECT * FROM _old_requirement;
DROP TABLE _old_requirement;

CREATE INDEX idx_requirement_iteration_id ON requirement(iteration_id);

-- ============================================================
-- 6. data_exchange
--    Removed: CHECK(direction IN ('input', 'output'))
--    Indexes: none (iteration_id is leftmost in UNIQUE)
-- ============================================================

ALTER TABLE data_exchange RENAME TO _old_data_exchange;

CREATE TABLE data_exchange (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  direction TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  source TEXT,
  destination TEXT,
  data_format TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, direction, name)
);

INSERT INTO data_exchange SELECT * FROM _old_data_exchange;
DROP TABLE _old_data_exchange;

-- ============================================================
-- 7. nonfunctional_requirement
--    Removed: CHECK(nfr_type IN ('deployment', 'operational', 'technology'))
--    Indexes: none (iteration_id is leftmost in UNIQUE)
-- ============================================================

ALTER TABLE nonfunctional_requirement RENAME TO _old_nonfunctional_requirement;

CREATE TABLE nonfunctional_requirement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  nfr_type TEXT NOT NULL,
  item TEXT NOT NULL,
  category TEXT,
  value TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, nfr_type, item)
);

INSERT INTO nonfunctional_requirement SELECT * FROM _old_nonfunctional_requirement;
DROP TABLE _old_nonfunctional_requirement;

-- ============================================================
-- 8. adr
--    Removed: CHECK(status IN ('proposed', 'accepted', 'deprecated', 'superseded'))
--    Indexes: idx_adr_iteration_id, idx_adr_superseded_by
-- ============================================================

ALTER TABLE adr RENAME TO _old_adr;

CREATE TABLE adr (
  id TEXT PRIMARY KEY,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  decision TEXT,
  rationale TEXT,
  date TEXT,
  context TEXT,
  superseded_by TEXT REFERENCES adr(id) ON DELETE SET NULL,
  consequences JSON NOT NULL DEFAULT '[]',
  research_sources JSON NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

INSERT INTO adr SELECT * FROM _old_adr;
DROP TABLE _old_adr;

CREATE INDEX idx_adr_iteration_id ON adr(iteration_id);
CREATE INDEX idx_adr_superseded_by ON adr(superseded_by);

-- ============================================================
-- 9. requirement_trace
--    Removed: CHECK(addressed_by_type IN ('component', 'flow', 'screen',
--             'adr', 'endpoint', 'technology'))
--    Indexes: idx_requirement_trace_requirement_id,
--             idx_requirement_trace_iteration_id,
--             idx_requirement_trace_addressed_by
-- ============================================================

ALTER TABLE requirement_trace RENAME TO _old_requirement_trace;

CREATE TABLE requirement_trace (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  addressed_by TEXT NOT NULL,
  addressed_by_type TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, requirement_id, addressed_by, addressed_by_type)
);

INSERT INTO requirement_trace SELECT * FROM _old_requirement_trace;
DROP TABLE _old_requirement_trace;

CREATE INDEX idx_requirement_trace_requirement_id ON requirement_trace(requirement_id);
CREATE INDEX idx_requirement_trace_iteration_id ON requirement_trace(iteration_id);
CREATE INDEX idx_requirement_trace_addressed_by ON requirement_trace(addressed_by_type, addressed_by);

-- ============================================================
-- 10. work_item
--     Removed: CHECK(status IN ('pending', 'test_writing', 'implementing',
--              'completed')), CHECK(complexity IN ('XS', 'S', 'M', 'L', 'XL'))
--     Indexes: idx_work_item_iteration_id
-- ============================================================

ALTER TABLE work_item RENAME TO _old_work_item;

CREATE TABLE work_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  phase_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  work_type TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
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
  UNIQUE(iteration_id, name)
);

INSERT INTO work_item SELECT * FROM _old_work_item;
DROP TABLE _old_work_item;

CREATE INDEX idx_work_item_iteration_id ON work_item(iteration_id);

-- ============================================================
-- 11. plan_external_dependency
--     Removed: CHECK(risk_level IN ('low', 'medium', 'high', 'critical'))
--     Indexes: idx_plan_external_dependency_work_item_id
-- ============================================================

ALTER TABLE plan_external_dependency RENAME TO _old_plan_external_dependency;

CREATE TABLE plan_external_dependency (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  work_item_id INTEGER REFERENCES work_item(id) ON DELETE SET NULL,
  risk_level TEXT NOT NULL,
  mitigation TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, name)
);

INSERT INTO plan_external_dependency SELECT * FROM _old_plan_external_dependency;
DROP TABLE _old_plan_external_dependency;

CREATE INDEX idx_plan_external_dependency_work_item_id ON plan_external_dependency(work_item_id);

-- ============================================================
-- 12. implementation_requirement_status
--     Removed: CHECK(status IN ('implemented', 'partial', 'not_started',
--              'blocked', 'not_applicable'))
--     Indexes: idx_implementation_requirement_status_requirement_id
-- ============================================================

ALTER TABLE implementation_requirement_status RENAME TO _old_implementation_requirement_status;

CREATE TABLE implementation_requirement_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  notes TEXT,
  UNIQUE(iteration_id, requirement_id)
);

INSERT INTO implementation_requirement_status SELECT * FROM _old_implementation_requirement_status;
DROP TABLE _old_implementation_requirement_status;

CREATE INDEX idx_implementation_requirement_status_requirement_id
  ON implementation_requirement_status(requirement_id);

-- ============================================================
-- 13. implementation_component_status
--     Removed: CHECK(status IN ('complete', 'partial', 'not_started'))
--     Indexes: idx_implementation_component_status_component_id
-- ============================================================

ALTER TABLE implementation_component_status RENAME TO _old_implementation_component_status;

CREATE TABLE implementation_component_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES component(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  notes TEXT,
  UNIQUE(iteration_id, component_id)
);

INSERT INTO implementation_component_status SELECT * FROM _old_implementation_component_status;
DROP TABLE _old_implementation_component_status;

CREATE INDEX idx_implementation_component_status_component_id
  ON implementation_component_status(component_id);

-- ============================================================
-- 14. implementation_blocker
--     Removed: CHECK(severity IN ('critical', 'major', 'minor'))
--     Indexes: idx_implementation_blocker_iteration_id
-- ============================================================

ALTER TABLE implementation_blocker RENAME TO _old_implementation_blocker;

CREATE TABLE implementation_blocker (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  recommendation TEXT,
  needs_escalation INTEGER NOT NULL DEFAULT 0
);

INSERT INTO implementation_blocker SELECT * FROM _old_implementation_blocker;
DROP TABLE _old_implementation_blocker;

CREATE INDEX idx_implementation_blocker_iteration_id ON implementation_blocker(iteration_id);

-- ============================================================
-- 15. test_report
--     Removed: CHECK(status IN ('pass', 'fail', 'blocked'))
--     Indexes: idx_test_report_iteration_id
-- ============================================================

ALTER TABLE test_report RENAME TO _old_test_report;

CREATE TABLE test_report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  total_tests INTEGER NOT NULL DEFAULT 0,
  passed_count INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  coverage_line REAL,
  coverage_branch REAL,
  coverage_function REAL,
  duration_seconds REAL,
  status TEXT NOT NULL,
  stdout TEXT,
  stderr TEXT,
  version TEXT,
  document_date TEXT,
  requirements_version TEXT,
  architecture_version TEXT,
  commit_sha TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO test_report SELECT * FROM _old_test_report;
DROP TABLE _old_test_report;

CREATE INDEX idx_test_report_iteration_id ON test_report(iteration_id);

-- ============================================================
-- 16. security_audit_finding
--     Removed: CHECK(severity IN (...)), CHECK(status IN (...))
--     Indexes: idx_security_audit_finding_iteration_id
-- ============================================================

ALTER TABLE security_audit_finding RENAME TO _old_security_audit_finding;

CREATE TABLE security_audit_finding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT,
  recommendation TEXT NOT NULL,
  cve TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO security_audit_finding SELECT * FROM _old_security_audit_finding;
DROP TABLE _old_security_audit_finding;

CREATE INDEX idx_security_audit_finding_iteration_id ON security_audit_finding(iteration_id);

-- ============================================================
-- 17. performance_audit_finding
--     Removed: CHECK(severity IN (...)), CHECK(status IN (...))
--     Indexes: idx_performance_audit_finding_iteration_id
-- ============================================================

ALTER TABLE performance_audit_finding RENAME TO _old_performance_audit_finding;

CREATE TABLE performance_audit_finding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT,
  metric_name TEXT,
  baseline_value REAL,
  actual_value REAL,
  recommendation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO performance_audit_finding SELECT * FROM _old_performance_audit_finding;
DROP TABLE _old_performance_audit_finding;

CREATE INDEX idx_performance_audit_finding_iteration_id ON performance_audit_finding(iteration_id);

-- ============================================================
-- 18. blocker
--     Removed: CHECK(severity IN ('critical', 'major', 'minor'))
--     Kept:    FOREIGN KEY (iteration_id, phase_name) composite FK
--     Indexes: idx_blocker_iteration_id, idx_blocker_phase_name
-- ============================================================

ALTER TABLE blocker RENAME TO _old_blocker;

CREATE TABLE blocker (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  phase_name TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  raised_by TEXT NOT NULL,
  resolved_at TEXT,
  resolution_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (iteration_id, phase_name) REFERENCES phase(iteration_id, name) ON DELETE CASCADE
);

INSERT INTO blocker SELECT * FROM _old_blocker;
DROP TABLE _old_blocker;

CREATE INDEX idx_blocker_iteration_id ON blocker(iteration_id);
CREATE INDEX idx_blocker_phase_name ON blocker(phase_name);

-- (end of migration — FK enforcement is re-enabled by migrate.js)
