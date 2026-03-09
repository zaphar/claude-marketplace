# Cross-Cutting Architecture Tables

**Domain:** Cross-cutting concerns that span the entire system — security, deployment, observability, third-party dependencies, the traceability backbone, workflow blockers, and project lessons.

**Primary producer:** `backend_architect` (architecture phase)
**Critic:** `architecture_critic`

These tables are written during the architecture phase after components and ADRs are established. They do not model any single subsystem; instead, they capture decisions and constraints that apply system-wide or that weave requirements through the full architectural stack.

---

## Table of Contents

1. [approved_dependency](#approved_dependency)
2. [requirement_trace](#requirement_trace)
3. [blocker](#blocker)
4. [project_lesson](#project_lesson)

---

## approved_dependency

### Purpose

The vetted third-party dependency manifest. Every external library, package, or SDK that the system will use must have an entry here before it can appear in implementation. Each row records not just *what* the dependency is, but *why* it was chosen, what license it carries, and an assessment of its supply-chain health (maintenance activity, community adoption, transitive dependency count, single-maintainer risk).

This table is the enforcement point for the principle that dependencies are decisions, not accidents. Requiring justification and a license check at architecture time prevents license compliance issues and unmaintained-dependency drift from surfacing at implementation time.

### Context

Written by `backend_architect` as part of the architecture phase, usually alongside ADRs that justify the choice of a given library. Each significant dependency should reference the `adr_id` that decided to adopt it. Lightweight utilities may not need an ADR but still require a row here.

The `single_maintainer_risk` flag is a boolean (`0`/`1`) that signals whether the package has only one active maintainer — a supply-chain risk factor worth surfacing explicitly.

### Column Reference

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NOT NULL | autoincrement | PRIMARY KEY | Surrogate row identifier. |
| `iteration_id` | INTEGER | NOT NULL | — | FK → `iteration(id)` ON DELETE CASCADE | The iteration this dependency belongs to. |
| `package` | TEXT | NOT NULL | — | — | Package name as it appears in the ecosystem registry (e.g., `express`, `com.fasterxml.jackson.core:jackson-databind`). |
| `version_constraint` | TEXT | NULL | — | — | SemVer or ecosystem-specific version constraint (e.g., `^4.18.0`, `>=2.14.0 <3.0.0`). NULL means unconstrained (discouraged). |
| `purpose` | TEXT | NOT NULL | — | — | One-line description of what this dependency is used for (e.g., `HTTP server framework`, `JSON serialization`). |
| `justification` | TEXT | NOT NULL | — | — | Rationale for choosing this specific package over alternatives. Should cross-reference the relevant ADR. |
| `adr_id` | TEXT | NULL | — | FK → `adr(id)` | The ADR that decided to adopt this dependency, if one exists. |
| `license` | TEXT | NULL | — | — | SPDX license identifier (e.g., `MIT`, `Apache-2.0`, `GPL-3.0-only`). NULL means license was not checked (a gap that should be filled). |
| `category` | TEXT | NULL | — | — | Logical grouping for technology classification (e.g., `backend-language`, `database`, `cache`, `auth`, `testing`, `ci-cd`, `frontend-framework`). Used to categorize dependencies by their role in the stack, preserving the technology inventory concept. NULL if no category applies. |
| `maintenance_activity` | TEXT | NULL | — | — | Qualitative assessment of upstream maintenance health (e.g., `active — released 2024-11`, `sporadic — last release 18 months ago`). |
| `community_adoption` | TEXT | NULL | — | — | Qualitative measure of ecosystem adoption (e.g., `>10M weekly npm downloads`, `widely used in Go stdlib ecosystem`). |
| `transitive_deps` | INTEGER | NULL | — | — | Approximate count of transitive dependencies pulled in by this package, as a supply-chain surface area indicator. |
| `single_maintainer_risk` | INTEGER | NOT NULL | `0` | — | Boolean flag (`0` = no, `1` = yes). Set to `1` if the package has a single active maintainer, indicating bus-factor supply-chain risk. |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | — | ISO 8601 timestamp of row insertion. |

### Relationships

- **`iteration_id` → `iteration(id)`** — Scopes the dependency to an iteration.
- **`adr_id` → `adr(id)`** — Links to the ADR that decided to adopt this dependency. This is the primary audit trail for "why are we using this package?". The `read-tools.js` `traceability_query` tool fetches approved dependencies when tracing an ADR.
- Implementation code that uses a package should be able to look up its entry here to confirm approval and retrieve license/health data.

### MCP Tool Access

**Read** (`changelog_query`):
```json
{
  "entity_type": "approved_dependency",
  "iteration_id": 1,
  "filters": { "license": "MIT" }
}
```

Fetch all dependencies linked to a specific ADR:
```json
{
  "entity_type": "approved_dependency",
  "iteration_id": 1,
  "filters": { "adr_id": "ADR-003" }
}
```

**Write** (`changelog_insert`):
```json
{
  "entity_type": "approved_dependency",
  "iteration_id": 1,
  "data": {
    "package": "express",
    "version_constraint": "^4.18.0",
    "purpose": "HTTP server framework",
    "justification": "Industry-standard Node.js HTTP framework; chosen per ADR-003 over Fastify due to team familiarity and plugin ecosystem.",
    "adr_id": "ADR-003",
    "license": "MIT",
    "category": "backend-framework",
    "maintenance_activity": "active — v4.18.2 released 2023-02",
    "community_adoption": ">30M weekly npm downloads",
    "transitive_deps": 52,
    "single_maintainer_risk": 0
  }
}
```

**Traceability query** (resolves ADR → approved dependencies):
```json
{
  "target": "ADR-003",
  "target_type": "adr",
  "iteration_id": 1
}
```

---

## requirement_trace

### Purpose

The traceability backbone of the entire data model. Each row asserts that a specific requirement (`requirement_id`) is addressed by some named architectural element (`addressed_by`) of a given type (`addressed_by_type`). This creates the REQ → COMP/ENDPOINT/FLOW/SCREEN chain that makes the "why" query possible: given any artifact in the system, the architect can trace back to the requirement that motivated it, and forward to every other artifact that satisfies the same requirement.

This table is the primary data source for the `traceability_query` MCP tool, which is how humans and agents answer questions like "which component handles REQ-012?" or "which requirements does the payment screen address?".

### Context

Written by `backend_architect` after components, user flows, and screens have been defined. A complete architecture phase should have at least one `requirement_trace` row per requirement — requirements with no mapping are dark requirements that cannot be verified during QA.

The `addressed_by` field is a free-text identifier that should match an existing entity ID: `COMP-XXX` for components, an endpoint path/name, a `user_flow.id`, a `screen.id`, or a descriptive label for `other`. The `addressed_by_type` column has a CHECK constraint — valid values are `component`, `endpoint`, `flow`, `screen`, `adr`, and `technology`.

> **Note:** Screen-level requirement traceability (formerly tracked in a dedicated `ux_requirement_mapping` table in the UX design domain) is now consolidated here. Use `addressed_by_type = 'screen'` and set `addressed_by` to the screen ID (e.g., `screen-payment-confirmation`).

### Column Reference

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NOT NULL | autoincrement | PRIMARY KEY | Surrogate row identifier. |
| `iteration_id` | INTEGER | NOT NULL | — | FK → `iteration(id)` ON DELETE CASCADE | The iteration this trace belongs to. |
| `requirement_id` | TEXT | NOT NULL | — | FK → `requirement(id)` | The requirement being addressed (e.g., `REQ-007`). |
| `addressed_by` | TEXT | NOT NULL | — | — | Identifier of the architectural element satisfying the requirement (e.g., `COMP-002`, `POST /api/payments`, `flow-checkout`, `screen-confirmation`). |
| `addressed_by_type` | TEXT | NOT NULL | — | CHECK(`component`, `endpoint`, `flow`, `screen`, `adr`, `technology`) | Category of the addressing element. |
| `notes` | TEXT | NULL | — | — | Optional free-text clarification of how or why this element addresses the requirement (e.g., partial coverage, conditions, caveats). |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | — | ISO 8601 timestamp of row insertion. |

**`addressed_by_type` values:** Valid values are `component`, `endpoint`, `flow`, `screen`, `adr`, and `technology` (enforced by CHECK constraint). Screen-level traceability (`addressed_by_type = 'screen'`) supersedes the former `ux_requirement_mapping` table.

**Uniqueness:** `UNIQUE(iteration_id, requirement_id, addressed_by, addressed_by_type)` — prevents duplicate trace entries within the same iteration.

### Relationships

- **`iteration_id` → `iteration(id)`** — Scopes the trace to an iteration.
- **`requirement_id` → `requirement(id)`** — Hard FK to the requirements table. A trace row cannot exist without a valid requirement.
- **`addressed_by` (soft reference)** — The `addressed_by` value conventionally matches a `component.id` (`COMP-XXX`), `user_flow.id`, or `screen.id`, but there is no database-level FK enforcing this. This is intentional: endpoints and other addressable elements do not have their own top-level tables. The `addressed_by_type` field disambiguates which table (if any) to look up.
- The `traceability_query` tool in `read-tools.js` joins this table with `requirement`, `component`, `adr`, `user_flow`, and `screen` to build the full "why" chain for any query target.

### The REQ → COMP → ADR → SCREEN Chain

The full traceability chain is assembled by the `traceability_query` tool by combining multiple tables:

```
requirement (REQ-XXX)
    └── requirement_trace.requirement_id → addressed_by (COMP-XXX, flow-XXX, screen-XXX)
            ├── component (COMP-XXX)                              [via addressed_by_type = 'component']
            ├── adr (which ADRs reference this component?)        [via adr.consequences JSON / adr text]
            └── screen / user_flow                                [via addressed_by_type = 'screen' | 'flow']
```

Every requirement that is not covered by at least one `requirement_trace` row is an unaddressed requirement — a QA-phase failure condition.

### MCP Tool Access

**Primary read: `traceability_query`** (resolves the full chain):
```json
{
  "target": "REQ-007",
  "target_type": "requirement",
  "iteration_id": 1
}
```

```json
{
  "target": "COMP-002",
  "target_type": "component",
  "iteration_id": 1
}
```

**Direct read** (`changelog_query`):
```json
{
  "entity_type": "requirement_trace",
  "iteration_id": 1,
  "filters": { "addressed_by_type": "screen" }
}
```

**Write** (`changelog_insert`):
```json
{
  "entity_type": "requirement_trace",
  "iteration_id": 1,
  "data": {
    "requirement_id": "REQ-007",
    "addressed_by": "COMP-002",
    "addressed_by_type": "component",
    "notes": "PaymentService handles REQ-007 via the charge endpoint; partial — REQ-007 also requires the confirmation screen."
  }
}
```

Write a second mapping for the same requirement to a screen:
```json
{
  "entity_type": "requirement_trace",
  "iteration_id": 1,
  "data": {
    "requirement_id": "REQ-007",
    "addressed_by": "screen-payment-confirmation",
    "addressed_by_type": "screen",
    "notes": "Confirmation screen satisfies the user-visible acknowledgement half of REQ-007."
  }
}
```

---

## blocker

### Purpose

Records workflow blockers raised by any agent (producer or critic) when they encounter issues that prevent progress. Unlike domain-specific blockers (`implementation_blocker`) which are stored within their respective manifests, the `blocker` table is a cross-cutting lifecycle table that captures escalation events from any phase.

Blockers use soft-delete semantics: active blockers have `resolved_at IS NULL`. When a blocker is addressed, `blocker_resolve` sets `resolved_at` and optionally records resolution notes.

### Context

Written by the orchestrator when a producer or critic agent requests a blocker be recorded (via the escalation instruction pattern). Any agent across any phase can raise a blocker. The orchestrator queries active blockers at the start of each phase to surface them to the user.

Unlike most entity tables, `blocker` does not carry a `revision_id` column — blockers are lifecycle events, not producer-critic artifacts.

### Column Reference

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NOT NULL | autoincrement | PRIMARY KEY | Surrogate row identifier. |
| `iteration_id` | INTEGER | NOT NULL | — | FK → `iteration(id)` | The iteration in which this blocker was raised. |
| `phase_name` | TEXT | NOT NULL | — | FK (composite) → `phase(iteration_id, name)` | The phase during which the blocker was raised (e.g., `requirements`, `architecture`, `implementation`). |
| `description` | TEXT | NOT NULL | — | — | Human-readable description of the blocking issue. |
| `severity` | TEXT | NOT NULL | — | CHECK(severity IN ('critical', 'major', 'minor')) | Severity of the blocker. |
| `raised_by` | TEXT | NOT NULL | — | — | The agent that raised the blocker (e.g., `requirements_critic`, `backend_architect`). |
| `resolved_at` | TEXT | NULL | — | — | ISO 8601 timestamp when the blocker was resolved. NULL means still active. |
| `resolution_notes` | TEXT | NULL | — | — | Optional notes describing how the blocker was resolved. |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | — | ISO 8601 timestamp of row insertion. |

### Relationships

- **`iteration_id` → `iteration(id)`** — Blockers are scoped to an iteration. Active blockers from prior iterations are not automatically carried forward.
- **`(iteration_id, phase_name)` → `phase(iteration_id, name)`** — Composite FK ensures the phase_name is valid for the given iteration. ON DELETE CASCADE.
- No `revision_id` — blockers are lifecycle events that exist outside the producer-critic revision loop.

### MCP Tool Access

**Write** (`changelog_insert`):
```json
{
  "entity_type": "blocker",
  "iteration_id": 1,
  "data": {
    "phase_name": "architecture",
    "description": "Requirements REQ-003 and REQ-007 conflict — REQ-003 requires offline-first but REQ-007 requires real-time sync",
    "severity": "critical",
    "raised_by": "backend_architect"
  }
}
```

**Read** (`changelog_query`):
```json
{
  "entity_type": "blocker",
  "iteration_id": 1,
  "filters": { "resolved_at": null }
}
```

**Resolve** (`blocker_resolve`):
```json
{
  "blocker_id": 3,
  "resolution_notes": "REQ-003 was updated to allow eventual consistency, resolving the conflict with REQ-007"
}
```

---

## project_lesson

### Purpose

Records cross-phase lessons learned — categorised by type (e.g., patterns, anti-patterns, conventions, risks, decisions, process observations) — so that downstream agents benefit from accumulated project knowledge. Unlike file-based project memory, lessons are stored in the database with structured categories, enabling targeted queries (e.g., "show me all anti-patterns from architecture").

### Context

Written by the orchestrator when a critic agent requests a lesson be recorded (via the instruction pattern "instruct the orchestrator to insert a `project_lesson`"). Any critic across any phase can record lessons. Producer agents query lessons at the start of their work to check for relevant patterns, anti-patterns, and conventions.

Like `blocker`, `project_lesson` does not carry a `revision_id` column — lessons are observations, not producer-critic artifacts.

### Column Reference

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NOT NULL | autoincrement | PRIMARY KEY | Surrogate row identifier. |
| `iteration_id` | INTEGER | NOT NULL | — | FK → `iteration(id)` | The iteration in which this lesson was recorded. |
| `phase_name` | TEXT | NOT NULL | — | FK (composite) → `phase(iteration_id, name)` | The phase during which the lesson was recorded (e.g., `requirements`, `architecture`, `implementation`). |
| `category` | TEXT | NOT NULL | — | — | Free-form classification of the lesson for targeted querying (e.g., `pattern`, `anti-pattern`, `convention`, `risk`, `decision`, `process`). |
| `lesson` | TEXT | NOT NULL | — | — | Human-readable description of the lesson learned. |
| `recurring` | INTEGER | NOT NULL | `0` | — | Set to `1` if this pattern has been observed before. Helps surface systemic issues. |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | — | ISO 8601 timestamp of row insertion. |

### Relationships

- **`iteration_id` → `iteration(id)`** — Lessons are scoped to an iteration. Lessons from prior iterations remain queryable for cross-iteration knowledge.
- **`(iteration_id, phase_name)` → `phase(iteration_id, name)`** — Composite FK ensures the phase_name is valid for the given iteration. ON DELETE CASCADE.
- No `revision_id` — lessons are observations that exist outside the producer-critic revision loop.

### MCP Tool Access

**Write** (`changelog_insert`):
```json
{
  "entity_type": "project_lesson",
  "iteration_id": 1,
  "data": {
    "phase_name": "architecture",
    "category": "anti-pattern",
    "lesson": "Avoid choosing ORMs without verifying they support the required query patterns — the initial choice required replacement after discovering missing recursive CTE support",
    "recurring": 0
  }
}
```

**Read** (`changelog_query`):
```json
{
  "entity_type": "project_lesson",
  "iteration_id": 1
}
```

**Filtered by category:**
```json
{
  "entity_type": "project_lesson",
  "iteration_id": 1,
  "filters": { "category": "anti-pattern" }
}
```

**Recurring lessons only:**
```json
{
  "entity_type": "project_lesson",
  "iteration_id": 1,
  "filters": { "recurring": 1 }
}
```

---

## Common Patterns

### Querying all cross-cutting data for an iteration

All four tables can be queried by `iteration_id` using `changelog_query`. To get the full cross-cutting picture for iteration 1:

```json
{ "entity_type": "approved_dependency",  "iteration_id": 1 }
{ "entity_type": "requirement_trace", "iteration_id": 1 }
{ "entity_type": "blocker",             "iteration_id": 1 }
{ "entity_type": "project_lesson",      "iteration_id": 1 }
```

### Detecting unaddressed requirements

Query all `requirement` rows and all `requirement_trace` rows for an iteration, then find requirements whose `id` does not appear in any `requirement_trace.requirement_id`. This is a standard QA-phase check.

### Dependency audit trail

Given a dependency, find the ADR that approved it via `approved_dependency.adr_id`, then read that ADR's context and research sources. The formal decision and rationale are in the linked `adr_decision` record.
