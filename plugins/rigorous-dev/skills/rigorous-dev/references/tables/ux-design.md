# UX Design Domain — Table Reference

This document covers the 13 database tables that capture all output produced by the `ux_designer` agent during the `ux_design` phase. The `ux_critic` validates this data. Downstream consumers are `backend_architect` (flows and screens drive API surface decisions) and `implementation_planner` (flows and screens scope UI work phases).

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
| **User Flows** | `user_flow`, `user_flow_step`, `user_flow_step_branch`, `user_flow_error_state`, `user_flow_requirement` |
| **Screens** | `screen`, `screen_state`, `screen_responsive_variant` |
| **UX Configuration** | `ux_config` (discriminated by `config_type`: `design_system`, `accessibility`, `responsive`, `feedback_pattern`), `info_architecture` |
| **Traceability & Assets** | `persona_addressed`, `persona_addressed_flow`, `ux_asset` |

Every table carries `iteration_id` (mandatory) and `revision_id` (required/NOT NULL) to pin rows to the exact producer-critic loop that created them.

---

## User Flows

### `user_flow`

**Purpose:** Top-level record for a single named user journey. Represents a goal-oriented path a user takes through the application — from entry point to success state. Each flow belongs to a persona and maps to one or more requirements.

**Context:** The `ux_designer` creates one `user_flow` row per distinct journey (e.g., "User signs up", "Admin exports report"). IDs follow the pattern `FLOW-XXX`. The `backend_architect` reads flows to verify that every step has a corresponding API endpoint. The `implementation_planner` references flows when assigning UI work to plan phases.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | — | Canonical flow identifier, e.g. `FLOW-001`. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | Iteration that produced this flow. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | Revision within the iteration. |
| `name` | TEXT | NOT NULL | — | Short human-readable name, e.g. "User Registration". |
| `goal` | TEXT | NOT NULL | — | The user's objective for completing this flow. |
| `persona_id` | TEXT | FK → `persona(id)` | NULL | Primary persona this flow is designed for. |
| `entry_point` | TEXT | — | NULL | Where the flow starts (screen name, URL, trigger event). |
| `success_state` | TEXT | — | NULL | Observable outcome that marks successful completion. |
| `data_dependencies` | TEXT | NOT NULL | `'[]'` | JSON array of data dependency strings — data that must be available (from the backend or prior steps) for the flow to proceed (e.g., `"authenticated user session"`, `"product catalogue list"`). Replaces the former `user_flow_data_dependency` child table. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp set at insert time. |
| `updated_at` | TEXT | — | ISO 8601 timestamp of the last UPSERT update. NULL if never updated after initial insert. |

**Relationships:**
- Has many `user_flow_step` (ordered steps)
- Has many `user_flow_error_state` (error recovery paths)
- Has many `user_flow_requirement` (requirements this flow satisfies)
- JSON array: `data_dependencies` (inline on this table)
- Referenced by `persona_addressed_flow` (persona coverage tracking)
- Referenced by `plan_phase_flow` (implementation planning)
- Referenced by `traceability_mapping` via `addressed_by_type = 'flow'`

**MCP tool access:**
- **Write:** `changelog_insert` with `entity_type: "user_flow"`. Pass `steps`, `error_states`, `requirements_addressed`, and `data_dependencies` arrays in the `data` object — child rows are inserted atomically.
- **Read:** `changelog_query` with `entity_type: "user_flow"`. Use `include_related: true` to expand `steps` (with `branches`), `error_states`, `requirements`, and `data_dependencies` in one call.
- **Trace:** `traceability_query` with `target_type: "flow"` to walk from requirement → flow → referenced screens.

---

### `user_flow_step`

**Purpose:** A single discrete action within a user flow. Steps are ordered by `step_number` and each names the interaction surface on which the action occurs — a screen for UI apps, an endpoint for APIs, a CLI command, or NULL when not applicable. Decision-point steps can have conditional branches.

