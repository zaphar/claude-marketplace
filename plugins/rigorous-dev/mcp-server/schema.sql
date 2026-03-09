-- Rigorous-dev changelog database schema
-- Replaces YAML-based artifact storage with normalized SQLite
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Project-level config and lifecycle (singleton — one row per repo DB)
CREATE TABLE IF NOT EXISTS project (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  project_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL CHECK(status IN ('active', 'closed')),
  closed_at TEXT,
  critic_model TEXT NOT NULL DEFAULT 'sonnet',
  notes TEXT NOT NULL DEFAULT ''
);

-- Iterations: each request to change the system
CREATE TABLE IF NOT EXISTS iteration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK(status IN ('active', 'closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_iteration_status ON iteration(status);

-- Phases within an iteration
CREATE TABLE IF NOT EXISTS phase (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(name IN (
    'requirements', 'ux_design', 'architecture', 'planning',
    'implementation', 'documentation', 'qa', 'audit', 'release'
  )),
  status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed', 'skipped')),
  started_at TEXT,
  completed_at TEXT,
  approved_by TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, name)
);

-- Revisions: producer-critic loops within a phase
CREATE TABLE IF NOT EXISTS revision (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id INTEGER NOT NULL REFERENCES phase(id) ON DELETE CASCADE,
  producer_agent TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL CHECK(status IN ('draft', 'submitted', 'approved', 'rejected')),
  critic_agent TEXT,
  critic_feedback TEXT,
  reviewed_at TEXT
);

-- Convenience VIEW: derive iteration context from revision_id
CREATE VIEW IF NOT EXISTS entity_context AS
SELECT r.id AS revision_id, p.id AS phase_id, p.iteration_id, p.name AS phase_name
FROM revision r
JOIN phase p ON r.phase_id = p.id;

-- ============================================================
-- CHANGELOG ENTRIES: append-only record of all decisions
-- ============================================================

-- Personas
CREATE TABLE IF NOT EXISTS persona (
  id TEXT PRIMARY KEY,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  technical_level TEXT,
  frequency_of_use TEXT,
  goals JSON NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

-- Requirements
CREATE TABLE IF NOT EXISTS requirement (
  id TEXT PRIMARY KEY,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  rationale TEXT,
  priority TEXT NOT NULL CHECK(priority IN ('must-have', 'should-have', 'nice-to-have')),
  category TEXT NOT NULL,
  acceptance_criteria JSON NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS requirement_persona (
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  persona_id TEXT NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  PRIMARY KEY (requirement_id, persona_id)
);

CREATE TABLE IF NOT EXISTS requirement_dependency (
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  depends_on TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  PRIMARY KEY (requirement_id, depends_on)
);

-- Project-level context (problem statement, constraints, assumptions, etc.)
CREATE TABLE IF NOT EXISTS project_context (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  category TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, key, value)
);

-- System inputs and outputs (per iteration)
-- direction discriminator: 'input' for data the system receives, 'output' for data it emits.
-- source is typically set for inputs; destination for outputs (both nullable).
CREATE TABLE IF NOT EXISTS system_io (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK(direction IN ('input', 'output')),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  source TEXT,
  destination TEXT,
  data_format TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, direction, name)
);

-- Deployment requirements (per iteration)
-- Each row is a single infrastructure/deployment requirement with its target context inline.
CREATE TABLE IF NOT EXISTS deployment_requirement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  target TEXT,
  description TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Operational requirements (per iteration)
-- Uptime is stored as category='uptime' with the SLA value in `item`.
-- Monitoring/logging/observability items use their respective categories.
CREATE TABLE IF NOT EXISTS operational_requirement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  item TEXT NOT NULL,
  category TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Technology constraints
CREATE TABLE IF NOT EXISTS technology_constraint (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  constraint_type TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Architecture Decision Records
CREATE TABLE IF NOT EXISTS adr (
  id TEXT PRIMARY KEY,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('proposed', 'accepted', 'deprecated', 'superseded')),
  date TEXT, -- ISO 8601 date, e.g. "2026-03-08"
  context TEXT,
  decision TEXT NOT NULL,
  rationale TEXT NOT NULL,
  superseded_by TEXT REFERENCES adr(id) ON DELETE SET NULL,
  consequences JSON NOT NULL DEFAULT '[]',
  research_sources JSON NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS adr_alternative (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adr_id TEXT NOT NULL REFERENCES adr(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  pros TEXT,
  cons TEXT
);

-- Architecture Components
CREATE TABLE IF NOT EXISTS component (
  id TEXT PRIMARY KEY,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  component_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS component_interface (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_id TEXT NOT NULL REFERENCES component(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  interface_type TEXT NOT NULL,
  description TEXT,
  UNIQUE(component_id, name)
);

CREATE TABLE IF NOT EXISTS component_dependency (
  component_id TEXT NOT NULL REFERENCES component(id) ON DELETE CASCADE,
  depends_on TEXT NOT NULL REFERENCES component(id) ON DELETE CASCADE,
  PRIMARY KEY (component_id, depends_on)
);

-- requirement_trace: unified traceability — see requirement_trace table below

CREATE TABLE IF NOT EXISTS integration_test_boundary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_id TEXT NOT NULL REFERENCES component(id) ON DELETE CASCADE,
  target_component_id TEXT NOT NULL REFERENCES component(id) ON DELETE CASCADE,
  boundary_type TEXT NOT NULL,
  correct_behavior TEXT NOT NULL,
  UNIQUE(component_id, target_component_id, boundary_type)
);

-- Architecture: technology choices
CREATE TABLE IF NOT EXISTS technology_choice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  purpose TEXT,
  rationale TEXT,
  version TEXT,
  config TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(revision_id, category, name)
);

CREATE INDEX IF NOT EXISTS idx_technology_choice_name ON technology_choice(name);

-- Architecture overview
CREATE TABLE IF NOT EXISTS architecture_overview (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  principles JSON NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS architecture_diagram (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  overview_id INTEGER NOT NULL REFERENCES architecture_overview(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  description TEXT,
  UNIQUE(overview_id, name)
);

-- Data model entities
CREATE TABLE IF NOT EXISTS data_entity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(revision_id, name)
);

CREATE TABLE IF NOT EXISTS data_entity_attribute (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL REFERENCES data_entity(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  data_type TEXT NOT NULL,
  is_required INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  UNIQUE(entity_id, name)
);

CREATE TABLE IF NOT EXISTS data_entity_relationship (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL REFERENCES data_entity(id) ON DELETE CASCADE,
  target_entity_id INTEGER NOT NULL REFERENCES data_entity(id) ON DELETE CASCADE,
  cardinality TEXT CHECK(cardinality IN ('one-to-one', 'one-to-many', 'many-to-many')), -- NULL when cardinality not yet determined
  description TEXT
);

-- Unified architecture config (security, deployment, observability)
CREATE TABLE IF NOT EXISTS architecture_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  config_type TEXT NOT NULL CHECK(config_type IN ('security', 'deployment', 'observability')),
  target TEXT,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(revision_id, config_type, category, key)
);

-- Dependencies manifest
CREATE TABLE IF NOT EXISTS approved_dependency (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  package TEXT NOT NULL,
  version_constraint TEXT,
  purpose TEXT NOT NULL,
  justification TEXT NOT NULL,
  adr_id TEXT REFERENCES adr(id) ON DELETE SET NULL,
  license TEXT,
  maintenance_activity TEXT,
  community_adoption TEXT,
  transitive_deps INTEGER,
  single_maintainer_risk INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(revision_id, package)
);

-- Traceability: unified requirement → design-element mapping
CREATE TABLE IF NOT EXISTS requirement_trace (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  addressed_by TEXT NOT NULL,
  addressed_by_type TEXT NOT NULL
    CHECK(addressed_by_type IN ('component', 'flow', 'screen', 'adr', 'endpoint', 'technology')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(revision_id, requirement_id, addressed_by, addressed_by_type)
);

-- UX: user flows
CREATE TABLE IF NOT EXISTS user_flow (
  id TEXT PRIMARY KEY,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  persona_id TEXT REFERENCES persona(id) ON DELETE SET NULL,
  entry_point TEXT,
  success_state TEXT,
  data_dependencies JSON NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS user_flow_step (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_id TEXT NOT NULL REFERENCES user_flow(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  action TEXT NOT NULL,
  surface TEXT, -- soft FK → screen.name (no constraint: references name, not id; screens may not exist yet when flows are defined)
  is_decision_point INTEGER NOT NULL DEFAULT 0,
  UNIQUE(flow_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_user_flow_step_surface ON user_flow_step(surface);

CREATE TABLE IF NOT EXISTS user_flow_step_branch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_id INTEGER NOT NULL REFERENCES user_flow_step(id) ON DELETE CASCADE,
  condition TEXT NOT NULL,
  next_step INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_flow_error_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_id TEXT NOT NULL REFERENCES user_flow(id) ON DELETE CASCADE,
  condition TEXT NOT NULL,
  recovery TEXT NOT NULL
);

-- requirement_trace: unified traceability — see requirement_trace table above

-- UX: screens
CREATE TABLE IF NOT EXISTS screen (
  id TEXT PRIMARY KEY,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  wireframe_path TEXT,
  mockup_path TEXT,
  components JSON NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_screen_name ON screen(name);

CREATE TABLE IF NOT EXISTS screen_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  screen_id TEXT NOT NULL REFERENCES screen(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  wireframe_path TEXT,
  UNIQUE(screen_id, name)
);

CREATE TABLE IF NOT EXISTS screen_responsive_variant (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  screen_id TEXT NOT NULL REFERENCES screen(id) ON DELETE CASCADE,
  breakpoint TEXT NOT NULL,
  wireframe_path TEXT,
  layout_changes TEXT,
  UNIQUE(screen_id, breakpoint)
);

-- UX: unified config (design system, accessibility, responsive, feedback patterns)
CREATE TABLE IF NOT EXISTS ux_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  config_type TEXT NOT NULL CHECK(config_type IN ('design_system', 'accessibility', 'responsive', 'feedback_pattern')),
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(revision_id, config_type, category, key)
);

-- UX: information architecture
CREATE TABLE IF NOT EXISTS info_architecture (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  parent_id INTEGER REFERENCES info_architecture(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- UX: personas addressed mapping
CREATE TABLE IF NOT EXISTS persona_addressed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  persona_id TEXT NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  how_addressed TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(revision_id, persona_id)
);

CREATE TABLE IF NOT EXISTS persona_addressed_flow (
  persona_addressed_id INTEGER NOT NULL REFERENCES persona_addressed(id) ON DELETE CASCADE,
  flow_id TEXT NOT NULL REFERENCES user_flow(id) ON DELETE CASCADE,
  PRIMARY KEY (persona_addressed_id, flow_id)
);

-- UX: assets
CREATE TABLE IF NOT EXISTS ux_asset (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  screen_id TEXT REFERENCES screen(id) ON DELETE SET NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Implementation plan phases
CREATE TABLE IF NOT EXISTS plan_phase (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  phase_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  phase_type TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'test_writing', 'implementing', 'completed')),
  complexity TEXT CHECK(complexity IN ('XS', 'S', 'M', 'L', 'XL')), -- NULL when estimation not yet done
  review_checkpoint INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  entry_criteria JSON NOT NULL DEFAULT '[]',
  exit_criteria JSON NOT NULL DEFAULT '[]',
  checkpoint_focus JSON NOT NULL DEFAULT '[]',
  critical_path_sequence INTEGER, -- NULL = not on critical path; non-NULL = sequence order
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(revision_id, name)
);

CREATE TABLE IF NOT EXISTS plan_phase_requirement (
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  priority TEXT,
  notes TEXT,
  PRIMARY KEY (plan_phase_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS plan_phase_component (
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES component(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_phase_id, component_id)
);

CREATE TABLE IF NOT EXISTS plan_phase_flow (
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  flow_id TEXT NOT NULL REFERENCES user_flow(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_phase_id, flow_id)
);

CREATE TABLE IF NOT EXISTS plan_phase_screen (
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  screen_id TEXT NOT NULL REFERENCES screen(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_phase_id, screen_id)
);

CREATE TABLE IF NOT EXISTS plan_phase_api_endpoint (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  http_method TEXT NOT NULL,
  route TEXT NOT NULL,
  description TEXT,
  UNIQUE(plan_phase_id, route, http_method)
);

CREATE TABLE IF NOT EXISTS plan_phase_db_change (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  migration_name TEXT NOT NULL,
  description TEXT,
  tables JSON NOT NULL DEFAULT '[]',
  UNIQUE(plan_phase_id, migration_name)
);

CREATE TABLE IF NOT EXISTS plan_phase_relationship (
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  related_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL CHECK(dependency_type IN ('dependency', 'parallel')),
  reason TEXT, -- only populated for dependency_type = 'dependency'
  PRIMARY KEY (plan_phase_id, related_phase_id)
);

CREATE TABLE IF NOT EXISTS plan_phase_risk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  risk TEXT NOT NULL,
  mitigation TEXT
);

-- Implementation plan: overview
CREATE TABLE IF NOT EXISTS plan_overview (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  strategy TEXT NOT NULL,
  rationale TEXT NOT NULL,
  phase_one_approach TEXT,
  assumptions JSON NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(revision_id)
);

CREATE TABLE IF NOT EXISTS plan_overview_risk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_overview_id INTEGER NOT NULL REFERENCES plan_overview(id) ON DELETE CASCADE,
  risk TEXT NOT NULL,
  mitigation TEXT,
  plan_phase_id INTEGER REFERENCES plan_phase(id) ON DELETE SET NULL
);

-- Implementation plan: external dependencies
CREATE TABLE IF NOT EXISTS plan_external_dependency (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  plan_phase_id INTEGER REFERENCES plan_phase(id) ON DELETE SET NULL,
  risk_level TEXT NOT NULL CHECK(risk_level IN ('low', 'medium', 'high', 'critical')),
  mitigation TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, name)
);

-- Implementation plan: metadata
CREATE TABLE IF NOT EXISTS plan_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  version TEXT NOT NULL,
  document_date TEXT NOT NULL,
  document_updated TEXT,
  status TEXT NOT NULL CHECK(status IN ('draft', 'review', 'approved')),
  requirements_version TEXT NOT NULL,
  architecture_version TEXT NOT NULL,
  ux_specification_version TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Implementation manifests (per sub-phase)
CREATE TABLE IF NOT EXISTS implementation_manifest (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('complete', 'partial', 'blocked')),
  lines_of_code INTEGER,
  warnings INTEGER NOT NULL DEFAULT 0,
  build_status TEXT CHECK(build_status IN ('success', 'failure')), -- NULL when build not yet run
  version TEXT,
  document_date TEXT, -- ISO 8601 date (YYYY-MM-DD)
  requirements_version TEXT,
  architecture_version TEXT,
  language TEXT,
  commit_sha TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS implementation_file (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  file_operation TEXT NOT NULL CHECK(file_operation IN ('created', 'modified', 'deleted')),
  purpose TEXT,
  component_id TEXT REFERENCES component(id) ON DELETE SET NULL,
  UNIQUE(manifest_id, path)
);

CREATE TABLE IF NOT EXISTS implementation_file_requirement (
  file_id INTEGER NOT NULL REFERENCES implementation_file(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS implementation_requirement_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('implemented', 'partial', 'not_started', 'blocked', 'not_applicable')),
  notes TEXT,
  UNIQUE(manifest_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS implementation_component_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES component(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('complete', 'partial', 'not_started')),
  notes TEXT,
  UNIQUE(manifest_id, component_id)
);

CREATE TABLE IF NOT EXISTS implementation_api_endpoint (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id) ON DELETE CASCADE,
  route TEXT NOT NULL,
  http_method TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('complete', 'stubbed', 'not_started')),
  UNIQUE(manifest_id, route, http_method)
);

CREATE TABLE IF NOT EXISTS implementation_api_endpoint_requirement (
  endpoint_id INTEGER NOT NULL REFERENCES implementation_api_endpoint(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  PRIMARY KEY (endpoint_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS implementation_dependency_added (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  purpose TEXT NOT NULL,
  license TEXT,
  UNIQUE(manifest_id, name)
);

CREATE TABLE IF NOT EXISTS implementation_db_migration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK(status IN ('created', 'applied', 'pending')),
  UNIQUE(manifest_id, name)
);

CREATE TABLE IF NOT EXISTS implementation_blocker (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('critical', 'major', 'minor')),
  recommendation TEXT,
  needs_escalation INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS implementation_blocker_requirement (
  blocker_id INTEGER NOT NULL REFERENCES implementation_blocker(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  PRIMARY KEY (blocker_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS implementation_review_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id) ON DELETE CASCADE,
  check_name TEXT NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(manifest_id, check_name)
);

-- VCS commits linked to iterations
CREATE TABLE IF NOT EXISTS vcs_commit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  phase_id INTEGER REFERENCES phase(id) ON DELETE SET NULL,
  commit_sha TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, commit_sha)
);

-- Intermediate assets shared between producer/critic
CREATE TABLE IF NOT EXISTS intermediate_asset (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id INTEGER REFERENCES phase(id) ON DELETE SET NULL,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Asset deliverables: files committed to VCS
CREATE TABLE IF NOT EXISTS asset_deliverable (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  phase_id INTEGER REFERENCES phase(id) ON DELETE SET NULL,
  asset_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  description TEXT,
  commit_sha TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- RELEASE WORKFLOW TABLES
-- ============================================================

-- Test report
CREATE TABLE IF NOT EXISTS test_report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  total_tests INTEGER NOT NULL DEFAULT 0,
  passed_count INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  coverage_line REAL,
  coverage_branch REAL,
  coverage_function REAL,
  duration_seconds REAL,
  status TEXT NOT NULL CHECK(status IN ('pass', 'fail', 'blocked')),
  version TEXT,
  document_date TEXT, -- ISO 8601 date (YYYY-MM-DD)
  requirements_version TEXT,
  architecture_version TEXT,
  commit_sha TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS test_requirement_coverage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES test_report(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pass', 'fail', 'partial', 'not_tested')),
  UNIQUE(report_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS test_acceptance_criterion_result (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coverage_id INTEGER NOT NULL REFERENCES test_requirement_coverage(id) ON DELETE CASCADE,
  criterion TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pass', 'fail', 'not_tested')),
  notes TEXT,
  test_ids JSON NOT NULL DEFAULT '[]',
  UNIQUE(coverage_id, criterion)
);

CREATE TABLE IF NOT EXISTS test_suite (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES test_report(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  suite_type TEXT NOT NULL,
  UNIQUE(report_id, name)
);

CREATE TABLE IF NOT EXISTS test_case (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suite_id INTEGER NOT NULL REFERENCES test_suite(id) ON DELETE CASCADE,
  test_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK(status IN ('pass', 'fail', 'skipped', 'flaky')),
  duration_ms REAL,
  error_message TEXT,
  stack_trace TEXT,
  retry_count INTEGER,
  UNIQUE(suite_id, test_id)
);

CREATE TABLE IF NOT EXISTS test_case_requirement (
  test_case_id INTEGER NOT NULL REFERENCES test_case(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  PRIMARY KEY (test_case_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS test_security_finding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES test_report(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  tool TEXT,
  severity TEXT CHECK(severity IN ('critical', 'high', 'medium', 'low', 'informational')), -- NULL when severity not yet triaged
  description TEXT NOT NULL,
  location TEXT,
  recommendation TEXT NOT NULL,
  package TEXT,
  advisory TEXT
);

CREATE TABLE IF NOT EXISTS test_performance_benchmark (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES test_report(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  metric TEXT NOT NULL,
  measured_value REAL NOT NULL,
  unit TEXT NOT NULL,
  threshold REAL,
  status TEXT CHECK(status IN ('pass', 'fail')), -- NULL when benchmark not yet evaluated
  UNIQUE(report_id, name)
);

CREATE TABLE IF NOT EXISTS test_blocker (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES test_report(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('critical', 'major', 'minor')),
  recommendation TEXT
);

CREATE TABLE IF NOT EXISTS test_blocker_requirement (
  blocker_id INTEGER NOT NULL REFERENCES test_blocker(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  PRIMARY KEY (blocker_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS test_recommendation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES test_report(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  priority TEXT NOT NULL CHECK(priority IN ('high', 'medium', 'low'))
);

-- ============================================================
-- AUDIT PHASE TABLES
-- ============================================================

-- Security audit findings (produced by security_auditor during audit phase)
CREATE TABLE IF NOT EXISTS security_audit_finding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'informational')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT,
  recommendation TEXT NOT NULL,
  cve TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'accepted', 'false-positive')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Performance audit findings (produced by performance_auditor during audit phase)
CREATE TABLE IF NOT EXISTS performance_audit_finding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'informational')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT,
  metric_name TEXT,
  baseline_value REAL,
  actual_value REAL,
  recommendation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'accepted', 'deferred')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Documentation manifest
CREATE TABLE IF NOT EXISTS documentation_manifest (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('complete', 'partial', 'blocked')),
  total_pages INTEGER,
  accessibility_compliant INTEGER NOT NULL DEFAULT 0,
  version TEXT,
  document_date TEXT, -- ISO 8601 date (YYYY-MM-DD)
  requirements_version TEXT,
  architecture_version TEXT,
  implementation_version TEXT,
  format TEXT CHECK(format IN ('markdown', 'html', 'pdf', 'docusaurus', 'mkdocs', 'other')), -- NULL when format not yet decided
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documentation_section (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES documentation_manifest(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  path TEXT,
  UNIQUE(manifest_id, category, key)
);

CREATE TABLE IF NOT EXISTS documentation_feature (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES documentation_manifest(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  includes_examples INTEGER NOT NULL DEFAULT 0,
  includes_screenshots INTEGER NOT NULL DEFAULT 0,
  UNIQUE(manifest_id, name)
);

CREATE TABLE IF NOT EXISTS documentation_feature_requirement (
  feature_id INTEGER NOT NULL REFERENCES documentation_feature(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  PRIMARY KEY (feature_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS documentation_requirement_coverage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES documentation_manifest(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  documented INTEGER NOT NULL DEFAULT 0,
  user_facing INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  paths JSON NOT NULL DEFAULT '[]',
  UNIQUE(manifest_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS documentation_asset (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES documentation_manifest(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK(asset_type IN ('screenshot', 'diagram', 'video', 'code-sample', 'other')),
  description TEXT,
  alt_text TEXT,
  UNIQUE(manifest_id, path)
);

CREATE TABLE IF NOT EXISTS documentation_review_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES documentation_manifest(id) ON DELETE CASCADE,
  check_name TEXT NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(manifest_id, check_name)
);

-- Deployment manifest
CREATE TABLE IF NOT EXISTS deployment_manifest (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('ready', 'not_ready', 'blocked')),
  targets JSON NOT NULL DEFAULT '[]',
  blockers JSON NOT NULL DEFAULT '[]',
  version TEXT,
  document_date TEXT, -- ISO 8601 date (YYYY-MM-DD)
  requirements_version TEXT,
  architecture_version TEXT,
  implementation_version TEXT,
  test_report_version TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS deployment_pipeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  config_files JSON NOT NULL DEFAULT '[]',
  UNIQUE(manifest_id, platform)
);

CREATE TABLE IF NOT EXISTS deployment_pipeline_stage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_id INTEGER NOT NULL REFERENCES deployment_pipeline(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  triggers JSON NOT NULL DEFAULT '[]',
  steps JSON NOT NULL DEFAULT '[]',
  UNIQUE(pipeline_id, name)
);

CREATE TABLE IF NOT EXISTS deployment_stage_quality_gate (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id INTEGER NOT NULL REFERENCES deployment_pipeline_stage(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  condition TEXT NOT NULL,
  failure_action TEXT NOT NULL CHECK(failure_action IN ('block', 'warn', 'notify')),
  UNIQUE(stage_id, name)
);

CREATE TABLE IF NOT EXISTS deployment_quality_gate (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  UNIQUE(manifest_id, category, key)
);

CREATE TABLE IF NOT EXISTS deployment_environment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  deployment_method TEXT NOT NULL,
  url TEXT,
  rollback_procedure TEXT,
  UNIQUE(manifest_id, name)
);

CREATE TABLE IF NOT EXISTS deployment_env_infra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  environment_id INTEGER NOT NULL REFERENCES deployment_environment(id) ON DELETE CASCADE,
  provider TEXT,
  resource TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployment_env_var (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  environment_id INTEGER NOT NULL REFERENCES deployment_environment(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  value_source TEXT NOT NULL,
  description TEXT,
  UNIQUE(environment_id, name)
);

CREATE TABLE IF NOT EXISTS deployment_artifact (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  artifact_type TEXT NOT NULL,
  registry TEXT,
  versioning TEXT CHECK(versioning IN ('semantic', 'git-sha', 'timestamp', 'custom')), -- NULL when versioning strategy not yet chosen
  platforms JSON NOT NULL DEFAULT '[]',
  UNIQUE(manifest_id, name)
);

CREATE TABLE IF NOT EXISTS deployment_signing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0,
  signing_method TEXT
);

CREATE TABLE IF NOT EXISTS deployment_local_executable (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id) ON DELETE CASCADE,
  installation_method TEXT,
  update_mechanism TEXT,
  platforms JSON NOT NULL DEFAULT '[]',
  channels JSON NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS deployment_secret (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id) ON DELETE CASCADE,
  provider TEXT,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  rotation_policy TEXT,
  UNIQUE(manifest_id, name)
);

CREATE TABLE IF NOT EXISTS deployment_health_check (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  endpoint TEXT,
  interval TEXT, -- duration string, e.g. "30s", "5m", "1h"
  UNIQUE(manifest_id, name)
);

CREATE TABLE IF NOT EXISTS deployment_alerting (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id) ON DELETE CASCADE,
  provider TEXT,
  channel TEXT NOT NULL,
  UNIQUE(manifest_id, channel)
);

CREATE TABLE IF NOT EXISTS deployment_runbook (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scenario TEXT NOT NULL,
  UNIQUE(manifest_id, name)
);

CREATE TABLE IF NOT EXISTS deployment_runbook_step (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  runbook_id INTEGER NOT NULL REFERENCES deployment_runbook(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  is_rollback INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deployment_review_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id) ON DELETE CASCADE,
  check_name TEXT NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(manifest_id, check_name)
);

-- ============================================================
-- BLOCKER: cross-phase workflow blockers raised by agents
-- ============================================================

CREATE TABLE IF NOT EXISTS blocker (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  phase_name TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('critical', 'major', 'minor')),
  raised_by TEXT NOT NULL,
  resolved_at TEXT,
  resolution_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (iteration_id, phase_name) REFERENCES phase(iteration_id, name) ON DELETE CASCADE
);

-- ============================================================
-- PROJECT LESSON: cross-phase lessons learned, recorded by critics
-- ============================================================

CREATE TABLE IF NOT EXISTS project_lesson (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  phase_name TEXT NOT NULL,
  category TEXT NOT NULL,
  lesson TEXT NOT NULL,
  recurring INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (iteration_id, phase_name) REFERENCES phase(iteration_id, name) ON DELETE CASCADE
);

-- ============================================================
-- ENTITY SNAPSHOT: JSON history of entity changes across revisions
-- ============================================================

CREATE TABLE IF NOT EXISTS entity_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  -- soft FK: entity_type must match a key in ENTITY_TABLE (read-tools.js)
  entity_type TEXT NOT NULL, -- e.g. 'requirement', 'adr', 'component', 'screen', 'user_flow', 'plan_phase', etc.
  source_id TEXT NOT NULL,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  snapshot JSON NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_type, source_id, revision_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_snapshot_lookup
  ON entity_snapshot(entity_type, source_id);

-- ============================================================
-- INDEXES: high-frequency FK column lookups
-- ============================================================
-- Naming: idx_<table>_<column> (single), idx_<table>_<col1>_<col2> (composite)
-- Skips: columns already leftmost in a PK or UNIQUE constraint (auto-indexed)

-- ------------------------------------------------------------
-- iteration_id — on tables that still carry iteration_id directly
-- Skipped: phase, project_context
--   (iteration_id is leftmost in their UNIQUE constraints)
-- ------------------------------------------------------------

-- Requirements domain
-- Skipped: system_io (iteration_id is leftmost in UNIQUE(iteration_id, direction, name))
CREATE INDEX IF NOT EXISTS idx_deployment_requirement_iteration_id
  ON deployment_requirement(iteration_id);
CREATE INDEX IF NOT EXISTS idx_operational_requirement_iteration_id
  ON operational_requirement(iteration_id);
CREATE INDEX IF NOT EXISTS idx_technology_constraint_iteration_id
  ON technology_constraint(iteration_id);


-- Planning domain
-- Skipped: plan_external_dependency (iteration_id is leftmost in UNIQUE(iteration_id, name))


-- Cross-cutting domain
-- Skipped: vcs_commit (iteration_id is leftmost in UNIQUE(iteration_id, commit_sha))
CREATE INDEX IF NOT EXISTS idx_asset_deliverable_iteration_id
  ON asset_deliverable(iteration_id);
CREATE INDEX IF NOT EXISTS idx_blocker_iteration_id
  ON blocker(iteration_id);
CREATE INDEX IF NOT EXISTS idx_project_lesson_iteration_id
  ON project_lesson(iteration_id);

-- ------------------------------------------------------------
-- manifest_id — child tables of implementation_manifest,
--   documentation_manifest, deployment_manifest
-- Skipped: implementation_requirement_status, implementation_component_status,
--   documentation_requirement_coverage (manifest_id is leftmost in UNIQUE)
-- Skipped: implementation_dependency_added, implementation_db_migration,
--   documentation_section, deployment_secret, deployment_health_check,
--   deployment_alerting (manifest_id is leftmost in UNIQUE added for dedup)
-- ------------------------------------------------------------

-- Implementation manifest children
CREATE INDEX IF NOT EXISTS idx_implementation_file_manifest_id
  ON implementation_file(manifest_id);
-- Skipped: implementation_api_endpoint (manifest_id is leftmost in UNIQUE(manifest_id, route, http_method))
CREATE INDEX IF NOT EXISTS idx_implementation_blocker_manifest_id
  ON implementation_blocker(manifest_id);
CREATE INDEX IF NOT EXISTS idx_implementation_review_checklist_manifest_id
  ON implementation_review_checklist(manifest_id);

-- Documentation manifest children
CREATE INDEX IF NOT EXISTS idx_documentation_feature_manifest_id
  ON documentation_feature(manifest_id);
CREATE INDEX IF NOT EXISTS idx_documentation_asset_manifest_id
  ON documentation_asset(manifest_id);
CREATE INDEX IF NOT EXISTS idx_documentation_review_checklist_manifest_id
  ON documentation_review_checklist(manifest_id);

-- Deployment manifest children
CREATE INDEX IF NOT EXISTS idx_deployment_pipeline_manifest_id
  ON deployment_pipeline(manifest_id);
CREATE INDEX IF NOT EXISTS idx_deployment_quality_gate_manifest_id
  ON deployment_quality_gate(manifest_id);
CREATE INDEX IF NOT EXISTS idx_deployment_environment_manifest_id
  ON deployment_environment(manifest_id);
CREATE INDEX IF NOT EXISTS idx_deployment_artifact_manifest_id
  ON deployment_artifact(manifest_id);
CREATE INDEX IF NOT EXISTS idx_deployment_signing_manifest_id
  ON deployment_signing(manifest_id);
CREATE INDEX IF NOT EXISTS idx_deployment_local_executable_manifest_id
  ON deployment_local_executable(manifest_id);
CREATE INDEX IF NOT EXISTS idx_deployment_runbook_manifest_id
  ON deployment_runbook(manifest_id);
CREATE INDEX IF NOT EXISTS idx_deployment_review_checklist_manifest_id
  ON deployment_review_checklist(manifest_id);

-- ------------------------------------------------------------
-- report_id — child tables of test_report
-- Skipped: test_requirement_coverage (report_id is leftmost in UNIQUE)
-- Skipped: test_suite (report_id is leftmost in UNIQUE(report_id, name))
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_test_security_finding_report_id
  ON test_security_finding(report_id);
CREATE INDEX IF NOT EXISTS idx_test_performance_benchmark_report_id
  ON test_performance_benchmark(report_id);
CREATE INDEX IF NOT EXISTS idx_test_blocker_report_id
  ON test_blocker(report_id);
CREATE INDEX IF NOT EXISTS idx_test_recommendation_report_id
  ON test_recommendation(report_id);

-- ------------------------------------------------------------
-- plan_phase_id — child tables of plan_phase
-- Skipped: plan_phase_requirement, plan_phase_component, plan_phase_flow,
--   plan_phase_screen, plan_phase_relationship
--   (plan_phase_id is leftmost in their composite PKs)
-- ------------------------------------------------------------

-- Skipped: plan_phase_api_endpoint (plan_phase_id is leftmost in UNIQUE(plan_phase_id, route, http_method))
CREATE INDEX IF NOT EXISTS idx_plan_phase_db_change_plan_phase_id
  ON plan_phase_db_change(plan_phase_id);
CREATE INDEX IF NOT EXISTS idx_plan_phase_risk_plan_phase_id
  ON plan_phase_risk(plan_phase_id);
CREATE INDEX IF NOT EXISTS idx_implementation_manifest_plan_phase_id
  ON implementation_manifest(plan_phase_id);

-- ------------------------------------------------------------
-- plan_overview_id — child tables of plan_overview
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_plan_overview_risk_plan_overview_id
  ON plan_overview_risk(plan_overview_id);

-- ------------------------------------------------------------
-- requirement_id — junction and mapping tables
-- Skipped: requirement_persona, requirement_dependency
--   (requirement_id is leftmost in their composite PKs)
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_requirement_trace_requirement_id
  ON requirement_trace(requirement_id);
CREATE INDEX IF NOT EXISTS idx_plan_phase_requirement_requirement_id
  ON plan_phase_requirement(requirement_id);
CREATE INDEX IF NOT EXISTS idx_implementation_file_requirement_requirement_id
  ON implementation_file_requirement(requirement_id);
CREATE INDEX IF NOT EXISTS idx_implementation_requirement_status_requirement_id
  ON implementation_requirement_status(requirement_id);
CREATE INDEX IF NOT EXISTS idx_impl_api_endpoint_req_requirement_id
  ON implementation_api_endpoint_requirement(requirement_id);
CREATE INDEX IF NOT EXISTS idx_implementation_blocker_requirement_requirement_id
  ON implementation_blocker_requirement(requirement_id);
CREATE INDEX IF NOT EXISTS idx_test_requirement_coverage_requirement_id
  ON test_requirement_coverage(requirement_id);
CREATE INDEX IF NOT EXISTS idx_test_case_requirement_requirement_id
  ON test_case_requirement(requirement_id);
CREATE INDEX IF NOT EXISTS idx_test_blocker_requirement_requirement_id
  ON test_blocker_requirement(requirement_id);
CREATE INDEX IF NOT EXISTS idx_documentation_feature_requirement_requirement_id
  ON documentation_feature_requirement(requirement_id);
CREATE INDEX IF NOT EXISTS idx_doc_requirement_coverage_requirement_id
  ON documentation_requirement_coverage(requirement_id);
CREATE INDEX IF NOT EXISTS idx_requirement_trace_revision_id
  ON requirement_trace(revision_id);
CREATE INDEX IF NOT EXISTS idx_requirement_trace_addressed_by_type
  ON requirement_trace(addressed_by_type);

-- ------------------------------------------------------------
-- revision_id — provenance FK on every entity table
-- ------------------------------------------------------------

-- Requirements domain
CREATE INDEX IF NOT EXISTS idx_persona_revision_id
  ON persona(revision_id);
CREATE INDEX IF NOT EXISTS idx_requirement_revision_id
  ON requirement(revision_id);

-- Architecture domain
CREATE INDEX IF NOT EXISTS idx_adr_revision_id
  ON adr(revision_id);
CREATE INDEX IF NOT EXISTS idx_component_revision_id
  ON component(revision_id);
CREATE INDEX IF NOT EXISTS idx_technology_choice_revision_id
  ON technology_choice(revision_id);
CREATE INDEX IF NOT EXISTS idx_architecture_overview_revision_id
  ON architecture_overview(revision_id);
CREATE INDEX IF NOT EXISTS idx_data_entity_revision_id
  ON data_entity(revision_id);
CREATE INDEX IF NOT EXISTS idx_architecture_config_revision_id
  ON architecture_config(revision_id);
CREATE INDEX IF NOT EXISTS idx_approved_dependency_revision_id
  ON approved_dependency(revision_id);
-- requirement_trace revision_id covered by idx_requirement_trace_revision_id above

-- UX design domain
CREATE INDEX IF NOT EXISTS idx_user_flow_revision_id
  ON user_flow(revision_id);
CREATE INDEX IF NOT EXISTS idx_screen_revision_id
  ON screen(revision_id);
CREATE INDEX IF NOT EXISTS idx_ux_config_revision_id
  ON ux_config(revision_id);
CREATE INDEX IF NOT EXISTS idx_info_architecture_revision_id
  ON info_architecture(revision_id);
CREATE INDEX IF NOT EXISTS idx_persona_addressed_revision_id
  ON persona_addressed(revision_id);
CREATE INDEX IF NOT EXISTS idx_ux_asset_revision_id
  ON ux_asset(revision_id);

-- Planning domain
CREATE INDEX IF NOT EXISTS idx_plan_phase_revision_id
  ON plan_phase(revision_id);
-- Skipped: plan_overview (revision_id is the UNIQUE key)
CREATE INDEX IF NOT EXISTS idx_plan_metadata_revision_id
  ON plan_metadata(revision_id);

-- Implementation domain
CREATE INDEX IF NOT EXISTS idx_implementation_manifest_revision_id
  ON implementation_manifest(revision_id);

-- Release workflow domain
CREATE INDEX IF NOT EXISTS idx_test_report_revision_id
  ON test_report(revision_id);

-- Audit domain
CREATE INDEX IF NOT EXISTS idx_security_audit_finding_revision_id
  ON security_audit_finding(revision_id);
CREATE INDEX IF NOT EXISTS idx_performance_audit_finding_revision_id
  ON performance_audit_finding(revision_id);

-- Documentation domain
CREATE INDEX IF NOT EXISTS idx_documentation_manifest_revision_id
  ON documentation_manifest(revision_id);

-- Deployment domain
CREATE INDEX IF NOT EXISTS idx_deployment_manifest_revision_id
  ON deployment_manifest(revision_id);

-- Cross-cutting domain
CREATE INDEX IF NOT EXISTS idx_intermediate_asset_revision_id
  ON intermediate_asset(revision_id);
CREATE INDEX IF NOT EXISTS idx_entity_snapshot_revision_id
  ON entity_snapshot(revision_id);

-- ------------------------------------------------------------
-- phase_id — FK to phase(id)
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_revision_phase_id
  ON revision(phase_id);
CREATE INDEX IF NOT EXISTS idx_vcs_commit_phase_id
  ON vcs_commit(phase_id);
CREATE INDEX IF NOT EXISTS idx_intermediate_asset_phase_id
  ON intermediate_asset(phase_id);
CREATE INDEX IF NOT EXISTS idx_asset_deliverable_phase_id
  ON asset_deliverable(phase_id);

-- ------------------------------------------------------------
-- persona_id — FK to persona(id)
-- Skipped: requirement_persona (persona_id is not leftmost,
--   but requirement_id is — need index on non-PK side)
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_requirement_persona_persona_id
  ON requirement_persona(persona_id);
CREATE INDEX IF NOT EXISTS idx_user_flow_persona_id
  ON user_flow(persona_id);
CREATE INDEX IF NOT EXISTS idx_persona_addressed_persona_id
  ON persona_addressed(persona_id);

-- ------------------------------------------------------------
-- component_id — FK to component(id)
-- Skipped: component_dependency
--   (component_id is leftmost in their composite PKs)
-- Skipped: component_interface, integration_test_boundary
--   (component_id is leftmost in their UNIQUE constraints)
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_plan_phase_component_component_id
  ON plan_phase_component(component_id);
CREATE INDEX IF NOT EXISTS idx_implementation_file_component_id
  ON implementation_file(component_id);
CREATE INDEX IF NOT EXISTS idx_implementation_component_status_component_id
  ON implementation_component_status(component_id);

-- ------------------------------------------------------------
-- screen_id — FK to screen(id)
-- Skipped: screen_state, screen_responsive_variant
--   (screen_id is leftmost in their UNIQUE constraints)
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_ux_asset_screen_id
  ON ux_asset(screen_id);
CREATE INDEX IF NOT EXISTS idx_plan_phase_screen_screen_id
  ON plan_phase_screen(screen_id);

-- ------------------------------------------------------------
-- flow_id — FK to user_flow(id)
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_user_flow_step_flow_id
  ON user_flow_step(flow_id);
CREATE INDEX IF NOT EXISTS idx_user_flow_error_state_flow_id
  ON user_flow_error_state(flow_id);
CREATE INDEX IF NOT EXISTS idx_persona_addressed_flow_flow_id
  ON persona_addressed_flow(flow_id);
CREATE INDEX IF NOT EXISTS idx_plan_phase_flow_flow_id
  ON plan_phase_flow(flow_id);

-- ------------------------------------------------------------
-- adr_id — FK to adr(id)
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_adr_alternative_adr_id
  ON adr_alternative(adr_id);
CREATE INDEX IF NOT EXISTS idx_approved_dependency_adr_id
  ON approved_dependency(adr_id);

-- ------------------------------------------------------------
-- Remaining FK columns — one-off or small groups
-- ------------------------------------------------------------

-- requirement_dependency.depends_on → requirement(id)
CREATE INDEX IF NOT EXISTS idx_requirement_dependency_depends_on
  ON requirement_dependency(depends_on);

-- component_dependency.depends_on → component(id)
CREATE INDEX IF NOT EXISTS idx_component_dependency_depends_on
  ON component_dependency(depends_on);

-- integration_test_boundary.target_component_id → component(id)
CREATE INDEX IF NOT EXISTS idx_integration_test_boundary_target_component_id
  ON integration_test_boundary(target_component_id);

-- adr.superseded_by → adr(id)
CREATE INDEX IF NOT EXISTS idx_adr_superseded_by
  ON adr(superseded_by);

-- architecture_diagram.overview_id → architecture_overview(id)
-- Skipped: architecture_diagram
--   (overview_id is leftmost in UNIQUE(overview_id, name))

-- Skipped: data_entity_attribute (entity_id is leftmost in UNIQUE(entity_id, name))

-- data_entity_relationship.entity_id → data_entity(id)
CREATE INDEX IF NOT EXISTS idx_data_entity_relationship_entity_id
  ON data_entity_relationship(entity_id);

-- data_entity_relationship.target_entity_id → data_entity(id)
CREATE INDEX IF NOT EXISTS idx_data_entity_relationship_target_entity_id
  ON data_entity_relationship(target_entity_id);

-- info_architecture.parent_id → info_architecture(id) (self-referencing)
CREATE INDEX IF NOT EXISTS idx_info_architecture_parent_id
  ON info_architecture(parent_id);

-- persona_addressed_flow.persona_addressed_id → persona_addressed(id)
-- Skipped: persona_addressed_flow
--   (persona_addressed_id is leftmost in PK(persona_addressed_id, flow_id))

-- user_flow_step_branch.step_id → user_flow_step(id)
CREATE INDEX IF NOT EXISTS idx_user_flow_step_branch_step_id
  ON user_flow_step_branch(step_id);

-- plan_phase_relationship.related_phase_id → plan_phase(id)
CREATE INDEX IF NOT EXISTS idx_plan_phase_relationship_related_phase_id
  ON plan_phase_relationship(related_phase_id);

-- test_acceptance_criterion_result.coverage_id → test_requirement_coverage(id)
CREATE INDEX IF NOT EXISTS idx_test_acceptance_criterion_result_coverage_id
  ON test_acceptance_criterion_result(coverage_id);

-- deployment_pipeline_stage.pipeline_id → deployment_pipeline(id)
CREATE INDEX IF NOT EXISTS idx_deployment_pipeline_stage_pipeline_id
  ON deployment_pipeline_stage(pipeline_id);

-- deployment_stage_quality_gate.stage_id → deployment_pipeline_stage(id)
CREATE INDEX IF NOT EXISTS idx_deployment_stage_quality_gate_stage_id
  ON deployment_stage_quality_gate(stage_id);

-- deployment_env_infra.environment_id → deployment_environment(id)
CREATE INDEX IF NOT EXISTS idx_deployment_env_infra_environment_id
  ON deployment_env_infra(environment_id);

-- deployment_env_var.environment_id → deployment_environment(id)
CREATE INDEX IF NOT EXISTS idx_deployment_env_var_environment_id
  ON deployment_env_var(environment_id);

-- deployment_runbook_step.runbook_id → deployment_runbook(id)
CREATE INDEX IF NOT EXISTS idx_deployment_runbook_step_runbook_id
  ON deployment_runbook_step(runbook_id);
