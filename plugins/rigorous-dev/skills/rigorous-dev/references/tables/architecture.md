# Architecture Domain — Table Reference

This document covers the 7 tables that capture the output of the **backend_architect** agent during the architecture phase of the rigorous-dev workflow. Together they record the complete architectural decision log, system component graph, and integration test boundaries that downstream agents build upon.

**Producer:** `backend_architect`
**Critic/Validator:** `architecture_critic`
**Downstream consumers:** `implementation_planner` (builds work phases from components/requirements), `senior_developer` (implements against component interfaces)

---

## Table of Contents

1. [adr](#1-adr)
2. [adr_alternative](#2-adr_alternative)
3. [adr_decision](#3-adr_decision)
4. [component](#4-component)
5. [component_interface](#5-component_interface)
6. [component_dependency](#6-component_dependency)
7. [integration_test_boundary](#7-integration_test_boundary)

---

## 1. `adr`

### Purpose

The central record for each Architecture Decision Record. An ADR captures a single significant technical decision — what was decided, why, and when — giving every future reader a permanent, auditable record of the reasoning behind the system's shape. All alternative options are stored in the `adr_alternative` child table; the formal decision (selected alternative + rationale) is recorded in the `adr_decision` child table; consequences and research citations are stored inline as JSON arrays in the `consequences` and `research_sources` columns.

### Context

ADRs are the backbone of architectural traceability. Every major technology choice, structural pattern, or integration strategy that required deliberation should have an ADR. `adr` rows reference the current iteration (via `iteration_id`), so the full evolution of any decision across critic feedback rounds is preserved via `entity_snapshot`. The `superseded_by` self-reference creates a chain of record when an earlier decision is replaced. The `research_sources` JSON column is the key enabler of the "why are we using X?" traceability query.

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | TEXT | PRIMARY KEY | — | Human-readable identifier, format `ADR-XXX` (e.g., `ADR-001`). Assigned by the backend_architect. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` ON DELETE CASCADE | — | The iteration this ADR belongs to. |
| `title` | TEXT | NOT NULL | — | Short, imperative title describing the decision (e.g., "Use PostgreSQL for primary datastore"). |
| `status` | TEXT | NOT NULL, CHECK(`status` IN `'proposed'`, `'accepted'`, `'deprecated'`, `'superseded'`) | — | Lifecycle state. `proposed` = under consideration; `accepted` = ratified; `deprecated` = no longer relevant but not replaced; `superseded` = replaced by another ADR (see `superseded_by`). |
| `date` | TEXT | — | NULL | ISO-8601 date the decision was made (e.g., `2024-01-15`). Optional; set when a formal decision date is recorded. |
| `context` | TEXT | — | NULL | Narrative describing the forces, constraints, and background that made this decision necessary. |
| `superseded_by` | TEXT | FK → `adr(id)` | NULL | If `status = 'superseded'`, points to the newer ADR that replaces this one. |
| `consequences` | TEXT | NOT NULL | `'[]'` | JSON array of consequence strings describing effects of accepting this decision (e.g., `["All services must implement circuit-breaker logic"]`). Formerly stored in the `adr_consequence` child table. |
| `research_sources` | TEXT | NOT NULL | `'[]'` | JSON array of citation strings (URLs, paper references, etc.) that informed this decision (e.g., `["https://example.com/postgresql-benchmarks"]`). Formerly stored in the `adr_research_source` child table. Enables the "why are we using X?" traceability query. |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO-8601 timestamp of row creation. |
| `updated_at` | TEXT | — | ISO 8601 timestamp of the last UPSERT update. NULL if never updated after initial insert. |

### Relationships

- **Parent:** `iteration` (via `iteration_id`), `adr` self-reference (via `superseded_by`).
- **Children:** `adr_alternative`, `adr_decision`
- **Referenced by:** `approved_dependency.adr_id` (third-party dependencies may cite a backing ADR)

**Note:** Consequences and research sources are stored inline as JSON arrays in the `consequences` and `research_sources` columns. Formerly stored in the `adr_consequence` and `adr_research_source` child tables. The decision statement and rationale have been moved to the `adr_decision` child table.

### MCP Tool Access

```
# Write
changelog_insert  entity_type="adr"  { id, iteration_id, title, status, date, context, superseded_by }

# Record formal decision (after alternatives are evaluated)
changelog_insert  entity_type="adr_decision"  { adr_id, alternative_id, rationale }

# Update (status transitions without full re-insert)
changelog_update  entity_type="adr"  entity_id="ADR-001"  updates={ "status": "accepted" }

# Read
changelog_query   entity_type="adr"  [iteration_id=N] [ids=["ADR-001"]]
traceability_query  from="adr"  id="ADR-001"   # follows superseded_by chain, surfaces research sources
```

---

## 2. `adr_alternative`

### Purpose

Records each option that was explicitly considered when making an ADR decision. Every ADR should have at least two alternatives (including the chosen option) so that future readers understand what was weighed. Pros and cons are stored inline as JSON arrays.

### Context

The alternative-with-pros-and-cons pattern is the structured form of the classic ADR "options considered" section. Pros and cons are stored as nullable TEXT columns containing JSON arrays (e.g., `["Built-in horizontal sharding","Mature ecosystem"]`). When queried via `changelog_query` or `traceability_query`, these columns are parsed back into arrays for convenient consumption.

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `adr_id` | TEXT | NOT NULL, FK → `adr(id)` | — | The ADR this alternative belongs to. |
| `option_text` | TEXT | NOT NULL | — | Name or brief description of the alternative (e.g., "Use Redis as a cache layer"). |
| `pros` | TEXT | — | NULL | JSON array of advantages (e.g., `["Built-in horizontal sharding","Mature ecosystem"]`). NULL if none stated. |
| `cons` | TEXT | — | NULL | JSON array of disadvantages (e.g., `["Vendor lock-in","Requires operational expertise"]`). NULL if none stated. |

### Relationships

- **Parent:** `adr` (via `adr_id`)

### MCP Tool Access

```
# Written as nested children when inserting an adr via changelog_insert
# Input: alternatives_considered[].pros and .cons are arrays — stored as JSON arrays
# Queried as part of the adr entity via changelog_query entity_type="adr"
# Output: pros and cons are returned as arrays (JSON parsed back)
```

---

## 3. `adr_decision`

### Purpose

Records the formal decision for an ADR — which alternative was selected and why. The primary key on `adr_id` enforces exactly one decision per ADR. `alternative_id` is nullable so that decisions can be recorded without requiring a formal alternative entry (e.g., when the decision is straightforward and no alternatives were enumerated).

### Context

Created by the **backend_architect** when an ADR reaches the "accepted" state. The `rationale` field explains why the chosen option was selected over its alternatives. The `decided_at` timestamp records when the decision was formalised. When queried via `changelog_query` with `entity_type="adr"` and `include_related=true`, the decision is attached to the ADR result.

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `adr_id` | TEXT | NOT NULL, FK → `adr(id)`, PRIMARY KEY | — | The ADR this decision belongs to. One decision per ADR. |
| `alternative_id` | INTEGER | FK → `adr_alternative(id)` | NULL | The selected alternative, if one was formally recorded. NULL when the decision was made without enumerated alternatives. |
| `rationale` | TEXT | — | NULL | Why this option was chosen over the alternatives. Should reference alternatives by name and cite research sources. |
| `decided_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO-8601 timestamp of when the decision was formalised. |

### Relationships

- **Parent:** `adr` (via `adr_id`)
- **Parent:** `adr_alternative` (via `alternative_id`, nullable)

### MCP Tool Access

```
# Write (record a decision for an ADR)
changelog_insert  entity_type="adr_decision"  { adr_id: "ADR-001", alternative_id: 3, rationale: "..." }

# Query decisions directly
changelog_query  entity_type="adr_decision"  [iteration_id=N] [ids=["ADR-001"]]

# Also included when querying ADRs with include_related=true
changelog_query  entity_type="adr"  include_related=true
```

---

## 4. `component`

### Purpose

Represents a deployable or logically distinct unit of the system — an API server, background worker, database, cache, message queue, external third-party service, or shared library. Components are the primary unit of architectural decomposition. All interfaces, dependencies, and requirement mappings hang off component rows.

### Context

`component` is the central node in the architecture domain graph. The backend_architect decomposes the system into components during the architecture phase; the implementation_planner then uses `component_dependency` and `requirement_trace` (with `addressed_by_type = 'component'`) to sequence work phases; the senior_developer builds against `component_interface` contracts. Component IDs (`COMP-XXX`) appear in `requirement_trace`, `integration_test_boundary`, and `implementation_component_status`.

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | TEXT | PRIMARY KEY | — | Human-readable identifier, format `COMP-XXX` (e.g., `COMP-001`). Assigned by the backend_architect. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` ON DELETE CASCADE | — | The iteration this component belongs to. |
| `name` | TEXT | NOT NULL | — | Short, descriptive name (e.g., "Auth Service", "PostgreSQL Primary", "Payment Gateway"). |
| `purpose` | TEXT | NOT NULL | — | One-to-two sentence statement of what this component does and why it exists in the system. |
| `type` | TEXT | NOT NULL | — | Free-form classification of the component. Canonical values (by convention): `api` = HTTP/RPC boundary; `service` = internal service with no direct external exposure; `worker` = async/background processor; `database` = persistent data store; `cache` = volatile data store; `queue` = message broker; `external` = third-party dependency outside system boundary; `library` = shared code, not a process. Custom values are allowed for project-specific component types. |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO-8601 timestamp of row creation. |
| `updated_at` | TEXT | — | ISO 8601 timestamp of the last UPSERT update. NULL if never updated after initial insert. |

### Relationships

- **Parent:** `iteration` (via `iteration_id`).
- **Children:** `component_interface`, `component_dependency` (both sides), `integration_test_boundary` (both sides)
- **Referenced by:** `requirement_trace.addressed_by` (when `addressed_by_type = 'component'`), `implementation_component_status.component_id`

### MCP Tool Access

```
# Write
changelog_insert  entity_type="component"  { id, iteration_id, name, purpose, type }

# Read
changelog_query   entity_type="component"  [iteration_id=N]
traceability_query  from="component"  id="COMP-001"   # shows requirements satisfied, interfaces, dependencies
```

---

## 5. `component_interface`

### Purpose

Describes each interface — HTTP endpoint group, gRPC service definition, message topic, or file I/O contract — that a component exposes to the rest of the system. Interfaces define the *contract* other components depend on.

### Context

`component_interface` rows are the foundation for implementation contract tests and the `work_item_api_endpoint` entries created by the implementation_planner. When the senior_developer builds a component, the interfaces listed here define what must exist and be tested. The `type` field is free-text to accommodate diverse interface styles (REST, gRPC, event, file).

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `component_id` | TEXT | NOT NULL, FK → `component(id)`, part of UNIQUE(component_id, name) | — | The component that exposes this interface. |
| `name` | TEXT | NOT NULL, part of UNIQUE(component_id, name) | — | Short identifier for the interface (e.g., `POST /auth/token`, `UserCreated event`, `orders.csv export`). |
| `type` | TEXT | NOT NULL | — | Interface style: typically one of `rest`, `grpc`, `graphql`, `event`, `cli`, `file`, `library`. Free-text — no CHECK constraint. |
| `description` | TEXT | — | NULL | Longer description of the interface's contract, expected inputs/outputs, or SLA. |

### Relationships

- **Parent:** `component` (via `component_id`)

### MCP Tool Access

```
# Written as nested children when inserting a component via changelog_insert
# Queried as part of the component entity via changelog_query entity_type="component"
```

---

## 6. `component_dependency`

### Purpose

Records a directed dependency edge between two components: `component_id` depends on `depends_on`. The set of all rows defines the component dependency graph, which must be a directed acyclic graph (DAG) — cycles indicate an architectural problem.

### Context

The dependency graph is consumed by the implementation_planner to sequence work items (a component cannot be implemented before its dependencies) and by the architecture_critic to verify there are no cycles and that `external` components are not being depended on implicitly. The composite primary key prevents duplicate edges.

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `component_id` | TEXT | NOT NULL, FK → `component(id)`, part of PK | — | The dependent component (the one that calls or relies on the other). |
| `depends_on` | TEXT | NOT NULL, FK → `component(id)`, part of PK | — | The component being depended upon (the one that must exist first). |

**Composite PK:** `(component_id, depends_on)` — prevents duplicate dependency edges.

### Relationships

- Both columns are foreign keys into `component`.

### MCP Tool Access

```
# Written as nested children when inserting a component via changelog_insert
# Queried as part of the component entity — dependency list returned inline
changelog_query  entity_type="component"  ids=["COMP-001"]
```

---

> **Note:** Component-to-requirement traceability (formerly tracked in a dedicated `component_requirement` table) is now handled by `requirement_trace` with `addressed_by_type = 'component'`. See [cross-cutting.md](cross-cutting.md#requirement_trace) for details.

---

## 7. `integration_test_boundary`

### Purpose

Identifies the interaction points between components where integration tests are mandatory. Each row names a source component, a target component, the type of boundary being crossed, and the correct observable behaviour that tests must verify.

### Context

Integration test boundaries are a direct output of architectural decomposition: wherever two components communicate, there is a test boundary. By recording these boundaries explicitly during the architecture phase, the backend_architect ensures the test_writer knows exactly which component interactions need contract or integration-level coverage. The `boundary_type` field is free-form text to accommodate project-specific boundary types; canonical values are `api_call`, `database_access`, `message_event`, and `file_system` (see column reference below).

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `component_id` | TEXT | NOT NULL, FK → `component(id)`, part of UNIQUE(component_id, target_component_id, boundary_type) | — | The initiating component (the one that crosses the boundary). |
| `target_component_id` | TEXT | NOT NULL, FK → `component(id)`, part of UNIQUE(component_id, target_component_id, boundary_type) | — | The receiving component (the one being called or accessed). |
| `boundary_type` | TEXT | NOT NULL, part of UNIQUE(component_id, target_component_id, boundary_type) | — | Mechanism of interaction. Free-form text; canonical values: `api_call` (HTTP/RPC call), `database_access` (direct DB read/write), `message_event` (message broker publish/subscribe), `file_system` (shared file I/O). Custom values are accepted for project-specific boundary types. |
| `correct_behavior` | TEXT | NOT NULL | — | Human-readable description of what a passing integration test must assert (e.g., "When the Auth Service returns 401, the API Gateway must return 403 to the caller and log the event"). |

### Relationships

- **Parents:** `component` × 2 (both `component_id` and `target_component_id`)
- **Consumed by:** `test_writer` (derives integration test scaffolding from this table)

### MCP Tool Access

```
# Written as nested children when inserting a component via changelog_insert
# Queried as part of the component entity with include_related: true
changelog_query  entity_type="component"  ids=["COMP-001"]  include_related=true
# Returns: interfaces, dependencies, requirements_addressed, integration_test_boundaries
```

> **Note:** `integration_test_boundary` is not a standalone queryable entity type — it is always read as a child of `component` when `include_related: true` is set.

---

## Cross-Table Query Patterns

### "Why are we using X?"

The canonical traceability query traverses: `approved_dependency` (with `category` for grouping) → `adr` (via `approved_dependency.adr_id`) → `adr.research_sources` JSON column. Technology choices that are not third-party dependencies are recorded in ADRs directly.

```
traceability_query  from="adr"  id="ADR-003"
# Returns: alternatives with pros/cons, decision (via adr_decision), consequences, research sources
```

### "What does component COMP-002 do and what does it need?"

```
changelog_query  entity_type="component"  ids=["COMP-002"]  include_related=true
# Returns inline: interfaces, dependency list, requirement mappings, integration test boundaries
```

### "Which requirements have no component assigned?"

```sql
SELECT r.id, r.description
FROM requirement r
WHERE r.id NOT IN (SELECT requirement_id FROM requirement_trace WHERE addressed_by_type = 'component');
```

### "Show all accepted ADRs for this iteration"

```
changelog_query  entity_type="adr"  iteration_id=2  filters={status: "accepted"}
```

### "What are the integration test obligations at the API Gateway boundary?"

```
changelog_query  entity_type="component"  ids=["COMP-001"]  include_related=true
# The integration_test_boundaries array in the response lists all target components,
# boundary types, and correct_behavior assertions for COMP-001
```

---

## Domain Summary

| Table | PK Type | Parent Tables | Key Constraints |
|-------|---------|---------------|-----------------|
| `adr` | TEXT (ADR-XXX) | `revision`, self | `status` CHECK 4 values; `superseded_by` self-FK |
| `adr_alternative` | INTEGER AUTO | `adr` | `pros` and `cons` nullable TEXT (JSON arrays) |
| `adr_decision` | Composite (adr_id) | `adr`, `adr_alternative` | PK enforces one decision per ADR; `alternative_id` nullable |
| `component` | TEXT (COMP-XXX) | `revision` | `type` CHECK 8 values |
| `component_interface` | INTEGER AUTO | `component` | UNIQUE(component_id, name) |
| `component_dependency` | Composite (component_id, depends_on) | `component` × 2 | Composite PK prevents duplicate edges |
| `integration_test_boundary` | INTEGER AUTO | `component` × 2 | UNIQUE(component_id, target_component_id, boundary_type); `boundary_type` free-form TEXT |
