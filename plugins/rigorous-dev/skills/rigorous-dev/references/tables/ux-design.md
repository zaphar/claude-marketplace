# UX Design Domain — Table Reference

This document covers the 19 database tables that capture all output produced by the `ux_designer` agent during the `ux_design` phase. The `ux_critic` validates this data. Downstream consumers are `backend_architect` (flows and screens drive API surface decisions) and `implementation_planner` (flows and screens scope UI work phases).

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
| **User Flows** | `user_flow`, `user_flow_step`, `user_flow_step_branch`, `user_flow_error_state`, `user_flow_requirement`, `user_flow_data_dependency` |
| **Screens** | `screen`, `screen_component`, `screen_state`, `screen_responsive_variant` |
| **Design System** | `design_system` |
| **UX Configuration** | `accessibility_config`, `responsive_config`, `feedback_pattern`, `info_architecture` |
| **Traceability & Assets** | `persona_addressed`, `persona_addressed_flow`, `ux_asset`, `ux_requirement_mapping` |

Every table carries `iteration_id` (mandatory) and `revision_id` (optional) to pin rows to the exact producer-critic loop that created them.

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
| `revision_id` | INTEGER | FK → `revision(id)` | NULL | Revision within the iteration (NULL = initial draft). |
| `name` | TEXT | NOT NULL | — | Short human-readable name, e.g. "User Registration". |
| `goal` | TEXT | NOT NULL | — | The user's objective for completing this flow. |
| `persona_id` | TEXT | FK → `persona(id)` | NULL | Primary persona this flow is designed for. |
| `entry_point` | TEXT | — | NULL | Where the flow starts (screen name, URL, trigger event). |
| `success_state` | TEXT | — | NULL | Observable outcome that marks successful completion. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp set at insert time. |

**Relationships:**
- Has many `user_flow_step` (ordered steps)
- Has many `user_flow_error_state` (error recovery paths)
- Has many `user_flow_requirement` (requirements this flow satisfies)
- Has many `user_flow_data_dependency` (data the flow needs)
- Referenced by `persona_addressed_flow` (persona coverage tracking)
- Referenced by `plan_phase_flow` (implementation planning)
- Referenced by `traceability_mapping` via `addressed_by_type = 'flow'`

**MCP tool access:**
- **Write:** `changelog_insert` with `entity_type: "user_flow"`. Pass `steps`, `error_states`, `requirements_addressed`, and `data_dependencies` arrays in the `data` object — child rows are inserted atomically.
- **Read:** `changelog_query` with `entity_type: "user_flow"`. Use `include_related: true` to expand `steps` (with `branches`), `error_states`, `requirements`, and `data_dependencies` in one call.
- **Trace:** `traceability_query` with `target_type: "flow"` to walk from requirement → flow → referenced screens.

---

### `user_flow_step`

**Purpose:** A single discrete action within a user flow. Steps are ordered by `step_number` and each names the screen on which the action occurs. Decision-point steps can have conditional branches.

**Context:** The `ux_designer` inserts steps as part of the parent `user_flow` insert (they are not inserted separately). The `backend_architect` uses step-to-screen mappings to validate API coverage. Steps with `is_decision_point = 1` must have at least one `user_flow_step_branch` row.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `flow_id` | TEXT | NOT NULL, FK → `user_flow(id)` | — | Parent flow. |
| `step_number` | INTEGER | NOT NULL | — | 1-based ordering within the flow. |
| `action` | TEXT | NOT NULL | — | What the user does, e.g. "Submits login form". |
| `screen` | TEXT | NOT NULL | — | Screen name where this action occurs (matches `screen.name`). |
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

### `user_flow_data_dependency`

**Purpose:** Records data that must be available (from the backend or prior steps) for the flow to proceed. Helps the `backend_architect` identify what the API must supply.