**Context:** The `ux_designer` inserts steps as part of the parent `user_flow` insert (they are not inserted separately). The `backend_architect` uses step-to-surface mappings to validate API coverage. Steps with `is_decision_point = 1` must have at least one `user_flow_step_branch` row.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `flow_id` | TEXT | NOT NULL, FK → `user_flow(id)` | — | Parent flow. |
| `step_number` | INTEGER | NOT NULL | — | 1-based ordering within the flow. |
| `action` | TEXT | NOT NULL | — | What the user does, e.g. "Submits login form". |
| `surface` | TEXT | — | NULL | Interaction surface where this action occurs. For UI apps, a screen name (matches `screen.name`). For APIs, an endpoint. For CLIs, a command. NULL when not applicable. |
| `is_decision_point` | INTEGER | — | `0` | `1` if this step branches; `0` otherwise. SQLite boolean. |

**Relationships:**
- Belongs to `user_flow`
- Has many `user_flow_step_branch` (conditional paths when `is_decision_point = 1`)

**MCP tool access:**
- **Write:** Inserted automatically as part of `changelog_insert` for `user_flow`. Not directly addressable.
- **Read:** Returned as the `steps` array when querying `user_flow` with `include_related: true`.

---

### `user_flow_step_branch`

**Purpose:** A conditional branch at a decision-point step. Captures the condition that triggers the branch and which step number it leads to (can be a forward or backward jump).

**Context:** Used to model decision trees, retry loops, and alternate paths within a flow. The `ux_critic` checks that every decision-point step has at least one branch, and that `next_step` values refer to valid `step_number` values within the same flow.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `step_id` | INTEGER | NOT NULL, FK → `user_flow_step(id)` | — | The decision-point step this branch belongs to. |
| `condition` | TEXT | NOT NULL | — | Human-readable condition, e.g. "If email already exists". |
| `next_step` | INTEGER | NOT NULL | — | `step_number` to jump to when condition is met. |

**Relationships:**
- Belongs to `user_flow_step`

**MCP tool access:**
- **Write:** Inserted automatically as part of `changelog_insert` for `user_flow` when a step includes a `branches` array.
- **Read:** Returned nested inside each step's `branches` array when querying `user_flow` with `include_related: true`.

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

### `user_flow_requirement`

**Purpose:** Many-to-many join table linking a user flow to the requirements it addresses. Enables bidirectional traceability: "which requirements does this flow cover?" and "which flows cover this requirement?"

**Context:** The `ux_critic` validates that every requirement of category `usability` or `functional` is covered by at least one flow. The `implementation_planner` reads this join to ensure each plan phase covers the flows that satisfy its requirements.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `flow_id` | TEXT | NOT NULL, FK → `user_flow(id)` | — | The flow. |
| `requirement_id` | TEXT | NOT NULL, FK → `requirement(id)` | — | The requirement it addresses. |
| — | — | PRIMARY KEY (`flow_id`, `requirement_id`) | — | Prevents duplicate mappings. |

**Relationships:**
- Belongs to `user_flow`
- References `requirement`

**MCP tool access:**
- **Write:** Inserted automatically as part of `changelog_insert` for `user_flow` via the `requirements_addressed` array. Uses `INSERT OR IGNORE` — duplicates are silently skipped.
- **Read:** Returned as the `requirements` array when querying `user_flow` with `include_related: true`.

---

## Screens

### `screen`

**Purpose:** A distinct UI view or page in the application. Screens are the atomic building blocks of the visual design. Each screen has a purpose, optional wireframe and mockup paths, and is decomposed into components, states, and responsive variants.

