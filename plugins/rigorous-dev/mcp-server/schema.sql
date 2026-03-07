-- Rigorous-dev changelog database schema
-- Replaces YAML-based artifact storage with normalized SQLite
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Project-level config and lifecycle (singleton — one row per repo DB)
CREATE TABLE IF NOT EXISTS project (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  project_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'closed')),
  closed_at TEXT,
  critic_model TEXT DEFAULT 'sonnet',
  notes TEXT DEFAULT ''
);

-- Iterations: each request to change the system
CREATE TABLE IF NOT EXISTS iteration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK(status IN ('active', 'closed')),
  started_at TEXT NOT NULL,
  closed_at TEXT,
  notes TEXT DEFAULT ''
);

-- Phases within an iteration
CREATE TABLE IF NOT EXISTS phase (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  name TEXT NOT NULL CHECK(name IN (
    'requirements', 'ux_design', 'architecture', 'planning',
    'implementation', 'documentation', 'qa', 'audit', 'release'
  )),
  status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed', 'skipped')),
  started_at TEXT,
  completed_at TEXT,
  approved_by TEXT,
  notes TEXT DEFAULT '',
  UNIQUE(iteration_id, name)
);

-- Revisions: producer-critic loops within a phase
CREATE TABLE IF NOT EXISTS revision (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id INTEGER NOT NULL REFERENCES phase(id),
  producer_agent TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft', 'submitted', 'approved', 'rejected')),
  critic_agent TEXT,
  critic_feedback TEXT,
  reviewed_at TEXT
);

-- ============================================================
-- CHANGELOG ENTRIES: append-only record of all decisions
-- ============================================================

-- Personas
CREATE TABLE IF NOT EXISTS persona (
  id TEXT PRIMARY KEY,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  technical_level TEXT,
  frequency_of_use TEXT,
  goals TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT
);

-- Requirements
CREATE TABLE IF NOT EXISTS requirement (
  id TEXT PRIMARY KEY,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  description TEXT NOT NULL,
  rationale TEXT,
  priority TEXT NOT NULL CHECK(priority IN ('must-have', 'should-have', 'nice-to-have')),
  category TEXT NOT NULL CHECK(category IN (
    'functional', 'security', 'usability', 'performance', 'operational', 'deployment'
  )),
  acceptance_criteria TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS requirement_persona (
  requirement_id TEXT NOT NULL REFERENCES requirement(id),
  persona_id TEXT NOT NULL REFERENCES persona(id),
  PRIMARY KEY (requirement_id, persona_id)
);

CREATE TABLE IF NOT EXISTS requirement_dependency (
  requirement_id TEXT NOT NULL REFERENCES requirement(id),
  depends_on TEXT NOT NULL REFERENCES requirement(id),
  PRIMARY KEY (requirement_id, depends_on)
);

-- Project-level context (problem statement, constraints, assumptions, etc.)
CREATE TABLE IF NOT EXISTS project_context (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  category TEXT,
  UNIQUE(iteration_id, key, value)
);

-- System inputs and outputs (per iteration)
CREATE TABLE IF NOT EXISTS system_input (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  source TEXT,
  format TEXT
);

CREATE TABLE IF NOT EXISTS system_output (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  destination TEXT,
  format TEXT
);

-- Deployment requirements (per iteration)
-- Each row is a single infrastructure/deployment requirement with its target context inline.
CREATE TABLE IF NOT EXISTS deployment_requirement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  target TEXT CHECK(target IN ('private-cloud', 'local-executable', 'both', 'other')),
  requirement TEXT NOT NULL,
  notes TEXT
);

-- Operational requirements (per iteration)
-- Uptime is stored as category='uptime' with the SLA value in `item`.
-- Monitoring/logging/observability items use their respective categories.
CREATE TABLE IF NOT EXISTS operational_requirement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  item TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('uptime', 'monitoring', 'logging', 'observability')),
  notes TEXT
);

-- Technology constraints
CREATE TABLE IF NOT EXISTS technology_constraint (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  constraint_type TEXT NOT NULL CHECK(constraint_type IN ('allowed_language', 'forbidden_dependency', 'required_framework')),
  value TEXT NOT NULL
);