**Context:** Each dependency is a free-text string naming a data item, e.g. "authenticated user session", "product catalogue list", "shipping rate quote". This table is intentionally simple — it is not typed or linked to `data_entity` rows, keeping UX design decoupled from data modelling.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `flow_id` | TEXT | NOT NULL, FK → `user_flow(id)` | — | Parent flow. |
| `dependency` | TEXT | NOT NULL | — | Named data item required by the flow. |

**Relationships:**
- Belongs to `user_flow`

**MCP tool access:**
- **Write:** Inserted automatically as part of `changelog_insert` for `user_flow` via the `data_dependencies` array.
- **Read:** Returned as the `data_dependencies` array when querying `user_flow` with `include_related: true`.

---

## Screens

### `screen`

**Purpose:** A distinct UI view or page in the application. Screens are the atomic building blocks of the visual design. Each screen has a purpose, optional wireframe and mockup paths, and is decomposed into components, states, and responsive variants.

**Context:** The `ux_designer` creates one `screen` row per unique view (e.g., `SCREEN-001 Dashboard`, `SCREEN-002 Login`). Screens are referenced by name in `user_flow_step.screen`. The `backend_architect` cross-references screens with flow steps to determine which endpoints each screen requires. The `implementation_planner` references `screen_id` in `plan_phase_screen`.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | — | Canonical screen identifier, e.g. `SCREEN-001`. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | Iteration that produced this screen. |
| `revision_id` | INTEGER | FK → `revision(id)` | NULL | Revision within the iteration. |
| `name` | TEXT | NOT NULL | — | Screen name, e.g. "Dashboard". Must match `user_flow_step.screen` references. |
| `purpose` | TEXT | NOT NULL | — | What this screen enables the user to do. |
| `wireframe_path` | TEXT | — | NULL | Relative path to the default wireframe file. |
| `mockup_path` | TEXT | — | NULL | Relative path to the high-fidelity mockup file. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp set at insert time. |

**Relationships:**
- Has many `screen_component`
- Has many `screen_state`
- Has many `screen_responsive_variant`
- Referenced by `user_flow_step.screen` (by name, not by FK)
- Referenced by `ux_asset.screen_id`
- Referenced by `plan_phase_screen`
- Referenced by `traceability_mapping` via `addressed_by_type = 'screen'`

**MCP tool access:**
- **Write:** `changelog_insert` with `entity_type: "screen"`. Pass `components`, `states`, and `responsive_variants` arrays in `data` — all child rows inserted atomically.
- **Read:** `changelog_query` with `entity_type: "screen"`. Use `include_related: true` to get `components`, `states`, and `responsive_variants` expanded inline.
- **Trace:** `traceability_query` with `target_type: "screen"` to find flows that reference this screen and requirements satisfied by those flows.

---

### `screen_component`

**Purpose:** Names a UI component placed on a screen. Establishes the component inventory for each screen — used by the `implementation_planner` to estimate build effort and by the `senior_developer` to know what to implement.

**Context:** Component names should match design system component names where applicable (e.g., "DataTable", "SearchBar", "PrimaryButton"). This is a flat list — component composition and props are out of scope for UX design.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `screen_id` | TEXT | NOT NULL, FK → `screen(id)` | — | Parent screen. |
| `component_name` | TEXT | NOT NULL | — | Name of the component, e.g. "NavigationSidebar". |

**Relationships:**
- Belongs to `screen`

**MCP tool access:**
- **Write:** Inserted automatically as part of `changelog_insert` for `screen` via the `components` array. Values may be plain strings or objects with a `component_name`/`name` key.
- **Read:** Returned as the `components` array when querying `screen` with `include_related: true`.

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

**Context:** One row per breakpoint per screen. Breakpoint names should align with values defined in `responsive_config`. The `ux_critic` validates that screens either have responsive variants for all defined breakpoints or explicitly omit them with justification.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `screen_id` | TEXT | NOT NULL, FK → `screen(id)` | — | Parent screen. |
| `breakpoint` | TEXT | NOT NULL | — | Breakpoint label, e.g. `mobile`, `tablet`, `desktop`. Should match a breakpoint defined in `responsive_config`. |
| `wireframe_path` | TEXT | — | NULL | Path to a wireframe for this breakpoint. |
| `layout_changes` | TEXT | — | NULL | Prose description of what changes at this breakpoint. |

