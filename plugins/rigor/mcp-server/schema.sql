-- Rigorous-dev changelog database schema
-- All artifacts produced during the rigorous development workflow are stored in
-- a normalized SQLite changelog database. This file is the cumulative reference
-- for the full schema. It is not directly executed — see migrate.js and the
-- migrations/ directory for how schema changes are applied.
--
-- Database location: .claude/rigor.db
-- Engine: better-sqlite3 (synchronous), WAL mode, foreign keys enforced
--
-- ============================================================
-- DESIGN PRINCIPLES
-- ============================================================
--
-- 1. Pragmatic normalization — Core entities and M:N relationships use proper
--    tables with FKs. Simple 1:N string lists (goals, criteria, etc.) are stored
--    as JSON arrays on the parent row, avoiding unnecessary child tables while
--    keeping data self-contained and queryable via JSON_EACH().
--
-- 2. Append-only — Revisions are never deleted or overwritten. New revisions
--    create new rows. Full history is preserved.
--
-- 3. Traceability — Every entity carries iteration_id (FK → iteration) for
--    direct iteration scoping. The one exception is persona, which is
--    project-scoped via project_id.
--
-- 4. Idempotent DDL — All tables use CREATE TABLE IF NOT EXISTS so the schema
--    can be re-applied safely.
--
-- 5. UTC timestamps in ISO 8601 — All timestamp columns use TEXT type. App code
--    sets timestamps via new Date().toISOString(). No DATETIME or INTEGER epoch.
--
-- 6. No CHECK constraints on TEXT columns — CHECK constraints must not be used
--    to enforce enum-like values on TEXT columns. They cause LLM quality
--    degradation (opaque, unrecoverable errors) and migration friction (SQLite
--    requires full table recreation to alter constraints). Validation of
--    enum-like values belongs in the application layer (write-tools.js) or is
--    the agent's responsibility. The only permitted CHECK is CHECK(id = 1) on
--    project.id (INTEGER PK singleton enforcement).
--
-- ============================================================
-- DOMAIN MAP (10 domains, 44 tables)
-- ============================================================
--
-- Core (spine):       project, iteration, phase, revision, schema_version
-- Requirements:       persona, requirement, requirement_persona,
--                     requirement_dependency, project_context, data_exchange,
--                     nonfunctional_requirement
-- Architecture:       adr, adr_alternative, adr_decision, component,
--                     component_interface, component_dependency,
--                     integration_test_boundary
-- Cross-cutting:      approved_dependency, requirement_trace, blocker,
--                     project_lesson
-- UX Design:          user_flow, user_flow_step, screen,
--                     info_architecture, persona_addressed,
--                     persona_addressed_flow, ux_asset
-- Planning:           work_item, work_item_requirement, work_item_component,
--                     plan_overview, plan_external_dependency
--                     (supports plan versioning — work items carry plan_version
--                     and can be superseded by a replan)
-- Implementation:     implementation_requirement_status,
--                     implementation_component_status, implementation_blocker,
--                     implementation_blocker_requirement, vcs_commit,
--                     intermediate_asset
-- QA/Test:            test_report
-- Audit:              security_audit_finding, performance_audit_finding
-- Documentation:      (no tables — docs are file artifacts reviewed by critic)
--
-- Each table below is tagged with its domain in a "-- Domain:" comment.
-- Agents interact with tables via MCP tools (changelog_insert, changelog_query),
-- not by reading this file directly.
--
-- ============================================================
-- ADDING A NEW ENTITY TYPE (checklist)
-- ============================================================
--
-- 1. schema.sql  — CREATE TABLE with FK to iteration(id) + CREATE INDEX for
--                  iteration_id + any child/junction tables + their indexes
-- 1b. migrations/    — Create a new NNN_<name>.sql migration file with the DDL
--                      changes (ALTER TABLE, CREATE TABLE, etc.). Never modify
--                      an already-applied migration — always create a new one.
-- 2. write-tools.js — Write an insertXxx() function + add the case to the
--                     changelogInsert dispatch handlers object
-- 3. read-tools.js  — Add to ENTITY_TABLE mapping + write a queryXxx function
--                     with FILTERS spec + register in QUERY_DISPATCH
-- 4. test/         — Add or update tests (entities.test.js, query-dispatch.test.js,
--                    reads.test.js, and others as needed)
--
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Schema version tracking for migrations
-- Domain: core
-- Purpose: Tracks which migration scripts have been applied to this database.
-- Managed by migrate.js — do not insert directly.
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  checksum TEXT NOT NULL
);

-- Project-level config (singleton — one row per repo DB)
-- Domain: core
-- Purpose: Project-level configuration. Singleton — exactly one row per database,
-- enforced by CHECK(id = 1).
-- Context: Created by iteration_create on first run (alongside the first iteration and its phases).
-- The iteration lifecycle (active/closed) is the sole authority for project activity —
-- the project table has no status column. artifacts_directory stores the root path for all
-- SDLC file artifacts, relative to the project root (default: docs/sdlc).
CREATE TABLE IF NOT EXISTS project (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  project_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  critic_model TEXT NOT NULL DEFAULT 'sonnet',
  notes TEXT NOT NULL DEFAULT '',
  artifacts_directory TEXT NOT NULL DEFAULT 'docs/sdlc'
);

-- Iterations: each request to change the system
-- Domain: core
-- Purpose: A single change-request cycle within a project. Each time new work is requested — a new
-- feature, a bug-fix batch, a refactor — a new iteration is opened. Iterations are numbered
-- sequentially.
-- Context: Created by iteration_create. An iteration encompasses all eight phases and their revision
-- attempts. Changelog entities reference the iteration via iteration_id (both context tables and
-- producer-critic artifacts). Closing an iteration (status closed) signals that the work shipped
-- and a new request cycle can begin. brief_path stores the path (relative to project root) of an
-- investigation brief that seeds this iteration's requirements phase. When present, the
-- requirements_analyst reads this file instead of conducting an interactive interview. NULL means
-- the iteration uses the standard interview flow.
CREATE TABLE IF NOT EXISTS iteration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  brief_path TEXT
);