-- Architecture Decision Records
CREATE TABLE IF NOT EXISTS adr (
  id TEXT PRIMARY KEY,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('proposed', 'accepted', 'deprecated', 'superseded')),
  date TEXT,
  context TEXT,
  decision TEXT NOT NULL,
  rationale TEXT NOT NULL,
  superseded_by TEXT REFERENCES adr(id),
  consequences TEXT DEFAULT '[]',
  research_sources TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS adr_alternative (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adr_id TEXT NOT NULL REFERENCES adr(id),
  option_text TEXT NOT NULL,
  pros TEXT,
  cons TEXT
);

-- Architecture Components
CREATE TABLE IF NOT EXISTS component (
  id TEXT PRIMARY KEY,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS component_interface (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_id TEXT NOT NULL REFERENCES component(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS component_dependency (
  component_id TEXT NOT NULL REFERENCES component(id),
  depends_on TEXT NOT NULL REFERENCES component(id),
  PRIMARY KEY (component_id, depends_on)
);

CREATE TABLE IF NOT EXISTS component_requirement (
  component_id TEXT NOT NULL REFERENCES component(id),
  requirement_id TEXT NOT NULL REFERENCES requirement(id),
  PRIMARY KEY (component_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS integration_test_boundary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_id TEXT NOT NULL REFERENCES component(id),
  target_component TEXT NOT NULL REFERENCES component(id),
  boundary_type TEXT NOT NULL,
  correct_behavior TEXT NOT NULL
);

-- Architecture: technology choices
CREATE TABLE IF NOT EXISTS technology_choice (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  purpose TEXT,
  rationale TEXT,
  version TEXT,
  config TEXT,
  created_at TEXT NOT NULL
);

-- Architecture overview
CREATE TABLE IF NOT EXISTS architecture_overview (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  description TEXT NOT NULL,
  principles TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS architecture_diagram (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  overview_id INTEGER NOT NULL REFERENCES architecture_overview(id),
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  description TEXT
);

-- Data model entities
CREATE TABLE IF NOT EXISTS data_entity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  entity_name TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS data_entity_attribute (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL REFERENCES data_entity(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  is_required INTEGER DEFAULT 0,
  description TEXT
);

CREATE TABLE IF NOT EXISTS data_entity_relationship (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL REFERENCES data_entity(id),
  target_entity_id INTEGER NOT NULL REFERENCES data_entity(id),
  relationship_type TEXT CHECK(relationship_type IN ('one-to-one', 'one-to-many', 'many-to-many')),
  description TEXT
);

-- Unified architecture config (security, deployment, observability)
CREATE TABLE IF NOT EXISTS architecture_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  config_type TEXT NOT NULL CHECK(config_type IN ('security', 'deployment', 'observability')),
  target TEXT,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Dependencies manifest
CREATE TABLE IF NOT EXISTS approved_dependency (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  package TEXT NOT NULL,
  version_constraint TEXT,
  purpose TEXT NOT NULL,
  justification TEXT NOT NULL,
  adr_id TEXT REFERENCES adr(id),
  license TEXT,
  maintenance_activity TEXT,
  community_adoption TEXT,
  transitive_deps INTEGER,
  single_maintainer_risk INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

-- Traceability: requirement → architecture element
CREATE TABLE IF NOT EXISTS traceability_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  requirement_id TEXT NOT NULL REFERENCES requirement(id),
  addressed_by TEXT NOT NULL,
  addressed_by_type TEXT NOT NULL CHECK(addressed_by_type IN ('component', 'endpoint', 'flow', 'screen', 'other')),
  notes TEXT,
  created_at TEXT NOT NULL
);

-- UX: user flows
CREATE TABLE IF NOT EXISTS user_flow (
  id TEXT PRIMARY KEY,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  persona_id TEXT REFERENCES persona(id),
  entry_point TEXT,
  success_state TEXT,
  data_dependencies TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS user_flow_step (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_id TEXT NOT NULL REFERENCES user_flow(id),
  step_number INTEGER NOT NULL,
  action TEXT NOT NULL,
  surface TEXT,
  is_decision_point INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_flow_step_branch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_id INTEGER NOT NULL REFERENCES user_flow_step(id),
  condition TEXT NOT NULL,
  next_step INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_flow_error_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_id TEXT NOT NULL REFERENCES user_flow(id),
  condition TEXT NOT NULL,
  recovery TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_flow_requirement (
  flow_id TEXT NOT NULL REFERENCES user_flow(id),
  requirement_id TEXT NOT NULL REFERENCES requirement(id),
  PRIMARY KEY (flow_id, requirement_id)
);

-- UX: screens
CREATE TABLE IF NOT EXISTS screen (
  id TEXT PRIMARY KEY,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  wireframe_path TEXT,
  mockup_path TEXT,
  components TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS screen_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  screen_id TEXT NOT NULL REFERENCES screen(id),
  name TEXT NOT NULL CHECK(name IN (
    'default', 'loading', 'empty', 'error', 'success',
    'session_expired', 'forced', 'editing', 'reviewing', 'search_results', 'complete'
  )),
  description TEXT,
  wireframe_path TEXT
);

CREATE TABLE IF NOT EXISTS screen_responsive_variant (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  screen_id TEXT NOT NULL REFERENCES screen(id),
  breakpoint TEXT NOT NULL,
  wireframe_path TEXT,
  layout_changes TEXT
);

-- UX: unified config (design system, accessibility, responsive, feedback patterns)
CREATE TABLE IF NOT EXISTS ux_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  config_type TEXT NOT NULL CHECK(config_type IN ('design_system', 'accessibility', 'responsive', 'feedback_pattern')),
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- UX: information architecture
CREATE TABLE IF NOT EXISTS info_architecture (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  parent_id INTEGER REFERENCES info_architecture(id),
  created_at TEXT NOT NULL
);

-- UX: personas addressed mapping
CREATE TABLE IF NOT EXISTS persona_addressed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  persona_id TEXT NOT NULL REFERENCES persona(id),
  goal TEXT NOT NULL,
  how_addressed TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persona_addressed_flow (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_addressed_id INTEGER NOT NULL REFERENCES persona_addressed(id),
  flow_id TEXT NOT NULL REFERENCES user_flow(id)
);

-- UX: assets
CREATE TABLE IF NOT EXISTS ux_asset (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('wireframe', 'mockup', 'prototype', 'icon', 'image', 'video')),
  screen_id TEXT REFERENCES screen(id),
  description TEXT,
  created_at TEXT NOT NULL
);

-- UX: requirements mapping
CREATE TABLE IF NOT EXISTS ux_requirement_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  requirement_id TEXT NOT NULL REFERENCES requirement(id),
  addressed_by TEXT NOT NULL,
  notes TEXT
);

-- Implementation plan phases
CREATE TABLE IF NOT EXISTS plan_phase (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  phase_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('feature', 'infrastructure')),
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'test_writing', 'implementing', 'completed')),
  complexity TEXT CHECK(complexity IN ('XS', 'S', 'M', 'L', 'XL')),
  review_checkpoint INTEGER DEFAULT 0,
  notes TEXT,
  entry_criteria TEXT DEFAULT '[]',
  exit_criteria TEXT DEFAULT '[]',
  checkpoint_focus TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_phase_requirement (
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id),
  requirement_id TEXT NOT NULL REFERENCES requirement(id),
  PRIMARY KEY (plan_phase_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS plan_phase_component (
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id),
  component_id TEXT NOT NULL REFERENCES component(id),
  PRIMARY KEY (plan_phase_id, component_id)
);

CREATE TABLE IF NOT EXISTS plan_phase_flow (
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id),
  flow_id TEXT NOT NULL REFERENCES user_flow(id),
  PRIMARY KEY (plan_phase_id, flow_id)
);

CREATE TABLE IF NOT EXISTS plan_phase_screen (
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id),
  screen_id TEXT NOT NULL REFERENCES screen(id),
  PRIMARY KEY (plan_phase_id, screen_id)
);

CREATE TABLE IF NOT EXISTS plan_phase_api_endpoint (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id),
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_phase_db_change (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id),
  migration_name TEXT NOT NULL,
  description TEXT NOT NULL,
  tables TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS plan_phase_dependency (
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id),
  depends_on_phase_id INTEGER NOT NULL REFERENCES plan_phase(id),
  reason TEXT,
  PRIMARY KEY (plan_phase_id, depends_on_phase_id)
);

CREATE TABLE IF NOT EXISTS plan_phase_parallel (
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id),
  can_parallel_with_id INTEGER NOT NULL REFERENCES plan_phase(id),
  PRIMARY KEY (plan_phase_id, can_parallel_with_id)
);