**Relationships:**
- Belongs to `screen`

**MCP tool access:**
- **Write:** Inserted automatically as part of `changelog_insert` for `screen` via the `responsive_variants` array.
- **Read:** Returned as the `responsive_variants` array when querying `screen` with `include_related: true`.

---

## Design System

### `design_system`

**Purpose:** Key-value store for design system tokens and configuration. A flat, flexible table that holds colours, typography scales, spacing scales, shadow definitions, border radii, component library choices, icon set, and any other design token the `ux_designer` wants to formalise.

**Context:** Rows are grouped by `category` (e.g., `colors`, `typography`, `spacing`, `elevation`, `component_library`) and then keyed within each category (e.g., `primary`, `heading_1`, `base_unit`). The `senior_developer` reads design system rows to implement a consistent token file or CSS custom properties. The `ux_critic` validates coverage across at least colours, typography, and spacing categories.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | Iteration that produced this token. |
| `revision_id` | INTEGER | FK → `revision(id)` | NULL | Revision within the iteration. |
| `category` | TEXT | NOT NULL | — | Token category, e.g. `colors`, `typography`, `spacing`, `shadows`. |
| `key` | TEXT | NOT NULL | — | Token name within the category, e.g. `primary`, `heading_1`, `base_4`. |
| `value` | TEXT | NOT NULL | — | Token value, e.g. `#2563EB`, `16px/24px Inter`, `4px`. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp set at insert time. |

**Relationships:**
- Belongs to `iteration` / `revision`
- No FK children — flat store

**MCP tool access:**
- **Read:** `changelog_query` with `entity_type: "design_system"`. Filter by `iteration_id` and optionally `filters: { category: "colors" }` to retrieve tokens by category.
- **Write:** `design_system` appears in the `changelog_insert` enum but does **not** have a handler implemented — calling it will throw `Unsupported entity_type`. Insert rows directly via SQL until a handler is added.

---

## UX Configuration

The following four tables — `accessibility_config`, `responsive_config`, `feedback_pattern`, and `info_architecture` — share the same flat key-value structure as `design_system`. They differ only in semantics and in `info_architecture`'s additional `parent_id` self-reference.

---

### `accessibility_config`

**Purpose:** Captures accessibility decisions and configuration: WCAG compliance target level, focus management strategy, ARIA landmark usage, keyboard navigation patterns, colour contrast ratios, motion/animation preferences, and screen reader guidance.

**Context:** The `ux_designer` populates this table to make accessibility requirements explicit and reviewable. The `ux_critic` checks that WCAG level is specified and that colour contrast tokens in `design_system` are consistent with the contrast policy recorded here. The `senior_developer` reads these rows to configure accessibility tooling and implement ARIA patterns.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | Iteration that produced this config entry. |
| `revision_id` | INTEGER | FK → `revision(id)` | NULL | Revision within the iteration. |
| `category` | TEXT | NOT NULL | — | Grouping, e.g. `wcag`, `focus_management`, `aria`, `keyboard`, `motion`. |
| `key` | TEXT | NOT NULL | — | Config key within the category, e.g. `target_level`, `focus_ring_style`. |
| `value` | TEXT | NOT NULL | — | Config value, e.g. `AA`, `2px solid #2563EB`. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp set at insert time. |

**Relationships:**
- Belongs to `iteration` / `revision`
- No FK children

**MCP tool access:**
- **Write / Read:** Not in `ENTITY_TABLE`; not a handler in `changelog_insert`. Insert and query via direct SQL.
- `accessibility_config` is listed in the `changelog_insert` input schema enum but has no handler — calling it will throw `Unsupported entity_type`.

---

### `responsive_config`

**Purpose:** Defines the responsive layout strategy: breakpoint definitions, layout grid configuration, fluid typography settings, touch target sizes, and any platform-specific layout rules.