CREATE INDEX IF NOT EXISTS idx_iteration_status ON iteration(status);

-- Phases within an iteration
-- Domain: core
-- Purpose: One of the eight SDLC stages within an iteration. Phases are created in bulk (all eight,
-- all pending) when an iteration is created, then activated and completed one at a time as the
-- workflow advances.
-- Context: Created by iteration_create alongside the iteration row. Status is advanced by
-- phase_transition. approved_by records which agent approved the phase output (set by the critic).
-- Revisions hang off phases, so the full producer-critic history for any phase is traceable via
-- revision.
CREATE TABLE IF NOT EXISTS phase (
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

-- Each row = one producer-critic loop attempt within a phase
-- Domain: core
-- Purpose: A single producer-critic loop attempt within a phase. When a producer agent generates
-- output for a phase, a revision row is created. The critic agent then reviews it and records a
-- verdict (approved or rejected) along with feedback text. If rejected, a new revision is created
-- for the next attempt.
-- Context: Revisions are the mechanism that enforces quality gates. The full revision chain for any
-- phase shows every draft, the feedback that was given, and the final approved version. Changelog
-- entities that are produced during a specific revision attempt carry the iteration_id so that
-- approved output can be distinguished from earlier drafts.
CREATE TABLE IF NOT EXISTS revision (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id INTEGER NOT NULL REFERENCES phase(id) ON DELETE CASCADE,
  producer_agent TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'draft',
  critic_agent TEXT,
  critic_feedback TEXT,
  reviewed_at TEXT
);

-- ============================================================
-- CHANGELOG ENTRIES: append-only record of all decisions
-- ============================================================

-- Personas
-- Domain: requirements
-- Purpose: Represents a user archetype — a named, described role with a defined technical level and
-- usage frequency. Personas ground the requirements in real human context, preventing the system
-- from being designed in the abstract. Personas are project-scoped — they represent the app's users
-- across all iterations, not iteration-specific artifacts.
-- Context: Produced by the requirements_analyst agent. Validated (and potentially revised) by the
-- requirements_critic. Consumed by the ux_designer (who associates personas with user flows) and
-- the requirements_analyst itself (who links personas to requirements via requirement_persona).
-- Referenced downstream by user_flow.persona_id.
CREATE TABLE IF NOT EXISTS persona (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  introduced_in_iteration_id INTEGER REFERENCES iteration(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  technical_level TEXT,
  frequency_of_use TEXT,
  goals JSON NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  UNIQUE(project_id, name)
);

-- Requirements
-- Domain: requirements
-- Purpose: The central table of this domain. Each row is a single requirement — a statement of
-- something the system must, should, or could do — classified by category and priority.
-- Requirements have a human-readable description, an optional rationale explaining why the
-- requirement exists, and a category that guides which downstream agents care about it most.
-- Context: Produced by the requirements_analyst. Validated by the requirements_critic, which may
-- reject and request rewriting. Once approved, requirements are referenced by virtually every
-- downstream agent: the backend_architect maps them to components and ADRs via requirement_trace;
-- the ux_designer links them to user flows via requirement_trace (with addressed_by_type = 'flow');
-- the implementation_planner uses priority to sequence work.
CREATE TABLE IF NOT EXISTS requirement (
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

-- Domain: requirements
-- Purpose: A junction table linking requirements to the personas they serve. A single requirement
-- may affect multiple personas, and a persona may be implicated in many requirements. This many-to-
-- many relationship allows downstream agents to ask "which requirements matter to persona X?" or
-- "which personas are affected by requirement Y?" without scanning free text.
-- Context: Produced by the requirements_analyst during requirement elaboration. Consumed by the
-- ux_designer to ensure that user flows cover the requirements relevant to each persona, and by the
-- implementation_planner to understand stakeholder impact when prioritising work.
CREATE TABLE IF NOT EXISTS requirement_persona (
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  persona_id TEXT NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  PRIMARY KEY (requirement_id, persona_id)
);

-- Domain: requirements
-- Purpose: Records directed dependencies between requirements. A dependency row asserts that
-- requirement_id cannot be satisfied without first satisfying depends_on. This models prerequisite
-- relationships that the implementation_planner must respect when sequencing work — for example, an
-- authentication requirement that must land before any access-controlled feature requirement.
-- Context: Produced by the requirements_analyst when dependencies are identified. Validated by the
-- requirements_critic, who may challenge questionable dependency claims. Consumed by the
-- implementation_planner to construct a sequenced backlog that respects the dependency graph.
CREATE TABLE IF NOT EXISTS requirement_dependency (
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  depends_on TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  PRIMARY KEY (requirement_id, depends_on)
);

-- Project-level context (problem statement, constraints, assumptions, etc.)
-- Domain: requirements
-- Purpose: A flexible key-value store for project-level contextual information that does not fit a
-- more structured table. Common uses include recording the problem statement, key assumptions,
-- explicit scope constraints, and business context. The optional category column allows grouping of
-- context entries (e.g. "assumption", "constraint", "context").
-- Context: Produced by the requirements_analyst during the requirements phase. Validated by the
-- requirements_critic, who may challenge assumptions or flag missing context. Consumed by all
-- downstream agents as background context when generating their artefacts, and surfaced in the
-- final output documents.
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
-- Domain: requirements
-- Purpose: Describes the inputs and outputs of the system in a single unified table. Each row names
-- a single input or output, describes it, and optionally records its source, destination, and
-- format. The direction column distinguishes inputs from outputs. This information is essential for
-- the backend_architect when designing ingestion pipelines, output interfaces, and data contracts.
-- Context: Produced by the requirements_analyst. Consumed by the backend_architect when modelling
-- data entities, integration boundaries, and output interfaces, and by the implementation_planner
-- when identifying external dependencies that affect delivery sequencing. The ux_designer also
-- reads output rows to understand what information must be surfaced in screens and flows.
CREATE TABLE IF NOT EXISTS data_exchange (
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

-- Non-functional requirements (per iteration)
-- Unified table for deployment, operational, and technology requirements.
-- The `type` column discriminates the three kinds; `category` captures
-- each kind's secondary classification (deployment target, operational
-- category, or technology constraint type).
-- Domain: requirements
-- Purpose: Unified table for non-functional requirements spanning three categories: deployment
-- infrastructure requirements, operational requirements (uptime/SLA targets, monitoring, logging,
-- observability), and technology constraints (allowed languages, forbidden dependencies, required
-- frameworks). The type column discriminates the three kinds. The category column captures each
-- kind's secondary classification — deployment target context (e.g. "private-cloud", "local-
-- executable"), operational category (e.g. "uptime", "monitoring"), or technology constraint type
-- (e.g. "allowed_language", "forbidden_dependency"). The item column carries the primary
-- descriptive content, value provides an optional supplementary value, and notes is available for
-- free-text elaboration (unused by technology type).
-- Context: Produced by the requirements_analyst. Consumed by the backend_architect when selecting
-- infrastructure patterns, designing for reliability, and evaluating technology choices. The
-- implementation_planner uses deployment and operational rows to assess delivery environment
-- constraints and flag operational readiness tasks, and enforces technology constraints when
-- accepting or rejecting proposed dependencies. The requirements_critic validates all entries.
CREATE TABLE IF NOT EXISTS nonfunctional_requirement (
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

-- Architecture Decision Records
-- Domain: architecture
-- Purpose: The central record for each Architecture Decision Record. An ADR captures a single
-- significant technical decision — what was decided, why, and when — giving every future reader a
-- permanent, auditable record of the reasoning behind the system's shape. All alternative options
-- are stored in the adr_alternative child table; the formal decision (selected alternative +
-- rationale) is recorded in the adr_decision child table; consequences and research citations are
-- stored inline as JSON arrays in the consequences and research_sources columns.
-- Context: ADRs are the backbone of architectural traceability. Every major technology choice,
-- structural pattern, or integration strategy that required deliberation should have an ADR. adr
-- rows carry iteration_id directly, so the full evolution of any decision across critic feedback
-- rounds is preserved. The
-- superseded_by self-reference creates a chain of record when an earlier decision is replaced. The
-- research_sources JSON column is the key enabler of the "why are we using X?" traceability query.
CREATE TABLE IF NOT EXISTS adr (
  id TEXT PRIMARY KEY,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  decision TEXT, -- the decision that was made, e.g. "Adopt", "Reject", "Deprecate"
  rationale TEXT, -- the reasoning behind the decision
  date TEXT, -- ISO 8601 date, e.g. "2026-03-08"
  context TEXT,
  superseded_by TEXT REFERENCES adr(id) ON DELETE SET NULL,
  consequences JSON NOT NULL DEFAULT '[]',
  research_sources JSON NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

-- Domain: architecture
-- Purpose: Records each option that was explicitly considered when making an ADR decision. Every
-- ADR should have at least two alternatives (including the chosen option) so that future readers
-- understand what was weighed. Pros and cons are stored inline as JSON arrays.
-- Context: The alternative-with-pros-and-cons pattern is the structured form of the classic ADR
-- "options considered" section. Pros and cons are stored as nullable JSON columns containing
-- arrays (e.g., ["Built-in horizontal sharding","Mature ecosystem"]). The columns use JSON type
-- for clarity (SQLite treats JSON as TEXT affinity). When queried via changelog_query or
-- traceability_query, these columns are parsed back into arrays for convenient consumption.
CREATE TABLE IF NOT EXISTS adr_alternative (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adr_id TEXT NOT NULL REFERENCES adr(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  pros JSON,
  cons JSON
);

-- Domain: architecture
-- Purpose: Records the formal decision for an ADR — which alternative was selected and why.
-- The primary key on adr_id enforces exactly one decision per ADR. alternative_id is nullable
-- so that decisions can be recorded without requiring a formal alternative entry (e.g., when
-- the decision is straightforward and no alternatives were enumerated).
-- Context: Created by the backend_architect when an ADR reaches the "accepted" state. The
-- rationale field explains why the chosen option was selected over its alternatives. The
-- decided_at timestamp records when the decision was formalised.
CREATE TABLE IF NOT EXISTS adr_decision (
  adr_id TEXT NOT NULL REFERENCES adr(id) ON DELETE CASCADE,
  alternative_id INTEGER REFERENCES adr_alternative(id) ON DELETE SET NULL,
  rationale TEXT,
  decided_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (adr_id)
);

-- Architecture Components
-- Domain: architecture
-- Purpose: Represents a deployable or logically distinct unit of the system — an API server,
-- background worker, database, cache, message queue, external third-party service, or shared
-- library. Components are the primary unit of architectural decomposition. All interfaces,
-- dependencies, and requirement mappings hang off component rows.
-- Context: component is the central node in the architecture domain graph. The backend_architect
-- decomposes the system into components during the architecture phase; the implementation_planner
-- then uses component_dependency and requirement_trace (with addressed_by_type = 'component') to
-- sequence work phases; the senior_developer builds against component_interface contracts.
-- Component IDs (COMP-XXX) appear in requirement_trace, integration_test_boundary, and
-- implementation_component_status.
CREATE TABLE IF NOT EXISTS component (
  id TEXT PRIMARY KEY,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  component_type TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

-- Domain: architecture
-- Purpose: Describes each interface — HTTP endpoint group, gRPC service definition, message topic,
-- or file I/O contract — that a component exposes to the rest of the system. Interfaces define the
-- *contract* other components depend on.
-- Context: component_interface rows are the foundation for implementation contract tests and the
-- work_item API endpoint entries created by the implementation_planner. When the senior_developer
-- builds a component, the interfaces listed here define what must exist and be tested. The type
-- field is free-text to accommodate diverse interface styles (REST, gRPC, event, file).
CREATE TABLE IF NOT EXISTS component_interface (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_id TEXT NOT NULL REFERENCES component(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  interface_type TEXT NOT NULL,
  description TEXT,
  UNIQUE(component_id, name)
);

-- Domain: architecture
-- Purpose: Records a directed dependency edge between two components: component_id depends on
-- depends_on. The set of all rows defines the component dependency graph, which must be a directed
-- acyclic graph (DAG) — cycles indicate an architectural problem.
-- Context: The dependency graph is consumed by the implementation_planner to sequence plan phases
-- (a component cannot be implemented before its dependencies) and by the architecture_critic to
-- verify there are no cycles and that external components are not being depended on implicitly. The
-- composite primary key prevents duplicate edges.
CREATE TABLE IF NOT EXISTS component_dependency (
  component_id TEXT NOT NULL REFERENCES component(id) ON DELETE CASCADE,
  depends_on TEXT NOT NULL REFERENCES component(id) ON DELETE CASCADE,
  PRIMARY KEY (component_id, depends_on)
);

-- Domain: architecture
-- Purpose: Identifies the interaction points between components where integration tests are
-- mandatory. Each row names a source component, a target component, the type of boundary being
-- crossed, and the correct observable behaviour that tests must verify.
-- Context: Integration test boundaries are a direct output of architectural decomposition: wherever
-- two components communicate, there is a test boundary. By recording these boundaries explicitly
-- during the architecture phase, the backend_architect ensures the test_writer knows exactly which
-- component interactions need contract or integration-level coverage. The boundary_type field is
-- free-form text to accommodate project-specific boundary types; canonical values are api_call,
-- database_access, message_event, and file_system (see column reference below).
CREATE TABLE IF NOT EXISTS integration_test_boundary (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  component_id TEXT NOT NULL REFERENCES component(id) ON DELETE CASCADE,
  target_component_id TEXT NOT NULL REFERENCES component(id) ON DELETE CASCADE,
  boundary_type TEXT NOT NULL,
  correct_behavior TEXT NOT NULL,
  UNIQUE(component_id, target_component_id, boundary_type)
);
-- Dependencies manifest
-- Domain: cross-cutting
-- Purpose: The vetted third-party dependency manifest. Every external library, package, or SDK that
-- the system will use must have an entry here before it can appear in implementation. Each row
-- records not just *what* the dependency is, but *why* it was chosen, what license it carries, and
-- an assessment of its supply-chain health (maintenance activity, community adoption, transitive
-- dependency count, single-maintainer risk).
-- Context: Written by backend_architect as part of the architecture phase, usually alongside ADRs
-- that justify the choice of a given library. Each significant dependency should reference the
-- adr_id that decided to adopt it. Lightweight utilities may not need an ADR but still require a
-- row here. The single_maintainer_risk flag is a boolean (0/1) that signals whether the package has
-- only one active maintainer — a supply-chain risk factor worth surfacing explicitly.
CREATE TABLE IF NOT EXISTS approved_dependency (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  package TEXT NOT NULL,
  version_constraint TEXT,
  purpose TEXT NOT NULL,
  justification TEXT NOT NULL,
  adr_id TEXT REFERENCES adr(id) ON DELETE SET NULL,
  license TEXT,
  category TEXT,
  maintenance_activity TEXT,
  community_adoption TEXT,
  transitive_deps INTEGER,
  single_maintainer_risk INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, package)
);

-- Traceability: unified requirement → design-element mapping
-- Domain: cross-cutting
-- Purpose: The traceability backbone of the entire data model. Each row asserts that a specific
-- requirement (requirement_id) is addressed by some named architectural element (addressed_by) of a
-- given type (addressed_by_type). This creates the REQ → COMP/ENDPOINT/FLOW/SCREEN chain that makes
-- the "why" query possible: given any artifact in the system, the architect can trace back to the
-- requirement that motivated it, and forward to every other artifact that satisfies the same
-- requirement.
-- Context: Written by backend_architect after components, user flows, and screens have been
-- defined. A complete architecture phase should have at least one requirement_trace row per
-- requirement — requirements with no mapping are dark requirements that cannot be verified during
-- QA. The addressed_by field is a free-text identifier that should match an existing entity ID:
-- COMP-XXX for components, an endpoint path/name, a user_flow.id, a screen.id, or a descriptive
-- label for other. The addressed_by_type column uses application-level validation (CHECK constraint
-- removed in migration 002); valid values are component, endpoint, flow, screen, adr, and technology.
CREATE TABLE IF NOT EXISTS requirement_trace (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  addressed_by TEXT NOT NULL,
  addressed_by_type TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, requirement_id, addressed_by, addressed_by_type)
);

-- UX: user flows
-- Domain: ux-design
-- Purpose: Top-level record for a single named user journey. Represents a goal-oriented path a user
-- takes through the application — from entry point to success state. Each flow belongs to a persona
-- and maps to one or more requirements.
-- Context: The ux_designer creates one user_flow row per distinct journey (e.g., "User signs up",
-- "Admin exports report"). IDs follow the pattern FLOW-XXX. The backend_architect reads flows to
-- verify that every step has a corresponding API endpoint. The implementation_planner references
-- flows when assigning UI work to plan phases.
CREATE TABLE IF NOT EXISTS user_flow (
  id TEXT PRIMARY KEY,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  persona_id TEXT REFERENCES persona(id) ON DELETE SET NULL,
  entry_point TEXT,
  success_state TEXT,
  data_dependencies JSON NOT NULL DEFAULT '[]',
  error_states JSON, -- [{condition, recovery}] — error conditions and recovery paths for this flow
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

-- Domain: ux-design
-- Purpose: A single discrete action within a user flow. Steps are ordered by step_number and each
-- names the interaction surface on which the action occurs — a screen for UI apps, an endpoint for
-- APIs, a CLI command, or NULL when not applicable. Decision-point steps carry their conditional
-- branches inline as a JSON array.
-- Context: The ux_designer inserts steps as part of the parent user_flow insert (they are not
-- inserted separately). The backend_architect uses step-to-surface mappings to validate API
-- coverage. Steps with is_decision_point = 1 should have a non-NULL branches JSON array.
CREATE TABLE IF NOT EXISTS user_flow_step (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_id TEXT NOT NULL REFERENCES user_flow(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  action TEXT NOT NULL,
  surface TEXT, -- soft FK → screen.name (no constraint: references name, not id; screens may not exist yet when flows are defined)
  is_decision_point INTEGER NOT NULL DEFAULT 0,
  branches JSON, -- [{condition, next_step}] — NULL for non-decision steps, populated when is_decision_point = 1
  UNIQUE(flow_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_user_flow_step_surface ON user_flow_step(surface);

-- requirement_trace: unified traceability — see requirement_trace table above

-- UX: screens
-- Domain: ux-design
-- Purpose: A distinct UI view or page in the application. Screens are the atomic building blocks of
-- the visual design. Each screen has a purpose, optional wireframe and mockup paths, and is
-- decomposed into components, states, and responsive variants.
-- Context: The ux_designer creates one screen row per unique view (e.g., SCREEN-001 Dashboard,
-- SCREEN-002 Login). Screens are referenced by name in user_flow_step.surface. The
-- backend_architect cross-references screens with flow steps to determine which endpoints each
-- screen requires.
CREATE TABLE IF NOT EXISTS screen (
  id TEXT PRIMARY KEY,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  wireframe_path TEXT,
  mockup_path TEXT,
  components JSON NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_screen_name ON screen(name);
-- UX: information architecture
-- Domain: ux-design
-- Purpose: Captures the information architecture of the application: site map, navigation
-- hierarchy, route structure, content groupings, and labelling decisions. Rows form a tree via the
-- parent_id self-reference.
-- Context: The ux_designer builds the IA before or in parallel with screen design, ensuring that
-- navigation flows match the site map. The backend_architect reads top-level IA nodes to confirm
-- routing strategy aligns with the frontend navigation tree. The ux_critic checks that all screens
-- are reachable from the IA root.
CREATE TABLE IF NOT EXISTS info_architecture (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  parent_id INTEGER REFERENCES info_architecture(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- UX: personas addressed mapping
-- Domain: ux-design
-- Purpose: Documents how the UX design addresses a specific persona's goals. Each row states which
-- persona is covered, what their goal is in this context, and how the design addresses it. Serves
-- as the UX design's accountability record to the personas defined in requirements.
-- Context: The ux_critic validates that every persona defined in persona (for the iteration) has at
-- least one persona_addressed row. Each row is linked to one or more user flows via
-- persona_addressed_flow, closing the traceability chain: persona → addressed by → flows.
CREATE TABLE IF NOT EXISTS persona_addressed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  persona_id TEXT NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  how_addressed TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, persona_id)
);

-- Domain: ux-design
-- Purpose: Many-to-many join table linking a persona_addressed record to the user flows that
-- deliver the addressed goal. Answers: "which flows implement the design's promise to this
-- persona?"
-- Context: The ux_critic checks that every persona_addressed row has at least one flow. The
-- implementation_planner can use this join to prioritise flows by persona criticality.
CREATE TABLE IF NOT EXISTS persona_addressed_flow (
  persona_addressed_id INTEGER NOT NULL REFERENCES persona_addressed(id) ON DELETE CASCADE,
  flow_id TEXT NOT NULL REFERENCES user_flow(id) ON DELETE CASCADE,
  PRIMARY KEY (persona_addressed_id, flow_id)
);

-- UX: assets
-- Domain: ux-design
-- Purpose: A registry of all UX artefact files: wireframes, mockups, prototypes, icons, images, and
-- videos. Provides a canonical inventory of design files and their locations, optionally linked to
-- a specific screen.
-- Context: The ux_designer registers every file it produces. wireframe_path and mockup_path on
-- screen rows should correspond to path values in this table. The ux_critic
-- verifies that all referenced paths have corresponding ux_asset entries. Assets not tied to a
-- specific screen (e.g., a global icon set, a prototype video) leave screen_id NULL.
CREATE TABLE IF NOT EXISTS ux_asset (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  screen_id TEXT REFERENCES screen(id) ON DELETE SET NULL,
  description TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, path)
);

-- Implementation plan phases
-- Domain: planning
-- Purpose: Central record for one implementation work chunk. A work item groups related development
-- work that can be handed to a developer as a coherent unit. The phase_number field provides the
-- human-readable sequential ordering; child and related tables reference the work item by its id
-- primary key. The critical_path_sequence column (nullable INTEGER) indicates whether this work
-- item is on the critical path and its position in the sequence; NULL means not on the critical
-- path. The work_order column (nullable INTEGER) captures execution ordering when explicit
-- sequencing is needed (replaces the former plan_phase_relationship table).
-- Context: Created by implementation_planner once per logical work grouping within an iteration.
-- Each work item has a type describing whether it delivers user-facing features, internal
-- infrastructure, or another category of work. review_checkpoint = 1 flags work items where the
-- critic or architect should conduct a mid-implementation review before proceeding. complexity is a
-- t-shirt size estimate used by the senior_developer to gauge effort before starting.
CREATE TABLE IF NOT EXISTS work_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  phase_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  work_type TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  plan_version INTEGER NOT NULL DEFAULT 1,
  superseded_at TEXT, -- NULL = active; set when WI is retired by a replan
  complexity TEXT, -- NULL when estimation not yet done
  review_checkpoint INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  entry_criteria JSON NOT NULL DEFAULT '[]',
  exit_criteria JSON NOT NULL DEFAULT '[]',
  checkpoint_focus JSON NOT NULL DEFAULT '[]',
  critical_path_sequence INTEGER, -- NULL = not on critical path; non-NULL = sequence order
  work_order INTEGER, -- NULL = unordered; non-NULL = explicit execution sequence
  risks JSON, -- [{risk, mitigation}] — work-item-scoped risks; NULL when none
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  UNIQUE(iteration_id, plan_version, name)
);

-- Domain: planning
-- Purpose: Links a work_item to the requirement IDs it satisfies. This is the primary traceability
-- bridge from implementation plan back to the requirements domain.
-- Context: Many-to-many join. A work item can address multiple requirements; a requirement can span
-- multiple work items. Populated when implementation_planner inserts a work_item. Requirements IDs
-- must already exist in the requirement table. Used by implementation_plan_critic to verify full
-- requirement coverage across all work items. Also used in traceability_query to show "which work
-- items implement REQ-XXX?"
CREATE TABLE IF NOT EXISTS work_item_requirement (
  work_item_id INTEGER NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  priority TEXT,
  notes TEXT,
  PRIMARY KEY (work_item_id, requirement_id)
);

-- Domain: planning
-- Purpose: Links a work_item to the architecture component IDs it touches. Tells developers which
-- system components will be written or modified during this work item.
-- Context: Many-to-many join. Populated alongside work_item_requirement during work item insertion.
-- implementation_plan_critic uses this to verify that every component gets covered in at least one
-- work item, and that no work item is overloaded with unrelated components. senior_developer uses
-- this to decide which codebases/services to check out before starting a work item.
CREATE TABLE IF NOT EXISTS work_item_component (
  work_item_id INTEGER NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES component(id) ON DELETE CASCADE,
  PRIMARY KEY (work_item_id, component_id)
);

-- Implementation plan: overview
-- Domain: planning
-- Purpose: One row per planning revision: the high-level summary of the entire implementation plan.
-- Records the overall strategy, the rationale for the chosen breakdown, and a description of the
-- Phase 1 approach.
-- Context: Created once per planning revision by implementation_planner, alongside all work_item
-- rows. implementation_plan_critic uses this to evaluate whether the strategy is coherent and
-- whether the rationale justifies the phase count. senior_developer reads this first to understand
-- the big picture before drilling into individual phases. Assumptions and plan-wide risks are
-- stored inline as JSON arrays.
CREATE TABLE IF NOT EXISTS plan_overview (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  plan_version INTEGER NOT NULL DEFAULT 1,
  strategy TEXT NOT NULL,
  rationale TEXT NOT NULL,
  phase_one_approach TEXT,
  assumptions JSON NOT NULL DEFAULT '[]',
  risks JSON, -- [{risk, mitigation, work_item_number}] — plan-wide strategic risks; NULL when none
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, plan_version)
);

-- Implementation plan: external dependencies
-- Domain: planning
-- Purpose: Records external systems, services, or teams that the implementation plan depends on but
-- cannot directly control. Each row is one external dependency with a risk level and optional
-- mitigation strategy.
-- Context: One-to-many child of the iteration (not a specific phase — external dependencies are
-- plan-wide). Examples: "Auth0 tenant provisioning", "Payment gateway sandbox credentials", "Mobile
-- team delivering SDK v2", "Legal approval for GDPR data flows". The optional work_item_number
-- field marks when the dependency becomes blocking. implementation_plan_critic verifies that
-- high/critical external dependencies have concrete mitigations. senior_developer tracks these as
-- pre-conditions to flag blockers early.
CREATE TABLE IF NOT EXISTS plan_external_dependency (
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
-- Implementation manifests (per sub-phase)
-- Domain: implementation
-- Purpose: The root record for one sub-phase of implementation work. Every time the
-- Domain: implementation
-- Purpose: Records the implementation progress of each requirement as assessed by the
-- senior_developer at the end of a sub-phase. This is the canonical source of truth for "is REQ-042
-- done?" from the implementation perspective.
-- Context: Scoped to an iteration. A requirement may appear multiple times across sub-phases;
-- later rows supersede earlier ones. The QA engineer consults this table to determine what has been
-- built and what still needs testing.
CREATE TABLE IF NOT EXISTS implementation_requirement_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  notes TEXT,
  UNIQUE(iteration_id, requirement_id)
);

-- Domain: implementation
-- Purpose: Records per-component implementation progress alongside requirement status. Where
-- implementation_requirement_status tracks the "what", this table tracks the "which system part".
-- Context: Useful for architecture-level dashboards: the critic checks that each component reaches
-- complete before the phase exits. A component's status may be partial across sub-phases until all
-- its files and requirements are done.
CREATE TABLE IF NOT EXISTS implementation_component_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES component(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  notes TEXT,
  UNIQUE(iteration_id, component_id)
);

-- Domain: implementation
-- Purpose: Records any impediment the senior_developer encountered during a sub-phase that
-- prevented complete implementation. Blockers are the primary signal used by the
-- senior_developer_critic to decide whether to reject a revision and escalate.
-- Context: Blockers have three severity levels. needs_escalation = 1 flags that the
-- senior_developer believes human intervention or architecture revision is required. The critic
-- checks this flag and severity when writing its verdict in revision.feedback.
CREATE TABLE IF NOT EXISTS implementation_blocker (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  severity TEXT NOT NULL,
  recommendation TEXT,
  needs_escalation INTEGER NOT NULL DEFAULT 0
);

-- Domain: implementation
-- Purpose: Join table associating each blocker with the requirements it prevents from being
-- implemented. Enables the critic and QA to pinpoint exactly which requirements are at risk.
-- Context: The join table tracks which requirements are affected by each blocker.
CREATE TABLE IF NOT EXISTS implementation_blocker_requirement (
  blocker_id INTEGER NOT NULL REFERENCES implementation_blocker(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  PRIMARY KEY (blocker_id, requirement_id)
);

-- VCS commits linked to work items and revision attempts
-- Domain: implementation
-- Purpose: Links a Git (or Jujutsu) commit SHA to exactly one work item and one revision attempt.
-- Acts as the durable connection between the changelog database and the version control history.
-- Context: Populated exclusively by the commit_link MCP tool, not by changelog_insert. The
-- senior_developer calls commit_link after each commit. Each commit belongs to a specific work
-- item (what was being implemented) and revision (which producer-critic attempt produced it).
-- The iteration_summary read tool surfaces these rows alongside deliverables to give a complete
-- picture of an iteration's VCS activity.
CREATE TABLE IF NOT EXISTS vcs_commit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  work_item_id INTEGER NOT NULL REFERENCES work_item(id) ON DELETE CASCADE,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  commit_sha TEXT NOT NULL,
  message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, commit_sha)
);

-- Intermediate assets shared between producer/critic
-- Domain: implementation
-- Purpose: Stores transient work items, notes, plans, and references that the senior_developer (or
-- any agent) creates during work but that are not final deliverables. Used for producer-critic
-- handoff context — the critic reads intermediate assets to understand what the producer was
-- thinking.
-- Context: asset_type determines what content contains. For example, commit_ref and file_ref
-- typically store identifiers rather than full content, work_item captures task notes, plan
-- captures sub-phase planning text, and note captures free-form observations. The field is free-
-- form — agents may use any descriptive type string.
CREATE TABLE IF NOT EXISTS intermediate_asset (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phase_id INTEGER REFERENCES phase(id) ON DELETE SET NULL,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- ============================================================
-- QA & TEST TABLES
-- ============================================================

-- Test report
-- Domain: qa-test
-- Purpose: The root entity for a QA run. One test_report row represents the aggregate outcome of a
-- full test execution for a given iteration. All other test-domain tables reference this row.
-- Context: The qa_engineer creates exactly one test_report per iteration (possibly revised across
-- multiple revisions). The status field is the aggregate outcome signal: pass means all tests
-- passed and no critical blockers exist; fail means failures occurred; blocked means testing could
-- not complete.
CREATE TABLE IF NOT EXISTS test_report (
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
  document_date TEXT, -- ISO 8601 date (YYYY-MM-DD)
  requirements_version TEXT,
  architecture_version TEXT,
  commit_sha TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- ============================================================
-- AUDIT PHASE TABLES
-- ============================================================

-- Security audit findings (produced by security_auditor during audit phase)
-- Domain: audit
-- Purpose: Records a single security vulnerability or concern discovered during the audit phase.
-- Each finding is an independent row — auditors record findings incrementally as they complete each
-- OWASP category or code area.
-- Context: The security_auditor performs a deep code-level security audit (OWASP Top 10, data flow
-- tracing, dependency audit, configuration review) and records each finding individually via
-- changelog_insert. Audit findings come from manual expert code review during the audit phase. The security_audit_critic queries all findings for the current iteration
-- to validate completeness, accuracy, and actionability.
CREATE TABLE IF NOT EXISTS security_audit_finding (
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

-- Performance audit findings (produced by performance_auditor during audit phase)
-- Domain: audit
-- Purpose: Records a single performance bottleneck, anti-pattern, or optimization opportunity
-- discovered during the audit phase. Each finding is an independent row — auditors record findings
-- incrementally as they complete each performance area.
-- Context: The performance_auditor performs a deep code-level performance audit (database queries,
-- memory patterns, concurrency, API design, algorithm analysis) and records each finding
-- individually via changelog_insert. Audit findings identify
-- code-level anti-patterns and bottlenecks regardless of requirements. The performance_audit_critic
-- queries all findings for the current iteration to validate completeness, evidence backing, and
-- actionability.
CREATE TABLE IF NOT EXISTS performance_audit_finding (
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
-- ============================================================
-- BLOCKER: cross-phase workflow blockers raised by agents
-- ============================================================

-- Domain: cross-cutting
-- Purpose: System-wide blockers that span all phases or apply to a specific workflow phase as a
-- whole — issues that the system cannot progress past until resolved.
-- Context: Created when blockers are identified that cannot be addressed within the current phase
-- or are escalations from lower-level blockers. These are distinct from phase-specific blockers in
-- implementation and QA.
CREATE TABLE IF NOT EXISTS blocker (
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

-- ============================================================
-- PROJECT LESSON: cross-phase lessons learned, recorded by critics
-- ============================================================

-- Domain: cross-cutting
-- Purpose: Captures lessons learned and key insights from the project for future reference.
-- Recorded by agents or the team as the project progresses or concludes.
-- Context: Project lessons provide organizational memory — what worked, what didn't, patterns that
-- emerged, and recommendations for future projects. These are distinct from recommendations in
-- specific domains (QA, implementation) and capture systemic insights.
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
-- Skipped: data_exchange (iteration_id is leftmost in UNIQUE(iteration_id, direction, name))
-- Skipped: nonfunctional_requirement (iteration_id is leftmost in UNIQUE(iteration_id, nfr_type, item))
CREATE INDEX IF NOT EXISTS idx_persona_introduced_in_iteration_id
  ON persona(introduced_in_iteration_id);

-- Planning domain
-- Skipped: plan_external_dependency (iteration_id is leftmost in UNIQUE(iteration_id, name))

-- Cross-cutting domain
-- Skipped: vcs_commit (iteration_id is leftmost in UNIQUE(iteration_id, commit_sha))
CREATE INDEX IF NOT EXISTS idx_blocker_iteration_id
  ON blocker(iteration_id);
CREATE INDEX IF NOT EXISTS idx_project_lesson_iteration_id
  ON project_lesson(iteration_id);

-- ------------------------------------------------------------
-- iteration_id — implementation status tables
-- Skipped: implementation_requirement_status, implementation_component_status
--   (iteration_id is leftmost in UNIQUE)
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_implementation_blocker_iteration_id
  ON implementation_blocker(iteration_id);

-- ------------------------------------------------------------
-- work_item_id — child tables of work_item
-- Skipped: work_item_requirement, work_item_component
--   (work_item_id is leftmost in their composite PKs)
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_plan_external_dependency_work_item_id
  ON plan_external_dependency(work_item_id);
CREATE INDEX IF NOT EXISTS idx_vcs_commit_work_item_id
  ON vcs_commit(work_item_id);

-- ------------------------------------------------------------
-- requirement_id — junction and mapping tables
-- Skipped: requirement_persona, requirement_dependency
--   (requirement_id is leftmost in their composite PKs)
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_requirement_trace_requirement_id
  ON requirement_trace(requirement_id);
CREATE INDEX IF NOT EXISTS idx_work_item_requirement_requirement_id
  ON work_item_requirement(requirement_id);
CREATE INDEX IF NOT EXISTS idx_implementation_requirement_status_requirement_id
  ON implementation_requirement_status(requirement_id);
CREATE INDEX IF NOT EXISTS idx_implementation_blocker_requirement_requirement_id
  ON implementation_blocker_requirement(requirement_id);
CREATE INDEX IF NOT EXISTS idx_requirement_trace_iteration_id
  ON requirement_trace(iteration_id);
CREATE INDEX IF NOT EXISTS idx_requirement_trace_addressed_by
  ON requirement_trace(addressed_by_type, addressed_by);

-- ------------------------------------------------------------
-- iteration_id — provenance FK on every entity table
-- ------------------------------------------------------------

-- Requirements domain
CREATE INDEX IF NOT EXISTS idx_persona_project_id
  ON persona(project_id);
CREATE INDEX IF NOT EXISTS idx_requirement_iteration_id
  ON requirement(iteration_id);

-- Architecture domain
CREATE INDEX IF NOT EXISTS idx_adr_iteration_id
  ON adr(iteration_id);
CREATE INDEX IF NOT EXISTS idx_component_iteration_id
  ON component(iteration_id);
CREATE INDEX IF NOT EXISTS idx_approved_dependency_iteration_id
  ON approved_dependency(iteration_id);
-- requirement_trace iteration_id covered by idx_requirement_trace_iteration_id above

-- UX design domain
CREATE INDEX IF NOT EXISTS idx_user_flow_iteration_id
  ON user_flow(iteration_id);
CREATE INDEX IF NOT EXISTS idx_screen_iteration_id
  ON screen(iteration_id);
CREATE INDEX IF NOT EXISTS idx_info_architecture_iteration_id
  ON info_architecture(iteration_id);
CREATE INDEX IF NOT EXISTS idx_persona_addressed_iteration_id
  ON persona_addressed(iteration_id);
-- Skipped: ux_asset (iteration_id is leftmost in UNIQUE)

-- Planning domain
CREATE INDEX IF NOT EXISTS idx_work_item_iteration_id
  ON work_item(iteration_id);
-- Skipped: work_item plan_version (iteration_id, plan_version is leftmost prefix of
--   UNIQUE(iteration_id, plan_version, name))
-- Skipped: plan_overview (iteration_id is leftmost in UNIQUE(iteration_id, plan_version))

-- Implementation domain
-- Skipped: implementation_requirement_status, implementation_component_status
--   (iteration_id is leftmost in UNIQUE)
-- implementation_blocker iteration_id covered above in status table indexes

-- QA domain
CREATE INDEX IF NOT EXISTS idx_test_report_iteration_id
  ON test_report(iteration_id);

-- Audit domain
CREATE INDEX IF NOT EXISTS idx_security_audit_finding_iteration_id
  ON security_audit_finding(iteration_id);
CREATE INDEX IF NOT EXISTS idx_performance_audit_finding_iteration_id
  ON performance_audit_finding(iteration_id);

-- Documentation domain

-- Cross-cutting domain
CREATE INDEX IF NOT EXISTS idx_intermediate_asset_iteration_id
  ON intermediate_asset(iteration_id);

-- ------------------------------------------------------------
-- phase_id — FK to phase(id)
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_revision_phase_id
  ON revision(phase_id);
CREATE INDEX IF NOT EXISTS idx_intermediate_asset_phase_id
  ON intermediate_asset(phase_id);

-- ------------------------------------------------------------
-- revision_id — FK to revision(id)
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_vcs_commit_revision_id
  ON vcs_commit(revision_id);

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

CREATE INDEX IF NOT EXISTS idx_work_item_component_component_id
  ON work_item_component(component_id);
CREATE INDEX IF NOT EXISTS idx_implementation_component_status_component_id
  ON implementation_component_status(component_id);

-- ------------------------------------------------------------
-- screen_id — FK to screen(id)
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_ux_asset_screen_id
  ON ux_asset(screen_id);

-- ------------------------------------------------------------
-- flow_id — FK to user_flow(id)
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_user_flow_step_flow_id
  ON user_flow_step(flow_id);
CREATE INDEX IF NOT EXISTS idx_persona_addressed_flow_flow_id
  ON persona_addressed_flow(flow_id);

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

-- adr_decision.alternative_id → adr_alternative(id)
-- Skipped: adr_decision.adr_id (leftmost in PK)
CREATE INDEX IF NOT EXISTS idx_adr_decision_alternative_id
  ON adr_decision(alternative_id);

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

-- info_architecture.parent_id → info_architecture(id) (self-referencing)
CREATE INDEX IF NOT EXISTS idx_info_architecture_parent_id
  ON info_architecture(parent_id);

-- persona_addressed_flow.persona_addressed_id → persona_addressed(id)
-- Skipped: persona_addressed_flow
--   (persona_addressed_id is leftmost in PK(persona_addressed_id, flow_id))

-- blocker.phase_name — composite FK (iteration_id, phase_name) → phase(iteration_id, name)
CREATE INDEX IF NOT EXISTS idx_blocker_phase_name
  ON blocker(phase_name);

-- project_lesson.phase_name — composite FK (iteration_id, phase_name) → phase(iteration_id, name)
CREATE INDEX IF NOT EXISTS idx_project_lesson_phase_name
  ON project_lesson(phase_name);