CREATE TABLE IF NOT EXISTS plan_phase_risk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id),
  risk TEXT NOT NULL,
  mitigation TEXT NOT NULL
);

-- Implementation plan: overview
CREATE TABLE IF NOT EXISTS plan_overview (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  strategy TEXT NOT NULL,
  total_phases INTEGER NOT NULL,
  rationale TEXT NOT NULL,
  phase_one_approach TEXT,
  assumptions TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plan_overview_risk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_overview_id INTEGER NOT NULL REFERENCES plan_overview(id),
  risk TEXT NOT NULL,
  mitigation TEXT NOT NULL,
  phase INTEGER
);

-- Implementation plan: requirements mapping
CREATE TABLE IF NOT EXISTS plan_requirement_mapping (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  requirement_id TEXT NOT NULL REFERENCES requirement(id),
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id),
  priority TEXT NOT NULL CHECK(priority IN ('critical', 'high', 'medium', 'low')),
  notes TEXT
);

-- Implementation plan: external dependencies
CREATE TABLE IF NOT EXISTS plan_external_dependency (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  phase INTEGER,
  risk_level TEXT NOT NULL CHECK(risk_level IN ('low', 'medium', 'high', 'critical')),
  mitigation TEXT
);

-- Implementation plan: critical path
CREATE TABLE IF NOT EXISTS plan_critical_path (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id),
  sequence_order INTEGER NOT NULL
);