**Context:** The `ux_designer` creates one `screen` row per unique view (e.g., `SCREEN-001 Dashboard`, `SCREEN-002 Login`). Screens are referenced by name in `user_flow_step.surface`. The `backend_architect` cross-references screens with flow steps to determine which endpoints each screen requires. The `implementation_planner` references `screen_id` in `plan_phase_screen`.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | — | Canonical screen identifier, e.g. `SCREEN-001`. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | Iteration that produced this screen. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | Revision within the iteration. |
| `name` | TEXT | NOT NULL | — | Screen name, e.g. "Dashboard". Must match `user_flow_step.surface` references. |
| `purpose` | TEXT | NOT NULL | — | What this screen enables the user to do. |
| `wireframe_path` | TEXT | — | NULL | Relative path to the default wireframe file. |
| `mockup_path` | TEXT | — | NULL | Relative path to the high-fidelity mockup file. |
| `components` | TEXT | NOT NULL | `'[]'` | JSON array of component name strings placed on this screen (e.g., `["NavigationSidebar", "DataTable", "SearchBar"]`). Replaces the former `screen_component` child table. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp set at insert time. |
| `updated_at` | TEXT | — | ISO 8601 timestamp of the last UPSERT update. NULL if never updated after initial insert. |

**Relationships:**
- Has many `screen_state`
- Has many `screen_responsive_variant`
- JSON array: `components` (inline on this table)
- Referenced by `user_flow_step.surface` (by name, not by FK)
- Referenced by `ux_asset.screen_id`
- Referenced by `plan_phase_screen`
- Referenced by `traceability_mapping` via `addressed_by_type = 'screen'`

**MCP tool access:**
- **Write:** `changelog_insert` with `entity_type: "screen"`. Pass `components`, `states`, and `responsive_variants` arrays in `data` — all child rows inserted atomically.
- **Read:** `changelog_query` with `entity_type: "screen"`. Use `include_related: true` to get `components`, `states`, and `responsive_variants` expanded inline.
- **Trace:** `traceability_query` with `target_type: "screen"` to find flows that reference this screen and requirements satisfied by those flows.

---

### `screen_state`

**Purpose:** A named UI state variant of a screen. Captures how the screen looks and behaves when it is in a particular condition (loading, empty, error, etc.). Each state may optionally have its own wireframe.

**Context:** The `ux_designer` must define at minimum a `default` state. The `ux_critic` checks that screens with data dependencies include `loading` and `empty` states, and that action-bearing screens include an `error` state. The `senior_developer` implements each state as a conditional render branch.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `screen_id` | TEXT | NOT NULL, FK → `screen(id)` | — | Parent screen. |
| `name` | TEXT | NOT NULL, CHECK(`name` IN allowed list) | — | State name. Allowed values: `default`, `loading`, `empty`, `error`, `success`, `session_expired`, `forced`, `editing`, `reviewing`, `search_results`, `complete`. |
| `description` | TEXT | — | NULL | What this state looks like and when it appears. |
| `wireframe_path` | TEXT | — | NULL | Path to a wireframe specific to this state. |

**Relationships:**
- Belongs to `screen`

**MCP tool access:**
- **Write:** Inserted automatically as part of `changelog_insert` for `screen` via the `states` array.
- **Read:** Returned as the `states` array when querying `screen` with `include_related: true`.

---

### `screen_responsive_variant`

**Purpose:** Describes how a screen layout changes at a specific responsive breakpoint. Captures breakpoint-specific wireframes and prose descriptions of layout adjustments (e.g., "sidebar collapses to hamburger menu at mobile breakpoint").

**Context:** One row per breakpoint per screen. Breakpoint names should align with values defined in `ux_config` (config_type `responsive`). The `ux_critic` validates that screens either have responsive variants for all defined breakpoints or explicitly omit them with justification.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `screen_id` | TEXT | NOT NULL, FK → `screen(id)` | — | Parent screen. |
| `breakpoint` | TEXT | NOT NULL | — | Breakpoint label, e.g. `mobile`, `tablet`, `desktop`. Should match a breakpoint defined in `ux_config` (config_type `responsive`). |
| `wireframe_path` | TEXT | — | NULL | Path to a wireframe for this breakpoint. |
| `layout_changes` | TEXT | — | NULL | Prose description of what changes at this breakpoint. |

**Relationships:**
- Belongs to `screen`

**MCP tool access:**
- **Write:** Inserted automatically as part of `changelog_insert` for `screen` via the `responsive_variants` array.
- **Read:** Returned as the `responsive_variants` array when querying `screen` with `include_related: true`.

---

## UX Configuration

### `ux_config`