**Context:** Breakpoint names defined here are the canonical set that `screen_responsive_variant.breakpoint` values must reference. The `ux_critic` validates consistency between these definitions and the breakpoints actually used in screen variants. The `senior_developer` uses this table to configure the CSS grid/flexbox system or the component library's breakpoint theme.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | Iteration that produced this config entry. |
| `revision_id` | INTEGER | FK → `revision(id)` | NULL | Revision within the iteration. |
| `category` | TEXT | NOT NULL | — | Grouping, e.g. `breakpoints`, `grid`, `typography`, `touch_targets`. |
| `key` | TEXT | NOT NULL | — | Config key, e.g. `mobile`, `tablet`, `columns_desktop`. |
| `value` | TEXT | NOT NULL | — | Config value, e.g. `320px`, `768px`, `12`. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp set at insert time. |

**Relationships:**
- Belongs to `iteration` / `revision`
- Informally referenced by `screen_responsive_variant.breakpoint` (no enforced FK)

**MCP tool access:**
- **Write / Read:** Not in `ENTITY_TABLE` and no `changelog_insert` handler. Insert and query via direct SQL.

---

### `feedback_pattern`

**Purpose:** Defines the UX patterns used to communicate system feedback to users: loading indicators (spinners, skeletons), success notifications (toast duration, position), error display (inline field errors vs. banner vs. modal), empty states, and confirmation dialogs.

**Context:** Standardising feedback patterns prevents each screen from inventing its own loading/error treatment. The `ux_critic` validates that at minimum loading, error, and success patterns are defined. The `senior_developer` uses this table to implement a shared feedback component library.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | Iteration that produced this entry. |
| `revision_id` | INTEGER | FK → `revision(id)` | NULL | Revision within the iteration. |
| `category` | TEXT | NOT NULL | — | Pattern type, e.g. `loading`, `success`, `error`, `empty_state`, `confirmation`. |
| `key` | TEXT | NOT NULL | — | Pattern variant key, e.g. `global_spinner`, `inline_field_error`, `toast_success`. |
| `value` | TEXT | NOT NULL | — | Pattern specification, e.g. `Skeleton placeholder, 200 ms delay before display`. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp set at insert time. |

**Relationships:**
- Belongs to `iteration` / `revision`
- No FK children

**MCP tool access:**
- **Write / Read:** Not in `ENTITY_TABLE` and no `changelog_insert` handler. Insert and query via direct SQL.

---

### `info_architecture`

**Purpose:** Captures the information architecture of the application: site map, navigation hierarchy, route structure, content groupings, and labelling decisions. Rows form a tree via the `parent_id` self-reference.

**Context:** The `ux_designer` builds the IA before or in parallel with screen design, ensuring that navigation flows match the site map. The `backend_architect` reads top-level IA nodes to confirm routing strategy aligns with the frontend navigation tree. The `ux_critic` checks that all screens are reachable from the IA root.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | Iteration that produced this node. |
| `revision_id` | INTEGER | FK → `revision(id)` | NULL | Revision within the iteration. |
| `category` | TEXT | NOT NULL | — | Node type, e.g. `navigation`, `route`, `content_group`, `label`. |
| `key` | TEXT | NOT NULL | — | Node identifier, e.g. `main_nav_dashboard`, `/settings/profile`. |
| `value` | TEXT | NOT NULL | — | Node description or label, e.g. "Dashboard", "User profile settings page". |
| `parent_id` | INTEGER | FK → `info_architecture(id)` | NULL | Parent node for hierarchical nesting. NULL = root node. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp set at insert time. |

**Relationships:**
- Belongs to `iteration` / `revision`
- Self-referential tree via `parent_id` → `info_architecture(id)`

