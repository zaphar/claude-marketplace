-- audit-schema.sql
-- Schema for the audit workflow state database at .scratch/rigor-plugin-update/audit.db
-- Bootstrapped by the skill orchestrator on first use:
--   sqlite3 .scratch/rigor-plugin-update/audit.db < .github/skills/rigor-plugin-update/audit-schema.sql
--
-- All queries against this database MUST use: sqlite3 -header -markdown
-- This produces clean markdown tables optimized for LLM consumption.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- One row per audit session (deep audit, schema audit, or MCP server audit invocation)
CREATE TABLE IF NOT EXISTS audit_run (
  id TEXT PRIMARY KEY,               -- e.g. '20260308T185725_deep_audit'
  mode TEXT NOT NULL                 -- which audit mode launched this run
    CHECK(mode IN ('deep_audit', 'schema_audit', 'mcp_server_audit')),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK(status IN ('running', 'review', 'implementing', 'completed', 'abandoned')),
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

-- One row per finding surfaced by a critic in a specific audit run
CREATE TABLE IF NOT EXISTS finding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  audit_run_id TEXT NOT NULL REFERENCES audit_run(id) ON DELETE CASCADE,
  critic TEXT NOT NULL               -- which critic produced this finding
    CHECK(critic IN ('consistency', 'schema', 'mcp_server')),
  category TEXT NOT NULL,            -- e.g. '5 (Schema Correctness)', 'Dim 1: Correctness', 'Agent Cross-References'
  severity TEXT NOT NULL
    CHECK(severity IN ('critical', 'high', 'medium', 'low', 'info')),
  summary TEXT NOT NULL,             -- one-line finding description
  affected_entities TEXT,            -- JSON array of affected tables, files, or other structural identifiers
  fingerprint TEXT NOT NULL,         -- dedup key: critic || '::' || category || '::' || sorted(affected_entities)
  report_path TEXT NOT NULL,         -- path to the raw critic markdown report containing full details
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per user decision on a finding
CREATE TABLE IF NOT EXISTS decision (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  finding_id INTEGER NOT NULL REFERENCES finding(id) ON DELETE CASCADE,
  decision TEXT NOT NULL
    CHECK(decision IN ('approved', 'rejected', 'skipped')),
  action TEXT,                       -- planned remediation for approved findings (e.g. 'Add UNIQUE constraint')
  reason TEXT,                       -- rationale for rejected/skipped (e.g. 'Loses FK enforcement for marginal gain')
  supersedes INTEGER REFERENCES decision(id), -- prior decision this one supersedes
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  implemented_at TEXT                -- set when an approved decision's action has been carried out
);

CREATE INDEX IF NOT EXISTS idx_finding_run ON finding(audit_run_id);
CREATE INDEX IF NOT EXISTS idx_finding_fingerprint ON finding(fingerprint);
CREATE INDEX IF NOT EXISTS idx_finding_critic ON finding(critic);
CREATE INDEX IF NOT EXISTS idx_decision_finding ON decision(finding_id);