**Purpose:** Unified key-value store for all UX configuration: design system tokens, accessibility settings, responsive layout definitions, and feedback patterns. A `config_type` discriminator column distinguishes the four concerns.

**Context:** Rows are grouped first by `config_type` (one of `design_system`, `accessibility`, `responsive`, `feedback_pattern`) and then by `category` / `key` within each type. This consolidation follows the same pattern as `architecture_config`. The `ux_critic` validates coverage across config types — at minimum: colours/typography/spacing for `design_system`, WCAG level for `accessibility`, breakpoints for `responsive`, and loading/error/success for `feedback_pattern`. The `senior_developer` reads these rows to implement token files, accessibility tooling, responsive grid systems, and shared feedback components.

**Config types and typical categories:**

| `config_type` | Typical categories | Example keys |
|---|---|---|
| `design_system` | `colors`, `typography`, `spacing`, `elevation`, `component_library` | `primary`, `heading_1`, `base_unit` |
| `accessibility` | `wcag`, `focus_management`, `aria`, `keyboard`, `motion` | `target_level`, `focus_ring_style` |
| `responsive` | `breakpoints`, `grid`, `typography`, `touch_targets` | `mobile`, `tablet`, `columns_desktop` |
| `feedback_pattern` | `loading`, `success`, `error`, `empty_state`, `confirmation` | `global_spinner`, `inline_field_error`, `toast_success` |

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | Iteration that produced this entry. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | Revision within the iteration. |
| `config_type` | TEXT | NOT NULL, CHECK IN (`design_system`, `accessibility`, `responsive`, `feedback_pattern`) | — | Discriminator for the type of UX configuration. |
| `category` | TEXT | NOT NULL | — | Grouping within the config type, e.g. `colors`, `wcag`, `breakpoints`, `loading`. |
| `key` | TEXT | NOT NULL | — | Config key within the category. |
| `value` | TEXT | NOT NULL | — | Config value. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp set at insert time. |

**Relationships:**
- Belongs to `iteration` / `revision`
- No FK children — flat store
- Informally referenced by `screen_responsive_variant.breakpoint` (config_type `responsive`, no enforced FK)

**MCP tool access:**
- **Write:** `changelog_insert` with `entity_type: "ux_config"`. Accepts a single object or an array of `{ config_type, category, key, value }` objects — all rows are inserted in one call. The `config_type` field is required on every entry.
- **Read:** `changelog_query` with `entity_type: "ux_config"`. Filter by `iteration_id` and `filters: { config_type: "design_system" }` to retrieve a specific config type. Add `filters: { config_type: "accessibility", category: "wcag" }` for finer-grained queries.

---

### `info_architecture`

**Purpose:** Captures the information architecture of the application: site map, navigation hierarchy, route structure, content groupings, and labelling decisions. Rows form a tree via the `parent_id` self-reference.

**Context:** The `ux_designer` builds the IA before or in parallel with screen design, ensuring that navigation flows match the site map. The `backend_architect` reads top-level IA nodes to confirm routing strategy aligns with the frontend navigation tree. The `ux_critic` checks that all screens are reachable from the IA root.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | Iteration that produced this node. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | Revision within the iteration. |
| `category` | TEXT | NOT NULL | — | Node type, e.g. `navigation`, `route`, `content_group`, `label`. |
| `key` | TEXT | NOT NULL | — | Node identifier, e.g. `main_nav_dashboard`, `/settings/profile`. |
| `value` | TEXT | NOT NULL | — | Node description or label, e.g. "Dashboard", "User profile settings page". |
| `parent_id` | INTEGER | FK → `info_architecture(id)` | NULL | Parent node for hierarchical nesting. NULL = root node. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp set at insert time. |

**Relationships:**
- Belongs to `iteration` / `revision`
- Self-referential tree via `parent_id` → `info_architecture(id)`

**MCP tool access:**
- **Write:** `changelog_insert` with `entity_type: "info_architecture"`. Accepts a single object or an array of `{ category, key, value, parent_id }` objects. Set `parent_id` to an existing `info_architecture` row ID for nested nodes, or omit for root nodes.
- **Read:** `changelog_query` with `entity_type: "info_architecture"`. Use `include_related: true` to attach direct `children` for each node. For the full tree, use `filters: { parent_id: null }` to get root nodes with their children, then recurse as needed.

