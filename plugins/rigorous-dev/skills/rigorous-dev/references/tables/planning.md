# Planning Domain — Table Reference

**Domain:** Implementation Planning
**Producer:** `implementation_planner`
**Critic:** `implementation_plan_critic`
**Consumers:** `senior_developer`, `test_writer`
**Schema source:** `mcp-server/schema.sql`

---

## Overview

The planning domain captures the output of the `implementation_planner` agent. It breaks the full architecture into **implementable work phases** — discrete developer task groupings (e.g., "Phase 1: Auth module", "Phase 2: API endpoints"). This is **not** the same as the SDLC workflow `phase` table, which tracks stages like requirements, architecture, and planning. `plan_phase` rows represent chunks of coding work within a single iteration.

Each plan phase records what to build (components, endpoints, DB migrations), when work can start and stop (entry/exit criteria), which other phases it depends on, and what risks apply. The overview tables capture the high-level strategy, global risks, assumptions, and traceability from requirements to phases.

### Table map

| Table | Role |
|-------|------|
| [`plan_phase`](#plan_phase) | One row per implementation work chunk |
| [`plan_phase_requirement`](#plan_phase_requirement) | Requirements addressed by a phase (M:N) |
| [`plan_phase_component`](#plan_phase_component) | Architecture components touched by a phase (M:N) |
| [`plan_phase_flow`](#plan_phase_flow) | User flows covered by a phase (M:N) |
| [`plan_phase_screen`](#plan_phase_screen) | UI screens delivered by a phase (M:N) |
| [`plan_phase_api_endpoint`](#plan_phase_api_endpoint) | API endpoints to build in a phase |
| [`plan_phase_db_change`](#plan_phase_db_change) | Database migrations required by a phase |
| [`plan_phase_relationship`](#plan_phase_relationship) | Phase ordering and parallelism (merged dependency + parallel) |
| [`plan_phase_risk`](#plan_phase_risk) | Phase-level risks and mitigations |
| [`plan_overview`](#plan_overview) | High-level strategy and rationale for a plan |
| [`plan_overview_risk`](#plan_overview_risk) | Plan-wide risks and mitigations |
| [`plan_external_dependency`](#plan_external_dependency) | External systems or services the plan depends on |
| [`plan_metadata`](#plan_metadata) | Plan versioning and source document references |

---

## `plan_phase`

### Purpose

Central record for one implementation work chunk. A phase groups related development work that can be handed to a developer as a coherent unit. The `phase_number` field provides the human-readable sequential ordering; child and related tables reference the phase by its `id` primary key (e.g., `plan_phase_relationship.related_phase_id`). The `critical_path_sequence` column (nullable INTEGER) indicates whether this phase is on the critical path and its position in the sequence; NULL means not on the critical path.

### Context

- Created by `implementation_planner` once per logical work grouping within an iteration.
- Each phase has a `type` describing whether it delivers user-facing features, internal infrastructure, or another category of work.
- `review_checkpoint = 1` flags phases where the critic or architect should conduct a mid-implementation review before proceeding.
- `complexity` is a t-shirt size estimate used by the `senior_developer` to gauge effort before starting.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. Referenced by all child tables as `plan_phase_id`. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | The planning revision that produced this phase. |
| `phase_number` | INTEGER | NOT NULL | — | Sequential number (1, 2, 3…). Human-readable ordering identifier. Dependency tables reference phases by surrogate `id` rather than this field. Must be unique within an iteration (enforced by application logic). |
| `name` | TEXT | NOT NULL | — | Short descriptive name (e.g., "Auth Module", "API Endpoints — User Service"). |
| `type` | TEXT | NOT NULL | — | Free-form label describing the kind of work (e.g., `feature`, `infrastructure`). |
| `goal` | TEXT | NOT NULL | — | One-paragraph statement of what this phase achieves and why. |
| `status` | TEXT | NOT NULL, DEFAULT `'pending'`, CHECK(`pending` \| `test_writing` \| `implementing` \| `completed`) | `'pending'` | Tracks sub-phase progress during implementation. `test_writing` while tests are being written; `implementing` while implementation is in progress; `completed` when the sub-phase is fully approved. |
| `complexity` | TEXT | CHECK(`XS` \| `S` \| `M` \| `L` \| `XL`), nullable | — | T-shirt size effort estimate. NULL means unestimated. |
| `review_checkpoint` | INTEGER | — | `0` | Boolean flag (0/1). When `1`, a review checkpoint is required before subsequent phases begin. |
| `entry_criteria` | TEXT | NOT NULL | `'[]'` | JSON array of strings. Each string is a precondition that must be true before this phase can begin (e.g., `"Phase 2 is complete and approved"`). Replaces the former `plan_phase_entry_criterion` child table. |
| `exit_criteria` | TEXT | NOT NULL | `'[]'` | JSON array of strings. Each string is a done-condition that must be met before the phase is considered complete (e.g., `"All unit tests pass with ≥80% coverage"`). Replaces the former `plan_phase_exit_criterion` child table. |
| `checkpoint_focus` | TEXT | NOT NULL | `'[]'` | JSON array of strings drawn from a fixed vocabulary (`requirements`, `architecture`, `ux`). Only populated when `review_checkpoint = 1`. Indicates which domains to examine during the checkpoint. Replaces the former `plan_checkpoint_focus` child table. |
| `notes` | TEXT | nullable | — | Free-form notes from the planner (caveats, open questions, reminders). |
| `critical_path_sequence` | INTEGER | nullable | NULL | Position of this phase in the critical path sequence (1 = first, 2 = second, …). NULL means this phase is not on the critical path. Replaces the former `plan_critical_path` child table. |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO-8601 timestamp of row creation. |

### Relationships

- **Parent:** `revision` via `revision_id`. Iteration derived via revision → phase → iteration (or via `entity_context` VIEW).
- **Children:** `plan_phase_requirement`, `plan_phase_component`, `plan_phase_flow`, `plan_phase_screen`, `plan_phase_api_endpoint`, `plan_phase_db_change`, `plan_phase_relationship`, `plan_phase_risk`
- **JSON arrays:** `entry_criteria`, `exit_criteria`, `checkpoint_focus` (inline on this table)
- **Referenced by FK in:** `plan_phase_relationship.related_phase_id`, `implementation_manifest.plan_phase_id`

### MCP tool access

| Operation | Tool | Entity type / notes |
|-----------|------|---------------------|
| Insert | `changelog_insert` | `entity_type: "plan_phase"` — inserts the phase and all child arrays in one call: `requirements`, `components`, `flows`, `screens`, `entry_criteria`, `exit_criteria`, `api_endpoints`, `db_changes` (with nested `tables`), `dependencies`, `risks`, `checkpoint_focus`, `parallel_with` |
| Query | `changelog_query` | `entity_type: "plan_phase"` — with `include_related: true`, returns phase with all children hydrated (including `db_changes[].tables`) |
| Traceability | `traceability_query` | Look up which phases cover a given `requirement_id` |

---

## `plan_phase_requirement`

### Purpose

Links a `plan_phase` to the `requirement` IDs it satisfies. This is the primary traceability bridge from implementation plan back to the requirements domain.

### Context

- Many-to-many join. A phase can address multiple requirements; a requirement can span multiple phases.
- Populated when `implementation_planner` inserts a `plan_phase`. Requirements IDs must already exist in the `requirement` table.
- Used by `implementation_plan_critic` to verify full requirement coverage across all phases.
- Also used in `traceability_query` to show "which phases implement REQ-XXX?"

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `plan_phase_id` | INTEGER | NOT NULL, FK → `plan_phase(id)`, part of PK | — | The phase that addresses this requirement. |
| `requirement_id` | TEXT | NOT NULL, FK → `requirement(id)`, part of PK | — | The requirement being addressed (e.g., `REQ-001`). |
| `priority` | TEXT | nullable | — | How critical this requirement is to the phase (e.g., `critical`, `high`, `medium`, `low`). Informs ordering when phases must be cut. |
| `notes` | TEXT | nullable | — | Additional context about how this requirement is addressed in this phase (e.g., "Partial implementation; full support in Phase 4"). |

**Primary key:** `(plan_phase_id, requirement_id)` — prevents duplicate links.

### Relationships

- **Parent:** `plan_phase` via `plan_phase_id`; `requirement` via `requirement_id`

### MCP tool access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Pass `requirements: ["REQ-001", ...]` in the `plan_phase` payload; child rows inserted automatically |
| Query | `changelog_query` | Retrieved as the `requirements` array when querying a `plan_phase` |

---

## `plan_phase_component`

### Purpose

Links a `plan_phase` to the architecture `component` IDs it touches. Tells developers which system components will be written or modified during this phase.

### Context

- Many-to-many join. Populated alongside `plan_phase_requirement` during phase insertion.
- `implementation_plan_critic` uses this to verify that every component gets covered in at least one phase, and that no phase is overloaded with unrelated components.
- `senior_developer` uses this to decide which codebases/services to check out before starting a phase.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `plan_phase_id` | INTEGER | NOT NULL, FK → `plan_phase(id)`, part of PK | — | The phase that involves this component. |
| `component_id` | TEXT | NOT NULL, FK → `component(id)`, part of PK | — | The architecture component (e.g., `COMP-001`). |

**Primary key:** `(plan_phase_id, component_id)` — prevents duplicate links.

### Relationships

- **Parent:** `plan_phase` via `plan_phase_id`; `component` via `component_id`

### MCP tool access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Pass `components: ["COMP-001", ...]` in the `plan_phase` payload |
| Query | `changelog_query` | Retrieved as the `components` array when querying a `plan_phase` |

---

## `plan_phase_flow`

### Purpose

Links a `plan_phase` to the `user_flow` IDs it implements. Records which user flows will be brought to life during a given phase.

### Context

- Many-to-many join between `plan_phase` and `user_flow` (from the UX domain).
- Used by `senior_developer` and `test_writer` to understand the end-to-end user journeys that must work by the end of the phase.
- Enables `implementation_plan_critic` to check that all designed user flows are covered.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `plan_phase_id` | INTEGER | NOT NULL, FK → `plan_phase(id)`, part of PK | — | The phase that implements this flow. |
| `flow_id` | TEXT | NOT NULL, FK → `user_flow(id)`, part of PK | — | The user flow being implemented. |

**Primary key:** `(plan_phase_id, flow_id)` — prevents duplicate links.

### Relationships

- **Parent:** `plan_phase` via `plan_phase_id`; `user_flow` via `flow_id`

### MCP tool access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Pass `flows: ["FLOW-001", ...]` in the `plan_phase` payload |
| Query | `changelog_query` | Retrieved as the `flows` array when querying a `plan_phase` |

---

## `plan_phase_screen`

### Purpose

Links a `plan_phase` to the `screen` IDs it will build or modify. Records which UI screens are in scope for a given phase.

### Context

- Many-to-many join between `plan_phase` and `screen` (from the UX domain).
- Helps `senior_developer` and frontend engineers understand which screens to implement in each phase.
- Used by `test_writer` to scope UI/integration tests per phase.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `plan_phase_id` | INTEGER | NOT NULL, FK → `plan_phase(id)`, part of PK | — | The phase that builds or modifies this screen. |
| `screen_id` | TEXT | NOT NULL, FK → `screen(id)`, part of PK | — | The screen in scope. |

**Primary key:** `(plan_phase_id, screen_id)` — prevents duplicate links.

### Relationships

- **Parent:** `plan_phase` via `plan_phase_id`; `screen` via `screen_id`

### MCP tool access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Pass `screens: ["SCR-001", ...]` in the `plan_phase` payload |
| Query | `changelog_query` | Retrieved as the `screens` array when querying a `plan_phase` |

---

## `plan_phase_api_endpoint`

### Purpose

Lists the HTTP API endpoints that must be implemented during a phase. This is the developer's build spec for the API surface of a phase — HTTP method, route, and purpose for each endpoint.

### Context

- One-to-many child of `plan_phase`. A phase may have zero (infrastructure phases) to many endpoints.
- `implementation_planner` derives these from the architecture domain (`component_interface`) and requirements.
- `senior_developer` treats each row as an endpoint to implement and unit-test.
- `test_writer` generates integration test cases from these rows.
- `implementation_plan_critic` cross-checks that the listed endpoints cover all relevant acceptance criteria.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `plan_phase_id` | INTEGER | NOT NULL, FK → `plan_phase(id)`, part of UNIQUE(plan_phase_id, route, http_method) | — | The phase that implements this endpoint. |
| `http_method` | TEXT | NOT NULL, part of UNIQUE(plan_phase_id, route, http_method) | — | HTTP method (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`). |
| `route` | TEXT | NOT NULL, part of UNIQUE(plan_phase_id, route, http_method) | — | URL path, e.g., `/api/v1/users/{id}`. |
| `description` | TEXT | nullable | — | What this endpoint does and what it returns. |

### Relationships

- **Parent:** `plan_phase` via `plan_phase_id`

### MCP tool access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Pass `api_endpoints: [{http_method, route, description}, ...]` in the `plan_phase` payload |
| Query | `changelog_query` | Retrieved as the `api_endpoints` array when querying a `plan_phase` |

---

## `plan_phase_db_change`

### Purpose

Represents one database migration required within a phase. Each row is a named migration unit (analogous to a migration file). The `tables` JSON array lists the specific table names the migration touches.

### Context

- One-to-many child of `plan_phase`. Infrastructure phases often have several migrations; feature phases typically have one or two.
- `implementation_planner` names migrations following a convention so they can be ordered and versioned.
- `senior_developer` uses these to generate or write migration files before implementing application logic.
- `implementation_plan_critic` verifies that migrations align with the architecture's data model and don't conflict across phases.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `plan_phase_id` | INTEGER | NOT NULL, FK → `plan_phase(id)` | — | The phase that runs this migration. |
| `migration_name` | TEXT | NOT NULL | — | Unique name for this migration (e.g., `001_create_users_table`). Should be sortable/versioned. |
| `description` | TEXT | nullable | — | What this migration does (e.g., "Creates `users` and `sessions` tables with indexes on email"). |
| `tables` | TEXT | NOT NULL | `'[]'` | JSON array of table name strings affected by this migration (e.g., `["users", "sessions"]`). Replaces the former `plan_phase_db_change_table` child table. |

### Relationships

- **Parent:** `plan_phase` via `plan_phase_id`
- **JSON array:** `tables` (inline on this table)

### MCP tool access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Pass `db_changes: [{migration_name, description, tables: [...]}]` in the `plan_phase` payload |
| Query | `changelog_query` | Retrieved as the `db_changes` array when querying a `plan_phase` |

---

## `plan_phase_relationship`

### Purpose

Records inter-phase relationships: ordering constraints (`dependency`) and concurrency pairs (`parallel`). A single table with a `dependency_type` discriminator replaces the former `plan_phase_dependency` and `plan_phase_parallel` tables.

### Context

- **dependency** rows define a DAG of phase execution order: `plan_phase_id` cannot begin until `related_phase_id` is complete.
- **parallel** rows record pairs of phases that can be worked concurrently — they have no blocking dependency and touch independent parts of the system.
- `implementation_planner` populates both relationship types to ensure correct sequencing and to surface safe parallelism.
- `senior_developer` reads dependencies to decide which phases to start/queue, and reads parallel relationships to maximize throughput.
- The critical path is derived from the dependency subset — the longest chain through dependency rows. Critical path membership is tracked on `plan_phase.critical_path_sequence`.
- `implementation_plan_critic` verifies claimed parallelism by checking for hidden conflicts in `plan_phase_db_change.tables` and `plan_phase_component`.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `plan_phase_id` | INTEGER | NOT NULL, FK → `plan_phase(id)`, part of PK | — | The phase that has the relationship (the "downstream" phase for dependencies, one side for parallel). |
| `related_phase_id` | INTEGER | NOT NULL, FK → `plan_phase(id)`, part of PK | — | The `id` of the related phase. For dependencies: the phase that must complete first. For parallel: the phase that can run concurrently. |
| `dependency_type` | TEXT | NOT NULL, CHECK(`dependency` \| `parallel`), part of PK | — | Discriminator. `dependency` = ordering constraint; `parallel` = safe concurrency pair. |
| `reason` | TEXT | nullable | — | Only populated for `dependency_type = 'dependency'`. Explains why this ordering is required (e.g., "Auth tokens must exist before user profile endpoints can be tested"). |

**Primary key:** `(plan_phase_id, related_phase_id, dependency_type)` — allows the same pair to have both a dependency and parallel relationship (unusual but not logically impossible for different sub-aspects).

### Relationships

- **Parent:** `plan_phase` via `plan_phase_id`
- **References:** `plan_phase` via `related_phase_id`

### MCP tool access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert dependency | `changelog_insert` | Pass `dependencies: [{depends_on_phase_id: 2, reason: "..."}]` in the `plan_phase` payload |
| Insert parallel | `changelog_insert` | Pass `parallel_with: [3, 4]` in the `plan_phase` payload |
| Query | `changelog_query` | Dependencies returned as `dependencies` array (objects with `depends_on_phase_id` + `reason`); parallel returned as `parallel_with` array (ids) |

---

## `plan_phase_risk`

### Purpose

Records risks specific to a single phase — technical unknowns, integration hazards, or schedule threats — along with their mitigations.

### Context

- One-to-many child of `plan_phase`. A phase may have zero or more risks.
- Distinct from `plan_overview_risk`, which records plan-wide risks. These are phase-scoped.
- `implementation_planner` documents risks when a phase touches unfamiliar technology, has a tight time window, or depends on external teams.
- `senior_developer` reviews these before starting the phase to pre-empt blockers.
- `implementation_plan_critic` checks that every risk has a concrete mitigation (not just "be careful").

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `plan_phase_id` | INTEGER | NOT NULL, FK → `plan_phase(id)` | — | The phase this risk applies to. |
| `risk` | TEXT | NOT NULL | — | Description of the risk (e.g., "Third-party OAuth provider may rate-limit token validation during load testing"). |
| `mitigation` | TEXT | nullable | — | How the risk will be addressed (e.g., "Cache token validation results for 60 seconds; implement exponential backoff"). |

### Relationships

- **Parent:** `plan_phase` via `plan_phase_id`

### MCP tool access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Pass `risks: [{risk: "...", mitigation: "..."}]` in the `plan_phase` payload |
| Query | `changelog_query` | Retrieved as the `risks` array when querying a `plan_phase` |

---

## `plan_overview`

### Purpose

One row per planning revision: the high-level summary of the entire implementation plan. Records the overall strategy, the rationale for the chosen breakdown, and a description of the Phase 1 approach.

### Context

- Created once per planning revision by `implementation_planner`, alongside all `plan_phase` rows.
- `implementation_plan_critic` uses this to evaluate whether the strategy is coherent and whether the rationale justifies the phase count.
- `senior_developer` reads this first to understand the big picture before drilling into individual phases.
- Child table `plan_overview_risk` hangs off this row. Assumptions are stored inline as a JSON array.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. Referenced by child tables as `plan_overview_id`. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | The revision that produced this plan. |
| `strategy` | TEXT | NOT NULL | — | Overall implementation strategy (e.g., "Bottom-up: build data layer first, then service layer, then API, then UI"). |
| `rationale` | TEXT | NOT NULL | — | Explanation of why the architecture was broken into phases this way. |
| `phase_one_approach` | TEXT | nullable | — | Specific description of how Phase 1 begins, what it sets up, and why it comes first. |
| `assumptions` | TEXT | NOT NULL | `'[]'` | JSON array of assumption strings the plan relies on (e.g., `"The third-party payment API supports webhook retries"`). Replaces the former `plan_overview_assumption` child table. |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO-8601 timestamp of row creation. |

### Relationships

- **Parent:** `revision` via `revision_id`. Iteration derived via revision → phase → iteration (or via `entity_context` VIEW).
- **Children:** `plan_overview_risk`
- **JSON array:** `assumptions` (inline on this table)

### MCP tool access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | `entity_type: "plan_overview"` — also inserts child risk and assumption rows |
| Query | `changelog_query` | `entity_type: "plan_overview"` — returns overview with risks and assumptions hydrated |

---

## `plan_overview_risk`

### Purpose

Records plan-wide risks that apply across multiple phases or to the overall delivery, along with mitigations. These are strategic risks rather than the phase-specific tactical risks stored in `plan_phase_risk`.

### Context

- One-to-many child of `plan_overview`. A plan typically has 2–5 overview risks.
- Examples: "Architecture depends on unproven library X", "Team lacks experience with streaming databases", "Regulatory approval may delay Phase 3".
- The optional `plan_phase_number` field indicates if the risk materialises at a specific phase (for scheduling mitigation work).
- `implementation_plan_critic` verifies that mitigations are actionable and not generic.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `plan_overview_id` | INTEGER | NOT NULL, FK → `plan_overview(id)` | — | The plan overview this risk belongs to. |
| `risk` | TEXT | NOT NULL | — | Description of the risk. |
| `mitigation` | TEXT | nullable | — | How this risk will be managed or reduced. |
| `plan_phase_number` | INTEGER | nullable | — | The `phase_number` at which this risk is most acute or must be mitigated, if applicable. |

### Relationships

- **Parent:** `plan_overview` via `plan_overview_id`

### MCP tool access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Pass `risks: [{risk, mitigation, plan_phase_number}]` in the `plan_overview` payload |
| Query | `changelog_query` | Retrieved as the `risks` array when querying a `plan_overview` |

---

## `plan_external_dependency`

### Purpose

Records external systems, services, or teams that the implementation plan depends on but cannot directly control. Each row is one external dependency with a risk level and optional mitigation strategy.

### Context

- One-to-many child of the iteration (not a specific phase — external dependencies are plan-wide).
- Examples: "Auth0 tenant provisioning", "Payment gateway sandbox credentials", "Mobile team delivering SDK v2", "Legal approval for GDPR data flows".
- The optional `plan_phase_number` field marks when the dependency becomes blocking.
- `implementation_plan_critic` verifies that high/critical external dependencies have concrete mitigations.
- `senior_developer` tracks these as pre-conditions to flag blockers early.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | The iteration this external dependency belongs to. |
| `name` | TEXT | NOT NULL | — | Short name of the external dependency (e.g., "Stripe Sandbox Credentials"). |
| `description` | TEXT | NOT NULL | — | What this dependency is and why the plan needs it. |
| `plan_phase_number` | INTEGER | nullable | — | The `phase_number` at which this dependency becomes blocking, if known. |
| `risk_level` | TEXT | NOT NULL, CHECK(`low` \| `medium` \| `high` \| `critical`) | — | How much risk this dependency poses to the plan if not resolved. |
| `mitigation` | TEXT | nullable | — | How the team plans to manage or reduce the dependency risk (e.g., "Use mock server for Phase 1–2; real credentials required for Phase 3"). |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO-8601 timestamp of row creation. |

### Relationships

- **Parent:** `iteration` via `iteration_id`
- **References by value:** `plan_phase.phase_number` via `plan_phase_number`

### MCP tool access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | `entity_type: "plan_external_dependency"` |
| Query | `changelog_query` | `entity_type: "plan_external_dependency"` — filter by `iteration_id` |

---

> **Note:** Critical path tracking (formerly in a dedicated `plan_critical_path` table) is now handled by the `plan_phase.critical_path_sequence` column — a nullable INTEGER where NULL means not on the critical path and a non-NULL value indicates the phase's position in the critical path sequence.

---

## `plan_metadata`

### Purpose

Version and provenance record for the implementation plan. Records what version of the requirements, architecture, and UX specifications the plan was produced from, the plan's own version string, and its lifecycle status.

### Context

- One row per planning revision. Inserted by `implementation_planner` when producing a plan.
- The `status` field tracks the plan through its lifecycle: `draft` (just produced), `review` (submitted to critic), `approved` (critic accepted).
- `requirements_version`, `architecture_version`, and `ux_specification_version` capture the source document versions so that, if any upstream artifact changes, the plan can be identified as potentially stale.
- `implementation_plan_critic` updates `status` to `approved` or leaves feedback that triggers a new revision (which creates a new row with `status: 'draft'`).

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | The revision that produced this plan version. |
| `title` | TEXT | NOT NULL | — | Human-readable plan title (e.g., "Implementation Plan — Invoice Generation Feature"). |
| `version` | TEXT | NOT NULL | — | Semantic version string of this plan (e.g., `1.0.0`, `1.1.0`). |
| `document_date` | TEXT | NOT NULL | — | Human-readable creation date (e.g., `2024-01-15`). Distinct from `created_at`. Aligns with peer manifest tables. |
| `document_updated` | TEXT | nullable | — | Human-readable date of last update, if the plan has been revised. Aligns with peer manifest tables. |
| `status` | TEXT | NOT NULL, CHECK(`draft` \| `review` \| `approved`) | — | Lifecycle status. `draft` = just produced; `review` = submitted to critic; `approved` = critic accepted. |
| `requirements_version` | TEXT | NOT NULL | — | Version of the requirements document this plan was based on. |
| `architecture_version` | TEXT | NOT NULL | — | Version of the architecture document this plan was based on. |
| `ux_specification_version` | TEXT | NOT NULL | — | Version of the UX specification this plan was based on. |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO-8601 timestamp of row creation (machine-generated, unlike `document_date`). |

### Relationships

- **Parent:** `revision` via `revision_id`. Iteration derived via revision → phase → iteration (or via `entity_context` VIEW).

### MCP tool access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | `entity_type: "plan_metadata"` |
| Query | `changelog_query` | `entity_type: "plan_metadata"` — filter by `iteration_id` |

---

## Entity Relationship Summary

```
iteration ──────────────────────────────────────────────────────────┐
│                                                                    │
├─ plan_overview (1:N per revision)                                 │
│   ├─ plan_overview_risk (1:N)                                     │
│   └─ assumptions (JSON array, inline)                             │
│                                                                    │
├─ plan_phase (1:N, phase_number sequential within iteration)       │
│   ├─ plan_phase_requirement  (M:N → requirement)                  │
│   ├─ plan_phase_component    (M:N → component)                    │
│   ├─ plan_phase_flow         (M:N → user_flow)                    │
│   ├─ plan_phase_screen       (M:N → screen)                       │
│   ├─ entry_criteria          (JSON array, inline)                 │
│   ├─ exit_criteria           (JSON array, inline)                 │
│   ├─ checkpoint_focus        (JSON array, inline)                 │
│   ├─ plan_phase_api_endpoint     (1:N)                            │
│   ├─ plan_phase_db_change        (1:N)                            │
│   │   └─ tables              (JSON array, inline)                 │
│   ├─ plan_phase_relationship (FK → plan_phase(id), discriminated)   │
│   └─ plan_phase_risk         (1:N)                                │
│                                                                    │
├─ plan_external_dependency  (1:N)                                  │
└─ plan_metadata             (version + status)                     │
```

## Cross-domain references

| Planning table | References | Domain |
|----------------|------------|--------|
| `plan_phase_requirement` | `requirement.id` | Requirements |
| `plan_phase_component` | `component.id` | Architecture |
| `plan_phase_flow` | `user_flow.id` | UX |
| `plan_phase_screen` | `screen.id` | UX |
