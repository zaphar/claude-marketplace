# Implementation Domain — Table Design Reference

This document covers the 6 tables that record output produced during the **implementation phase** (senior_developer) and related cross-cutting tracking. It includes per-requirement and per-component implementation status, blockers encountered, VCS commits, and intermediate assets.

**Producers:** `senior_developer`, `test_writer`
**Validator:** `senior_developer_critic`
**Consumer:** `qa_engineer` (reads to know what to test)

---

## Table of Contents

1. [implementation_requirement_status](#1-implementation_requirement_status)
2. [implementation_component_status](#2-implementation_component_status)
3. [implementation_blocker](#3-implementation_blocker)
4. [implementation_blocker_requirement](#4-implementation_blocker_requirement)
5. [vcs_commit](#5-vcs_commit)
6. [intermediate_asset](#6-intermediate_asset)

---

## 1. `implementation_requirement_status`

### Purpose

Records the implementation progress of each requirement as assessed by the senior_developer. This is the canonical source of truth for "is REQ-042 done?" from the implementation perspective.

### Context

Written per iteration. A requirement may appear across iterations; later rows supersede earlier ones. The QA engineer consults this table to determine what has been built and what still needs testing. Uses `INSERT OR REPLACE` on the `UNIQUE(iteration_id, requirement_id)` constraint so re-inserting during the same iteration updates the existing row.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `iteration_id` | INTEGER | NO | — | FK → `iteration(id)` ON DELETE CASCADE | The iteration this status belongs to. |
| `requirement_id` | TEXT | NO | — | FK → `requirement(id)` ON DELETE CASCADE | The requirement being assessed (e.g. `REQ-003`). |
| `status` | TEXT | NO | — | CHECK IN ('implemented','partial','not_started','blocked','not_applicable') | Implementation state. |
| `notes` | TEXT | YES | NULL | — | Explanation for non-`implemented` statuses; required when `status` is `partial` or `blocked` in practice. |

**Constraints:**
- `UNIQUE(iteration_id, requirement_id)` — one status per requirement per iteration; re-inserts update in place.

### Relationships

- **Parent:** `iteration` (via `iteration_id`)
- **Sibling FK:** `requirement` (via `requirement_id`)

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | `entity_type: "implementation_manifest"`. Nested under `data.requirement_status[]`. Each element: `{ requirement_id, status, notes }`. Uses `INSERT OR REPLACE`. |
| Query | `changelog_query` | `entity_type: "implementation_manifest"`, filter by `iteration_id`. Pass `include_related: true` to attach requirement_status, component_status, and blockers. |

---

## 2. `implementation_component_status`

### Purpose

Records per-component implementation progress alongside requirement status. Where `implementation_requirement_status` tracks the "what", this table tracks the "which system part".

### Context

Useful for architecture-level dashboards: the critic checks that each component reaches `complete` before the phase exits. A component's status may be `partial` across iterations until all its requirements are done. Uses `INSERT OR REPLACE` on the `UNIQUE(iteration_id, component_id)` constraint so re-inserting during the same iteration updates the existing row.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `iteration_id` | INTEGER | NO | — | FK → `iteration(id)` ON DELETE CASCADE | The iteration this status belongs to. |
| `component_id` | TEXT | NO | — | FK → `component(id)` ON DELETE CASCADE | The architecture component (e.g. `COMP-002`). |
| `status` | TEXT | NO | — | CHECK IN ('complete','partial','not_started') | Build completion state. |
| `notes` | TEXT | YES | NULL | — | Optional detail for partial or not_started entries. |

**Constraints:**
- `UNIQUE(iteration_id, component_id)` — one status per component per iteration; re-inserts update in place.

### Relationships

- **Parent:** `iteration` (via `iteration_id`)
- **Sibling FK:** `component` (via `component_id`)

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | `entity_type: "implementation_manifest"`. Nested under `data.component_status[]`. Each element: `{ component_id, status, notes }`. Uses `INSERT OR REPLACE`. |
| Query | `changelog_query` | `entity_type: "implementation_manifest"` with `include_related: true`; component statuses are returned as the `component_status` array. |

---

## 3. `implementation_blocker`

### Purpose

Records any impediment the senior_developer encountered during implementation that prevented complete work. Blockers are the primary signal used by the senior_developer_critic to decide whether to reject a revision and escalate.

### Context

Blockers have three severity levels. `needs_escalation = 1` flags that the senior_developer believes human intervention or architecture revision is required. The critic checks this flag and severity when writing its verdict in `revision.feedback`.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `iteration_id` | INTEGER | NO | — | FK → `iteration(id)` ON DELETE CASCADE | The iteration this blocker belongs to. |
| `description` | TEXT | NO | — | — | Full description of the blocker. |
| `severity` | TEXT | NO | — | CHECK IN ('critical','major','minor') | Impact level: `critical` = work cannot proceed; `major` = significant workaround needed; `minor` = inconvenience only. |
| `recommendation` | TEXT | YES | NULL | — | Suggested resolution. |
| `needs_escalation` | INTEGER | NO | 0 | — | Boolean (0/1). `1` means the developer believes this cannot be resolved without outside input. |

### Relationships

- **Parent:** `iteration` (via `iteration_id`)
- **Children:** `implementation_blocker_requirement`

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | `entity_type: "implementation_manifest"`. Nested under `data.blockers[]`. Each element: `{ description, severity, recommendation, needs_escalation, requirements[] }`. |
| Query | `changelog_query` | `entity_type: "implementation_manifest"` with `include_related: true`; blockers are returned as the `blockers` array, each with a nested `requirements` array. |

---

## 4. `implementation_blocker_requirement`

### Purpose

Join table associating each blocker with the requirements it prevents from being implemented. Enables the critic and QA to pinpoint exactly which requirements are at risk.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `blocker_id` | INTEGER | NO | — | FK → `implementation_blocker(id)` ON DELETE CASCADE, PK part | The blocker. |
| `requirement_id` | TEXT | NO | — | FK → `requirement(id)` ON DELETE CASCADE, PK part | The blocked requirement (e.g. `REQ-014`). |

**Primary Key:** `(blocker_id, requirement_id)` — composite.

### Relationships

- **Parents:** `implementation_blocker` (via `blocker_id`), `requirement` (via `requirement_id`)

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Populated from `data.blockers[n].requirements[]` in the `implementation_manifest` call. Uses `INSERT OR IGNORE`. |
| Query | `changelog_query` | `entity_type: "implementation_manifest"` with `include_related: true`; blocker rows include a nested `requirements` array of requirement IDs from this join table. |

---

## 5. `vcs_commit`

### Purpose

Links a Git (or Jujutsu) commit SHA to a specific work item and revision attempt within an iteration. Acts as the durable connection between the changelog database and the version control history.

### Context

**Populated by both `commit_link` and `changelog_insert` MCP tools.** The senior_developer calls `commit_link` after each commit. Every commit belongs to exactly one work item and one revision attempt. The `iteration_summary` read tool surfaces these rows alongside deliverables to give a complete picture of an iteration's VCS activity.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `iteration_id` | INTEGER | NO | — | FK → `iteration(id)` ON DELETE CASCADE | The iteration this commit belongs to. |
| `work_item_id` | INTEGER | NO | — | FK → `work_item(id)` ON DELETE CASCADE | The work item this commit implements. |
| `revision_id` | INTEGER | NO | — | FK → `revision(id)` ON DELETE CASCADE | The producer-critic revision attempt that produced this commit. |
| `commit_sha` | TEXT | NO | — | UNIQUE with `iteration_id` | Full or abbreviated VCS commit identifier. |
| `message` | TEXT | YES | NULL | — | Commit message summary. |
| `created_at` | TEXT | NO | `(datetime('now'))` | ISO 8601 | Timestamp set by the MCP server on insert. |

**Constraints:**
- `UNIQUE(iteration_id, commit_sha)` — prevents recording the same commit SHA twice within an iteration.

### Relationships

- **Parents:** `iteration` (via `iteration_id`), `work_item` (via `work_item_id`), `revision` (via `revision_id`)

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `commit_link` | Required fields: `iteration_id`, `work_item_id`, `revision_id`, `commit_sha`. Optional: `message`. |
| Insert | `changelog_insert` | `entity_type: "vcs_commit"`. Fields: `work_item_id`, `commit_sha`, `message`. |
| Query | `changelog_query` | `entity_type: "vcs_commit"`. Filters: `work_item_id`, `revision_id`, `commit_sha`. |

---

## 6. `intermediate_asset`

### Purpose

Stores transient work items, notes, plans, and references that the senior_developer (or any agent) creates during work but that are not final deliverables. Used for producer-critic handoff context — the critic reads intermediate assets to understand what the producer was thinking.

### Context

`asset_type` determines what `content` contains. For example, `commit_ref` and `file_ref` typically store identifiers rather than full content, `work_item` captures task notes, `plan` captures sub-phase planning text, and `note` captures free-form observations. The field is free-form — agents may use any descriptive type string.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `phase_id` | INTEGER | YES | NULL | FK → `phase(id)` | Phase in which it was created. |
| `iteration_id` | INTEGER | NO | — | FK → `iteration(id)` ON DELETE CASCADE | The iteration this asset belongs to. |
| `asset_type` | TEXT | NO | — | — | Free-form semantic type of the asset (e.g., `work_item`, `plan`, `note`, `commit_ref`, `file_ref`). |
| `title` | TEXT | NO | — | — | Short descriptive title. |
| `content` | TEXT | YES | NULL | — | Full content; may be NULL for `commit_ref`/`file_ref` where the identifier is in `title`. |
| `created_at` | TEXT | NO | `(datetime('now'))` | ISO 8601 | Timestamp set by the MCP server on insert. |

### Relationships

- **Parents:** `phase` (via `phase_id`), `iteration` (via `iteration_id`).

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | `entity_type: "intermediate_asset"`. Fields: `phase_id`, `asset_type`, `title`, `content`. |
| Query | `changelog_query` with `entity_type: "intermediate_asset"` and `iteration_id`. |

---

## Entity Relationship Summary

```
iteration
 ├── implementation_requirement_status (iteration_id, requirement_id)
 ├── implementation_component_status (iteration_id, component_id)
 ├── implementation_blocker (iteration_id)
 │    └── implementation_blocker_requirement (blocker_id, requirement_id)
 ├── vcs_commit (iteration_id, work_item_id, revision_id)
 └── intermediate_asset (phase_id, iteration_id)
```

---

## Implementation Status & Blocker Tracking

All 4 implementation tables (`implementation_requirement_status`, `implementation_component_status`, `implementation_blocker`, `implementation_blocker_requirement`) are inserted via `changelog_insert` with `entity_type: "implementation_manifest"`. Requirement and component status tables use `INSERT OR REPLACE` on their UNIQUE constraints, while blockers use plain `INSERT`. Querying with `include_related: true` returns all related rows grouped by iteration.

| Nested key in `data` | Table | Notes |
|-----------------------|-------|-------|
| `requirement_status[]` | `implementation_requirement_status` | `{ requirement_id, status, notes }` |
| `component_status[]` | `implementation_component_status` | `{ component_id, status, notes }` |
| `blockers[]` | `implementation_blocker` + `implementation_blocker_requirement` | Each blocker accepts `requirements[]` for the join table. |

---

## Cross-Domain References

| This domain references | Via column | Why |
|------------------------|-----------|-----|
| `iteration` | `iteration_id` | All rows scoped to an iteration (direct FK). |
| `work_item` | `work_item_id` | VCS commits tied to the work item they implement. |
| `revision` | `revision_id` | VCS commits tied to the producer-critic revision attempt. |
| `phase` | `phase_id` | Phase-level asset scoping (intermediate_asset only). |
| `requirement` | `requirement_id` | Traceability from implementation status and blockers to requirements. |
| `component` | `component_id` | Traceability from implementation status to architecture. |

The QA engineer reads `implementation_requirement_status` → `requirement` (with the `acceptance_criteria` JSON column) to build the test matrix without re-reading requirements from scratch.