---

## Traceability & Assets

### `persona_addressed`

**Purpose:** Documents how the UX design addresses a specific persona's goals. Each row states which persona is covered, what their goal is in this context, and how the design addresses it. Serves as the UX design's accountability record to the personas defined in requirements.

**Context:** The `ux_critic` validates that every persona defined in `persona` (for the iteration) has at least one `persona_addressed` row. Each row is linked to one or more user flows via `persona_addressed_flow`, closing the traceability chain: persona → addressed by → flows.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | Iteration that produced this record. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | Revision within the iteration. |
| `persona_id` | TEXT | NOT NULL, FK → `persona(id)` | — | The persona being addressed. |
| `goal` | TEXT | NOT NULL | — | The persona goal this addresses (may paraphrase the persona's goals JSON array). |
| `how_addressed` | TEXT | NOT NULL | — | How the UX design meets this goal. |

**Relationships:**
- Belongs to `iteration` / `revision`
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
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `persona_addressed_id` | INTEGER | NOT NULL, FK → `persona_addressed(id)` | — | Parent persona-addressed record. |
| `flow_id` | TEXT | NOT NULL, FK → `user_flow(id)` | — | A flow that delivers the addressed goal. |

**Relationships:**
- Belongs to `persona_addressed`
- References `user_flow`

**MCP tool access:**
- **Write:** Inserted automatically as part of `changelog_insert` for `persona_addressed` via the `flows` array. Not directly addressable.
- **Read:** Returned as the `flows` array when querying `persona_addressed` with `include_related: true`.

---

### `ux_asset`

**Purpose:** A registry of all UX artefact files: wireframes, mockups, prototypes, icons, images, and videos. Provides a canonical inventory of design files and their locations, optionally linked to a specific screen.

**Context:** The `ux_designer` registers every file it produces. `wireframe_path` and `mockup_path` on `screen` and `screen_state` rows should correspond to `path` values in this table. The `ux_critic` verifies that all referenced paths have corresponding `ux_asset` entries. Assets not tied to a specific screen (e.g., a global icon set, a prototype video) leave `screen_id` NULL.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | Iteration that produced this asset. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | Revision within the iteration. |
| `name` | TEXT | NOT NULL | — | Human-readable asset name, e.g. "Dashboard Default Wireframe". |
| `path` | TEXT | NOT NULL | — | Relative file path from the project root. |
| `type` | TEXT | NOT NULL, CHECK(`type` IN (`wireframe`, `mockup`, `prototype`, `icon`, `image`, `video`)) | — | Asset category. |
| `screen_id` | TEXT | FK → `screen(id)` | NULL | Screen this asset belongs to, if applicable. |
| `description` | TEXT | — | NULL | Optional notes about the asset. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp set at insert time. |

**Relationships:**
- Belongs to `iteration` / `revision`
- Optionally belongs to `screen`

**MCP tool access:**
- **Write:** `changelog_insert` with `entity_type: "ux_asset"`. Accepts a single object or an array of `{ name, path, type, screen_id?, description? }` objects.
- **Read:** `changelog_query` with `entity_type: "ux_asset"`. Filter by `iteration_id` and optionally `filters: { type: "wireframe" }` or `filters: { screen_id: "SCREEN-001" }` to retrieve specific asset types or screen-specific assets.

---

> **Note:** UX screen-level requirement traceability (formerly tracked in a dedicated `ux_requirement_mapping` table) is now handled via `traceability_mapping` with `addressed_by_type = 'screen'`. See [cross-cutting.md](cross-cutting.md#traceability_mapping) for details.

---

## MCP Tool Access Summary

| Table | `changelog_insert` | `changelog_query` | Notes |
|---|---|---|---|
| `user_flow` | ✅ `entity_type: "user_flow"` | ✅ `entity_type: "user_flow"` | `include_related: true` expands steps, branches, error states, requirements; `data_dependencies` is a JSON column |
| `user_flow_step` | via `user_flow` | via `user_flow` | Not directly addressable |
| `user_flow_step_branch` | via `user_flow` | via `user_flow` | Not directly addressable |
| `user_flow_error_state` | via `user_flow` | via `user_flow` | Not directly addressable |
| `user_flow_requirement` | via `user_flow` | via `user_flow` | Not directly addressable |
| `screen` | ✅ `entity_type: "screen"` | ✅ `entity_type: "screen"` | `include_related: true` expands states, responsive variants; `components` is a JSON column |
| `screen_state` | via `screen` | via `screen` | Not directly addressable |
| `screen_responsive_variant` | via `screen` | via `screen` | Not directly addressable |
| `ux_config` | ✅ `entity_type: "ux_config"` | ✅ `entity_type: "ux_config"` | Accepts single or array of `{ config_type, category, key, value }`. Filter by `config_type`. |
| `info_architecture` | ✅ `entity_type: "info_architecture"` | ✅ `entity_type: "info_architecture"` | `include_related: true` attaches direct `children`; supports `parent_id` for tree nesting |
| `persona_addressed` | ✅ `entity_type: "persona_addressed"` | ✅ `entity_type: "persona_addressed"` | `include_related: true` expands `flows`; pass `flows` array in data for atomic child insert |
| `persona_addressed_flow` | via `persona_addressed` | via `persona_addressed` | Not directly addressable |
| `ux_asset` | ✅ `entity_type: "ux_asset"` | ✅ `entity_type: "ux_asset"` | Accepts single or array; filter by `type` or `screen_id` |
| _(screen traceability)_ | — | — | Now via `traceability_mapping` with `addressed_by_type = 'screen'` (see [cross-cutting.md](cross-cutting.md#traceability_mapping)) |

### `traceability_query` integration

The `traceability_query` tool supports `target_type: "flow"` and `target_type: "screen"`. When called with a flow or screen ID it walks the full chain:

- **flow chain:** requirement → `user_flow_requirement` → `user_flow` → `user_flow_step` → referenced `surface` names → matched `screen` rows
- **screen chain:** `screen` → `user_flow_step` (by `surface` name) → `user_flow` → `user_flow_requirement` → `requirement`

---

## Key Design Decisions

1. **Two insertion strategies.** `user_flow` and `screen` use transactional `changelog_insert` handlers with UPSERT semantics that atomically insert parent + all child rows. The flat config tables (`ux_config`, `info_architecture`) use batch-insert handlers that accept a single object or an array of key-value entries. `persona_addressed` uses a parent-child handler that atomically inserts the parent row and its `persona_addressed_flow` children.

2. **Surface referenced by name, not FK.** `user_flow_step.surface` stores a surface name string (typically a screen name for UI apps) rather than a `screen_id` FK. This allows steps to reference screens before the screen row is formally created, supporting iterative design. The column is nullable to accommodate API-only and CLI applications where there is no visual screen. The trade-off is that name consistency must be enforced by the `ux_critic`, not the database.

3. **Append-only revision model.** No UX rows are updated in place. When the `ux_critic` rejects a design, a new `revision` is created and the `ux_designer` inserts fresh rows with the new `revision_id`. All prior revisions remain queryable.

4. **Flat key-value for config.** `ux_config` and `info_architecture` use a `category / key / value` pattern rather than typed columns. This makes them extensible without schema changes — new token categories can be added freely. `ux_config` adds a `config_type` discriminator to distinguish design system, accessibility, responsive, and feedback pattern entries in a single table. The `info_architecture` table adds `parent_id` to support a tree structure within this flat scheme.

5. **Screen traceability via `traceability_mapping`.** UX screen-level requirement coverage was previously tracked in a dedicated `ux_requirement_mapping` table. This is now consolidated into the cross-cutting `traceability_mapping` table using `addressed_by_type = 'screen'`, giving a single unified traceability chain across all artifact types. `user_flow_requirement` remains the precise FK join (flow → requirement) used for automated coverage checks within the UX domain.