-- Implementation plan: metadata
CREATE TABLE IF NOT EXISTS plan_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  title TEXT NOT NULL,
  version TEXT NOT NULL,
  created TEXT NOT NULL,
  updated TEXT,
  status TEXT NOT NULL CHECK(status IN ('draft', 'review', 'approved')),
  requirements_version TEXT NOT NULL,
  architecture_version TEXT NOT NULL,
  ux_specification_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Implementation manifests (per sub-phase)
CREATE TABLE IF NOT EXISTS implementation_manifest (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id),
  status TEXT NOT NULL CHECK(status IN ('complete', 'partial', 'blocked')),
  files_created INTEGER DEFAULT 0,
  files_modified INTEGER DEFAULT 0,
  lines_of_code INTEGER,
  warnings INTEGER DEFAULT 0,
  build_status TEXT CHECK(build_status IN ('success', 'failure')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS implementation_file (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id),
  path TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('created', 'modified', 'deleted')),
  purpose TEXT,
  component_id TEXT REFERENCES component(id)
);

CREATE TABLE IF NOT EXISTS implementation_file_requirement (
  file_id INTEGER NOT NULL REFERENCES implementation_file(id),
  requirement_id TEXT NOT NULL REFERENCES requirement(id),
  PRIMARY KEY (file_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS implementation_requirement_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id),
  requirement_id TEXT NOT NULL REFERENCES requirement(id),
  status TEXT NOT NULL CHECK(status IN ('implemented', 'partial', 'not_started', 'blocked', 'not_applicable')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS implementation_component_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id),
  component_id TEXT NOT NULL REFERENCES component(id),
  status TEXT NOT NULL CHECK(status IN ('complete', 'partial', 'not_started')),
  notes TEXT
);

CREATE TABLE IF NOT EXISTS implementation_api_endpoint (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id),
  path TEXT NOT NULL,
  method TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('complete', 'stubbed', 'not_started'))
);