**MCP tool access:**
- **Write / Read:** Not in `ENTITY_TABLE` and no `changelog_insert` handler. Insert and query via direct SQL. For the full tree, use a recursive CTE: `WITH RECURSIVE tree AS (SELECT * FROM info_architecture WHERE parent_id IS NULL UNION ALL SELECT i.* FROM info_architecture i JOIN tree t ON i.parent_id = t.id) SELECT * FROM tree`.

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
| `revision_id` | INTEGER | FK → `revision(id)` | NULL | Revision within the iteration. |
| `persona_id` | TEXT | NOT NULL, FK → `persona(id)` | — | The persona being addressed. |
| `goal` | TEXT | NOT NULL | — | The persona goal this addresses (may paraphrase the `persona_goal` text). |
| `how_addressed` | TEXT | NOT NULL | — | How the UX design meets this goal. |

**Relationships:**
- Belongs to `iteration` / `revision`
- References `persona`
- Has many `persona_addressed_flow`

**MCP tool access:**
- **Write / Read:** Not in `ENTITY_TABLE` and no `changelog_insert` handler. Insert and query via direct SQL.

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
- **Write / Read:** Not in `ENTITY_TABLE` and no `changelog_insert` handler. Insert and query via direct SQL.

---

### `ux_asset`

**Purpose:** A registry of all UX artefact files: wireframes, mockups, prototypes, icons, images, and videos. Provides a canonical inventory of design files and their locations, optionally linked to a specific screen.

**Context:** The `ux_designer` registers every file it produces. `wireframe_path` and `mockup_path` on `screen` and `screen_state` rows should correspond to `path` values in this table. The `ux_critic` verifies that all referenced paths have corresponding `ux_asset` entries. Assets not tied to a specific screen (e.g., a global icon set, a prototype video) leave `screen_id` NULL.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | Iteration that produced this asset. |
| `revision_id` | INTEGER | FK → `revision(id)` | NULL | Revision within the iteration. |
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
- **Write / Read:** Not in `ENTITY_TABLE` and no `changelog_insert` handler. Insert and query via direct SQL. Example query to list all wireframes for a screen: `SELECT * FROM ux_asset WHERE screen_id = ? AND type = 'wireframe'`.

---

### `ux_requirement_mapping`

**Purpose:** Explicit traceability from a requirement to the UX artefact (screen, flow, or design decision) that addresses it. Answers: "is every requirement visible in the UX design, and where?" Distinct from `user_flow_requirement` (which links flows to requirements) — this table allows linking any UX artefact to a requirement via free text.

**Context:** The `ux_designer` populates this table to demonstrate coverage of all `usability`, `functional`, and `performance` requirements in the UX design. The `ux_critic` uses it to check completeness. The `backend_architect` cross-references it when designing APIs to ensure all requirement-driven screens have endpoints.

**Columns:**

| Column | Type | Constraints | Default | Description |
|---|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | Iteration that produced this mapping. |
| `revision_id` | INTEGER | FK → `revision(id)` | NULL | Revision within the iteration. |
| `requirement_id` | TEXT | NOT NULL, FK → `requirement(id)` | — | The requirement being addressed. |
| `addressed_by` | TEXT | NOT NULL | — | Free-text identifier of the UX artefact: a screen ID, flow ID, design system category, or prose description. |
| `notes` | TEXT | — | NULL | Additional context about how this requirement is addressed. |

**Relationships:**
- Belongs to `iteration` / `revision`
- References `requirement`

**MCP tool access:**
- **Write / Read:** Not in `ENTITY_TABLE` and no `changelog_insert` handler. Insert and query via direct SQL. Example query to audit coverage: `SELECT r.id, r.description, m.addressed_by FROM requirement r LEFT JOIN ux_requirement_mapping m ON r.id = m.requirement_id AND m.iteration_id = ? WHERE r.iteration_id = ? ORDER BY r.id`.

---

## MCP Tool Access Summary

