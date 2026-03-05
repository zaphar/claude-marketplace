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

Every changelog entity below carries `iteration_id` and `revision_id` (both NOT NULL) to trace exactly when and why it was created. The one exception is `iteration_metadata`, which is a simple key-value store with no revision tracking.

## Requirements Domain

📄 **Detailed design:** [tables/requirements.md](tables/requirements.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `persona` | requirements_analyst | User personas (id: `PERSONA-XXX`). Name, description, role. |
| `persona_goal` | requirements_analyst | Goals for each persona (1:N child). |
| `requirement` | requirements_analyst | Core requirements (id: `REQ-XXX`). Priority (must-have/should-have/nice-to-have), category (functional/security/performance/usability/operational/deployment), description, rationale. |
| `requirement_acceptance_criterion` | requirements_analyst | Testable acceptance criteria per requirement (1:N). |
| `requirement_persona` | requirements_analyst | Which personas each requirement serves (M:N join). |
| `requirement_dependency` | requirements_analyst | Dependencies between requirements. |
| `iteration_metadata` | requirements_analyst | Per-iteration problem statement, success criteria, scope type (MVP/full). |
| `iteration_input` / `iteration_output` | requirements_analyst | What goes in/out of each iteration. |
| `deployment_requirement` | requirements_analyst | Deployment-specific requirements. |
| `deployment_infra_requirement` | requirements_analyst | Infrastructure needs per deployment requirement. |
| `operational_requirement` | requirements_analyst | SLAs, uptime targets. |
| `operational_monitoring` | requirements_analyst | Monitoring configuration per operational requirement. |
| `technology_constraint` | requirements_analyst | User-imposed tech constraints (e.g., "must use PostgreSQL"). |

**Critic:** requirements_critic

## Architecture Domain

📄 **Detailed design:** [tables/architecture.md](tables/architecture.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `adr` | backend_architect | Architecture Decision Records (id: `ADR-XXX`). Status, context, decision, rationale. |
| `adr_alternative` | backend_architect | Alternatives considered per ADR. |
| `adr_alternative_pro` / `adr_alternative_con` | backend_architect | Pros/cons per alternative. |
| `adr_consequence` | backend_architect | Consequences of each decision. |
| `adr_research_source` | backend_architect | Research citations backing decisions — enables "why are we using X?" queries. |
| `component` | backend_architect | System components (id: `COMP-XXX`). Type, responsibility, tech stack. |
| `component_interface` | backend_architect | APIs/ports each component exposes. |
| `component_dependency` | backend_architect | Component-to-component dependency graph (must be a DAG). |
| `component_requirement` | backend_architect | Which requirements each component satisfies (traceability). |
| `integration_test_boundary` | backend_architect | Where integration tests are needed between components. |
| `technology_choice` | backend_architect | Language, framework, DB choices with rationale. |
| `architecture_overview` | backend_architect | High-level summary, style, communication patterns. |
| `architecture_principle` | backend_architect | Design principles. |
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
| `security_config` | backend_architect | Auth approach, authorization model, data protection, secrets management. |
| `deployment_config` | backend_architect | Target environments, strategy, containerization, scaling. |
| `observability_config` | backend_architect | Logging, metrics, tracing, health check config. |
| `approved_dependency` | backend_architect | Vetted third-party dependencies with justification, license, health assessment. |
| `traceability_mapping` | backend_architect | REQ → COMP → ADR → SCREEN cross-references (the "why" chain). |

## UX Design Domain

📄 **Detailed design:** [tables/ux-design.md](tables/ux-design.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `user_flow` | ux_designer | User journeys (id: `FLOW-XXX`). Trigger, preconditions, success criteria. |
| `user_flow_step` | ux_designer | Steps within each flow. |
| `user_flow_step_branch` | ux_designer | Conditional branches at each step. |
| `user_flow_error_state` | ux_designer | Error states per flow. |
| `user_flow_requirement` | ux_designer | Flow-to-requirement mapping. |
| `user_flow_data_dependency` | ux_designer | Data needs per flow. |
| `screen` | ux_designer | UI screens (id: `SCREEN-XXX`). Layout, route, purpose. |
| `screen_component` | ux_designer | UI components on each screen. |
| `screen_state` | ux_designer | State variants (loading, empty, error, populated). |
| `screen_responsive_variant` | ux_designer | Responsive breakpoint behavior. |
| `design_system` | ux_designer | Colors, typography, spacing, component library. |
| `accessibility_config` | ux_designer | WCAG level, focus management, ARIA patterns. |
| `responsive_config` | ux_designer | Breakpoints and layout strategy. |
| `feedback_pattern` | ux_designer | Loading indicators, success/error toast patterns. |
| `info_architecture` | ux_designer | Navigation structure, sitemap. |
| `persona_addressed` / `persona_addressed_flow` | ux_designer | Which personas each UX design addresses. |
| `ux_asset` | ux_designer | Mockup/asset references. |
| `ux_requirement_mapping` | ux_designer | UX-to-requirement coverage. |

**Critic:** ux_critic

## Planning Domain

📄 **Detailed design:** [tables/planning.md](tables/planning.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `plan_phase` | implementation_planner | Implementation work phases (dev work chunks, not workflow phases). |
| `plan_phase_requirement` / `_component` / `_flow` / `_screen` | implementation_planner | What each plan phase covers. |
| `plan_phase_entry_criterion` / `_exit_criterion` | implementation_planner | Gate conditions for each phase. |
| `plan_phase_api_endpoint` | implementation_planner | APIs built in each phase. |
| `plan_phase_db_change` / `_db_change_table` | implementation_planner | Database migrations per phase. |
| `plan_phase_dependency` / `_parallel` / `_risk` | implementation_planner | Phase ordering, parallelism, risks. |
| `plan_checkpoint_focus` | implementation_planner | What to verify at each checkpoint. |
| `plan_overview` | implementation_planner | High-level plan summary. |
| `plan_overview_risk` / `_assumption` | implementation_planner | Plan-level risks and assumptions. |
| `plan_requirement_mapping` | implementation_planner | REQ → plan phase mapping (when will each requirement be built?). |
| `plan_external_dependency` | implementation_planner | External blockers. |
| `plan_critical_path` | implementation_planner | Critical path phases. |
| `plan_metadata` | implementation_planner | Plan versioning, upstream artifact versions used. |

**Critic:** implementation_plan_critic

## Implementation Domain

📄 **Detailed design:** [tables/implementation.md](tables/implementation.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `implementation_manifest` | senior_developer | Per-phase implementation summary — status, files changed, tests. |
| `implementation_file` | senior_developer | Each file created/modified with purpose. |
| `implementation_file_requirement` | senior_developer | File-to-requirement traceability. |
| `implementation_requirement_status` | senior_developer | Per-requirement implementation progress. |
| `implementation_component_status` | senior_developer | Per-component implementation progress. |
| `implementation_api_endpoint` | senior_developer | APIs actually implemented (vs. planned). |
| `implementation_dependency_added` | senior_developer | Dependencies added during implementation. |
| `implementation_db_migration` | senior_developer | Migrations actually run. |
| `implementation_blocker` / `_blocker_requirement` | senior_developer | Issues encountered and affected requirements. |
| `implementation_review_checklist` | senior_developer | Self-review items. |
| `implementation_manifest_metadata` | senior_developer | Implementation versioning. |
| `vcs_commit` | (commit_link tool) | Git/jj commits linked to iterations. |
| `intermediate_asset` / `asset_deliverable` | senior_developer | Build artifacts and deliverables. |

**Critic:** senior_developer_critic (also test_writer / test_writer_critic for the test-writing step)

## QA/Test Domain

📄 **Detailed design:** [tables/qa-test.md](tables/qa-test.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `test_report` | qa_engineer | Overall test report — pass/fail counts, coverage percentage. |
| `test_report_metadata` | qa_engineer | Report versioning. |
| `test_requirement_coverage` | qa_engineer | Which requirements have test coverage. |
| `test_acceptance_criterion_result` | qa_engineer | Pass/fail per acceptance criterion. |
| `test_suite` / `test_case` | qa_engineer | Test suites and individual cases with status, duration. |
| `test_case_requirement` | qa_engineer | Test-to-requirement traceability. |
| `test_security_finding` | qa_engineer | Security issues found during testing. |
| `test_performance_benchmark` | qa_engineer | Performance results vs. targets. |
| `test_blocker` / `_blocker_requirement` | qa_engineer | Blockers and affected requirements. |
| `test_recommendation` | qa_engineer | QA recommendations. |

**Critic:** qa_critic

## Documentation Domain

📄 **Detailed design:** [tables/documentation.md](tables/documentation.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `documentation_manifest` | documentation_master | Doc coverage summary. |
| `documentation_manifest_metadata` | documentation_master | Manifest versioning. |
| `documentation_section` | documentation_master | Doc sections (README, API docs, guides). |
| `documentation_feature` | documentation_master | Feature documentation with examples. |
| `documentation_feature_requirement` | documentation_master | Feature-to-requirement traceability. |
| `documentation_requirement_coverage` | documentation_master | Per-requirement doc coverage. |
| `documentation_requirement_path` | documentation_master | Where each requirement is documented. |
| `documentation_asset` | documentation_master | Generated doc assets (diagrams, etc.). |
| `documentation_verification` | documentation_master | Doc accuracy verification results. |

**Critic:** documentation_critic

## Deployment/Release Domain

📄 **Detailed design:** [tables/deployment.md](tables/deployment.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `deployment_manifest` | release_engineer | Release readiness summary. |
| `deployment_manifest_metadata` | release_engineer | Manifest versioning. |
| `deployment_target` | release_engineer | Where it deploys. |
| `deployment_manifest_blocker` | release_engineer | What blocks release. |
| `deployment_pipeline` / `_config_file` / `_stage` | release_engineer | CI/CD pipeline definition. |
| `deployment_stage_trigger` / `_step` / `_quality_gate` | release_engineer | Pipeline stage details. |
| `deployment_quality_gates` | release_engineer | Global quality gate rules. |
| `deployment_environment` / `_env_infra` / `_env_var` | release_engineer | Environment configs. |
| `deployment_artifact` / `_artifact_platform` | release_engineer | Build artifacts and platform targets. |
| `deployment_signing` | release_engineer | Code signing config. |
| `deployment_local_executable` / `_local_platform` / `_local_channel` | release_engineer | Local distribution (Homebrew, apt, etc.). |
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
| `changelog_insert` | Insert any entity type with full normalization into child tables. Main workhorse — handles ~20 entity types. |
| `iteration_create` | Create project + iteration + all phase rows in one call. |
| `phase_transition` | Update phase status (pending → in_progress → completed/skipped). |
| `revision_create` | Start a new producer-critic revision within a phase. |
| `revision_update` | Record critic verdict (approved/rejected) with feedback. |
| `commit_link` | Link a VCS commit to the current iteration. |
| `project_update` | Update project status (e.g., close it). |
| `plan_phase_transition` | Update a plan_phase row's status (pending → test_writing → implementing → completed). |

### Read Tools

| Tool | Purpose |
|------|---------|
| `changelog_query` | Query entities by type, iteration, IDs, or field filters. |

> **Note:** 5 entity types are write-only — they can be inserted via `changelog_insert` but are not queryable via `changelog_query`: `plan_overview`, `plan_requirement_mapping`, `vcs_commit`, `intermediate_asset`, `asset_deliverable`. These are stored in dedicated tables and can be queried directly via SQL or through `traceability_query` where applicable.
>
> **Known issue:** `accessibility_config` appears in the `changelog_insert` input schema enum but has no handler in the handler map — calling `changelog_insert` with it will throw "Unsupported entity_type" at runtime. This is a pre-existing MCP server bug.
| `traceability_query` | Trace decisions across entity types — "why are we using X?" |
| `revision_history` | Full revision chain for any entity. |
| `iteration_summary` | Phase-level summary for an iteration. |
| `project_status` | Current project state, phases, and progress. |

## Key Design Principles

1. **Full normalization** — Every YAML array became its own table with foreign keys. No JSON blobs.
2. **Append-only** — Revisions are never deleted or overwritten. New revisions create new rows. Full history preserved.
3. **Traceability** — Every entity carries `iteration_id` and `revision_id`. You can always answer "who produced this, when, and in response to what feedback."
4. **Idempotent DDL** — All tables use `CREATE TABLE IF NOT EXISTS` so the schema can be re-applied safely.

## Extending the Schema

To add new entity types:

1. Add `CREATE TABLE IF NOT EXISTS` statements to `mcp-server/schema.sql`
2. Add the entity type to `ENTITY_TABLE` map in `mcp-server/write-tools.js` and `mcp-server/read-tools.js`
3. Add insert/query logic for child tables if the entity has nested data
4. Update agent checklists to verify the new fields

## Alphabetical Table Index

All 146 tables with links to their detailed design documents.

| Table | Domain |
|-------|--------|
| `accessibility_config` | [ux-design](tables/ux-design.md) |
| `adr` | [architecture](tables/architecture.md) |
| `adr_alternative` | [architecture](tables/architecture.md) |
| `adr_alternative_con` | [architecture](tables/architecture.md) |
| `adr_alternative_pro` | [architecture](tables/architecture.md) |
| `adr_consequence` | [architecture](tables/architecture.md) |
| `adr_research_source` | [architecture](tables/architecture.md) |
| `approved_dependency` | [cross-cutting](tables/cross-cutting.md) |
| `architecture_diagram` | [architecture](tables/architecture.md) |
| `architecture_overview` | [architecture](tables/architecture.md) |
| `architecture_principle` | [architecture](tables/architecture.md) |
| `asset_deliverable` | [implementation](tables/implementation.md) |
| `component` | [architecture](tables/architecture.md) |
| `component_dependency` | [architecture](tables/architecture.md) |
| `component_interface` | [architecture](tables/architecture.md) |
| `component_requirement` | [architecture](tables/architecture.md) |
| `data_entity` | [data-model](tables/data-model.md) |
| `data_entity_attribute` | [data-model](tables/data-model.md) |
| `data_entity_relationship` | [data-model](tables/data-model.md) |
| `deployment_alerting` | [deployment](tables/deployment.md) |
| `deployment_artifact` | [deployment](tables/deployment.md) |
| `deployment_artifact_platform` | [deployment](tables/deployment.md) |
| `deployment_config` | [cross-cutting](tables/cross-cutting.md) |
| `deployment_env_infra` | [deployment](tables/deployment.md) |
| `deployment_env_var` | [deployment](tables/deployment.md) |
| `deployment_environment` | [deployment](tables/deployment.md) |
| `deployment_health_check` | [deployment](tables/deployment.md) |
| `deployment_infra_requirement` | [requirements](tables/requirements.md) |
| `deployment_local_channel` | [deployment](tables/deployment.md) |
| `deployment_local_executable` | [deployment](tables/deployment.md) |
| `deployment_local_platform` | [deployment](tables/deployment.md) |
| `deployment_manifest` | [deployment](tables/deployment.md) |
| `deployment_manifest_blocker` | [deployment](tables/deployment.md) |
| `deployment_manifest_metadata` | [deployment](tables/deployment.md) |
| `deployment_pipeline` | [deployment](tables/deployment.md) |
| `deployment_pipeline_config_file` | [deployment](tables/deployment.md) |
| `deployment_pipeline_stage` | [deployment](tables/deployment.md) |
| `deployment_quality_gates` | [deployment](tables/deployment.md) |
| `deployment_requirement` | [requirements](tables/requirements.md) |
| `deployment_review_checklist` | [deployment](tables/deployment.md) |
| `deployment_runbook` | [deployment](tables/deployment.md) |
| `deployment_runbook_step` | [deployment](tables/deployment.md) |
| `deployment_secret` | [deployment](tables/deployment.md) |
| `deployment_signing` | [deployment](tables/deployment.md) |
| `deployment_stage_quality_gate` | [deployment](tables/deployment.md) |
| `deployment_stage_step` | [deployment](tables/deployment.md) |
| `deployment_stage_trigger` | [deployment](tables/deployment.md) |
| `deployment_target` | [deployment](tables/deployment.md) |
| `design_system` | [ux-design](tables/ux-design.md) |
| `documentation_asset` | [documentation](tables/documentation.md) |
| `documentation_feature` | [documentation](tables/documentation.md) |
| `documentation_feature_requirement` | [documentation](tables/documentation.md) |
| `documentation_manifest` | [documentation](tables/documentation.md) |
| `documentation_manifest_metadata` | [documentation](tables/documentation.md) |
| `documentation_requirement_coverage` | [documentation](tables/documentation.md) |
| `documentation_requirement_path` | [documentation](tables/documentation.md) |
| `documentation_section` | [documentation](tables/documentation.md) |
| `documentation_verification` | [documentation](tables/documentation.md) |
| `entity_snapshot` | Core | JSON history of entity changes across revisions |
| `feedback_pattern` | [ux-design](tables/ux-design.md) |
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
| `implementation_manifest_metadata` | [implementation](tables/implementation.md) |
| `implementation_requirement_status` | [implementation](tables/implementation.md) |
| `implementation_review_checklist` | [implementation](tables/implementation.md) |
| `info_architecture` | [ux-design](tables/ux-design.md) |
| `integration_test_boundary` | [architecture](tables/architecture.md) |
| `intermediate_asset` | [implementation](tables/implementation.md) |
| `iteration` | [core](tables/core.md) |
| `iteration_input` | [requirements](tables/requirements.md) |
| `iteration_metadata` | [requirements](tables/requirements.md) |
| `iteration_output` | [requirements](tables/requirements.md) |
| `observability_config` | [cross-cutting](tables/cross-cutting.md) |
| `operational_monitoring` | [requirements](tables/requirements.md) |
| `operational_requirement` | [requirements](tables/requirements.md) |
| `persona` | [requirements](tables/requirements.md) |
| `persona_addressed` | [ux-design](tables/ux-design.md) |
| `persona_addressed_flow` | [ux-design](tables/ux-design.md) |
| `persona_goal` | [requirements](tables/requirements.md) |
| `phase` | [core](tables/core.md) |
| `plan_checkpoint_focus` | [planning](tables/planning.md) |
| `plan_critical_path` | [planning](tables/planning.md) |
| `plan_external_dependency` | [planning](tables/planning.md) |
| `plan_metadata` | [planning](tables/planning.md) |
| `plan_overview` | [planning](tables/planning.md) |
| `plan_overview_assumption` | [planning](tables/planning.md) |
| `plan_overview_risk` | [planning](tables/planning.md) |
| `plan_phase` | [planning](tables/planning.md) |
| `plan_phase_api_endpoint` | [planning](tables/planning.md) |
| `plan_phase_component` | [planning](tables/planning.md) |
| `plan_phase_db_change` | [planning](tables/planning.md) |
| `plan_phase_db_change_table` | [planning](tables/planning.md) |
| `plan_phase_dependency` | [planning](tables/planning.md) |
| `plan_phase_entry_criterion` | [planning](tables/planning.md) |
| `plan_phase_exit_criterion` | [planning](tables/planning.md) |
| `plan_phase_flow` | [planning](tables/planning.md) |
| `plan_phase_parallel` | [planning](tables/planning.md) |
| `plan_phase_requirement` | [planning](tables/planning.md) |
| `plan_phase_risk` | [planning](tables/planning.md) |
| `plan_phase_screen` | [planning](tables/planning.md) |
| `plan_requirement_mapping` | [planning](tables/planning.md) |
| `requirement` | [requirements](tables/requirements.md) |
| `requirement_acceptance_criterion` | [requirements](tables/requirements.md) |
| `requirement_dependency` | [requirements](tables/requirements.md) |
| `requirement_persona` | [requirements](tables/requirements.md) |
| `responsive_config` | [ux-design](tables/ux-design.md) |
| `revision` | [core](tables/core.md) |
| `screen` | [ux-design](tables/ux-design.md) |
| `screen_component` | [ux-design](tables/ux-design.md) |
| `screen_responsive_variant` | [ux-design](tables/ux-design.md) |
| `screen_state` | [ux-design](tables/ux-design.md) |
| `security_config` | [cross-cutting](tables/cross-cutting.md) |
| `technology_choice` | [architecture](tables/architecture.md) |
| `technology_constraint` | [requirements](tables/requirements.md) |
| `test_acceptance_criterion_result` | [qa-test](tables/qa-test.md) |
| `test_acceptance_criterion_test_id` | [qa-test](tables/qa-test.md) |
| `test_blocker` | [qa-test](tables/qa-test.md) |
| `test_blocker_requirement` | [qa-test](tables/qa-test.md) |
| `test_case` | [qa-test](tables/qa-test.md) |
| `test_case_requirement` | [qa-test](tables/qa-test.md) |
| `test_performance_benchmark` | [qa-test](tables/qa-test.md) |
| `test_recommendation` | [qa-test](tables/qa-test.md) |
| `test_report` | [qa-test](tables/qa-test.md) |
| `test_report_metadata` | [qa-test](tables/qa-test.md) |
| `test_requirement_coverage` | [qa-test](tables/qa-test.md) |
| `test_security_finding` | [qa-test](tables/qa-test.md) |
| `test_suite` | [qa-test](tables/qa-test.md) |
| `traceability_mapping` | [cross-cutting](tables/cross-cutting.md) |
| `user_flow` | [ux-design](tables/ux-design.md) |
| `user_flow_data_dependency` | [ux-design](tables/ux-design.md) |
| `user_flow_error_state` | [ux-design](tables/ux-design.md) |
| `user_flow_requirement` | [ux-design](tables/ux-design.md) |
| `user_flow_step` | [ux-design](tables/ux-design.md) |
| `user_flow_step_branch` | [ux-design](tables/ux-design.md) |
| `ux_asset` | [ux-design](tables/ux-design.md) |
| `ux_requirement_mapping` | [ux-design](tables/ux-design.md) |
| `vcs_commit` | [implementation](tables/implementation.md) |
| `project` | [core](tables/core.md) |

**Total: 146 tables across 11 domains**