CREATE TABLE IF NOT EXISTS implementation_api_endpoint_requirement (
  endpoint_id INTEGER NOT NULL REFERENCES implementation_api_endpoint(id),
  requirement_id TEXT NOT NULL REFERENCES requirement(id),
  PRIMARY KEY (endpoint_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS implementation_dependency_added (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id),
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  purpose TEXT NOT NULL,
  license TEXT
);

CREATE TABLE IF NOT EXISTS implementation_db_migration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id),
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK(status IN ('created', 'applied', 'pending'))
);

CREATE TABLE IF NOT EXISTS implementation_blocker (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id),
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('critical', 'major', 'minor')),
  recommendation TEXT,
  needs_escalation INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS implementation_blocker_requirement (
  blocker_id INTEGER NOT NULL REFERENCES implementation_blocker(id),
  requirement_id TEXT NOT NULL REFERENCES requirement(id),
  PRIMARY KEY (blocker_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS implementation_review_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id),
  check_name TEXT NOT NULL,
  passed INTEGER DEFAULT 0
);

-- Implementation manifest metadata
CREATE TABLE IF NOT EXISTS implementation_manifest_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id),
  version TEXT NOT NULL,
  created TEXT NOT NULL,
  requirements_version TEXT NOT NULL,
  architecture_version TEXT NOT NULL,
  language TEXT,
  commit_sha TEXT
);

-- VCS commits linked to iterations
CREATE TABLE IF NOT EXISTS vcs_commit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  phase_id INTEGER REFERENCES phase(id),
  commit_sha TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL
);

-- Intermediate assets shared between producer/critic
CREATE TABLE IF NOT EXISTS intermediate_asset (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  phase_id INTEGER REFERENCES phase(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  asset_type TEXT NOT NULL CHECK(asset_type IN ('work_item', 'plan', 'note', 'commit_ref', 'file_ref')),
  title TEXT NOT NULL,
  content TEXT,
  created_at TEXT NOT NULL
);

-- Asset deliverables: files committed to VCS
CREATE TABLE IF NOT EXISTS asset_deliverable (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  phase_id INTEGER REFERENCES phase(id),
  asset_type TEXT NOT NULL CHECK(asset_type IN (
    'architecture_diagram', 'data_model', 'interface', 'ux_design_system',
    'source_code', 'toolchain', 'test', 'documentation'
  )),
  file_path TEXT NOT NULL,
  description TEXT,
  commit_sha TEXT,
  created_at TEXT NOT NULL
);

-- ============================================================
-- RELEASE WORKFLOW TABLES
-- ============================================================

-- Test report
CREATE TABLE IF NOT EXISTS test_report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  total_tests INTEGER NOT NULL DEFAULT 0,
  passed INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  coverage_line REAL,
  coverage_branch REAL,
  coverage_function REAL,
  duration_seconds REAL,
  status TEXT NOT NULL CHECK(status IN ('pass', 'fail', 'blocked')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS test_report_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES test_report(id),
  version TEXT NOT NULL,
  created TEXT NOT NULL,
  requirements_version TEXT NOT NULL,
  architecture_version TEXT NOT NULL,
  commit_sha TEXT
);

CREATE TABLE IF NOT EXISTS test_requirement_coverage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES test_report(id),
  requirement_id TEXT NOT NULL REFERENCES requirement(id),
  status TEXT NOT NULL CHECK(status IN ('pass', 'fail', 'partial', 'not_tested'))
);

