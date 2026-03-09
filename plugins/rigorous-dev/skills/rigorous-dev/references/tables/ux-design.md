# UX Design Domain — Table Reference

This document covers the 12 database tables that capture all output produced by the `ux_designer` agent during the `ux_design` phase. The `ux_critic` validates this data. Downstream consumers are `backend_architect` (flows and screens drive API surface decisions) and `implementation_planner` (flows and screens scope UI work phases).

**Database:** `.claude/rigorous-dev.db`  
**Phase:** `ux_design`  
**Producer:** `ux_designer`  
**Critic:** `ux_critic`  
**Downstream consumers:** `backend_architect`, `implementation_planner`

---

## Domain Overview

The UX design domain is organised into five sub-areas:

| Sub-area | Tables |
|---|---|
| **User Flows** | `user_flow`, `user_flow_step`, `user_flow_error_state` |
| **Screens** | `screen` |
| **UX Configuration** | `info_architecture` |
| **Traceability & Assets** | `persona_addressed`, `persona_addressed_flow`, `ux_asset` |

Every primary table carries `revision_id` (NOT NULL, FK → `revision`) to pin rows to the exact producer-critic loop that created them. The iteration is derived via the `revision → phase → iteration` foreign-key chain (or via the `entity_context` VIEW).

---

## User Flows

### `user_flow`

**Purpose:** Top-level record for a single named user journey. Represents a goal-oriented path a user takes through the application — from entry point to success state. Each flow belongs to a persona and maps to one or more requirements.

**Context:** The `ux_designer` creates one `user_flow` row per distinct journey (e.g., "User signs up", "Admin exports report"). IDs follow the pattern `FLOW-XXX`. The `backend_architect` reads flows to verify that every step has a corresponding API endpoint. The `implementation_planner` references flows when assigning UI work to plan phases.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | — | Canonical flow identifier, e.g. `FLOW-001`. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | Revision that produced this flow. |
| `name` | TEXT | NOT NULL | — | Short human-readable name, e.g. "User Registration". |
| `goal` | TEXT | NOT NULL | — | The user's objective for completing this flow. |
| `persona_id` | TEXT | FK → `persona(id)` | NULL | Primary persona this flow is designed for. |
| `entry_point` | TEXT | — | NULL | Where the flow starts (screen name, URL, trigger event). |
| `success_state` | TEXT | — | NULL | Observable outcome that marks successful completion. |
| `data_dependencies` | TEXT | NOT NULL | `'[]'` | JSON array of data dependency strings — data that must be available (from the backend or prior steps) for the flow to proceed (e.g., `"authenticated user session"`, `"product catalogue list"`). Replaces the former `user_flow_data_dependency` child table. |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO-8601 timestamp set at insert time. |
| `updated_at` | TEXT | — | ISO 8601 timestamp of the last UPSERT update. NULL if never updated after initial insert. |

**Relationships:**
- Has many `user_flow_step` (ordered steps)
- Has many `user_flow_error_state` (error recovery paths)
- JSON array: `data_dependencies` (inline on this table)
- Referenced by `persona_addressed_flow` (persona coverage tracking)
- Referenced by `plan_phase_flow` (implementation planning)
- Referenced by `requirement_trace` via `addressed_by_type = 'flow'`

**MCP tool access:**
- **Write:** `changelog_insert` with `entity_type: "user_flow"`. Pass `steps`, `error_states`, `requirements_addressed`, and `data_dependencies` arrays in the `data` object — child rows are inserted atomically.
- **Read:** `changelog_query` with `entity_type: "user_flow"`. Use `include_related: true` to expand `steps` (with `branches`), `error_states`, `requirements`, and `data_dependencies` in one call.
- **Trace:** `traceability_query` with `target_type: "flow"` to walk from requirement → flow → referenced screens.

---

### `user_flow_step`

**Purpose:** A single discrete action within a user flow. Steps are ordered by `step_number` and each names the interaction surface on which the action occurs — a screen for UI apps, an endpoint for APIs, a CLI command, or NULL when not applicable. Decision-point steps carry their conditional branches inline as a JSON array.

