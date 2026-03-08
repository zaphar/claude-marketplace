# Core Spine Tables

These four tables form the backbone of the entire data model. Every other table in the system exists to record artifacts produced during the development lifecycle, and each of those tables traces back to this spine. The hierarchy flows strictly downward: a **project** is the root identity for a project, **iterations** represent discrete change-request cycles within that project, **phases** represent the nine SDLC stages executed within each iteration, and **revisions** represent individual producer-critic loop attempts within a phase.

The core spine is write-once and append-forward. The project row is created once and optionally closed. Iterations are opened when new work begins and closed when that work ships. Phases are created in bulk by `iteration_create` (one row per phase name, all set to `pending`) and advance through status transitions via `phase_transition`. Revisions are created at the start of each producer-critic attempt and resolved to `approved` or `rejected` by the critic agent.

Every changelog entity in the system — requirements, ADRs, components, test cases, deployment configs, and so on — carries an `iteration_id` (NOT NULL) and a required `revision_id` (NOT NULL) to record exactly when and why it was produced (except `project_context`, which is a simple key-value store with no revision tracking). This makes the full provenance of any artifact queryable: which iteration requested it, which phase produced it, and which revision attempt resulted in the approved version.

---

## project

**Purpose:** Project-level config and lifecycle state. Singleton — exactly one row per database, enforced by CHECK(id = 1).

**Context:** Created by `iteration_create` on first run (alongside the first iteration and its phases). Status transitions to `closed` via `project_update`. The canonical "is this project active?" check is `status = 'active'`.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY CHECK(id = 1) | Singleton enforcer. Always 1. |
| `project_name` | TEXT | NOT NULL | Human-readable project name. |
| `created_at` | TEXT | NOT NULL, DEFAULT `(datetime('now'))` | ISO-8601 timestamp when the project was created. |
| `updated_at` | TEXT | NOT NULL, DEFAULT `(datetime('now'))` | ISO-8601 timestamp of the last update to this row. |
| `status` | TEXT | NOT NULL, CHECK(`active`, `closed`) | Lifecycle state. `active` while work is ongoing; `closed` when the project is complete or archived. |
| `closed_at` | TEXT | — | ISO-8601 timestamp when the project was closed. NULL while active. |
| `critic_model` | TEXT | DEFAULT `'sonnet'` | The LLM model identifier used for critic agents in this project. |
| `notes` | TEXT | DEFAULT `''` | Free-text notes about the project. |

**Relationships:**
- Children: `iteration` (implicitly the single project; no FK needed)

**Produced by:** `iteration_create` (creates project + first iteration + phases in one call)
**Queried by:** `project_status`
**Updated by:** `project_update`

---

## iteration

**Purpose:** A single change-request cycle within a project. Each time new work is requested — a new feature, a bug-fix batch, a refactor — a new iteration is opened. Iterations are numbered sequentially.

**Context:** Created by `iteration_create`. An iteration encompasses all nine phases and their revision attempts. All changelog entities carry `iteration_id` so that every artifact can be attributed to the change cycle that produced it. Closing an iteration (status `closed`) signals that the work shipped and a new request cycle can begin.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Surrogate key. |
| `status` | TEXT | NOT NULL, CHECK(`active`, `closed`) | Lifecycle state. Only one iteration should be `active` at a time. |
| `started_at` | TEXT | NOT NULL, DEFAULT `(datetime('now'))` | ISO-8601 timestamp when this iteration was opened. |
| `closed_at` | TEXT | — | ISO-8601 timestamp when this iteration was closed. NULL while active. |
| `notes` | TEXT | DEFAULT `''` | Free-text notes about this iteration's scope or outcomes. |

**Relationships:**
- Parent: `project` (implicitly the single project; no FK needed)
- Children: `phase` (via `iteration_id`), all changelog entity tables (via `iteration_id`)

**Produced by:** `iteration_create`
**Queried by:** `project_status`, `iteration_summary`

---

## phase

**Purpose:** One of the nine SDLC stages within an iteration. Phases are created in bulk (all nine, all `pending`) when an iteration is created, then activated and completed one at a time as the workflow advances.