CREATE TABLE IF NOT EXISTS test_acceptance_criterion_result (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coverage_id INTEGER NOT NULL REFERENCES test_requirement_coverage(id),
  criterion TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pass', 'fail', 'not_tested')),
  notes TEXT,
  test_ids TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS test_suite (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES test_report(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('unit', 'integration', 'e2e', 'security', 'performance'))
);

CREATE TABLE IF NOT EXISTS test_case (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  suite_id INTEGER NOT NULL REFERENCES test_suite(id),
  test_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK(status IN ('pass', 'fail', 'skipped', 'flaky')),
  duration_ms REAL,
  error_message TEXT,
  stack_trace TEXT,
  retry_count INTEGER
);

CREATE TABLE IF NOT EXISTS test_case_requirement (
  test_case_id INTEGER NOT NULL REFERENCES test_case(id),
  requirement_id TEXT NOT NULL REFERENCES requirement(id),
  PRIMARY KEY (test_case_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS test_security_finding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES test_report(id),
  category TEXT NOT NULL CHECK(category IN ('vulnerability_scan', 'dependency_audit')),
  tool TEXT,
  severity TEXT CHECK(severity IN ('critical', 'high', 'medium', 'low', 'info')),
  description TEXT,
  location TEXT,
  recommendation TEXT,
  package TEXT,
  advisory TEXT
);

CREATE TABLE IF NOT EXISTS test_performance_benchmark (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES test_report(id),
  name TEXT NOT NULL,
  metric TEXT NOT NULL,
  value REAL NOT NULL,
  unit TEXT NOT NULL,
  threshold REAL,
  status TEXT CHECK(status IN ('pass', 'fail'))
);

CREATE TABLE IF NOT EXISTS test_blocker (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES test_report(id),
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('critical', 'major', 'minor')),
  recommendation TEXT
);

CREATE TABLE IF NOT EXISTS test_blocker_requirement (
  blocker_id INTEGER NOT NULL REFERENCES test_blocker(id),
  requirement_id TEXT NOT NULL REFERENCES requirement(id),
  PRIMARY KEY (blocker_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS test_recommendation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES test_report(id),
  category TEXT NOT NULL CHECK(category IN ('coverage', 'reliability', 'performance', 'security', 'maintainability')),
  description TEXT NOT NULL,
  priority TEXT NOT NULL CHECK(priority IN ('high', 'medium', 'low'))
);

-- ============================================================
-- AUDIT PHASE TABLES
-- ============================================================

-- Security audit findings (produced by security_auditor during audit phase)
CREATE TABLE IF NOT EXISTS security_audit_finding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
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
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'informational')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  location TEXT,
  metric_name TEXT,
  baseline_value TEXT,
  actual_value TEXT,
  recommendation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'accepted', 'deferred')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Documentation manifest
CREATE TABLE IF NOT EXISTS documentation_manifest (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  status TEXT NOT NULL CHECK(status IN ('complete', 'partial', 'blocked')),
  documents_created INTEGER DEFAULT 0,
  total_pages INTEGER,
  accessibility_compliant INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documentation_manifest_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES documentation_manifest(id),
  version TEXT NOT NULL,
  created TEXT NOT NULL,
  requirements_version TEXT NOT NULL,
  architecture_version TEXT,
  implementation_version TEXT,
  format TEXT CHECK(format IN ('markdown', 'html', 'pdf', 'docusaurus', 'mkdocs', 'other'))
);

CREATE TABLE IF NOT EXISTS documentation_section (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES documentation_manifest(id),
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  path TEXT
);

CREATE TABLE IF NOT EXISTS documentation_feature (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES documentation_manifest(id),
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  includes_examples INTEGER DEFAULT 0,
  includes_screenshots INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS documentation_feature_requirement (
  feature_id INTEGER NOT NULL REFERENCES documentation_feature(id),
  requirement_id TEXT NOT NULL REFERENCES requirement(id),
  PRIMARY KEY (feature_id, requirement_id)
);

CREATE TABLE IF NOT EXISTS documentation_requirement_coverage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES documentation_manifest(id),
  requirement_id TEXT NOT NULL REFERENCES requirement(id),
  documented INTEGER DEFAULT 0,
  user_facing INTEGER DEFAULT 0,
  notes TEXT,
  paths TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS documentation_asset (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES documentation_manifest(id),
  path TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('screenshot', 'diagram', 'video', 'code-sample', 'other')),
  description TEXT,
  alt_text TEXT
);

CREATE TABLE IF NOT EXISTS documentation_verification (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES documentation_manifest(id),
  check_name TEXT NOT NULL,
  passed INTEGER DEFAULT 0
);

