# Planning Domain — Table Reference

**Domain:** Implementation Planning
**Producer:** `implementation_planner`
**Critic:** `implementation_plan_critic`
**Consumers:** `senior_developer`, `test_writer`
**Schema source:** `mcp-server/schema.sql`

---

## Overview

The planning domain captures the output of the `implementation_planner` agent. It breaks the full architecture into **implementable work phases** — discrete developer task groupings (e.g., "Phase 1: Auth module", "Phase 2: API endpoints"). This is **not** the same as the SDLC workflow `phase` table, which tracks stages like requirements, architecture, and planning. `work_item` rows represent chunks of coding work within a single iteration.

Each work item records what to build (components, requirements), when work can start and stop (entry/exit criteria), and what risks apply. The overview tables capture the high-level strategy, global risks, assumptions, and traceability from requirements to work items.

### Table map

| Table | Role |
|-------|------|
| [`work_item`](#work_item) | One row per implementation work chunk |
| [`work_item_requirement`](#work_item_requirement) | Requirements addressed by a work item (M:N) |
| [`work_item_component`](#work_item_component) | Architecture components touched by a work item (M:N) |
| [`work_item_risk`](#work_item_risk) | Work-item-level risks and mitigations |
| [`plan_overview`](#plan_overview) | High-level strategy and rationale for a plan |
| [`plan_external_dependency`](#plan_external_dependency) | External systems or services the plan depends on |

---

## `work_item`

### Purpose

Central record for one implementation work chunk. A work item groups related development work that can be handed to a developer as a coherent unit. The `phase_number` field provides the human-readable sequential ordering; child tables reference the work item by its `id` primary key. The `critical_path_sequence` column (nullable INTEGER) indicates whether this work item is on the critical path and its position in the sequence; NULL means not on the critical path. The `work_order` column (nullable INTEGER) captures execution ordering when explicit sequencing is needed; items with the same `work_order` can run in parallel, NULL means unordered.

### Context

- Created by `implementation_planner` once per logical work grouping within an iteration.
- Each phase has a `type` describing whether it delivers user-facing features, internal infrastructure, or another category of work.
- `review_checkpoint = 1` flags phases where the critic or architect should conduct a mid-implementation review before proceeding.
- `complexity` is a t-shirt size estimate used by the `senior_developer` to gauge effort before starting.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. Referenced by all child tables as `work_item_id`. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` ON DELETE CASCADE | — | The iteration this work item belongs to. |
| `phase_number` | INTEGER | NOT NULL | — | Sequential number (1, 2, 3…). Human-readable ordering identifier. Dependency tables reference phases by surrogate `id` rather than this field. Must be unique within an iteration (enforced by application logic). |
| `name` | TEXT | NOT NULL | — | Short descriptive name (e.g., "Auth Module", "API Endpoints — User Service"). |
| `type` | TEXT | NOT NULL | — | Free-form label describing the kind of work (e.g., `feature`, `infrastructure`). |
| `goal` | TEXT | NOT NULL | — | One-paragraph statement of what this phase achieves and why. |
| `status` | TEXT | NOT NULL, DEFAULT `'pending'`, CHECK(`pending` \| `test_writing` \| `implementing` \| `completed`) | `'pending'` | Tracks sub-phase progress during implementation. `test_writing` while tests are being written; `implementing` while implementation is in progress; `completed` when the sub-phase is fully approved. |
| `complexity` | TEXT | CHECK(`XS` \| `S` \| `M` \| `L` \| `XL`), nullable | — | T-shirt size effort estimate. NULL means unestimated. |
| `review_checkpoint` | INTEGER | — | `0` | Boolean flag (0/1). When `1`, a review checkpoint is required before subsequent phases begin. |
| `entry_criteria` | TEXT | NOT NULL | `'[]'` | JSON array of strings. Each string is a precondition that must be true before this phase can begin (e.g., `"Phase 2 is complete and approved"`). Replaces the former `work_item_entry_criterion` child table. |
| `exit_criteria` | TEXT | NOT NULL | `'[]'` | JSON array of strings. Each string is a done-condition that must be met before the phase is considered complete (e.g., `"All unit tests pass with ≥80% coverage"`). Replaces the former `work_item_exit_criterion` child table. |
| `checkpoint_focus` | TEXT | NOT NULL | `'[]'` | JSON array of strings drawn from a fixed vocabulary (`requirements`, `architecture`, `ux`). Only populated when `review_checkpoint = 1`. Indicates which domains to examine during the checkpoint. Replaces the former `plan_checkpoint_focus` child table. |
| `notes` | TEXT | nullable | — | Free-form notes from the planner (caveats, open questions, reminders). |
| `critical_path_sequence` | INTEGER | nullable | NULL | Position of this phase in the critical path sequence (1 = first, 2 = second, …). NULL means this phase is not on the critical path. Replaces the former `plan_critical_path` child table. |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO-8601 timestamp of row creation. |

### Relationships

- **Parent:** `iteration` via `iteration_id`.
- **Children:** `work_item_requirement`, `work_item_component`, `work_item_risk`
- **JSON arrays:** `entry_criteria`, `exit_criteria`, `checkpoint_focus` (inline on this table)
- **Referenced by FK in:** `implementation_manifest.work_item_id`

### MCP tool access

| Operation | Tool | Entity type / notes |
|-----------|------|---------------------|
| Insert | `changelog_insert` | `entity_type: "work_item"` — inserts the phase and all child arrays in one call: `requirements`, `components`, `flows`, `screens`, `entry_criteria`, `exit_criteria`, `api_endpoints`, `db_changes` (with nested `tables`), `dependencies`, `risks`, `checkpoint_focus`, `parallel_with` |
| Query | `changelog_query` | `entity_type: "work_item"` — with `include_related: true`, returns phase with all children hydrated (including `db_changes[].tables`) |
| Traceability | `traceability_query` | Look up which phases cover a given `requirement_id` |

---

## `work_item_requirement`

### Purpose

Links a `work_item` to the `requirement` IDs it satisfies. This is the primary traceability bridge from implementation plan back to the requirements domain.

### Context

- Many-to-many join. A phase can address multiple requirements; a requirement can span multiple phases.
- Populated when `implementation_planner` inserts a `work_item`. Requirements IDs must already exist in the `requirement` table.
- Used by `implementation_plan_critic` to verify full requirement coverage across all phases.
- Also used in `traceability_query` to show "which phases implement REQ-XXX?"

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `work_item_id` | INTEGER | NOT NULL, FK → `work_item(id)`, part of PK | — | The phase that addresses this requirement. |
| `requirement_id` | TEXT | NOT NULL, FK → `requirement(id)`, part of PK | — | The requirement being addressed (e.g., `REQ-001`). |
| `priority` | TEXT | nullable | — | How critical this requirement is to the phase (e.g., `critical`, `high`, `medium`, `low`). Informs ordering when phases must be cut. |
| `notes` | TEXT | nullable | — | Additional context about how this requirement is addressed in this phase (e.g., "Partial implementation; full support in Phase 4"). |

**Primary key:** `(work_item_id, requirement_id)` — prevents duplicate links.

### Relationships

- **Parent:** `work_item` via `work_item_id`; `requirement` via `requirement_id`

### MCP tool access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Pass `requirements: ["REQ-001", ...]` in the `work_item` payload; child rows inserted automatically |
| Query | `changelog_query` | Retrieved as the `requirements` array when querying a `work_item` |

---

## `work_item_component`

### Purpose

Links a `work_item` to the architecture `component` IDs it touches. Tells developers which system components will be written or modified during this phase.

### Context

- Many-to-many join. Populated alongside `work_item_requirement` during phase insertion.
- `implementation_plan_critic` uses this to verify that every component gets covered in at least one phase, and that no phase is overloaded with unrelated components.
- `senior_developer` uses this to decide which codebases/services to check out before starting a phase.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `work_item_id` | INTEGER | NOT NULL, FK → `work_item(id)`, part of PK | — | The phase that involves this component. |
| `component_id` | TEXT | NOT NULL, FK → `component(id)`, part of PK | — | The architecture component (e.g., `COMP-001`). |

**Primary key:** `(work_item_id, component_id)` — prevents duplicate links.

### Relationships

- **Parent:** `work_item` via `work_item_id`; `component` via `component_id`

### MCP tool access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Pass `components: ["COMP-001", ...]` in the `work_item` payload |
| Query | `changelog_query` | Retrieved as the `components` array when querying a `work_item` |

## `work_item_risk`

### Purpose

Records risks specific to a single phase — technical unknowns, integration hazards, or schedule threats — along with their mitigations.

### Context

- One-to-many child of `work_item`. A phase may have zero or more risks.
- Distinct from `plan_overview.risks` (JSON column), which records plan-wide risks. These are phase-scoped.
- `implementation_planner` documents risks when a phase touches unfamiliar technology, has a tight time window, or depends on external teams.
- `senior_developer` reviews these before starting the phase to pre-empt blockers.
- `implementation_plan_critic` checks that every risk has a concrete mitigation (not just "be careful").

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `work_item_id` | INTEGER | NOT NULL, FK → `work_item(id)` | — | The phase this risk applies to. |
| `risk` | TEXT | NOT NULL | — | Description of the risk (e.g., "Third-party OAuth provider may rate-limit token validation during load testing"). |
| `mitigation` | TEXT | nullable | — | How the risk will be addressed (e.g., "Cache token validation results for 60 seconds; implement exponential backoff"). |

### Relationships

- **Parent:** `work_item` via `work_item_id`

### MCP tool access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Pass `risks: [{risk: "...", mitigation: "..."}]` in the `work_item` payload |
| Query | `changelog_query` | Retrieved as the `risks` array when querying a `work_item` |

---

## `plan_overview`

### Purpose

One row per planning revision: the high-level summary of the entire implementation plan. Records the overall strategy, the rationale for the chosen breakdown, and a description of the Phase 1 approach.

### Context

- Created once per planning revision by `implementation_planner`, alongside all `work_item` rows.
- `implementation_plan_critic` uses this to evaluate whether the strategy is coherent and whether the rationale justifies the phase count.
- `senior_developer` reads this first to understand the big picture before drilling into individual phases.
- Assumptions and plan-wide risks are stored inline as JSON arrays.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` ON DELETE CASCADE | — | The iteration this plan belongs to. |
| `strategy` | TEXT | NOT NULL | — | Overall implementation strategy (e.g., "Bottom-up: build data layer first, then service layer, then API, then UI"). |
| `rationale` | TEXT | NOT NULL | — | Explanation of why the architecture was broken into phases this way. |
| `phase_one_approach` | TEXT | nullable | — | Specific description of how Phase 1 begins, what it sets up, and why it comes first. |
| `assumptions` | TEXT | NOT NULL | `'[]'` | JSON array of assumption strings the plan relies on (e.g., `"The third-party payment API supports webhook retries"`). Replaces the former `plan_overview_assumption` child table. |
| `risks` | JSON | nullable | NULL | JSON array of plan-wide risks: `[{"risk": "...", "mitigation": "...", "work_item_number": 3}]`. NULL when no plan-wide risks exist. |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO-8601 timestamp of row creation. |

### Relationships

- **Parent:** `iteration` via `iteration_id`.
- **JSON arrays:** `assumptions`, `risks` (inline on this table)

### MCP tool access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | `entity_type: "plan_overview"` — pass `risks` and `assumptions` arrays in the data payload |
| Query | `changelog_query` | `entity_type: "plan_overview"` — returns overview with risks and assumptions hydrated from JSON |

---

## `plan_external_dependency`

### Purpose

Records external systems, services, or teams that the implementation plan depends on but cannot directly control. Each row is one external dependency with a risk level and optional mitigation strategy.

### Context

- One-to-many child of the iteration (not a specific phase — external dependencies are plan-wide).
- Examples: "Auth0 tenant provisioning", "Payment gateway sandbox credentials", "Mobile team delivering SDK v2", "Legal approval for GDPR data flows".
- The optional `work_item_number` field marks when the dependency becomes blocking.
- `implementation_plan_critic` verifies that high/critical external dependencies have concrete mitigations.
- `senior_developer` tracks these as pre-conditions to flag blockers early.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | The iteration this external dependency belongs to. |
| `name` | TEXT | NOT NULL | — | Short name of the external dependency (e.g., "Stripe Sandbox Credentials"). |
| `description` | TEXT | NOT NULL | — | What this dependency is and why the plan needs it. |
| `work_item_number` | INTEGER | nullable | — | The `phase_number` at which this dependency becomes blocking, if known. |
| `risk_level` | TEXT | NOT NULL, CHECK(`low` \| `medium` \| `high` \| `critical`) | — | How much risk this dependency poses to the plan if not resolved. |
| `mitigation` | TEXT | nullable | — | How the team plans to manage or reduce the dependency risk (e.g., "Use mock server for Phase 1–2; real credentials required for Phase 3"). |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO-8601 timestamp of row creation. |

### Relationships

- **Parent:** `iteration` via `iteration_id`
- **References by value:** `work_item.phase_number` via `work_item_number`

### MCP tool access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | `entity_type: "plan_external_dependency"` |
| Query | `changelog_query` | `entity_type: "plan_external_dependency"` — filter by `iteration_id` |

---

> **Note:** Critical path tracking (formerly in a dedicated `plan_critical_path` table) is now handled by the `work_item.critical_path_sequence` column — a nullable INTEGER where NULL means not on the critical path and a non-NULL value indicates the phase's position in the critical path sequence.

---

## Entity Relationship Summary

```
iteration ──────────────────────────────────────────────────────────┐
│                                                                    │
├─ plan_overview (1:N per revision)                                 │
│   ├─ risks (JSON array, inline)                                   │
│   └─ assumptions (JSON array, inline)                             │
│                                                                    │
├─ work_item (1:N, phase_number sequential within iteration)       │
│   ├─ work_item_requirement  (M:N → requirement)                  │
│   ├─ work_item_component    (M:N → component)                    │
│   ├─ entry_criteria          (JSON array, inline)                 │
│   ├─ exit_criteria           (JSON array, inline)                 │
│   ├─ checkpoint_focus        (JSON array, inline)                 │
│   └─ work_item_risk         (1:N)                                │
│                                                                    │
└─ plan_external_dependency  (1:N)                                  │
```

## Cross-domain references

| Planning table | References | Domain |
|----------------|------------|--------|
| `work_item_requirement` | `requirement.id` | Requirements |
| `work_item_component` | `component.id` | Architecture |