| Table | `changelog_insert` | `changelog_query` | Notes |
|---|---|---|---|
| `user_flow` | ✅ `entity_type: "user_flow"` | ✅ `entity_type: "user_flow"` | `include_related: true` expands steps, branches, error states, requirements, data dependencies |
| `user_flow_step` | via `user_flow` | via `user_flow` | Not directly addressable |
| `user_flow_step_branch` | via `user_flow` | via `user_flow` | Not directly addressable |
| `user_flow_error_state` | via `user_flow` | via `user_flow` | Not directly addressable |
| `user_flow_requirement` | via `user_flow` | via `user_flow` | Not directly addressable |
| `user_flow_data_dependency` | via `user_flow` | via `user_flow` | Not directly addressable |
| `screen` | ✅ `entity_type: "screen"` | ✅ `entity_type: "screen"` | `include_related: true` expands components, states, responsive variants |
| `screen_component` | via `screen` | via `screen` | Not directly addressable |
| `screen_state` | via `screen` | via `screen` | Not directly addressable |
| `screen_responsive_variant` | via `screen` | via `screen` | Not directly addressable |
| `design_system` | ⚠️ In enum, no handler | ✅ `entity_type: "design_system"` | Write via direct SQL until handler is implemented |
| `accessibility_config` | ⚠️ In enum, no handler | ❌ Not in ENTITY_TABLE | Insert and query via direct SQL |
| `responsive_config` | ❌ Not in enum | ❌ Not in ENTITY_TABLE | Insert and query via direct SQL |
| `feedback_pattern` | ❌ Not in enum | ❌ Not in ENTITY_TABLE | Insert and query via direct SQL |
| `info_architecture` | ❌ Not in enum | ❌ Not in ENTITY_TABLE | Insert and query via direct SQL; supports recursive CTE for tree traversal |
| `persona_addressed` | ❌ Not in enum | ❌ Not in ENTITY_TABLE | Insert and query via direct SQL |
| `persona_addressed_flow` | ❌ Not in enum | ❌ Not in ENTITY_TABLE | Insert and query via direct SQL |
| `ux_asset` | ❌ Not in enum | ❌ Not in ENTITY_TABLE | Insert and query via direct SQL |
| `ux_requirement_mapping` | ❌ Not in enum | ❌ Not in ENTITY_TABLE | Insert and query via direct SQL |

### `traceability_query` integration

The `traceability_query` tool supports `target_type: "flow"` and `target_type: "screen"`. When called with a flow or screen ID it walks the full chain:

- **flow chain:** requirement → `user_flow_requirement` → `user_flow` → `user_flow_step` → referenced `screen` names → matched `screen` rows
- **screen chain:** `screen` → `user_flow_step` (by `screen` name) → `user_flow` → `user_flow_requirement` → `requirement`

---

## Key Design Decisions

1. **Two insertion strategies.** `user_flow` and `screen` use transactional `changelog_insert` handlers that atomically insert parent + all child rows. The flat config tables (`design_system`, `accessibility_config`, etc.) are row-per-token stores without handlers — they are inserted individually via SQL.

2. **Screen referenced by name, not FK.** `user_flow_step.screen` stores a screen name string rather than a `screen_id` FK. This allows steps to reference screens before the screen row is formally created, supporting iterative design. The trade-off is that name consistency must be enforced by the `ux_critic`, not the database.

3. **Append-only revision model.** No UX rows are updated in place. When the `ux_critic` rejects a design, a new `revision` is created and the `ux_designer` inserts fresh rows with the new `revision_id`. All prior revisions remain queryable.

4. **Flat key-value for config.** `design_system`, `accessibility_config`, `responsive_config`, `feedback_pattern`, and `info_architecture` use a `category / key / value` pattern rather than typed columns. This makes them extensible without schema changes — new token categories can be added freely. The `info_architecture` table adds `parent_id` to support a tree structure within this flat scheme.

5. **`ux_requirement_mapping` vs `user_flow_requirement`.** Both tables link requirements to UX artefacts, but they serve different purposes: `user_flow_requirement` is a precise FK join (flow → requirement) used for automated coverage checks. `ux_requirement_mapping` is a free-text association that can point to any UX artefact (screen, flow, design decision) and is used by the designer to demonstrate broader coverage in prose form.