**Context:** Created by `iteration_create` alongside the iteration row. Status is advanced by `phase_transition`. `approved_by` records which agent approved the phase output (set by the critic). Revisions hang off phases, so the full producer-critic history for any phase is traceable via `revision`.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, REFERENCES `iteration(id)` | Parent iteration. |
| `name` | TEXT | NOT NULL, CHECK(one of 9 values), UNIQUE with `iteration_id` | The SDLC stage name. One of: `requirements`, `ux_design`, `architecture`, `planning`, `implementation`, `documentation`, `qa`, `audit`, `release`. |
| `status` | TEXT | NOT NULL, CHECK(`pending`, `in_progress`, `completed`, `skipped`) | Lifecycle state of this phase within the iteration. |
| `started_at` | TEXT | — | ISO-8601 timestamp when the phase moved to `in_progress`. NULL if not yet started. |
| `completed_at` | TEXT | — | ISO-8601 timestamp when the phase reached `completed` or `skipped`. NULL while in progress. |
| `approved_by` | TEXT | — | Agent identifier that approved this phase's output (set by critic on final approval). NULL until approved. |
| `notes` | TEXT | DEFAULT `''` | Free-text notes about this phase. |
| `created_at` | TEXT | NOT NULL, DEFAULT `(datetime('now'))` | ISO-8601 timestamp of row creation. |

**Unique constraint:** `(iteration_id, name)` — each phase name appears exactly once per iteration.

**Relationships:**
- Parent: `iteration` (via `iteration_id`)
- Children: `revision` (via `phase_id`)

**Produced by:** `iteration_create` (all nine phase rows created at once)
**Updated by:** `phase_transition`
**Queried by:** `project_status`, `iteration_summary`

---

## revision

**Purpose:** A single producer-critic loop attempt within a phase. When a producer agent generates output for a phase, a revision row is created. The critic agent then reviews it and records a verdict (`approved` or `rejected`) along with feedback text. If rejected, a new revision is created for the next attempt.

**Context:** Revisions are the mechanism that enforces quality gates. The full revision chain for any phase shows every draft, the feedback that was given, and the final approved version. Changelog entities that are produced during a specific revision attempt carry the `revision_id` so that approved output can be distinguished from earlier drafts.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Surrogate key. |
| `phase_id` | INTEGER | NOT NULL, REFERENCES `phase(id)` | Parent phase. |
| `producer_agent` | TEXT | NOT NULL | Identifier of the agent that produced this revision's output. |
| `created_at` | TEXT | NOT NULL, DEFAULT `(datetime('now'))` | ISO-8601 timestamp when the revision was created (producer submitted work). |
| `status` | TEXT | NOT NULL, CHECK(`draft`, `submitted`, `approved`, `rejected`) | Lifecycle state. `draft` → `submitted` when producer finishes; `approved` or `rejected` after critic review. |
| `critic_agent` | TEXT | — | Identifier of the critic agent that reviewed this revision. NULL until reviewed. |
| `critic_feedback` | TEXT | — | Feedback text from the critic. NULL if not yet reviewed; populated for both `approved` and `rejected` outcomes. |
| `reviewed_at` | TEXT | — | ISO-8601 timestamp when the critic rendered a verdict. NULL until reviewed. |

**Relationships:**
- Parent: `phase` (via `phase_id`)
- Referenced by: changelog entity tables (via `revision_id`, NOT NULL)

**Produced by:** `revision_create`
**Updated by:** `revision_update` (records critic verdict, feedback, and `reviewed_at`)
**Queried by:** `revision_history`

## Entity Versioning Model

The six primary entity tables with TEXT primary keys — `persona`, `requirement`, `adr`, `component`, `user_flow`, `screen` — use an **UPSERT** (insert-or-update) model for versioning across revisions within a phase.

### How it works

1. When a producer agent creates entities during a revision, they are inserted normally.
2. If the critic rejects the revision and a new revision is created, the producer re-inserts only the entities that need changes. The UPSERT updates the existing row in place, setting `revision_id` to the new revision and `updated_at` to the current timestamp.
3. Entities that don't need changes keep their original `revision_id` — they are carried forward implicitly.
4. When the critic approves a revision, the phase transitions to `completed`. All entities in that iteration for the completed phase are considered **current and valid**.

### Snapshot history

Before an UPSERT overwrites an entity, the old state is captured as a JSON snapshot in the `entity_snapshot` table. This preserves the full change history without complicating the main entity tables.

To query current entities:
```sql
SELECT * FROM requirement WHERE iteration_id = ?;
```

To query change history for a specific entity:
```sql
SELECT * FROM entity_snapshot
WHERE entity_type = 'requirement' AND source_id = 'req-auth-001'
ORDER BY id ASC;
```

Or use `changelog_query` with `history: true`:
```json
{ "entity_type": "requirement", "ids": ["req-auth-001"], "history": true }
```

### What `revision_id` means on an entity

The `revision_id` on an entity records **provenance** — which revision last created or modified this entity. It does NOT determine validity. Validity is determined at the phase level: if the phase has an approved revision (or status `completed`), all entities for that phase's iteration are valid.

### The `updated_at` column

The six TEXT-PK entity tables carry an `updated_at` column (nullable). It is `NULL` on initial insert and set to the current timestamp whenever an UPSERT updates the row. This distinguishes entities that have been revised (`updated_at IS NOT NULL`) from those created once and never changed.