-- Deployment manifest
CREATE TABLE IF NOT EXISTS deployment_manifest (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  status TEXT NOT NULL CHECK(status IN ('ready', 'not_ready', 'blocked')),
  targets TEXT DEFAULT '[]',
  blockers TEXT DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployment_manifest_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id),
  version TEXT NOT NULL,
  created TEXT NOT NULL,
  requirements_version TEXT NOT NULL,
  architecture_version TEXT NOT NULL,
  implementation_version TEXT NOT NULL,
  test_report_version TEXT
);

CREATE TABLE IF NOT EXISTS deployment_pipeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id),
  platform TEXT NOT NULL,
  config_files TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS deployment_pipeline_stage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pipeline_id INTEGER NOT NULL REFERENCES deployment_pipeline(id),
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  triggers TEXT DEFAULT '[]',
  steps TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS deployment_stage_quality_gate (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id INTEGER NOT NULL REFERENCES deployment_pipeline_stage(id),
  name TEXT NOT NULL,
  condition TEXT NOT NULL,
  failure_action TEXT NOT NULL CHECK(failure_action IN ('block', 'warn', 'notify'))
);

CREATE TABLE IF NOT EXISTS deployment_quality_gates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id),
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployment_environment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id),
  name TEXT NOT NULL CHECK(name IN ('development', 'staging', 'production')),
  deployment_method TEXT NOT NULL,
  url TEXT,
  rollback_procedure TEXT
);

CREATE TABLE IF NOT EXISTS deployment_env_infra (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  environment_id INTEGER NOT NULL REFERENCES deployment_environment(id),
  provider TEXT,
  resource TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployment_env_var (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  environment_id INTEGER NOT NULL REFERENCES deployment_environment(id),
  name TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('secret', 'config', 'hardcoded')),
  description TEXT
);

CREATE TABLE IF NOT EXISTS deployment_artifact (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('container-image', 'binary', 'archive', 'package', 'installer')),
  registry TEXT,
  versioning TEXT CHECK(versioning IN ('semantic', 'git-sha', 'timestamp', 'custom')),
  platforms TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS deployment_signing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id),
  enabled INTEGER DEFAULT 0,
  method TEXT
);

CREATE TABLE IF NOT EXISTS deployment_local_executable (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id),
  installation_method TEXT,
  update_mechanism TEXT,
  platforms TEXT DEFAULT '[]',
  channels TEXT DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS deployment_secret (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id),
  provider TEXT,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  rotation_policy TEXT
);

CREATE TABLE IF NOT EXISTS deployment_health_check (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id),
  name TEXT NOT NULL,
  endpoint TEXT,
  interval TEXT
);

CREATE TABLE IF NOT EXISTS deployment_alerting (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id),
  provider TEXT,
  channel TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployment_runbook (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id),
  name TEXT NOT NULL,
  scenario TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deployment_runbook_step (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  runbook_id INTEGER NOT NULL REFERENCES deployment_runbook(id),
  step TEXT NOT NULL,
  is_rollback INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS deployment_review_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES deployment_manifest(id),
  check_name TEXT NOT NULL,
  passed INTEGER DEFAULT 0
);

-- ============================================================
-- BLOCKER: cross-phase workflow blockers raised by agents
-- ============================================================

CREATE TABLE IF NOT EXISTS blocker (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  phase_name TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('critical', 'high', 'medium')),
  raised_by TEXT NOT NULL,
  resolved_at TEXT,
  resolution_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- PROJECT LESSON: cross-phase lessons learned, recorded by critics
-- ============================================================

CREATE TABLE IF NOT EXISTS project_lesson (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id),
  phase_name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('pattern', 'anti-pattern', 'convention', 'risk', 'decision', 'process')),
  lesson TEXT NOT NULL,
  recurring INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- ENTITY SNAPSHOT: JSON history of entity changes across revisions
-- ============================================================

CREATE TABLE IF NOT EXISTS entity_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision_id INTEGER NOT NULL REFERENCES revision(id),
  snapshot JSON NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_entity_snapshot_lookup
  ON entity_snapshot(entity_type, entity_id);
