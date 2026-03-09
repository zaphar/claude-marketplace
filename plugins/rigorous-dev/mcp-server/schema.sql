-- Rigorous-dev changelog database schema
-- Replaces YAML-based artifact storage with normalized SQLite
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Project-level config and lifecycle (singleton — one row per repo DB)
-- Domain: core
-- Purpose: Project-level config and lifecycle state. Singleton — exactly one row per database,
-- enforced by CHECK(id = 1).
-- Context: Created by iteration_create on first run (alongside the first iteration and its phases).
-- Status transitions to closed via project_update. The canonical "is this project active?" check is
-- status = 'active'.
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
-- Domain: core
-- Purpose: A single change-request cycle within a project. Each time new work is requested — a new
-- feature, a bug-fix batch, a refactor — a new iteration is opened. Iterations are numbered
-- sequentially.
-- Context: Created by iteration_create. An iteration encompasses all nine phases and their revision
-- attempts. Changelog entities reference the iteration either directly (via iteration_id for
-- context tables) or indirectly (via revision_id → phase → iteration for producer-critic
-- artifacts). Closing an iteration (status closed) signals that the work shipped and a new request
-- cycle can begin.
CREATE TABLE IF NOT EXISTS iteration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK(status IN ('active', 'closed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_iteration_status ON iteration(status);

-- Phases within an iteration
-- Domain: core
-- Purpose: One of the nine SDLC stages within an iteration. Phases are created in bulk (all nine,
-- all pending) when an iteration is created, then activated and completed one at a time as the
-- workflow advances.
-- Context: Created by iteration_create alongside the iteration row. Status is advanced by
-- phase_transition. approved_by records which agent approved the phase output (set by the critic).
-- Revisions hang off phases, so the full producer-critic history for any phase is traceable via
-- revision.
CREATE TABLE IF NOT EXISTS phase (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(name IN (
    'requirements', 'ux_design', 'architecture', 'planning',
    'implementation', 'documentation', 'qa', 'audit'
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
-- Domain: core
-- Purpose: A single producer-critic loop attempt within a phase. When a producer agent generates
-- output for a phase, a revision row is created. The critic agent then reviews it and records a
-- verdict (approved or rejected) along with feedback text. If rejected, a new revision is created
-- for the next attempt.
-- Context: Revisions are the mechanism that enforces quality gates. The full revision chain for any
-- phase shows every draft, the feedback that was given, and the final approved version. Changelog
-- entities that are produced during a specific revision attempt carry the revision_id so that
-- approved output can be distinguished from earlier drafts.
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
-- Domain: requirements
-- Purpose: Represents a user archetype — a named, described role with a defined technical level and
-- usage frequency. Personas ground the requirements in real human context, preventing the system
-- from being designed in the abstract. Each persona is scoped to an iteration and pinned to a
-- specific revision when the requirements_critic has approved or revised the analyst's output.
-- Context: Produced by the requirements_analyst agent. Validated (and potentially revised) by the
-- requirements_critic. Consumed by the ux_designer (who associates personas with user flows) and
-- the requirements_analyst itself (who links personas to requirements via requirement_persona).
-- Referenced downstream by user_flow.persona_id.
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
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  rationale TEXT,
  priority TEXT NOT NULL CHECK(priority IN ('must-have', 'should-have', 'nice-to-have')),
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
  type TEXT NOT NULL CHECK(type IN ('deployment', 'operational', 'technology')),
  item TEXT NOT NULL,
  category TEXT,
  value TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Architecture Decision Records
-- Domain: architecture
-- Purpose: The central record for each Architecture Decision Record. An ADR captures a single
-- significant technical decision — what was decided, why, and when — giving every future reader a
-- permanent, auditable record of the reasoning behind the system's shape. All alternative options
-- are stored in the adr_alternative child table; consequences and research citations are stored
-- inline as JSON arrays in the consequences and research_sources columns.
-- Context: ADRs are the backbone of architectural traceability. Every major technology choice,
-- structural pattern, or integration strategy that required deliberation should have an ADR. adr
-- rows reference the current revision (with the iteration derived via revision → phase →
-- iteration), so the full evolution of any decision across critic feedback rounds is preserved. The
-- superseded_by self-reference creates a chain of record when an earlier decision is replaced. The
-- research_sources JSON column is the key enabler of the "why are we using X?" traceability query.
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

-- Domain: architecture
-- Purpose: Records each option that was explicitly considered when making an ADR decision. Every
-- ADR should have at least two alternatives (including the chosen option) so that future readers
-- understand what was weighed. Pros and cons are stored inline as JSON arrays.
-- Context: The alternative-with-pros-and-cons pattern is the structured form of the classic ADR
-- "options considered" section. Pros and cons are stored as nullable TEXT columns containing JSON
-- arrays (e.g., ["Built-in horizontal sharding","Mature ecosystem"]). When queried via
-- changelog_query or traceability_query, these columns are parsed back into arrays for convenient
-- consumption.
CREATE TABLE IF NOT EXISTS adr_alternative (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adr_id TEXT NOT NULL REFERENCES adr(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  pros TEXT,
  cons TEXT
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
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
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
-- plan_phase_api_endpoint entries created by the implementation_planner. When the senior_developer
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

-- requirement_trace: unified traceability — see requirement_trace table below

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

-- Unified config (architecture: security/deployment/observability; ux: design_system/accessibility/responsive/feedback_pattern)
-- Domain: cross-cutting
-- Purpose: Unified key/value store for cross-cutting configuration across both architecture and UX
-- domains. Each row captures one configuration decision or setting — for example, an authentication
-- scheme, a deployment scaling policy, a logging format, a design system colour token, or an
-- accessibility setting. The domain column classifies each row as architecture or ux, and the
-- config_type column further discriminates the concern within that domain.
-- Context: Architecture-domain entries are written by backend_architect during the architecture
-- phase. UX-domain entries are written by ux_designer during the ux_design phase. Security entries
-- are driven by nonfunctional_requirement rows with type = 'technology' and security implications.
-- Deployment entries are driven by nonfunctional_requirement rows with type = 'deployment'.
-- Observability entries are driven by nonfunctional_requirement rows with type = 'operational'. UX
-- entries are driven by design requirements and accessibility standards.
CREATE TABLE IF NOT EXISTS config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK(domain IN ('architecture', 'ux')),
  config_type TEXT NOT NULL,
  target TEXT,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  rationale TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(revision_id, domain, config_type, category, key)
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
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(revision_id, package)
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
-- label for other. The addressed_by_type column has a CHECK constraint — valid values are
-- component, endpoint, flow, screen, adr, and technology.
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

-- Domain: ux-design
-- Purpose: A single discrete action within a user flow. Steps are ordered by step_number and each
-- names the interaction surface on which the action occurs — a screen for UI apps, an endpoint for
-- APIs, a CLI command, or NULL when not applicable. Decision-point steps can have conditional
-- branches.
-- Context: The ux_designer inserts steps as part of the parent user_flow insert (they are not
-- inserted separately). The backend_architect uses step-to-surface mappings to validate API
-- coverage. Steps with is_decision_point = 1 must have at least one user_flow_step_branch row.
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

-- Domain: ux-design
-- Purpose: A conditional branch at a decision-point step. Captures the condition that triggers the
-- branch and which step number it leads to (can be a forward or backward jump).
-- Context: Used to model decision trees, retry loops, and alternate paths within a flow. The
-- ux_critic checks that every decision-point step has at least one branch, and that next_step
-- values refer to valid step_number values within the same flow.
CREATE TABLE IF NOT EXISTS user_flow_step_branch (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  step_id INTEGER NOT NULL REFERENCES user_flow_step(id) ON DELETE CASCADE,
  condition TEXT NOT NULL,
  next_step INTEGER NOT NULL
);

-- Domain: ux-design
-- Purpose: An error condition that can occur during the flow and the recovery path the user must
-- take. Captures exception handling from a UX perspective (not from a system error perspective).
-- Context: Error states are sibling records of the flow rather than children of individual steps,
-- because an error may span multiple steps or originate from backend failures. Examples: "Session
-- expires mid-flow → redirect to login with return URL", "Payment gateway timeout → show retry
-- dialog".
CREATE TABLE IF NOT EXISTS user_flow_error_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  flow_id TEXT NOT NULL REFERENCES user_flow(id) ON DELETE CASCADE,
  condition TEXT NOT NULL,
  recovery TEXT NOT NULL
);

-- requirement_trace: unified traceability — see requirement_trace table above

-- UX: screens
-- Domain: ux-design
-- Purpose: A distinct UI view or page in the application. Screens are the atomic building blocks of
-- the visual design. Each screen has a purpose, optional wireframe and mockup paths, and is
-- decomposed into components, states, and responsive variants.
-- Context: The ux_designer creates one screen row per unique view (e.g., SCREEN-001 Dashboard,
-- SCREEN-002 Login). Screens are referenced by name in user_flow_step.surface. The
-- backend_architect cross-references screens with flow steps to determine which endpoints each
-- screen requires. The implementation_planner references screen_id in plan_phase_screen.
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

-- Domain: ux-design
-- Purpose: A named UI state variant of a screen. Captures how the screen looks and behaves when it
-- is in a particular condition (loading, empty, error, etc.). Each state may optionally have its
-- own wireframe.
-- Context: The ux_designer must define at minimum a default state. The ux_critic checks that
-- screens with data dependencies include loading and empty states, and that action-bearing screens
-- include an error state. The senior_developer implements each state as a conditional render
-- branch.
CREATE TABLE IF NOT EXISTS screen_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  screen_id TEXT NOT NULL REFERENCES screen(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  wireframe_path TEXT,
  UNIQUE(screen_id, name)
);

-- Domain: ux-design
-- Purpose: Describes how a screen layout changes at a specific responsive breakpoint. Captures
-- breakpoint-specific wireframes and prose descriptions of layout adjustments (e.g., "sidebar
-- collapses to hamburger menu at mobile breakpoint").
-- Context: One row per breakpoint per screen. Breakpoint names should align with values defined in
-- config (domain: ux, config_type responsive). The ux_critic validates that screens either have
-- responsive variants for all defined breakpoints or explicitly omit them with justification.
CREATE TABLE IF NOT EXISTS screen_responsive_variant (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  screen_id TEXT NOT NULL REFERENCES screen(id) ON DELETE CASCADE,
  breakpoint TEXT NOT NULL,
  wireframe_path TEXT,
  layout_changes TEXT,
  UNIQUE(screen_id, breakpoint)
);

-- (ux_config has been merged into the unified `config` table — see architecture section)

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
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
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
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  persona_id TEXT NOT NULL REFERENCES persona(id) ON DELETE CASCADE,
  goal TEXT NOT NULL,
  how_addressed TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(revision_id, persona_id)
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
-- screen and screen_state rows should correspond to path values in this table. The ux_critic
-- verifies that all referenced paths have corresponding ux_asset entries. Assets not tied to a
-- specific screen (e.g., a global icon set, a prototype video) leave screen_id NULL.
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
-- Domain: planning
-- Purpose: Central record for one implementation work chunk. A phase groups related development
-- work that can be handed to a developer as a coherent unit. The phase_number field provides the
-- human-readable sequential ordering; child and related tables reference the phase by its id
-- primary key (e.g., plan_phase_relationship.related_phase_id). The critical_path_sequence column
-- (nullable INTEGER) indicates whether this phase is on the critical path and its position in the
-- sequence; NULL means not on the critical path.
-- Context: Created by implementation_planner once per logical work grouping within an iteration.
-- Each phase has a type describing whether it delivers user-facing features, internal
-- infrastructure, or another category of work. review_checkpoint = 1 flags phases where the critic
-- or architect should conduct a mid-implementation review before proceeding. complexity is a
-- t-shirt size estimate used by the senior_developer to gauge effort before starting.
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

-- Domain: planning
-- Purpose: Links a plan_phase to the requirement IDs it satisfies. This is the primary traceability
-- bridge from implementation plan back to the requirements domain.
-- Context: Many-to-many join. A phase can address multiple requirements; a requirement can span
-- multiple phases. Populated when implementation_planner inserts a plan_phase. Requirements IDs
-- must already exist in the requirement table. Used by implementation_plan_critic to verify full
-- requirement coverage across all phases. Also used in traceability_query to show "which phases
-- implement REQ-XXX?"
CREATE TABLE IF NOT EXISTS plan_phase_requirement (
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  priority TEXT,
  notes TEXT,
  PRIMARY KEY (plan_phase_id, requirement_id)
);

-- Domain: planning
-- Purpose: Links a plan_phase to the architecture component IDs it touches. Tells developers which
-- system components will be written or modified during this phase.
-- Context: Many-to-many join. Populated alongside plan_phase_requirement during phase insertion.
-- implementation_plan_critic uses this to verify that every component gets covered in at least one
-- phase, and that no phase is overloaded with unrelated components. senior_developer uses this to
-- decide which codebases/services to check out before starting a phase.
CREATE TABLE IF NOT EXISTS plan_phase_component (
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES component(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_phase_id, component_id)
);

-- Domain: planning
-- Purpose: Links a plan_phase to the user_flow IDs it implements. Records which user flows will be
-- brought to life during a given phase.
-- Context: Many-to-many join between plan_phase and user_flow (from the UX domain). Used by
-- senior_developer and test_writer to understand the end-to-end user journeys that must work by the
-- end of the phase. Enables implementation_plan_critic to check that all designed user flows are
-- covered.
CREATE TABLE IF NOT EXISTS plan_phase_flow (
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  flow_id TEXT NOT NULL REFERENCES user_flow(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_phase_id, flow_id)
);

-- Domain: planning
-- Purpose: Links a plan_phase to the screen IDs it will build or modify. Records which UI screens
-- are in scope for a given phase.
-- Context: Many-to-many join between plan_phase and screen (from the UX domain). Helps
-- senior_developer and frontend engineers understand which screens to implement in each phase. Used
-- by test_writer to scope UI/integration tests per phase.
CREATE TABLE IF NOT EXISTS plan_phase_screen (
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  screen_id TEXT NOT NULL REFERENCES screen(id) ON DELETE CASCADE,
  PRIMARY KEY (plan_phase_id, screen_id)
);

-- Domain: planning
-- Purpose: Lists the HTTP API endpoints that must be implemented during a phase. This is the
-- developer's build spec for the API surface of a phase — HTTP method, route, and purpose for each
-- endpoint.
-- Context: One-to-many child of plan_phase. A phase may have zero (infrastructure phases) to many
-- endpoints. implementation_planner derives these from the architecture domain
-- (component_interface) and requirements. senior_developer treats each row as an endpoint to
-- implement and unit-test. test_writer generates integration test cases from these rows.
-- implementation_plan_critic cross-checks that the listed endpoints cover all relevant acceptance
-- criteria.
CREATE TABLE IF NOT EXISTS plan_phase_api_endpoint (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  http_method TEXT NOT NULL,
  route TEXT NOT NULL,
  description TEXT,
  UNIQUE(plan_phase_id, route, http_method)
);

-- Domain: planning
-- Purpose: Represents one database migration required within a phase. Each row is a named migration
-- unit (analogous to a migration file). The tables JSON array lists the specific table names the
-- migration touches.
-- Context: One-to-many child of plan_phase. Infrastructure phases often have several migrations;
-- feature phases typically have one or two. implementation_planner names migrations following a
-- convention so they can be ordered and versioned. senior_developer uses these to generate or write
-- migration files before implementing application logic. implementation_plan_critic verifies that
-- migrations align with the architecture's data model and don't conflict across phases.
CREATE TABLE IF NOT EXISTS plan_phase_db_change (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  migration_name TEXT NOT NULL,
  description TEXT,
  tables JSON NOT NULL DEFAULT '[]',
  UNIQUE(plan_phase_id, migration_name)
);

-- Domain: planning
-- Purpose: Records inter-phase relationships: ordering constraints (dependency) and concurrency
-- pairs (parallel). A single table with a dependency_type discriminator replaces the former
-- plan_phase_dependency and plan_phase_parallel tables.
-- Context: dependency rows define a DAG of phase execution order: plan_phase_id cannot begin until
-- related_phase_id is complete. parallel rows record pairs of phases that can be worked
-- concurrently — they have no blocking dependency and touch independent parts of the system.
-- implementation_planner populates both relationship types to ensure correct sequencing and to
-- surface safe parallelism. senior_developer reads dependencies to decide which phases to
-- start/queue, and reads parallel relationships to maximize throughput. The critical path is
-- derived from the dependency subset — the longest chain through dependency rows. Critical path
-- membership is tracked on plan_phase.critical_path_sequence. implementation_plan_critic verifies
-- claimed parallelism by checking for hidden conflicts in plan_phase_db_change.tables and
-- plan_phase_component.
CREATE TABLE IF NOT EXISTS plan_phase_relationship (
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  related_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  dependency_type TEXT NOT NULL CHECK(dependency_type IN ('dependency', 'parallel')),
  reason TEXT, -- only populated for dependency_type = 'dependency'
  PRIMARY KEY (plan_phase_id, related_phase_id)
);

-- Domain: planning
-- Purpose: Records risks specific to a single phase — technical unknowns, integration hazards, or
-- schedule threats — along with their mitigations.
-- Context: One-to-many child of plan_phase. A phase may have zero or more risks. Distinct from
-- plan_overview_risk, which records plan-wide risks. These are phase-scoped. implementation_planner
-- documents risks when a phase touches unfamiliar technology, has a tight time window, or depends
-- on external teams. senior_developer reviews these before starting the phase to pre-empt blockers.
-- implementation_plan_critic checks that every risk has a concrete mitigation (not just "be
-- careful").
CREATE TABLE IF NOT EXISTS plan_phase_risk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_phase_id INTEGER NOT NULL REFERENCES plan_phase(id) ON DELETE CASCADE,
  risk TEXT NOT NULL,
  mitigation TEXT
);

-- Implementation plan: overview
-- Domain: planning
-- Purpose: One row per planning revision: the high-level summary of the entire implementation plan.
-- Records the overall strategy, the rationale for the chosen breakdown, and a description of the
-- Phase 1 approach.
-- Context: Created once per planning revision by implementation_planner, alongside all plan_phase
-- rows. implementation_plan_critic uses this to evaluate whether the strategy is coherent and
-- whether the rationale justifies the phase count. senior_developer reads this first to understand
-- the big picture before drilling into individual phases. Child table plan_overview_risk hangs off
-- this row. Assumptions are stored inline as a JSON array.
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

-- Domain: planning
-- Purpose: Records plan-wide risks that apply across multiple phases or to the overall delivery,
-- along with mitigations. These are strategic risks rather than the phase-specific tactical risks
-- stored in plan_phase_risk.
-- Context: One-to-many child of plan_overview. A plan typically has 2–5 overview risks. Examples:
-- "Architecture depends on unproven library X", "Team lacks experience with streaming databases",
-- "Regulatory approval may delay Phase 3". The optional plan_phase_number field indicates if the
-- risk materialises at a specific phase (for scheduling mitigation work).
-- implementation_plan_critic verifies that mitigations are actionable and not generic.
CREATE TABLE IF NOT EXISTS plan_overview_risk (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_overview_id INTEGER NOT NULL REFERENCES plan_overview(id) ON DELETE CASCADE,
  risk TEXT NOT NULL,
  mitigation TEXT,
  plan_phase_id INTEGER REFERENCES plan_phase(id) ON DELETE SET NULL
);

-- Implementation plan: external dependencies
-- Domain: planning
-- Purpose: Records external systems, services, or teams that the implementation plan depends on but
-- cannot directly control. Each row is one external dependency with a risk level and optional
-- mitigation strategy.
-- Context: One-to-many child of the iteration (not a specific phase — external dependencies are
-- plan-wide). Examples: "Auth0 tenant provisioning", "Payment gateway sandbox credentials", "Mobile
-- team delivering SDK v2", "Legal approval for GDPR data flows". The optional plan_phase_number
-- field marks when the dependency becomes blocking. implementation_plan_critic verifies that
-- high/critical external dependencies have concrete mitigations. senior_developer tracks these as
-- pre-conditions to flag blockers early.
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
-- Domain: planning
-- Purpose: Version and provenance record for the implementation plan. Records what version of the
-- requirements, architecture, and UX specifications the plan was produced from, the plan's own
-- version string, and its lifecycle status.
-- Context: One row per planning revision. Inserted by implementation_planner when producing a plan.
-- The status field tracks the plan through its lifecycle: draft (just produced), review (submitted
-- to critic), approved (critic accepted). requirements_version, architecture_version, and
-- ux_specification_version capture the source document versions so that, if any upstream artifact
-- changes, the plan can be identified as potentially stale. implementation_plan_critic updates
-- status to approved or leaves feedback that triggers a new revision (which creates a new row with
-- status: 'draft').
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
-- Domain: implementation
-- Purpose: The root record for one sub-phase of implementation work. Every time the
-- senior_developer completes a plan sub-phase it writes exactly one manifest row summarising the
-- outcome: overall status, total lines of code, warning count, and build result. All other
-- implementation tables hang off this row.
-- Context: The implementation phase is divided into sub-phases that mirror plan_phase rows.
-- plan_phase_id references the plan_phase(id) that was just executed. A manifest is written even
-- when work is partial or blocked so that the critic can inspect what was and was not done.
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

-- Domain: implementation
-- Purpose: Records each individual file that was created, modified, or deleted during a sub-phase.
-- Provides per-file traceability — which component owns the file and what was the intent behind
-- touching it.
-- Context: Written as children of implementation_manifest. One row per file path per manifest. The
-- component_id links to the architecture component responsible for this file, enabling QA to know
-- which components are affected by each file change.
CREATE TABLE IF NOT EXISTS implementation_file (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  file_operation TEXT NOT NULL CHECK(file_operation IN ('created', 'modified', 'deleted')),
  purpose TEXT,
  component_id TEXT REFERENCES component(id) ON DELETE SET NULL,
  UNIQUE(manifest_id, path)
);

-- Domain: implementation
-- Purpose: Join table connecting each implementation file to the requirements it helps satisfy.
-- Enables the QA engineer to ask "which files implement REQ-042?" and the critic to verify
-- coverage.
-- Context: Many files implement multiple requirements; a single requirement is typically spread
-- across multiple files. This M:N join captures both directions. Populated as part of the
-- implementation_manifest insert when requirements[] is provided per file entry.
CREATE TABLE IF NOT EXISTS implementation_file_requirement (
  file_id INTEGER NOT NULL REFERENCES implementation_file(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, requirement_id)
);

-- Domain: implementation
-- Purpose: Records the implementation progress of each requirement as assessed by the
-- senior_developer at the end of a sub-phase. This is the canonical source of truth for "is REQ-042
-- done?" from the implementation perspective.
-- Context: Written per manifest. A requirement may appear in multiple manifests across sub-phases;
-- later rows supersede earlier ones. The QA engineer consults this table — alongside
-- implementation_file_requirement — to determine what has been built and what still needs testing.
CREATE TABLE IF NOT EXISTS implementation_requirement_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('implemented', 'partial', 'not_started', 'blocked', 'not_applicable')),
  notes TEXT,
  UNIQUE(manifest_id, requirement_id)
);

-- Domain: implementation
-- Purpose: Records per-component implementation progress alongside requirement status. Where
-- implementation_requirement_status tracks the "what", this table tracks the "which system part".
-- Context: Useful for architecture-level dashboards: the critic checks that each component reaches
-- complete before the phase exits. A component's status may be partial across sub-phases until all
-- its files and requirements are done.
CREATE TABLE IF NOT EXISTS implementation_component_status (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id) ON DELETE CASCADE,
  component_id TEXT NOT NULL REFERENCES component(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('complete', 'partial', 'not_started')),
  notes TEXT,
  UNIQUE(manifest_id, component_id)
);

-- Domain: implementation
-- Purpose: Records each HTTP API endpoint actually implemented (as opposed to planned) during a
-- sub-phase. Allows comparison against plan_phase_api_endpoint to confirm delivery.
-- Context: The QA engineer uses this table to know which endpoints exist and which are only
-- stubbed, so integration tests can be scoped correctly. stubbed means the route exists but returns
-- mock data; complete means the full logic is wired up.
CREATE TABLE IF NOT EXISTS implementation_api_endpoint (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id) ON DELETE CASCADE,
  route TEXT NOT NULL,
  http_method TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('complete', 'stubbed', 'not_started')),
  UNIQUE(manifest_id, route, http_method)
);

-- Domain: implementation
-- Purpose: Join table linking implemented API endpoints to the requirements they fulfil. Enables
-- traceability from HTTP surface to business requirements.
-- Context: This is the join table and provides per-endpoint traceability.
CREATE TABLE IF NOT EXISTS implementation_api_endpoint_requirement (
  endpoint_id INTEGER NOT NULL REFERENCES implementation_api_endpoint(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  PRIMARY KEY (endpoint_id, requirement_id)
);

-- Domain: implementation
-- Purpose: Catalogues third-party packages or libraries added to the project during implementation.
-- Feeds into security/license audits and complements the pre-approved approved_dependency
-- architecture table with what was actually used.
-- Context: The senior_developer must record every npm install, pip install, go get, etc. here. This
-- allows the critic and QA to spot unapproved dependencies and confirm all dependencies are
-- licensed correctly.
CREATE TABLE IF NOT EXISTS implementation_dependency_added (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  purpose TEXT NOT NULL,
  license TEXT,
  UNIQUE(manifest_id, name)
);

-- Domain: implementation
-- Purpose: Tracks each database migration script created or applied during implementation. Provides
-- the ops and QA teams with a clear list of schema changes that need to be run before the code can
-- be deployed.
-- Context: Migrations may be created (file written but not yet run), pending (queued for the next
-- deploy), or applied (already executed against the database). This status helps QA and audit
-- agents verify that all schema changes have been properly executed.
CREATE TABLE IF NOT EXISTS implementation_db_migration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK(status IN ('created', 'applied', 'pending')),
  UNIQUE(manifest_id, name)
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
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('critical', 'major', 'minor')),
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

-- Domain: implementation
-- Purpose: Stores the results of the senior_developer's self-review checklist at the end of each
-- sub-phase. Functions as a structured pre-flight check before submitting to the critic.
-- Context: Typical checklist items include: "all tests pass", "no hardcoded secrets", "API
-- contracts match spec", "migrations are reversible". Each item is either passed (1) or not (0).
-- The critic may reject if mandatory items are failed.
CREATE TABLE IF NOT EXISTS implementation_review_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES implementation_manifest(id) ON DELETE CASCADE,
  check_name TEXT NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(manifest_id, check_name)
);

-- VCS commits linked to iterations
-- Domain: implementation
-- Purpose: Links a Git (or Jujutsu) commit SHA to an iteration and optionally to a specific phase.
-- Acts as the durable connection between the changelog database and the version control history.
-- Context: Populated exclusively by the commit_link MCP tool, not by changelog_insert. The
-- senior_developer calls commit_link after each commit. The iteration_summary read tool surfaces
-- these rows alongside deliverables to give a complete picture of an iteration's VCS activity.
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
  revision_id INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Asset deliverables: files committed to VCS
-- Domain: implementation
-- Purpose: Records files that have been committed to VCS as finished deliverables. Where
-- intermediate_asset captures in-progress work, asset_deliverable captures the permanent artefacts:
-- source code, tests, documentation, diagrams, toolchain configs.
-- Context: The asset_type field categorises the deliverable (e.g., source code, tests,
-- documentation). file_path is the repository-relative path. commit_sha ties the deliverable to the
-- specific commit that introduced it, enabling the iteration_summary tool to surface "what was
-- shipped" without querying VCS directly.
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

-- Domain: qa-test
-- Purpose: Records whether each requirement has been exercised by the test suite. Provides per-
-- requirement test traceability at the requirement level (as opposed to per-criterion detail in
-- test_acceptance_criterion_result).
-- Context: The qa_engineer creates one row per requirement. The qa_critic cross-checks this list
-- against the full requirement set in requirement to detect untested requirements. This table
-- confirms that all must_have requirements have at least a pass or partial coverage status.
CREATE TABLE IF NOT EXISTS test_requirement_coverage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES test_report(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('pass', 'fail', 'partial', 'not_tested')),
  UNIQUE(report_id, requirement_id)
);

