# Data Model Overview

All artifacts produced during the rigorous development workflow are stored in a normalized SQLite changelog database. The DDL lives at `mcp-server/schema.sql` and is auto-applied on first run.

**Database location:** `.claude/rigorous-dev.db`
**Engine:** better-sqlite3 (synchronous), WAL mode, foreign keys enforced

## Core Spine

📄 **Detailed design:** [tables/core.md](tables/core.md)

Four tables form the backbone — everything else hangs off them:

| Table | PK | Purpose |
|-------|-----|---------|
| `project` | `id INTEGER` | Single row per database (singleton). Identity, status (active/closed), critic model, timestamps. |
| `iteration` | `id INTEGER` | Each change-request cycle. The auto-incrementing `id` serves as the sequential counter. |
| `phase` | `id INTEGER` | 9 phases per iteration: requirements, ux_design, architecture, planning, implementation, documentation, qa, audit, release. Tracks status, timestamps, approval. |
| `revision` | `id INTEGER` | Producer-critic loop attempts within a phase. Tracks producer/critic agents, feedback text, verdict (draft → submitted → approved/rejected). |

**Hierarchy:** project → iteration → phase → revision

Every changelog entity below carries `iteration_id` and `revision_id` (both NOT NULL) to trace exactly when and why it was created. The exceptions are `project_context`, `system_io`, `blocker`, and `project_lesson`, which carry only `iteration_id` with no revision tracking.

## Requirements Domain

