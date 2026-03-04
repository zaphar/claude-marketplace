# Implementation Domain — Table Design Reference

This document covers the 16 tables that record output produced during the **implementation phase** (senior_developer) and the **test-writing step** (test_writer). It includes all files created or modified, per-requirement and per-component status, API endpoints built, dependencies added, database migrations run, blockers encountered, VCS commits, and intermediate/deliverable assets.

**Producers:** `senior_developer`, `test_writer`
**Validator:** `senior_developer_critic`
**Consumer:** `qa_engineer` (reads to know what to test)

---

## Table of Contents

1. [implementation_manifest](#1-implementation_manifest)
2. [implementation_file](#2-implementation_file)
3. [implementation_file_requirement](#3-implementation_file_requirement)
4. [implementation_requirement_status](#4-implementation_requirement_status)
5. [implementation_component_status](#5-implementation_component_status)
6. [implementation_api_endpoint](#6-implementation_api_endpoint)
7. [implementation_api_endpoint_requirement](#7-implementation_api_endpoint_requirement)
8. [implementation_dependency_added](#8-implementation_dependency_added)
9. [implementation_db_migration](#9-implementation_db_migration)
10. [implementation_blocker](#10-implementation_blocker)
11. [implementation_blocker_requirement](#11-implementation_blocker_requirement)
12. [implementation_review_checklist](#12-implementation_review_checklist)
13. [implementation_manifest_metadata](#13-implementation_manifest_metadata)
14. [vcs_commit](#14-vcs_commit)
15. [intermediate_asset](#15-intermediate_asset)
16. [asset_deliverable](#16-asset_deliverable)

---

## 1. `implementation_manifest`

### Purpose

The root record for one sub-phase of implementation work. Every time the `senior_developer` completes a plan sub-phase it writes exactly one manifest row summarising the outcome: overall status, file counts, total lines of code, warning count, and build result. All other implementation tables hang off this row.

### Context

The implementation phase is divided into sub-phases that mirror `plan_phase` rows. `sub_phase_number` corresponds to the `plan_phase.phase_number` that was just executed. A manifest is written even when work is partial or blocked so that the critic can inspect what was and was not done.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `iteration_id` | INTEGER | NO | — | FK → `iteration(id)` | Which iteration this belongs to. |
| `revision_id` | INTEGER | NO | — | FK → `revision(id)` | Producer-critic revision attempt. |
| `sub_phase_number` | INTEGER | NO | — | — | Plan sub-phase number that was implemented. |
| `status` | TEXT | NO | — | CHECK IN ('complete','partial','blocked') | Outcome of this sub-phase. |
| `files_created` | INTEGER | YES | 0 | — | Number of net-new files written. |
| `files_modified` | INTEGER | YES | 0 | — | Number of existing files changed. |
| `lines_of_code` | INTEGER | YES | NULL | — | Total non-blank, non-comment lines added/changed; NULL if not measured. |
| `warnings` | INTEGER | YES | 0 | — | Build/lint warning count at time of submission. |
| `build_status` | TEXT | YES | NULL | CHECK IN ('success','failure') | Result of the build step; NULL if build was not run. |
| `created_at` | TEXT | NO | — | ISO 8601 | Timestamp set by the MCP server on insert. |

### Relationships

- **Parent:** `iteration` (via `iteration_id`), `revision` (via `revision_id`)
- **Children:** `implementation_file`, `implementation_requirement_status`, `implementation_component_status`, `implementation_api_endpoint`, `implementation_dependency_added`, `implementation_db_migration`, `implementation_blocker`, `implementation_review_checklist`, `implementation_manifest_metadata`

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | `entity_type: "implementation_manifest"`. Child rows for files, requirement statuses, component statuses, api_endpoints, and blockers are inserted in the same call via nested arrays in `data`. |
| Query | `changelog_query` | `entity_type: "implementation_manifest"`, filter by `iteration_id`. |
| Iteration summary | `iteration_summary` | Returns counts of commits and deliverables alongside phase data; does not enumerate manifest fields directly. |

---

## 2. `implementation_file`

### Purpose

Records each individual file that was created, modified, or deleted during a sub-phase. Provides per-file traceability — which component owns the file and what was the intent behind touching it.

### Context

Written as children of `implementation_manifest`. One row per file path per manifest. The `component_id` links to the architecture component responsible for this file, enabling QA to know which components are affected by each file change.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `manifest_id` | INTEGER | NO | — | FK → `implementation_manifest(id)` | Parent manifest. |
| `path` | TEXT | NO | — | — | Repository-relative file path (e.g. `src/api/users.ts`). |
| `action` | TEXT | NO | — | CHECK IN ('created','modified','deleted') | What happened to this file. |
| `purpose` | TEXT | YES | NULL | — | Human-readable explanation of why this file was touched. |
| `component_id` | TEXT | YES | NULL | FK → `component(id)` | Architecture component this file belongs to (e.g. `COMP-001`). |

### Relationships

- **Parent:** `implementation_manifest` (via `manifest_id`)
- **Sibling FK:** `component` (via `component_id`)
- **Children:** `implementation_file_requirement`

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Nested under `data.files[]` in the `implementation_manifest` call. Each element includes `path`, `action`, `purpose`, `component_id`, and `requirements[]`. |
| Query | `changelog_query` | Query `implementation_manifest`; file rows are returned as nested children. |

---

## 3. `implementation_file_requirement`

### Purpose

Join table connecting each implementation file to the requirements it helps satisfy. Enables the QA engineer to ask "which files implement REQ-042?" and the critic to verify coverage.

### Context

Many files implement multiple requirements; a single requirement is typically spread across multiple files. This M:N join captures both directions. Populated as part of the `implementation_manifest` insert when `requirements[]` is provided per file entry.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `file_id` | INTEGER | NO | — | FK → `implementation_file(id)`, PK part | The file. |
| `requirement_id` | TEXT | NO | — | FK → `requirement(id)`, PK part | The requirement (e.g. `REQ-007`). |

**Primary Key:** `(file_id, requirement_id)` — composite, prevents duplicate links.

### Relationships

- **Parents:** `implementation_file` (via `file_id`), `requirement` (via `requirement_id`)

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Populated automatically from `data.files[n].requirements[]` in the `implementation_manifest` call. Uses `INSERT OR IGNORE` to avoid duplicate constraint errors. |
| Query | Join `implementation_file` + `implementation_file_requirement` in `changelog_query` or raw SQL. |

---

## 4. `implementation_requirement_status`

### Purpose

Records the implementation progress of each requirement as assessed by the senior_developer at the end of a sub-phase. This is the canonical source of truth for "is REQ-042 done?" from the implementation perspective.

### Context

Written per manifest. A requirement may appear in multiple manifests across sub-phases; later rows supersede earlier ones. The QA engineer consults this table — alongside `implementation_file_requirement` — to determine what has been built and what still needs testing.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `manifest_id` | INTEGER | NO | — | FK → `implementation_manifest(id)` | Which sub-phase this status was recorded in. |
| `requirement_id` | TEXT | NO | — | FK → `requirement(id)` | The requirement being assessed (e.g. `REQ-003`). |
| `status` | TEXT | NO | — | CHECK IN ('implemented','partial','not_started','blocked','not_applicable') | Implementation state. |
| `notes` | TEXT | YES | NULL | — | Explanation for non-`implemented` statuses; required when `status` is `partial` or `blocked` in practice. |

### Relationships

- **Parent:** `implementation_manifest` (via `manifest_id`)
- **Sibling FK:** `requirement` (via `requirement_id`)

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Nested under `data.requirement_status[]` in the `implementation_manifest` call. Each element: `{ requirement_id, status, notes }`. |
| Query | `changelog_query` | Filter `implementation_manifest` by `iteration_id` and inspect nested requirement statuses. |

---

## 5. `implementation_component_status`

### Purpose

Records per-component implementation progress alongside requirement status. Where `implementation_requirement_status` tracks the "what", this table tracks the "which system part".

### Context

Useful for architecture-level dashboards: the critic checks that each component reaches `complete` before the phase exits. A component's status may be `partial` across sub-phases until all its files and requirements are done.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `manifest_id` | INTEGER | NO | — | FK → `implementation_manifest(id)` | Sub-phase this status was recorded in. |
| `component_id` | TEXT | NO | — | FK → `component(id)` | The architecture component (e.g. `COMP-002`). |
| `status` | TEXT | NO | — | CHECK IN ('complete','partial','not_started') | Build completion state. |
| `notes` | TEXT | YES | NULL | — | Optional detail for partial or not_started entries. |

### Relationships

- **Parent:** `implementation_manifest` (via `manifest_id`)
- **Sibling FK:** `component` (via `component_id`)

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Nested under `data.component_status[]` in the `implementation_manifest` call. Each element: `{ component_id, status, notes }`. |
| Query | `changelog_query` | Filter `implementation_manifest` by `iteration_id`; component statuses are returned nested. |

---

## 6. `implementation_api_endpoint`

### Purpose

Records each HTTP API endpoint actually implemented (as opposed to planned) during a sub-phase. Allows comparison against `plan_phase_api_endpoint` to confirm delivery.

### Context

The QA engineer uses this table to know which endpoints exist and which are only stubbed, so integration tests can be scoped correctly. `stubbed` means the route exists but returns mock data; `complete` means the full logic is wired up.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `manifest_id` | INTEGER | NO | — | FK → `implementation_manifest(id)` | Parent manifest. |
| `path` | TEXT | NO | — | — | URL path pattern (e.g. `/api/v1/users/:id`). |
| `method` | TEXT | NO | — | — | HTTP verb: GET, POST, PUT, PATCH, DELETE, etc. |
| `status` | TEXT | NO | — | CHECK IN ('complete','stubbed','not_started') | Implementation state of this endpoint. |

### Relationships

- **Parent:** `implementation_manifest` (via `manifest_id`)
- **Children:** `implementation_api_endpoint_requirement`

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Nested under `data.api_endpoints[]` in the `implementation_manifest` call. Each element: `{ path, method, status, requirements[] }`. |
| Query | `changelog_query` | Filter by `implementation_manifest` + `iteration_id`; endpoints returned nested. |

---

## 7. `implementation_api_endpoint_requirement`

### Purpose

Join table linking implemented API endpoints to the requirements they fulfil. Enables traceability from HTTP surface to business requirements.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `endpoint_id` | INTEGER | NO | — | FK → `implementation_api_endpoint(id)`, PK part | The endpoint. |
| `requirement_id` | TEXT | NO | — | FK → `requirement(id)`, PK part | The requirement (e.g. `REQ-011`). |

**Primary Key:** `(endpoint_id, requirement_id)` — composite.

### Relationships

- **Parents:** `implementation_api_endpoint` (via `endpoint_id`), `requirement` (via `requirement_id`)

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Populated from `data.api_endpoints[n].requirements[]` in the `implementation_manifest` call. Uses `INSERT OR IGNORE`. |
| Query | Join via `implementation_api_endpoint` parent. |

---

## 8. `implementation_dependency_added`

### Purpose

Catalogues third-party packages or libraries added to the project during implementation. Feeds into security/license audits and complements the pre-approved `approved_dependency` architecture table with what was actually used.

### Context

The senior_developer must record every `npm install`, `pip install`, `go get`, etc. here. This allows the critic and QA to spot unapproved dependencies and the release engineer to confirm all dependencies are licensed correctly.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `manifest_id` | INTEGER | NO | — | FK → `implementation_manifest(id)` | Sub-phase in which the dependency was added. |
| `name` | TEXT | NO | — | — | Package name (e.g. `express`, `pydantic`). |
| `version` | TEXT | NO | — | — | Exact version pinned (e.g. `4.18.2`). |
| `purpose` | TEXT | NO | — | — | Why this dependency was added. |
| `license` | TEXT | YES | NULL | — | SPDX license identifier (e.g. `MIT`, `Apache-2.0`); NULL if unknown at time of entry. |

### Relationships

- **Parent:** `implementation_manifest` (via `manifest_id`)

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | Not yet in `insertImplementationManifest` nested arrays. Must be inserted via direct SQL or a future extension of the `changelog_insert` handler. Schema table exists and is ready. |
| Query | Direct SQL: `SELECT * FROM implementation_dependency_added WHERE manifest_id = ?` |

---

## 9. `implementation_db_migration`

### Purpose

Tracks each database migration script created or applied during implementation. Provides the ops and QA teams with a clear list of schema changes that need to be run before the code can be deployed.

### Context

Migrations may be `created` (file written but not yet run), `pending` (queued for the next deploy), or `applied` (already executed against the database). The release engineer uses this status when generating deployment runbooks.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `manifest_id` | INTEGER | NO | — | FK → `implementation_manifest(id)` | Sub-phase that produced this migration. |
| `name` | TEXT | NO | — | — | Migration file name or identifier (e.g. `0012_add_users_table`). |
| `description` | TEXT | YES | NULL | — | Human-readable summary of schema changes. |
| `status` | TEXT | NO | — | CHECK IN ('created','applied','pending') | Lifecycle state of the migration. |

### Relationships

- **Parent:** `implementation_manifest` (via `manifest_id`)

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | Not yet in `insertImplementationManifest` nested arrays. Schema table exists; direct SQL or future handler extension required. |
| Query | Direct SQL: `SELECT * FROM implementation_db_migration WHERE manifest_id = ?` |

---

## 10. `implementation_blocker`

### Purpose

Records any impediment the senior_developer encountered during a sub-phase that prevented complete implementation. Blockers are the primary signal used by the senior_developer_critic to decide whether to reject a revision and escalate.

### Context

Blockers have three severity levels. `needs_escalation = 1` flags that the senior_developer believes human intervention or architecture revision is required. The critic checks this flag and severity when writing its verdict in `revision.feedback`.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `manifest_id` | INTEGER | NO | — | FK → `implementation_manifest(id)` | Parent manifest. |
| `description` | TEXT | NO | — | — | Full description of the blocker. |
| `severity` | TEXT | NO | — | CHECK IN ('critical','major','minor') | Impact level: `critical` = work cannot proceed; `major` = significant workaround needed; `minor` = inconvenience only. |
| `recommendation` | TEXT | YES | NULL | — | Suggested resolution. |
| `needs_escalation` | INTEGER | YES | 0 | — | Boolean (0/1). `1` means the developer believes this cannot be resolved without outside input. |

### Relationships

- **Parent:** `implementation_manifest` (via `manifest_id`)
- **Children:** `implementation_blocker_requirement`

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Nested under `data.blockers[]` in the `implementation_manifest` call. Each element: `{ description, severity, recommendation, needs_escalation, requirements[] }`. |
| Query | `changelog_query` | Returned nested under manifest. |

---

## 11. `implementation_blocker_requirement`

### Purpose

Join table associating each blocker with the requirements it prevents from being implemented. Enables the critic and QA to pinpoint exactly which requirements are at risk.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `blocker_id` | INTEGER | NO | — | FK → `implementation_blocker(id)`, PK part | The blocker. |
| `requirement_id` | TEXT | NO | — | FK → `requirement(id)`, PK part | The blocked requirement (e.g. `REQ-014`). |

**Primary Key:** `(blocker_id, requirement_id)` — composite.

### Relationships

- **Parents:** `implementation_blocker` (via `blocker_id`), `requirement` (via `requirement_id`)

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | Populated from `data.blockers[n].requirements[]` in the `implementation_manifest` call. Uses `INSERT OR IGNORE`. |
| Query | Join via `implementation_blocker` parent. |

---

## 12. `implementation_review_checklist`

### Purpose

Stores the results of the senior_developer's self-review checklist at the end of each sub-phase. Functions as a structured pre-flight check before submitting to the critic.

### Context

Typical checklist items include: "all tests pass", "no hardcoded secrets", "API contracts match spec", "migrations are reversible". Each item is either passed (`1`) or not (`0`). The critic may reject if mandatory items are failed.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `manifest_id` | INTEGER | NO | — | FK → `implementation_manifest(id)` | Parent manifest. |
| `check_name` | TEXT | NO | — | — | Name of the checklist item (e.g. `"all_tests_pass"`). |
| `passed` | INTEGER | YES | 0 | — | Boolean (0/1). `1` = check passed. |

### Relationships

- **Parent:** `implementation_manifest` (via `manifest_id`)

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | Not yet in `insertImplementationManifest` nested arrays. Schema table exists; direct SQL or future handler extension required. |
| Query | Direct SQL: `SELECT * FROM implementation_review_checklist WHERE manifest_id = ?` |

---

## 13. `implementation_manifest_metadata`

### Purpose

Stores versioning metadata for an implementation manifest, pinning which upstream artifact versions (requirements doc, architecture doc) were in scope when the code was written. Enables audit of "what spec was this implementation based on?"

### Context

One row per manifest. `requirements_version` and `architecture_version` should match the versions recorded in the planning metadata to confirm no drift. `commit_sha` is the VCS HEAD at time of submission.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `manifest_id` | INTEGER | NO | — | FK → `implementation_manifest(id)` | The manifest this metadata describes. |
| `version` | TEXT | NO | — | — | Version string for this manifest (e.g. `1.0.0`). |
| `created` | TEXT | NO | — | ISO 8601 | Creation timestamp (agent-supplied, may differ from `implementation_manifest.created_at`). |
| `requirements_version` | TEXT | NO | — | — | Version of the requirements document in scope. |
| `architecture_version` | TEXT | NO | — | — | Version of the architecture document in scope. |
| `language` | TEXT | YES | NULL | — | Primary programming language used (e.g. `TypeScript`, `Python`). |
| `commit_sha` | TEXT | YES | NULL | — | VCS commit SHA at time of submission; cross-reference with `vcs_commit`. |

### Relationships

- **Parent:** `implementation_manifest` (via `manifest_id`)

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | Not yet in `insertImplementationManifest` nested arrays. Schema table exists; direct SQL or future handler extension required. |
| Query | Direct SQL: `SELECT * FROM implementation_manifest_metadata WHERE manifest_id = ?` |

---

## 14. `vcs_commit`

### Purpose

Links a Git (or Jujutsu) commit SHA to an iteration and optionally to a specific phase. Acts as the durable connection between the changelog database and the version control history.

### Context

**Populated exclusively by the `commit_link` MCP tool**, not by `changelog_insert`. The senior_developer calls `commit_link` after each commit. The `iteration_summary` read tool surfaces these rows alongside deliverables to give a complete picture of an iteration's VCS activity.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `iteration_id` | INTEGER | NO | — | FK → `iteration(id)` | The iteration this commit belongs to. |
| `phase_id` | INTEGER | YES | NULL | FK → `phase(id)` | Optional: which phase of the iteration this commit was made in. |
| `commit_sha` | TEXT | NO | — | — | Full or abbreviated VCS commit identifier. |
| `message` | TEXT | YES | NULL | — | Commit message summary. |
| `created_at` | TEXT | NO | — | ISO 8601 | Timestamp set by the MCP server on insert. |

### Relationships

- **Parents:** `iteration` (via `iteration_id`), `phase` (via `phase_id`)

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `commit_link` | Required fields: `iteration_id`, `commit_sha`. Optional: `phase_id`, `message`. **Do not use `changelog_insert` for this table.** |
| Query | `iteration_summary` | Returns all commits for an iteration under the `commits` array. |
| Direct query | `changelog_query` is not wired to `vcs_commit`; use `iteration_summary` or raw SQL. |

---

## 15. `intermediate_asset`

### Purpose

Stores transient work items, notes, plans, and references that the senior_developer (or any agent) creates during work but that are not final deliverables. Used for producer-critic handoff context — the critic reads intermediate assets to understand what the producer was thinking.

### Context

`asset_type` determines what `content` contains. `commit_ref` and `file_ref` store identifiers rather than full content. `work_item` captures task notes; `plan` captures sub-phase planning text; `note` captures free-form observations.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `iteration_id` | INTEGER | NO | — | FK → `iteration(id)` | Iteration this asset belongs to. |
| `phase_id` | INTEGER | YES | NULL | FK → `phase(id)` | Phase in which it was created. |
| `revision_id` | INTEGER | NO | — | FK → `revision(id)` | Revision attempt that produced it. |
| `asset_type` | TEXT | NO | — | CHECK IN ('work_item','plan','note','commit_ref','file_ref') | Semantic type of the asset. |
| `title` | TEXT | NO | — | — | Short descriptive title. |
| `content` | TEXT | YES | NULL | — | Full content; may be NULL for `commit_ref`/`file_ref` where the identifier is in `title`. |
| `created_at` | TEXT | NO | — | ISO 8601 | Timestamp set by the MCP server on insert. |

### Relationships

- **Parents:** `iteration` (via `iteration_id`), `phase` (via `phase_id`), `revision` (via `revision_id`)

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | `entity_type: "intermediate_asset"`. Fields: `phase_id`, `asset_type`, `title`, `content`. |
| Query | `changelog_query` with `entity_type: "intermediate_asset"` and `iteration_id`. |

---

## 16. `asset_deliverable`

### Purpose

Records files that have been committed to VCS as finished deliverables. Where `intermediate_asset` captures in-progress work, `asset_deliverable` captures the permanent artefacts: source code, tests, documentation, diagrams, toolchain configs.

### Context

The `asset_type` enum mirrors the major deliverable categories expected at the end of an iteration. `file_path` is the repository-relative path. `commit_sha` ties the deliverable to the specific commit that introduced it, enabling the `iteration_summary` tool to surface "what was shipped" without querying VCS directly.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NO | autoincrement | PRIMARY KEY | Surrogate key. |
| `iteration_id` | INTEGER | NO | — | FK → `iteration(id)` | Iteration this deliverable was produced in. |
| `phase_id` | INTEGER | YES | NULL | FK → `phase(id)` | Phase that produced the deliverable. |
| `asset_type` | TEXT | NO | — | CHECK IN ('architecture_diagram','data_model','interface','ux_design_system','source_code','toolchain','test','documentation') | Category of deliverable. |
| `file_path` | TEXT | NO | — | — | Repository-relative path to the committed file (e.g. `src/api/users.ts`). |
| `description` | TEXT | YES | NULL | — | Brief explanation of what this file contains. |
| `commit_sha` | TEXT | YES | NULL | — | VCS commit SHA that introduced this file; cross-reference with `vcs_commit`. |
| `created_at` | TEXT | NO | — | ISO 8601 | Timestamp set by the MCP server on insert. |

### Relationships

- **Parents:** `iteration` (via `iteration_id`), `phase` (via `phase_id`)

### MCP Tool Access

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert | `changelog_insert` | `entity_type: "asset_deliverable"`. Fields: `phase_id`, `asset_type`, `file_path`, `description`, `commit_sha`. |
| Query | `iteration_summary` | Returns all deliverables under the `deliverables` array (fields: `asset_type`, `file_path`, `description`, `commit_sha`, `created_at`). Also available via `changelog_query`. |

---

## Entity Relationship Summary

```
iteration
 ├── implementation_manifest (iteration_id, revision_id)
 │    ├── implementation_file (manifest_id)
 │    │    └── implementation_file_requirement (file_id, requirement_id)
 │    ├── implementation_requirement_status (manifest_id, requirement_id)
 │    ├── implementation_component_status (manifest_id, component_id)
 │    ├── implementation_api_endpoint (manifest_id)
 │    │    └── implementation_api_endpoint_requirement (endpoint_id, requirement_id)
 │    ├── implementation_dependency_added (manifest_id)
 │    ├── implementation_db_migration (manifest_id)
 │    ├── implementation_blocker (manifest_id)
 │    │    └── implementation_blocker_requirement (blocker_id, requirement_id)
 │    ├── implementation_review_checklist (manifest_id)
 │    └── implementation_manifest_metadata (manifest_id)
 ├── vcs_commit (iteration_id, phase_id)          ← written by commit_link tool only
 ├── intermediate_asset (iteration_id, phase_id, revision_id)
 └── asset_deliverable (iteration_id, phase_id)
```

---

## Notes on Partially-Wired Tables

The following four tables exist in `schema.sql` and are available for querying, but the `insertImplementationManifest` handler in `write-tools.js` does not yet populate them via nested arrays in `changelog_insert`. They must be inserted via direct SQL or a future extension of the handler:

| Table | Missing nested key |
|-------|--------------------|
| `implementation_dependency_added` | `data.dependencies[]` |
| `implementation_db_migration` | `data.migrations[]` |
| `implementation_review_checklist` | `data.review_checklist[]` |
| `implementation_manifest_metadata` | `data.metadata` |

---

## Cross-Domain References

| This domain references | Via column | Why |
|------------------------|-----------|-----|
| `iteration` | `iteration_id` | All rows scoped to an iteration. |
| `revision` | `revision_id` | Producer-critic loop tracking. |
| `phase` | `phase_id` | Phase-level VCS and asset scoping. |
| `requirement` | `requirement_id` | Traceability from code to requirements. |
| `component` | `component_id` | Traceability from code to architecture. |

The QA engineer joins `implementation_requirement_status` → `requirement` → `requirement_acceptance_criterion` to build the test matrix without re-reading requirements from scratch.
