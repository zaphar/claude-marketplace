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
| `phase` | `id INTEGER` | 8 phases per iteration: requirements, ux_design, architecture, planning, implementation, documentation, qa, audit. Tracks status, timestamps, approval. |
| `revision` | `id INTEGER` | Producer-critic loop attempts within a phase. Tracks producer/critic agents, feedback text, verdict (draft → submitted → approved/rejected). |

**Hierarchy:** project → iteration → phase → revision

Changelog entities follow a two-tier scoping pattern:

- **`iteration_id` (27 entity tables):** Most entity tables carry `iteration_id` (NOT NULL, FK → `iteration`). This includes both producer-critic artifacts and iteration-scoped context tables: `phase`, `project_context`, `data_exchange`, `blocker`, `project_lesson`, `nonfunctional_requirement`, `plan_external_dependency`, `vcs_commit`, `requirement`, `requirement_trace`, `adr`, `component`, `approved_dependency`, `user_flow`, `screen`, `info_architecture`, `persona_addressed`, `ux_asset`, `work_item`, `plan_overview`, `implementation_requirement_status`, `implementation_component_status`, `implementation_blocker`, `intermediate_asset`, `test_report`, `security_audit_finding`, `performance_audit_finding`.
- **`project_id` only (1 table):** `persona` is project-scoped — it carries `project_id` (NOT NULL, FK → `project`) and an informational `introduced_in_iteration_id` (FK → `iteration`, ON DELETE SET NULL).

## Requirements Domain