📄 **Detailed design:** [tables/requirements.md](tables/requirements.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `persona` | requirements_analyst | User personas (id: `PERSONA-XXX`). Name, description, role. Goals stored as JSON array (`goals` column). |
| `requirement` | requirements_analyst | Core requirements (id: `REQ-XXX`). Priority (must-have/should-have/nice-to-have), category (functional/security/performance/usability/operational/deployment), description, rationale. Acceptance criteria stored as JSON array (`acceptance_criteria` column). |
| `requirement_persona` | requirements_analyst | Which personas each requirement serves (M:N join). |
| `requirement_dependency` | requirements_analyst | Dependencies between requirements. |
| `project_context` | requirements_analyst | Project-level problem statement, success criteria, scope type (MVP/full). |
| `system_io` | requirements_analyst | What goes in/out of the system being built. Direction discriminator ('input'/'output') distinguishes the two. |
| `deployment_requirement` | requirements_analyst | Deployment infrastructure requirements with target context (private-cloud, local-executable, both, other). |
| `operational_requirement` | requirements_analyst | Operational requirements: uptime/SLA targets, monitoring, logging, observability items (categorised per row). |
| `technology_constraint` | requirements_analyst | User-imposed tech constraints (e.g., "must use PostgreSQL"). |

**Critic:** requirements_critic

## Architecture Domain

📄 **Detailed design:** [tables/architecture.md](tables/architecture.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `adr` | backend_architect | Architecture Decision Records (id: `ADR-XXX`). Status, context, decision, rationale. Consequences and research sources stored as JSON arrays (`consequences`, `research_sources` columns). |
| `adr_alternative` | backend_architect | Alternatives considered per ADR, with inline pros/cons (JSON arrays). |
| `component` | backend_architect | System components (id: `COMP-XXX`). Type, responsibility, tech stack. |
| `component_interface` | backend_architect | APIs/ports each component exposes. |
| `component_dependency` | backend_architect | Component-to-component dependency graph (must be a DAG). |
| `component_requirement` | backend_architect | Which requirements each component satisfies (traceability). |
| `integration_test_boundary` | backend_architect | Where integration tests are needed between components. |
| `technology_choice` | backend_architect | Language, framework, DB choices with rationale. |
| `architecture_overview` | backend_architect | High-level summary, style, communication patterns. Design principles stored as JSON array (`principles` column). |
| `architecture_diagram` | backend_architect | Diagram references. |

**Critic:** architecture_critic

## Data Model Domain

📄 **Detailed design:** [tables/data-model.md](tables/data-model.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `data_entity` | backend_architect | Database entities/models (like an ERD). |
| `data_entity_attribute` | backend_architect | Columns/fields per entity with types, constraints, nullability. |
| `data_entity_relationship` | backend_architect | Foreign key / relationship mappings between entities. |

## Cross-Cutting Architecture

📄 **Detailed design:** [tables/cross-cutting.md](tables/cross-cutting.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `architecture_config` | backend_architect | Unified config store for security, deployment, and observability architecture (discriminated by `config_type`). |
| `approved_dependency` | backend_architect | Vetted third-party dependencies with justification, license, health assessment. |
| `traceability_mapping` | backend_architect | REQ → COMP → ADR → SCREEN cross-references (the "why" chain). |
| `blocker` | (any agent via orchestrator) | Cross-phase workflow blockers — raised when agents encounter issues that prevent progress. Lifecycle events with soft-delete (active when `resolved_at IS NULL`). |
| `project_lesson` | (any critic via orchestrator) | Cross-phase lessons learned — patterns, anti-patterns, conventions, risks, decisions, and process observations recorded by critics for downstream agents. |
| `entity_snapshot` | (automatic — MCP server internals) | Before-update JSON snapshots of TEXT-PK entities for audit trail. Populated automatically during UPSERT, not written by agents. |

## UX Design Domain

📄 **Detailed design:** [tables/ux-design.md](tables/ux-design.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `user_flow` | ux_designer | User journeys (id: `FLOW-XXX`). Trigger, preconditions, success criteria. Data dependencies stored as JSON array (`data_dependencies` column). |
| `user_flow_step` | ux_designer | Steps within each flow. |
| `user_flow_step_branch` | ux_designer | Conditional branches at each step. |
| `user_flow_error_state` | ux_designer | Error states per flow. |
| `user_flow_requirement` | ux_designer | Flow-to-requirement mapping. |
| `screen` | ux_designer | UI screens (id: `SCREEN-XXX`). Layout, route, purpose. UI components stored as JSON array (`components` column). |
| `screen_state` | ux_designer | State variants (loading, empty, error, populated). |
| `screen_responsive_variant` | ux_designer | Responsive breakpoint behavior. |
| `ux_config` | ux_designer | Unified UX config: design system tokens, accessibility, responsive, feedback patterns. Discriminated by `config_type`. |
| `info_architecture` | ux_designer | Navigation structure, sitemap. |
| `persona_addressed` / `persona_addressed_flow` | ux_designer | Which personas each UX design addresses. |
| `ux_asset` | ux_designer | Mockup/asset references. |

**Critic:** ux_critic

## Planning Domain

📄 **Detailed design:** [tables/planning.md](tables/planning.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `plan_phase` | implementation_planner | Implementation work phases (dev work chunks, not workflow phases). Entry/exit criteria and checkpoint focus stored as JSON arrays (`entry_criteria`, `exit_criteria`, `checkpoint_focus` columns). |
| `plan_phase_requirement` / `_component` / `_flow` / `_screen` | implementation_planner | What each plan phase covers. |
| `plan_phase_api_endpoint` | implementation_planner | APIs built in each phase. |
| `plan_phase_db_change` | implementation_planner | Database migrations per phase. Affected tables stored as JSON array (`tables` column). |
| `plan_phase_relationship` | implementation_planner | Phase ordering and parallelism (dependency/parallel via `dependency_type` discriminator). |
| `plan_phase_risk` | implementation_planner | Phase-level risks and mitigations. |
| `plan_overview` | implementation_planner | High-level plan summary. Assumptions stored as JSON array (`assumptions` column). |
| `plan_overview_risk` | implementation_planner | Plan-level risks. |
| `plan_external_dependency` | implementation_planner | External blockers. |
| `plan_critical_path` | implementation_planner | Critical path phases. |
| `plan_metadata` | implementation_planner | Plan versioning, upstream artifact versions used. |

**Critic:** implementation_plan_critic

## Implementation Domain

📄 **Detailed design:** [tables/implementation.md](tables/implementation.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `implementation_manifest` | senior_developer | Per-phase implementation summary — status, files changed, tests, and version provenance metadata. |
| `implementation_file` | senior_developer | Each file created/modified with purpose. |
| `implementation_file_requirement` | senior_developer | File-to-requirement traceability. |
| `implementation_requirement_status` | senior_developer | Per-requirement implementation progress. |
| `implementation_component_status` | senior_developer | Per-component implementation progress. |
| `implementation_api_endpoint` | senior_developer | APIs actually implemented (vs. planned). |
| `implementation_dependency_added` | senior_developer | Dependencies added during implementation. |
| `implementation_db_migration` | senior_developer | Migrations actually run. |
| `implementation_blocker` / `_blocker_requirement` | senior_developer | Issues encountered and affected requirements. |
| `implementation_review_checklist` | senior_developer | Self-review items. |
| `vcs_commit` | (commit_link tool) | Git/jj commits linked to iterations. |
| `intermediate_asset` / `asset_deliverable` | senior_developer | Build artifacts and deliverables. |

**Critic:** senior_developer_critic (also test_writer / test_writer_critic for the test-writing step)

## QA/Test Domain

📄 **Detailed design:** [tables/qa-test.md](tables/qa-test.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `test_report` | qa_engineer | Overall test report — pass/fail counts, coverage percentage, and version provenance metadata. |
| `test_requirement_coverage` | qa_engineer | Which requirements have test coverage. |
| `test_acceptance_criterion_result` | qa_engineer | Pass/fail per acceptance criterion. Associated test IDs stored as JSON array (`test_ids` column). |
| `test_suite` / `test_case` | qa_engineer | Test suites and individual cases with status, duration. |
| `test_case_requirement` | qa_engineer | Test-to-requirement traceability. |
| `test_security_finding` | qa_engineer | Security issues found during testing. |
| `test_performance_benchmark` | qa_engineer | Performance results vs. targets. |
| `test_blocker` / `_blocker_requirement` | qa_engineer | Blockers and affected requirements. |
| `test_recommendation` | qa_engineer | QA recommendations. |

**Critic:** qa_critic

## Audit Domain

📄 **Detailed design:** [tables/audit.md](tables/audit.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `security_audit_finding` | security_auditor | Individual security vulnerability findings from deep code-level audit. |
| `performance_audit_finding` | performance_auditor | Individual performance bottleneck findings from deep code-level audit. |

**Critics:** security_audit_critic, performance_audit_critic

## Documentation Domain

📄 **Detailed design:** [tables/documentation.md](tables/documentation.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `documentation_manifest` | documentation_master | Doc coverage summary and version provenance metadata. |
| `documentation_section` | documentation_master | Doc sections (README, API docs, guides). |
| `documentation_feature` | documentation_master | Feature documentation with examples. |
| `documentation_feature_requirement` | documentation_master | Feature-to-requirement traceability. |
| `documentation_requirement_coverage` | documentation_master | Per-requirement doc coverage. File paths stored as JSON array (`paths` column). |
| `documentation_asset` | documentation_master | Generated doc assets (diagrams, etc.). |
| `documentation_review_checklist` | documentation_master | Doc accuracy verification results. |

**Critic:** documentation_critic

## Deployment/Release Domain

📄 **Detailed design:** [tables/deployment.md](tables/deployment.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `deployment_manifest` | release_engineer | Release readiness summary. Targets, blockers, and version provenance metadata stored as columns. |
| `deployment_pipeline` | release_engineer | CI/CD pipeline definition. Config files stored as JSON array (`config_files` column). |
| `deployment_pipeline_stage` | release_engineer | Pipeline stages. Triggers and steps stored as JSON arrays (`triggers`, `steps` columns). |
| `deployment_quality_gate` | release_engineer | Global quality gate rules. |
| `deployment_environment` / `_env_infra` / `_env_var` | release_engineer | Environment configs. |
| `deployment_artifact` | release_engineer | Build artifacts. Platform targets stored as JSON array (`platforms` column). |
| `deployment_signing` | release_engineer | Code signing config. |
| `deployment_local_executable` | release_engineer | Local distribution metadata. Platforms and channels stored as JSON arrays (`platforms`, `channels` columns). |
| `deployment_secret` | release_engineer | Secrets inventory (names/purposes, not values). |
| `deployment_health_check` | release_engineer | Health check config. |
| `deployment_alerting` | release_engineer | Alerting config. |
| `deployment_runbook` / `_runbook_step` | release_engineer | Operational runbooks. |
| `deployment_review_checklist` | release_engineer | Release review items. |

**Critic:** release_critic

## MCP Tools for Data Access

### Write Tools

| Tool | Purpose |
|------|---------|
| `changelog_insert` | Insert any entity type. Main workhorse — handles all entity types with nested child data. |
| `iteration_create` | Create project + iteration + all phase rows in one call. |
| `phase_transition` | Update phase status (pending → in_progress → completed/skipped). |
| `revision_create` | Start a new producer-critic revision within a phase. |
| `revision_update` | Record critic verdict (approved/rejected) with feedback. |
| `commit_link` | Link a VCS commit to the current iteration. |
| `project_update` | Update project status (e.g., close it). |
| `plan_phase_transition` | Update a plan_phase row's status (pending → test_writing → implementing → completed). |
| `blocker_resolve` | Mark a blocker as resolved with optional resolution notes. |
| `iteration_close` | Close an active iteration (sets status to closed, records closed_at). |
| `changelog_update` | Update mutable fields on an existing changelog entity (e.g. status transitions for audit findings and ADRs). |

### Read Tools

| Tool | Purpose |
|------|---------|
| `changelog_query` | Query entities by type, iteration, IDs, or field filters. |

> **Note:** All entity types in the `ENTITY_TABLE` map are fully queryable via `changelog_query`, including `vcs_commit`, `intermediate_asset`, and `asset_deliverable`.
>
| `traceability_query` | Trace decisions across entity types — "why are we using X?" |
| `revision_history` | Full revision chain for any entity. |
| `iteration_summary` | Phase-level summary for an iteration. |
| `project_status` | Current project state, phases, and progress. |

## Key Design Principles

1. **Pragmatic normalization** — Core entities and M:N relationships use proper tables with foreign keys. Simple 1:N string lists (goals, criteria, triggers, steps, etc.) are stored as JSON arrays on the parent row, avoiding unnecessary child tables while keeping data self-contained and queryable via `JSON_EACH()`.
2. **Append-only** — Revisions are never deleted or overwritten. New revisions create new rows. Full history preserved.
3. **Traceability** — Every entity carries `iteration_id` and `revision_id`. You can always answer "who produced this, when, and in response to what feedback."
4. **Idempotent DDL** — All tables use `CREATE TABLE IF NOT EXISTS` so the schema can be re-applied safely.
5. **UTC timestamps in ISO 8601** — All timestamp columns use `TEXT` type. The DDL declares `DEFAULT (datetime('now'))` as a fallback, but application code explicitly sets timestamps via JavaScript's `new Date().toISOString()`, producing full ISO 8601 format (`YYYY-MM-DDTHH:MM:SS.sssZ`). Timestamps are always UTC. Columns auto-populated on insert (e.g., `created_at`) are set explicitly by handler code; columns set later (e.g., `resolved_at` on blockers) use the same `toISOString()` format. No `DATETIME` or `INTEGER` (epoch) types are used — all temporal values are human-readable UTC text.

## Extending the Schema

To add new entity types:

1. Add `CREATE TABLE IF NOT EXISTS` statements to `mcp-server/schema.sql`
2. **Write side** (`mcp-server/write-tools.js`): Add a handler function (e.g., `insertMyEntity`), add it to the `handlers` map inside `changelogInsert()`, and add the type name to the `enum` array in the `changelog_insert` tool definition
3. **Read side** (`mcp-server/read-tools.js`): Add the entity type to the `ENTITY_TABLE` map so it is queryable via `changelog_query`
4. For simple 1:N string lists, prefer a JSON array column on the parent (with `NOT NULL DEFAULT '[]'`) over a separate child table
5. Update agent checklists to verify the new fields

## Alphabetical Table Index

All 111 tables with links to their detailed design documents.

| Table | Domain |
|-------|--------|
| `adr` | [architecture](tables/architecture.md) |
| `adr_alternative` | [architecture](tables/architecture.md) |
| `approved_dependency` | [cross-cutting](tables/cross-cutting.md) |
| `architecture_config` | [cross-cutting](tables/cross-cutting.md) |
| `architecture_diagram` | [architecture](tables/architecture.md) |
| `architecture_overview` | [architecture](tables/architecture.md) |
| `asset_deliverable` | [implementation](tables/implementation.md) |
| `blocker` | [cross-cutting](tables/cross-cutting.md) |
| `component` | [architecture](tables/architecture.md) |
| `component_dependency` | [architecture](tables/architecture.md) |
| `component_interface` | [architecture](tables/architecture.md) |
| `component_requirement` | [architecture](tables/architecture.md) |
| `data_entity` | [data-model](tables/data-model.md) |
| `data_entity_attribute` | [data-model](tables/data-model.md) |
| `data_entity_relationship` | [data-model](tables/data-model.md) |
| `deployment_alerting` | [deployment](tables/deployment.md) |
| `deployment_artifact` | [deployment](tables/deployment.md) |
| `deployment_env_infra` | [deployment](tables/deployment.md) |
| `deployment_env_var` | [deployment](tables/deployment.md) |
| `deployment_environment` | [deployment](tables/deployment.md) |
| `deployment_health_check` | [deployment](tables/deployment.md) |
| `deployment_local_executable` | [deployment](tables/deployment.md) |
| `deployment_manifest` | [deployment](tables/deployment.md) |
| `deployment_pipeline` | [deployment](tables/deployment.md) |
| `deployment_pipeline_stage` | [deployment](tables/deployment.md) |
| `deployment_quality_gate` | [deployment](tables/deployment.md) |
| `deployment_requirement` | [requirements](tables/requirements.md) |
| `deployment_review_checklist` | [deployment](tables/deployment.md) |
| `deployment_runbook` | [deployment](tables/deployment.md) |
| `deployment_runbook_step` | [deployment](tables/deployment.md) |
| `deployment_secret` | [deployment](tables/deployment.md) |
| `deployment_signing` | [deployment](tables/deployment.md) |
| `deployment_stage_quality_gate` | [deployment](tables/deployment.md) |
| `documentation_asset` | [documentation](tables/documentation.md) |
| `documentation_feature` | [documentation](tables/documentation.md) |
| `documentation_feature_requirement` | [documentation](tables/documentation.md) |
| `documentation_manifest` | [documentation](tables/documentation.md) |
| `documentation_requirement_coverage` | [documentation](tables/documentation.md) |
| `documentation_section` | [documentation](tables/documentation.md) |
| `documentation_review_checklist` | [documentation](tables/documentation.md) |
| `entity_snapshot` | [cross-cutting](tables/cross-cutting.md) |
| `implementation_api_endpoint` | [implementation](tables/implementation.md) |
| `implementation_api_endpoint_requirement` | [implementation](tables/implementation.md) |
| `implementation_blocker` | [implementation](tables/implementation.md) |
| `implementation_blocker_requirement` | [implementation](tables/implementation.md) |
| `implementation_component_status` | [implementation](tables/implementation.md) |
| `implementation_db_migration` | [implementation](tables/implementation.md) |
| `implementation_dependency_added` | [implementation](tables/implementation.md) |
| `implementation_file` | [implementation](tables/implementation.md) |
| `implementation_file_requirement` | [implementation](tables/implementation.md) |
| `implementation_manifest` | [implementation](tables/implementation.md) |
| `implementation_requirement_status` | [implementation](tables/implementation.md) |
| `implementation_review_checklist` | [implementation](tables/implementation.md) |
| `info_architecture` | [ux-design](tables/ux-design.md) |
| `integration_test_boundary` | [architecture](tables/architecture.md) |
| `intermediate_asset` | [implementation](tables/implementation.md) |
| `iteration` | [core](tables/core.md) |
| `operational_requirement` | [requirements](tables/requirements.md) |
| `performance_audit_finding` | [audit](tables/audit.md) |
| `persona` | [requirements](tables/requirements.md) |
| `persona_addressed` | [ux-design](tables/ux-design.md) |
| `persona_addressed_flow` | [ux-design](tables/ux-design.md) |
| `phase` | [core](tables/core.md) |
| `plan_critical_path` | [planning](tables/planning.md) |
| `plan_external_dependency` | [planning](tables/planning.md) |
| `plan_metadata` | [planning](tables/planning.md) |
| `plan_overview` | [planning](tables/planning.md) |
| `plan_overview_risk` | [planning](tables/planning.md) |
| `plan_phase` | [planning](tables/planning.md) |
| `plan_phase_api_endpoint` | [planning](tables/planning.md) |
| `plan_phase_component` | [planning](tables/planning.md) |
| `plan_phase_db_change` | [planning](tables/planning.md) |
| `plan_phase_flow` | [planning](tables/planning.md) |
| `plan_phase_relationship` | [planning](tables/planning.md) |
| `plan_phase_requirement` | [planning](tables/planning.md) |
| `plan_phase_risk` | [planning](tables/planning.md) |
| `plan_phase_screen` | [planning](tables/planning.md) |
| `project` | [core](tables/core.md) |
| `project_context` | [requirements](tables/requirements.md) |
| `project_lesson` | [cross-cutting](tables/cross-cutting.md) |
| `requirement` | [requirements](tables/requirements.md) |
| `requirement_dependency` | [requirements](tables/requirements.md) |
| `requirement_persona` | [requirements](tables/requirements.md) |
| `revision` | [core](tables/core.md) |
| `screen` | [ux-design](tables/ux-design.md) |
| `screen_responsive_variant` | [ux-design](tables/ux-design.md) |
| `screen_state` | [ux-design](tables/ux-design.md) |
| `security_audit_finding` | [audit](tables/audit.md) |
| `system_io` | [requirements](tables/requirements.md) |
| `technology_choice` | [architecture](tables/architecture.md) |
| `technology_constraint` | [requirements](tables/requirements.md) |
| `test_acceptance_criterion_result` | [qa-test](tables/qa-test.md) |
| `test_blocker` | [qa-test](tables/qa-test.md) |
| `test_blocker_requirement` | [qa-test](tables/qa-test.md) |
| `test_case` | [qa-test](tables/qa-test.md) |
| `test_case_requirement` | [qa-test](tables/qa-test.md) |
| `test_performance_benchmark` | [qa-test](tables/qa-test.md) |
| `test_recommendation` | [qa-test](tables/qa-test.md) |
| `test_report` | [qa-test](tables/qa-test.md) |
| `test_requirement_coverage` | [qa-test](tables/qa-test.md) |
| `test_security_finding` | [qa-test](tables/qa-test.md) |
| `test_suite` | [qa-test](tables/qa-test.md) |
| `traceability_mapping` | [cross-cutting](tables/cross-cutting.md) |
| `user_flow` | [ux-design](tables/ux-design.md) |
| `user_flow_error_state` | [ux-design](tables/ux-design.md) |
| `user_flow_requirement` | [ux-design](tables/ux-design.md) |
| `user_flow_step` | [ux-design](tables/ux-design.md) |
| `user_flow_step_branch` | [ux-design](tables/ux-design.md) |
| `ux_asset` | [ux-design](tables/ux-design.md) |
| `ux_config` | [ux-design](tables/ux-design.md) |
| `vcs_commit` | [implementation](tables/implementation.md) |

**Total: 111 tables across 12 domains**