**Context:** The `ux_designer` inserts steps as part of the parent `user_flow` insert (they are not inserted separately). The `backend_architect` uses step-to-surface mappings to validate API coverage. Steps with `is_decision_point = 1` should have a non-NULL `branches` JSON array.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `flow_id` | TEXT | NOT NULL, FK → `user_flow(id)` | — | Parent flow. |
| `step_number` | INTEGER | NOT NULL | — | 1-based ordering within the flow. |
| `action` | TEXT | NOT NULL | — | What the user does, e.g. "Submits login form". |
| `surface` | TEXT | — | NULL | Interaction surface where this action occurs. For UI apps, a screen name (matches `screen.name`). For APIs, an endpoint. For CLIs, a command. NULL when not applicable. |
| `is_decision_point` | INTEGER | — | `0` | `1` if this step branches; `0` otherwise. SQLite boolean. |
| `branches` | JSON | — | NULL | Conditional branches at this step. Format: `[{"condition": "valid credentials", "next_step": 3}, {"condition": "invalid", "next_step": 5}]`. NULL for non-decision steps, populated when `is_decision_point = 1`. |

**Relationships:**
- Belongs to `user_flow`
- **JSON array:** `branches` (inline on this table)

**Indexes:**

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_user_flow_step_surface` | `(surface)` | Supports soft-FK lookups joining `user_flow_step.surface` to `screen.name`. |

**MCP tool access:**
- **Write:** Inserted automatically as part of `changelog_insert` for `user_flow`. Not directly addressable. Pass `branches` array on each step with `is_decision_point: true`.
- **Read:** Returned as the `steps` array when querying `user_flow` with `include_related: true`. Each step's `branches` is parsed from JSON.

---

### `user_flow_error_state`

**Purpose:** An error condition that can occur during the flow and the recovery path the user must take. Captures exception handling from a UX perspective (not from a system error perspective).

**Context:** Error states are sibling records of the flow rather than children of individual steps, because an error may span multiple steps or originate from backend failures. Examples: "Session expires mid-flow → redirect to login with return URL", "Payment gateway timeout → show retry dialog".

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `flow_id` | TEXT | NOT NULL, FK → `user_flow(id)` | — | Parent flow. |
| `condition` | TEXT | NOT NULL | — | What went wrong, e.g. "API returns 429 rate-limited". |
| `recovery` | TEXT | NOT NULL | — | How the UI recovers, e.g. "Show inline error, disable submit for 5 s". |

**Relationships:**
- Belongs to `user_flow`

**MCP tool access:**
- **Write:** Inserted automatically as part of `changelog_insert` for `user_flow` via the `error_states` array.
- **Read:** Returned as the `error_states` array when querying `user_flow` with `include_related: true`.

---

> **Note:** Flow-to-requirement traceability (formerly tracked in a dedicated `user_flow_requirement` table) is now handled by `requirement_trace` with `addressed_by_type = 'flow'`. See [cross-cutting.md](cross-cutting.md#requirement_trace) for details.

---

## Screens

### `screen`

**Purpose:** A distinct UI view or page in the application. Screens are the atomic building blocks of the visual design. Each screen has a purpose, optional wireframe and mockup paths, and is decomposed into components, states, and responsive variants.

**Context:** The `ux_designer` creates one `screen` row per unique view (e.g., `SCREEN-001 Dashboard`, `SCREEN-002 Login`). Screens are referenced by name in `user_flow_step.surface`. The `backend_architect` cross-references screens with flow steps to determine which endpoints each screen requires. The `implementation_planner` references `screen_id` in `plan_phase_screen`.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | — | Canonical screen identifier, e.g. `SCREEN-001`. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | Revision that produced this screen. |
| `name` | TEXT | NOT NULL | — | Screen name, e.g. "Dashboard". Must match `user_flow_step.surface` references. |
| `purpose` | TEXT | NOT NULL | — | What this screen enables the user to do. |
| `wireframe_path` | TEXT | — | NULL | Relative path to the default wireframe file. |
| `mockup_path` | TEXT | — | NULL | Relative path to the high-fidelity mockup file. |
| `components` | TEXT | NOT NULL | `'[]'` | JSON array of component name strings placed on this screen (e.g., `["NavigationSidebar", "DataTable", "SearchBar"]`). Replaces the former `screen_component` child table. |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO-8601 timestamp set at insert time. |
| `updated_at` | TEXT | — | ISO 8601 timestamp of the last UPSERT update. NULL if never updated after initial insert. |

**Relationships:**
- JSON array: `components` (inline on this table)
- Referenced by `user_flow_step.surface` (by name, not by FK)
- Referenced by `ux_asset.screen_id`
- Referenced by `plan_phase_screen`
- Referenced by `requirement_trace` via `addressed_by_type = 'screen'`

**Indexes:**

| Index | Columns | Purpose |
|-------|---------|---------|
| `idx_screen_name` | `(name)` | Supports lookup queries matching `user_flow_step.surface` and `requirement_trace.addressed_by` to screen names. |

**MCP tool access:**
- **Write:** `changelog_insert` with `entity_type: "screen"`. Pass `components`, `states`, and `responsive_variants` arrays in `data` — all child rows inserted atomically.
- **Read:** `changelog_query` with `entity_type: "screen"`. Use `include_related: true` to get `components`, `states`, and `responsive_variants` expanded inline.
- **Trace:** `traceability_query` with `target_type: "screen"` to find flows that reference this screen and requirements satisfied by those flows.

---

## Traceability & Assets

### `persona_addressed`

**Purpose:** Documents how the UX design addresses a specific persona's goals. Each row states which persona is covered, what their goal is in this context, and how the design addresses it. Serves as the UX design's accountability record to the personas defined in requirements.

**Context:** The `ux_critic` validates that every persona defined in `persona` (for the iteration) has at least one `persona_addressed` row. Each row is linked to one or more user flows via `persona_addressed_flow`, closing the traceability chain: persona → addressed by → flows.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | Revision that produced this record. |
| `persona_id` | TEXT | NOT NULL, FK → `persona(id)` | — | The persona being addressed. |
| `goal` | TEXT | NOT NULL | — | The persona goal this addresses (may paraphrase the persona's goals JSON array). |
| `how_addressed` | TEXT | NOT NULL | — | How the UX design meets this goal. |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO-8601 timestamp of row creation. |

**Relationships:**
- Belongs to `revision` (iteration derived via revision → phase → iteration)
- References `persona`
- Has many `persona_addressed_flow`

**MCP tool access:**
- **Write:** `changelog_insert` with `entity_type: "persona_addressed"`. Pass `persona_id`, `goal`, `how_addressed`, and a `flows` array of flow IDs in the `data` object — the parent row and all `persona_addressed_flow` child rows are inserted atomically.
- **Read:** `changelog_query` with `entity_type: "persona_addressed"`. Use `include_related: true` to attach the `flows` array (list of `flow_id` values from `persona_addressed_flow`).

---

### `persona_addressed_flow`

**Purpose:** Many-to-many join table linking a `persona_addressed` record to the user flows that deliver the addressed goal. Answers: "which flows implement the design's promise to this persona?"

**Context:** The `ux_critic` checks that every `persona_addressed` row has at least one flow. The `implementation_planner` can use this join to prioritise flows by persona criticality.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `persona_addressed_id` | INTEGER | NOT NULL, FK → `persona_addressed(id)`, part of PRIMARY KEY(persona_addressed_id, flow_id) | — | Parent persona-addressed record. |
| `flow_id` | TEXT | NOT NULL, FK → `user_flow(id)`, part of PRIMARY KEY(persona_addressed_id, flow_id) | — | A flow that delivers the addressed goal. |

**Relationships:**
- Belongs to `persona_addressed`
- References `user_flow`

**MCP tool access:**
- **Write:** Inserted automatically as part of `changelog_insert` for `persona_addressed` via the `flows` array. Not directly addressable.
- **Read:** Returned as the `flows` array when querying `persona_addressed` with `include_related: true`.

---

### `ux_asset`

**Purpose:** A registry of all UX artefact files: wireframes, mockups, prototypes, icons, images, and videos. Provides a canonical inventory of design files and their locations, optionally linked to a specific screen.

**Context:** The `ux_designer` registers every file it produces. `wireframe_path` and `mockup_path` on `screen` rows should correspond to `path` values in this table. The `ux_critic` verifies that all referenced paths have corresponding `ux_asset` entries. Assets not tied to a specific screen (e.g., a global icon set, a prototype video) leave `screen_id` NULL.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | Revision that produced this asset. |
| `name` | TEXT | NOT NULL | — | Human-readable asset name, e.g. "Dashboard Default Wireframe". |
| `path` | TEXT | NOT NULL | — | Relative file path from the project root. |
| `asset_type` | TEXT | NOT NULL | — | Asset category (e.g., `wireframe`, `mockup`, `prototype`, `icon`, `image`, `video`). |
| `screen_id` | TEXT | FK → `screen(id)` | NULL | Screen this asset belongs to, if applicable. |
| `description` | TEXT | — | NULL | Optional notes about the asset. |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO-8601 timestamp set at insert time. |

**Relationships:**
- Belongs to `revision` (iteration derived via revision → phase → iteration)
- Optionally belongs to `screen`

**MCP tool access:**
- **Write:** `changelog_insert` with `entity_type: "ux_asset"`. Accepts a single object or an array of `{ name, path, type, screen_id?, description? }` objects.
- **Read:** `changelog_query` with `entity_type: "ux_asset"`. Optionally use `filters: { asset_type: "wireframe" }` or `filters: { screen_id: "SCREEN-001" }` to retrieve specific asset types or screen-specific assets.

---

> **Note:** UX screen-level requirement traceability (formerly tracked in a dedicated `ux_requirement_mapping` table) is now handled via `requirement_trace` with `addressed_by_type = 'screen'`. See [cross-cutting.md](cross-cutting.md#requirement_trace) for details.

---

## MCP Tool Access Summary

| Table | `changelog_insert` | `changelog_query` | Notes |
|---|---|---|---|
| `user_flow` | ✅ `entity_type: "user_flow"` | ✅ `entity_type: "user_flow"` | `include_related: true` expands steps, branches, error states, requirements; `data_dependencies` is a JSON column |
| `user_flow_step` | via `user_flow` | via `user_flow` | Not directly addressable; `branches` is a JSON column |
| `user_flow_error_state` | via `user_flow` | via `user_flow` | Not directly addressable |
| `screen` | ✅ `entity_type: "screen"` | ✅ `entity_type: "screen"` | `include_related: true` expands states, responsive variants; `components` is a JSON column |
| `info_architecture` | ✅ `entity_type: "info_architecture"` | ✅ `entity_type: "info_architecture"` | `include_related: true` attaches direct `children`; supports `parent_id` for tree nesting |
| `persona_addressed` | ✅ `entity_type: "persona_addressed"` | ✅ `entity_type: "persona_addressed"` | `include_related: true` expands `flows`; pass `flows` array in data for atomic child insert |
| `persona_addressed_flow` | via `persona_addressed` | via `persona_addressed` | Not directly addressable |
| `ux_asset` | ✅ `entity_type: "ux_asset"` | ✅ `entity_type: "ux_asset"` | Accepts single or array; filter by `asset_type` or `screen_id` |
| _(screen traceability)_ | — | — | Now via `requirement_trace` with `addressed_by_type = 'screen'` (see [cross-cutting.md](cross-cutting.md#requirement_trace)) |

### `traceability_query` integration

The `traceability_query` tool supports `target_type: "flow"` and `target_type: "screen"`. When called with a flow or screen ID it walks the full chain:

- **flow chain:** requirement → `requirement_trace` (where `addressed_by_type = 'flow'`) → `user_flow` → `user_flow_step` → referenced `surface` names → matched `screen` rows
- **screen chain:** `screen` → `user_flow_step` (by `surface` name) → `user_flow` → `requirement_trace` (where `addressed_by_type = 'flow'`) → `requirement`

---

## Key Design Decisions

1. **Two insertion strategies.** `user_flow` and `screen` use transactional `changelog_insert` handlers with UPSERT semantics that atomically insert parent + all child rows. The flat `info_architecture` table uses a batch-insert handler that accepts a single object or an array of key-value entries. `persona_addressed` uses a parent-child handler that atomically inserts the parent row and its `persona_addressed_flow` children.

2. **Surface referenced by name, not FK.** `user_flow_step.surface` stores a surface name string (typically a screen name for UI apps) rather than a `screen_id` FK. This allows steps to reference screens before the screen row is formally created, supporting iterative design. The column is nullable to accommodate API-only and CLI applications where there is no visual screen. The trade-off is that name consistency must be enforced by the `ux_critic`, not the database.

3. **Append-only revision model.** No UX rows are updated in place. When the `ux_critic` rejects a design, a new `revision` is created and the `ux_designer` inserts fresh rows with the new `revision_id`. All prior revisions remain queryable.

4. **Flat key-value for info_architecture.** The `info_architecture` table uses a `category / key / value` pattern rather than typed columns. This makes it extensible without schema changes — new navigation categories can be added freely. The table adds `parent_id` to support a tree structure within this flat scheme.

5. **Screen and flow traceability via `requirement_trace`.** UX requirement coverage — both screen-level and flow-level — is now consolidated into the cross-cutting `requirement_trace` table using `addressed_by_type = 'screen'` or `addressed_by_type = 'flow'`, giving a single unified traceability chain across all artifact types. See [cross-cutting.md](cross-cutting.md#requirement_trace) for details.