📄 **Detailed design:** [tables/requirements.md](tables/requirements.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `persona` | requirements_analyst | User personas (id: `PERSONA-XXX`). Project-scoped. Name, description, role. Goals stored as JSON array (`goals` column). |
| `requirement` | requirements_analyst | Core requirements (id: `REQ-XXX`). Priority (must-have/should-have/nice-to-have), category (functional/security/performance/usability/operational/deployment), description, rationale. Acceptance criteria stored as JSON array (`acceptance_criteria` column). |
| `requirement_persona` | requirements_analyst | Which personas each requirement serves (M:N join). |
| `requirement_dependency` | requirements_analyst | Dependencies between requirements. |
| `project_context` | requirements_analyst | Project-level problem statement, success criteria, scope type (MVP/full). |
| `data_exchange` | requirements_analyst | What goes in/out of the system being built. Direction discriminator ('input'/'output') distinguishes the two. |
| `nonfunctional_requirement` | requirements_analyst | Non-functional requirements — deployment infrastructure, operational (uptime/SLA, monitoring, logging, observability), and technology constraints — unified with a `type` discriminator. |

**Critic:** requirements_critic

## Architecture Domain

📄 **Detailed design:** [tables/architecture.md](tables/architecture.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `adr` | backend_architect | Architecture Decision Records (id: `ADR-XXX`). Status, context. Consequences and research sources stored as JSON arrays (`consequences`, `research_sources` columns). |
| `adr_alternative` | backend_architect | Alternatives considered per ADR, with inline pros/cons (JSON arrays). |
| `adr_decision` | backend_architect | Formal decision for an ADR — selected alternative and rationale. PK on `adr_id` enforces one decision per ADR. `alternative_id` nullable (decisions can exist without formal alternatives). |
| `component` | backend_architect | System components (id: `COMP-XXX`). Type, responsibility, tech stack. |
| `component_interface` | backend_architect | APIs/ports each component exposes. |
| `component_dependency` | backend_architect | Component-to-component dependency graph (must be a DAG). |
| `integration_test_boundary` | backend_architect | Where integration tests are needed between components. |

**Critic:** architecture_critic

> **Note:** Architecture narrative, principles, diagrams, technology inventory, and data model design live in committed markdown documents (not in the database). The `approved_dependency` table (see Cross-Cutting) tracks vetted third-party packages with an optional `category` column for logical grouping (e.g., `backend-language`, `database`, `ci-cd`).

## Cross-Cutting Architecture

📄 **Detailed design:** [tables/cross-cutting.md](tables/cross-cutting.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `approved_dependency` | backend_architect | Vetted third-party dependencies with justification, license, health assessment. |
| `requirement_trace` | backend_architect | REQ → COMP → ADR → SCREEN cross-references (the "why" chain). |
| `blocker` | (any agent via orchestrator) | Cross-phase workflow blockers — raised when agents encounter issues that prevent progress. Lifecycle events with soft-delete (active when `resolved_at IS NULL`). |
| `project_lesson` | (any critic via orchestrator) | Cross-phase lessons learned — patterns, anti-patterns, conventions, risks, decisions, and process observations recorded by critics for downstream agents. |

## UX Design Domain

📄 **Detailed design:** [tables/ux-design.md](tables/ux-design.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `user_flow` | ux_designer | User journeys (id: `FLOW-XXX`). Trigger, preconditions, success criteria. Data dependencies stored as JSON array (`data_dependencies` column). |
| `user_flow_step` | ux_designer | Steps within each flow. |
| `user_flow_error_state` | ux_designer | Error states per flow. |
| `screen` | ux_designer | UI screens (id: `SCREEN-XXX`). Layout, route, purpose. UI components stored as JSON array (`components` column). |
| `info_architecture` | ux_designer | Navigation structure, sitemap. |
| `persona_addressed` / `persona_addressed_flow` | ux_designer | Which personas each UX design addresses. |
| `ux_asset` | ux_designer | Mockup/asset references. |

**Critic:** ux_critic

## Planning Domain

📄 **Detailed design:** [tables/planning.md](tables/planning.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `work_item` | implementation_planner | Implementation work phases (dev work chunks, not workflow phases). Entry/exit criteria and checkpoint focus stored as JSON arrays (`entry_criteria`, `exit_criteria`, `checkpoint_focus` columns). |
| `work_item_requirement` / `_component` | implementation_planner | What each work item covers. |
| `work_item_risk` | implementation_planner | Phase-level risks and mitigations. |
| `plan_overview` | implementation_planner | High-level plan summary. Assumptions and plan-wide risks stored as JSON arrays (`assumptions`, `risks` columns). |
| `plan_external_dependency` | implementation_planner | External blockers. |

**Critic:** implementation_plan_critic

## Implementation Domain

📄 **Detailed design:** [tables/implementation.md](tables/implementation.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `implementation_requirement_status` | senior_developer | Per-requirement implementation progress. |
| `implementation_component_status` | senior_developer | Per-component implementation progress. |
| `implementation_blocker` / `_blocker_requirement` | senior_developer | Issues encountered and affected requirements. |
| `vcs_commit` | senior_developer | Git/jj commits linked to work items and revisions. |
| `intermediate_asset` | senior_developer | Build artifacts. |

**Critic:** senior_developer_critic (also test_writer / test_writer_critic for the test-writing step)

## QA/Test Domain

📄 **Detailed design:** [tables/qa-test.md](tables/qa-test.md)

| Table | Producer | Purpose |
|-------|----------|---------|
| `test_report` | qa_engineer | Overall test report — pass/fail counts, coverage percentage, stdout/stderr output, and version provenance metadata. |

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

Documentation quality is enforced by the `documentation_critic` reviewing committed markdown files. No database tables are used — the documentation files themselves are the artifacts.

**Critic:** documentation_critic

## MCP Tools for Data Access

### Write Tools

| Tool | Purpose |
|------|---------|
| `changelog_insert` | Insert any entity type. Main workhorse — handles all entity types with nested child data. |
| `iteration_create` | Create project + iteration + all phase rows in one call. |
| `phase_transition` | Update phase status (pending → in_progress → completed/skipped). |
| `revision_create` | Start a new producer-critic revision within a phase. |
| `revision_update` | Record critic verdict (approved/rejected) with feedback. |
| `commit_link` | Link a VCS commit to a work item and revision within an iteration. |
| `project_update` | Update project status (e.g., close it). |
| `work_item_transition` | Update a work_item row's status (pending → test_writing → implementing → completed). |
| `blocker_resolve` | Mark a blocker as resolved with optional resolution notes. |
| `iteration_close` | Close an active iteration (sets status to closed, records closed_at). |
| `changelog_update` | Update mutable fields on an existing changelog entity (e.g. status transitions for audit findings and ADRs). |

### Read Tools

| Tool | Purpose |
|------|---------|
| `changelog_query` | Query entities by type, iteration, IDs, or field filters. |

> **Note:** All entity types in the `ENTITY_TABLE` map are fully queryable via `changelog_query`, including `vcs_commit` and `intermediate_asset`.
>
| `traceability_query` | Trace decisions across entity types — "why are we using X?" |
| `revision_history` | Full revision chain for any entity. |
| `iteration_summary` | Phase-level summary for an iteration. |
| `project_status` | Current project state, phases, and progress. |

## Key Design Principles

1. **Pragmatic normalization** — Core entities and M:N relationships use proper tables with foreign keys. Simple 1:N string lists (goals, criteria, triggers, steps, etc.) are stored as JSON arrays on the parent row, avoiding unnecessary child tables while keeping data self-contained and queryable via `JSON_EACH()`.
2. **Append-only** — Revisions are never deleted or overwritten. New revisions create new rows. Full history preserved.
3. **Traceability** — Every entity carries `iteration_id` (FK → `iteration`) for direct iteration scoping. The one exception is `persona`, which is project-scoped via `project_id`. You can always answer "who produced this, when, and in response to what feedback."
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

All 45 tables with links to their detailed design documents.

| Table | Domain |
|-------|--------|
| `adr` | [architecture](tables/architecture.md) |
| `adr_alternative` | [architecture](tables/architecture.md) |
| `adr_decision` | [architecture](tables/architecture.md) |
| `approved_dependency` | [cross-cutting](tables/cross-cutting.md) |
| `blocker` | [cross-cutting](tables/cross-cutting.md) |
| `component` | [architecture](tables/architecture.md) |
| `component_dependency` | [architecture](tables/architecture.md) |
| `component_interface` | [architecture](tables/architecture.md) |
| `data_exchange` | [requirements](tables/requirements.md) |
| `implementation_blocker` | [implementation](tables/implementation.md) |
| `implementation_blocker_requirement` | [implementation](tables/implementation.md) |
| `implementation_component_status` | [implementation](tables/implementation.md) |
| `implementation_requirement_status` | [implementation](tables/implementation.md) |
| `info_architecture` | [ux-design](tables/ux-design.md) |
| `integration_test_boundary` | [architecture](tables/architecture.md) |
| `intermediate_asset` | [implementation](tables/implementation.md) |
| `iteration` | [core](tables/core.md) |
| `nonfunctional_requirement` | [requirements](tables/requirements.md) |
| `performance_audit_finding` | [audit](tables/audit.md) |
| `persona` | [requirements](tables/requirements.md) |
| `persona_addressed` | [ux-design](tables/ux-design.md) |
| `persona_addressed_flow` | [ux-design](tables/ux-design.md) |
| `phase` | [core](tables/core.md) |
| `plan_external_dependency` | [planning](tables/planning.md) |
| `plan_overview` | [planning](tables/planning.md) |
| `work_item` | [planning](tables/planning.md) |
| `work_item_component` | [planning](tables/planning.md) |
| `work_item_requirement` | [planning](tables/planning.md) |
| `work_item_risk` | [planning](tables/planning.md) |
| `project` | [core](tables/core.md) |
| `project_context` | [requirements](tables/requirements.md) |
| `project_lesson` | [cross-cutting](tables/cross-cutting.md) |
| `requirement` | [requirements](tables/requirements.md) |
| `requirement_dependency` | [requirements](tables/requirements.md) |
| `requirement_persona` | [requirements](tables/requirements.md) |
| `requirement_trace` | [cross-cutting](tables/cross-cutting.md) |
| `revision` | [core](tables/core.md) |
| `screen` | [ux-design](tables/ux-design.md) |
| `security_audit_finding` | [audit](tables/audit.md) |
| `test_report` | [qa-test](tables/qa-test.md) |
| `user_flow` | [ux-design](tables/ux-design.md) |
| `user_flow_error_state` | [ux-design](tables/ux-design.md) |
| `user_flow_step` | [ux-design](tables/ux-design.md) |
| `ux_asset` | [ux-design](tables/ux-design.md) |
| `vcs_commit` | [implementation](tables/implementation.md) |

**Total: 45 tables across 10 domains**