-- Domain: qa-test
-- Purpose: Records the pass/fail status of a single acceptance criterion for a given requirement
-- coverage entry. This is the finest level of requirement traceability in the test domain.
-- Context: Each requirement has one or more acceptance criteria (stored as the acceptance_criteria
-- JSON array on the requirement table). The qa_engineer must produce a result row for every
-- criterion. Unverified criteria appear as not_tested. The criterion text is copied from the source
-- requirement to make the report self-contained.
CREATE TABLE IF NOT EXISTS test_acceptance_criterion_result (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  coverage_id INTEGER NOT NULL REFERENCES test_requirement_coverage(id) ON DELETE CASCADE,
  criterion TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pass', 'fail', 'not_tested')),
  notes TEXT,
  test_ids JSON NOT NULL DEFAULT '[]',
  UNIQUE(coverage_id, criterion)
);

-- Domain: qa-test
-- Purpose: Groups test cases into named suites by their testing type. Each suite belongs to exactly
-- one test report and contains one or more test cases.
-- Context: The qa_engineer organizes test cases into suites reflecting the testing strategy (unit
-- tests, integration tests, end-to-end, security scans, performance benchmarks). Suites are the
-- second level of the hierarchy: test_report → test_suite → test_case.
CREATE TABLE IF NOT EXISTS test_suite (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES test_report(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  suite_type TEXT NOT NULL,
  UNIQUE(report_id, name)
);

-- Domain: qa-test
-- Purpose: Stores the result of a single test case execution, including its status, timing, and any
-- failure diagnostics.
-- Context: Each test_case belongs to a suite. The test_id is the canonical identifier used by the
-- test runner (e.g., "auth.login.valid_credentials"). Flaky tests (intermittently passing/failing)
-- are captured with the flaky status and a retry_count. Full stack traces are preserved to support
-- root-cause analysis.
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

-- Domain: qa-test
-- Purpose: Many-to-many bridge table linking test cases to the requirements they verify. Enables
-- requirement-centric queries ("which test cases cover REQ-042?") and test-centric queries ("what
-- requirements does this test verify?").
-- Context: The qa_engineer populates this for each test case that directly verifies a requirement.
-- Together with test_requirement_coverage and test_acceptance_criterion_result, this forms the full
-- traceability chain: requirement ↔ test case ↔ test suite ↔ test report.
CREATE TABLE IF NOT EXISTS test_case_requirement (
  test_case_id INTEGER NOT NULL REFERENCES test_case(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  PRIMARY KEY (test_case_id, requirement_id)
);

-- Domain: qa-test
-- Purpose: Records a security issue discovered during the QA phase, either from a vulnerability
-- scanner or a dependency audit tool.
-- Context: The qa_engineer runs security tooling (e.g., SAST scanners, npm audit, pip-audit) and
-- records each finding here. Critical or high severity findings typically populate the test_blocker
-- table as well.
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

-- Domain: qa-test
-- Purpose: Stores a measured performance metric alongside its target threshold and a pass/fail
-- verdict. One row per benchmark measurement.
-- Context: The qa_engineer runs benchmarks defined by performance requirements (from the
-- requirement table with category = 'performance'). Each metric (e.g., p95 response time,
-- throughput) is recorded with its actual value, the threshold from the requirement, and whether it
-- passed. Failed benchmarks typically become blockers.
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

-- Domain: qa-test
-- Purpose: Records an issue that prevents the test report from achieving a pass status. Each
-- blocker has a severity level and an optional recommendation for resolution.
-- Context: The qa_engineer creates blocker rows for critical failures, unresolved security
-- findings, or missing test coverage that disqualify the build from passing. The qa_critic
-- validates that every fail status in test_requirement_coverage has a corresponding blocker.
CREATE TABLE IF NOT EXISTS test_blocker (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL REFERENCES test_report(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('critical', 'major', 'minor')),
  recommendation TEXT
);

-- Domain: qa-test
-- Purpose: Many-to-many bridge linking blockers to the requirements they affect. Identifies
-- exactly which requirements are at risk due to each blocker.
-- Context: When a blocker is related to a specific requirement (e.g., a failed functional test for
-- REQ-012), the qa_engineer records that link here. A blocker may affect multiple requirements; a
-- requirement may be referenced by multiple blockers.
CREATE TABLE IF NOT EXISTS test_blocker_requirement (
  blocker_id INTEGER NOT NULL REFERENCES test_blocker(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  PRIMARY KEY (blocker_id, requirement_id)
);

-- Domain: qa-test
-- Purpose: Captures QA improvement suggestions that are not blocking but should be addressed in
-- future iterations. Categorized and prioritized for easy triage.
-- Context: The qa_engineer and qa_critic identify weaknesses in the test suite (gaps in coverage,
-- reliability issues, missing performance benchmarks, etc.) and record them here. Unlike blockers,
-- recommendations do not prevent progress — they are suggestions for future improvement.
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
-- Domain: audit
-- Purpose: Records a single security vulnerability or concern discovered during the audit phase.
-- Each finding is an independent row — auditors record findings incrementally as they complete each
-- OWASP category or code area.
-- Context: The security_auditor performs a deep code-level security audit (OWASP Top 10, data flow
-- tracing, dependency audit, configuration review) and records each finding individually via
-- changelog_insert. This differs from test_security_finding in the QA domain: QA findings come from
-- automated scanners during testing, while audit findings come from manual expert code review
-- during the audit phase. The security_audit_critic queries all findings for the current iteration
-- to validate completeness, accuracy, and actionability.
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
-- Domain: audit
-- Purpose: Records a single performance bottleneck, anti-pattern, or optimization opportunity
-- discovered during the audit phase. Each finding is an independent row — auditors record findings
-- incrementally as they complete each performance area.
-- Context: The performance_auditor performs a deep code-level performance audit (database queries,
-- memory patterns, concurrency, API design, algorithm analysis) and records each finding
-- individually via changelog_insert. This differs from test_performance_benchmark in the QA domain:
-- QA benchmarks measure against defined thresholds from requirements, while audit findings identify
-- code-level anti-patterns and bottlenecks regardless of requirements. The performance_audit_critic
-- queries all findings for the current iteration to validate completeness, evidence backing, and
-- actionability.
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
-- Domain: documentation
-- Purpose: The root aggregate for a documentation pass. One row is created per changelog_insert
-- call with entity_type = "documentation_manifest". It records the overall status (complete /
-- partial / blocked), a count of documents created, total pages, and accessibility compliance.
-- Context: Every other documentation table references this row. The manifest ties documentation
-- artifacts back to a specific revision via revision_id (NOT NULL), so the full history of
-- documentation revisions is preserved. The iteration is derived via the revision → phase →
-- iteration chain (or via the entity_context VIEW). The documentation_critic reads this row (and
-- its children) to validate coverage and quality; it then calls revision_update with a verdict of
-- approved or rejected.
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

-- Domain: documentation
-- Purpose: A flexible key/value store for named documentation sections within a manifest. Examples
-- include entries like category = "readme", key = "installation", value = "..." or category =
-- "api", key = "authentication", value = "...". The path field records the file path where this
-- section lives on disk.
-- Context: The documentation_master uses this table to enumerate every discrete section of the
-- documentation suite — README sections, API doc sections, guides, changelogs, etc. The
-- documentation_critic scans these records to verify section coverage against the requirements and
-- feature list.
CREATE TABLE IF NOT EXISTS documentation_section (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES documentation_manifest(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  path TEXT,
  UNIQUE(manifest_id, category, key)
);

-- Domain: documentation
-- Purpose: Records a documentation entry for a single feature of the product. Captures where the
-- feature's documentation lives (path) and whether it includes concrete examples and screenshots.
-- Child rows in documentation_feature_requirement link each feature documentation to the
-- requirements it satisfies.
-- Context: The documentation_master creates one row per documented feature. This allows the
-- documentation_critic to verify that every user-facing feature has documentation at a known path,
-- with examples where required. The includes_examples and includes_screenshots flags are used in
-- accessibility and quality checks.
CREATE TABLE IF NOT EXISTS documentation_feature (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES documentation_manifest(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  path TEXT NOT NULL,
  includes_examples INTEGER NOT NULL DEFAULT 0,
  includes_screenshots INTEGER NOT NULL DEFAULT 0,
  UNIQUE(manifest_id, name)
);

-- Domain: documentation
-- Purpose: A many-to-many join table linking documented features to the requirements they satisfy.
-- Enables bidirectional traceability: given a feature, find its requirements; given a requirement,
-- find which features document it.
-- Context: The documentation_master populates this after recording each documentation_feature. The
-- documentation_critic uses it to verify that all must_have requirements appear in at least one
-- feature's documentation. The requirement_id is a TEXT foreign key matching the REQ-XXX
-- identifiers from the requirement table.
CREATE TABLE IF NOT EXISTS documentation_feature_requirement (
  feature_id INTEGER NOT NULL REFERENCES documentation_feature(id) ON DELETE CASCADE,
  requirement_id TEXT NOT NULL REFERENCES requirement(id) ON DELETE CASCADE,
  PRIMARY KEY (feature_id, requirement_id)
);

-- Domain: documentation
-- Purpose: Records per-requirement documentation coverage status. One row per requirement that the
-- documentation_master assessed. Records whether the requirement is documented (documented flag),
-- whether it is user-facing, and any free-form notes. The paths JSON array lists the actual file
-- paths where coverage appears.
-- Context: This table is the primary coverage report used by the documentation_critic. A
-- requirement with documented = 0 is a gap. user_facing = 1 flags requirements that must appear in
-- end-user documentation (guides, README) rather than internal developer docs. The notes field
-- captures reasons for non-coverage (e.g., "internal implementation detail, no user doc needed").
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

-- Domain: documentation
-- Purpose: Catalogs generated documentation assets — diagrams, screenshots, videos, code samples,
-- and other media — that are referenced within the documentation. Each row records the asset's file
-- path, type, human-readable description, and accessibility alt text.
-- Context: The documentation_master creates one row per asset it generates or references. The
-- alt_text field is specifically required for accessibility compliance (accessibility_compliant = 1
-- on the manifest). The documentation_critic checks that all assets of type screenshot or diagram
-- have non-null alt_text. The asset_type CHECK constraint enforces a closed vocabulary aligned with
-- the output formats the workflow supports.
CREATE TABLE IF NOT EXISTS documentation_asset (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES documentation_manifest(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  asset_type TEXT NOT NULL CHECK(asset_type IN ('screenshot', 'diagram', 'video', 'code-sample', 'other')),
  description TEXT,
  alt_text TEXT,
  UNIQUE(manifest_id, path)
);

-- Domain: documentation
-- Purpose: Records the results of named verification checks run against the documentation. Each row
-- is a single check (e.g., "all_requirements_documented", "links_valid", "examples_compile") with a
-- boolean passed flag. The full set of rows for a manifest forms the documentation quality gate.
-- Context: The documentation_critic populates this table (or the documentation_master self-
-- validates and the critic confirms). A manifest is ready for release only when all critical checks
-- have passed = 1. The check names are free-form strings, giving flexibility to add new checks
-- without schema changes. The documentation_critic's rejection feedback will reference specific
-- failed check names from this table.
CREATE TABLE IF NOT EXISTS documentation_review_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  manifest_id INTEGER NOT NULL REFERENCES documentation_manifest(id) ON DELETE CASCADE,
  check_name TEXT NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(manifest_id, check_name)
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
-- ENTITY SNAPSHOT: JSON history of entity changes across revisions
-- ============================================================

-- Domain: cross-cutting
-- Purpose: Preserves the full change history of entities without complicating the main entity
-- tables. Before an UPSERT overwrites an entity, the old state is captured as a JSON snapshot in
-- this table.
-- Context: Enables querying change history for specific entities while keeping the main entity
-- tables clean and current. Supports the ability to see how any entity evolved across critic
-- feedback cycles within an iteration.
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
CREATE INDEX IF NOT EXISTS idx_nonfunctional_requirement_iteration_id
  ON nonfunctional_requirement(iteration_id);


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
--   documentation_manifest
-- Skipped: implementation_requirement_status, implementation_component_status,
--   documentation_requirement_coverage (manifest_id is leftmost in UNIQUE)
-- Skipped: implementation_dependency_added, implementation_db_migration,
--   documentation_section (manifest_id is leftmost in UNIQUE added for dedup)
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
CREATE INDEX IF NOT EXISTS idx_plan_overview_risk_plan_phase_id
  ON plan_overview_risk(plan_phase_id);
CREATE INDEX IF NOT EXISTS idx_plan_external_dependency_plan_phase_id
  ON plan_external_dependency(plan_phase_id);

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
CREATE INDEX IF NOT EXISTS idx_requirement_trace_addressed_by
  ON requirement_trace(addressed_by_type, addressed_by);

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
-- Skipped: config (revision_id is leftmost in UNIQUE(revision_id, domain, config_type, category, key))
CREATE INDEX IF NOT EXISTS idx_approved_dependency_revision_id
  ON approved_dependency(revision_id);
-- requirement_trace revision_id covered by idx_requirement_trace_revision_id above

-- UX design domain
CREATE INDEX IF NOT EXISTS idx_user_flow_revision_id
  ON user_flow(revision_id);
CREATE INDEX IF NOT EXISTS idx_screen_revision_id
  ON screen(revision_id);
-- (ux_config merged into config table — index covered by UNIQUE constraint, see above)
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

-- QA domain
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

-- blocker.phase_name — composite FK (iteration_id, phase_name) → phase(iteration_id, name)
CREATE INDEX IF NOT EXISTS idx_blocker_phase_name
  ON blocker(phase_name);

-- project_lesson.phase_name — composite FK (iteration_id, phase_name) → phase(iteration_id, name)
CREATE INDEX IF NOT EXISTS idx_project_lesson_phase_name
  ON project_lesson(phase_name);
