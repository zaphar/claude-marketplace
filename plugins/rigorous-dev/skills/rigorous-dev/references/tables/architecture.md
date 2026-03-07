# Architecture Domain — Table Reference

This document covers the 10 tables that capture the output of the **backend_architect** agent during the architecture phase of the rigorous-dev workflow. Together they record the complete architectural decision log, system component graph, technology selections, and high-level vision that downstream agents build upon.

**Producer:** `backend_architect`
**Critic/Validator:** `architecture_critic`
**Downstream consumers:** `implementation_planner` (builds work phases from components/requirements), `senior_developer` (implements against component interfaces and technology choices)

---

## Table of Contents

1. [adr](#1-adr)
2. [adr_alternative](#2-adr_alternative)
3. [component](#3-component)
4. [component_interface](#4-component_interface)
5. [component_dependency](#5-component_dependency)
6. [component_requirement](#6-component_requirement)
7. [integration_test_boundary](#7-integration_test_boundary)
8. [technology_choice](#8-technology_choice)
9. [architecture_overview](#9-architecture_overview)
10. [architecture_diagram](#10-architecture_diagram)

---

## 1. `adr`

### Purpose

The central record for each Architecture Decision Record. An ADR captures a single significant technical decision — what was decided, why, and when — giving every future reader a permanent, auditable record of the reasoning behind the system's shape. All alternative options are stored in the `adr_alternative` child table; consequences and research citations are stored inline as JSON arrays in the `consequences` and `research_sources` columns.

### Context

ADRs are the backbone of architectural traceability. Every major technology choice, structural pattern, or integration strategy that required deliberation should have an ADR. `adr` rows reference the current iteration and revision, so the full evolution of any decision across critic feedback rounds is preserved. The `superseded_by` self-reference creates a chain of record when an earlier decision is replaced. The `research_sources` JSON column is the key enabler of the "why are we using X?" traceability query.

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | TEXT | PRIMARY KEY | — | Human-readable identifier, format `ADR-XXX` (e.g., `ADR-001`). Assigned by the backend_architect. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | The iteration during which this ADR was produced. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | The producer-critic revision attempt that produced this row. |
| `title` | TEXT | NOT NULL | — | Short, imperative title describing the decision (e.g., "Use PostgreSQL for primary datastore"). |
| `status` | TEXT | NOT NULL, CHECK(`status` IN `'proposed'`, `'accepted'`, `'deprecated'`, `'superseded'`) | — | Lifecycle state. `proposed` = under consideration; `accepted` = ratified; `deprecated` = no longer relevant but not replaced; `superseded` = replaced by another ADR (see `superseded_by`). |
| `date` | TEXT | — | NULL | ISO-8601 date the decision was made (e.g., `2024-01-15`). Optional; set when a formal decision date is recorded. |
| `context` | TEXT | — | NULL | Narrative describing the forces, constraints, and background that made this decision necessary. |
| `decision` | TEXT | NOT NULL | — | The decision itself, stated clearly and unambiguously. |
| `rationale` | TEXT | NOT NULL | — | Why this option was chosen over the alternatives. Should reference alternatives by name and cite research sources. |
| `superseded_by` | TEXT | FK → `adr(id)` | NULL | If `status = 'superseded'`, points to the newer ADR that replaces this one. |
| `consequences` | TEXT | — | `'[]'` | JSON array of consequence strings describing effects of accepting this decision (e.g., `["All services must implement circuit-breaker logic"]`). Formerly stored in the `adr_consequence` child table. |
| `research_sources` | TEXT | — | `'[]'` | JSON array of citation strings (URLs, paper references, etc.) that informed this decision (e.g., `["https://example.com/postgresql-benchmarks"]`). Formerly stored in the `adr_research_source` child table. Enables the "why are we using X?" traceability query. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp of row creation. |
| `updated_at` | TEXT | — | ISO 8601 timestamp of the last UPSERT update. NULL if never updated after initial insert. |

### Relationships

- **Parent:** `iteration` (via `iteration_id`), `revision` (via `revision_id`), `adr` self-reference (via `superseded_by`)
- **Children:** `adr_alternative`
- **Referenced by:** `approved_dependency.adr_id` (third-party dependencies may cite a backing ADR)

**Note:** Consequences and research sources are stored inline as JSON arrays in the `consequences` and `research_sources` columns. Formerly stored in the `adr_consequence` and `adr_research_source` child tables.

### MCP Tool Access

```
# Write
changelog_insert  entity_type="adr"  { id, iteration_id, revision_id, title, status, date, context, decision, rationale, superseded_by }

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

## 3. `component`

### Purpose

Represents a deployable or logically distinct unit of the system — an API server, background worker, database, cache, message queue, external third-party service, or shared library. Components are the primary unit of architectural decomposition. All interfaces, dependencies, and requirement mappings hang off component rows.

### Context

`component` is the central node in the architecture domain graph. The backend_architect decomposes the system into components during the architecture phase; the implementation_planner then uses `component_dependency` and `component_requirement` to sequence work phases; the senior_developer builds against `component_interface` contracts. Component IDs (`COMP-XXX`) appear in `traceability_mapping`, `integration_test_boundary`, and `implementation_component_status`.

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | TEXT | PRIMARY KEY | — | Human-readable identifier, format `COMP-XXX` (e.g., `COMP-001`). Assigned by the backend_architect. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | The iteration during which this component was identified. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | The producer-critic revision attempt that produced this row. |
| `name` | TEXT | NOT NULL | — | Short, descriptive name (e.g., "Auth Service", "PostgreSQL Primary", "Payment Gateway"). |
| `purpose` | TEXT | NOT NULL | — | One-to-two sentence statement of what this component does and why it exists in the system. |
| `type` | TEXT | NOT NULL | — | Free-form classification of the component. Canonical values (by convention): `api` = HTTP/RPC boundary; `service` = internal service with no direct external exposure; `worker` = async/background processor; `database` = persistent data store; `cache` = volatile data store; `queue` = message broker; `external` = third-party dependency outside system boundary; `library` = shared code, not a process. Custom values are allowed for project-specific component types. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp of row creation. |
| `updated_at` | TEXT | — | ISO 8601 timestamp of the last UPSERT update. NULL if never updated after initial insert. |

### Relationships

- **Parent:** `iteration`, `revision`
- **Children:** `component_interface`, `component_dependency` (both sides), `component_requirement`, `integration_test_boundary` (both sides)
- **Referenced by:** `traceability_mapping.addressed_by_id` (when `addressed_by_type = 'component'`), `implementation_component_status.component_id`

### MCP Tool Access

```
# Write
changelog_insert  entity_type="component"  { id, iteration_id, revision_id, name, purpose, type }

# Read
changelog_query   entity_type="component"  [iteration_id=N]
traceability_query  from="component"  id="COMP-001"   # shows requirements satisfied, interfaces, dependencies
```

---

## 4. `component_interface`

### Purpose

Describes each interface — HTTP endpoint group, gRPC service definition, message topic, or file I/O contract — that a component exposes to the rest of the system. Interfaces define the *contract* other components depend on.

### Context

`component_interface` rows are the foundation for implementation contract tests and the `plan_phase_api_endpoint` entries created by the implementation_planner. When the senior_developer builds a component, the interfaces listed here define what must exist and be tested. The `type` field is free-text to accommodate diverse interface styles (REST, gRPC, event, file).

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `component_id` | TEXT | NOT NULL, FK → `component(id)` | — | The component that exposes this interface. |
| `name` | TEXT | NOT NULL | — | Short identifier for the interface (e.g., `POST /auth/token`, `UserCreated event`, `orders.csv export`). |
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

## 5. `component_dependency`

### Purpose

Records a directed dependency edge between two components: `component_id` depends on `depends_on`. The set of all rows defines the component dependency graph, which must be a directed acyclic graph (DAG) — cycles indicate an architectural problem.

### Context

The dependency graph is consumed by the implementation_planner to sequence plan phases (a component cannot be implemented before its dependencies) and by the architecture_critic to verify there are no cycles and that `external` components are not being depended on implicitly. The composite primary key prevents duplicate edges.

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

## 6. `component_requirement`

### Purpose

Maps components to the requirements they satisfy. This is the primary architecture-level traceability link: for any requirement, you can discover which component(s) implement it; for any component, you can see which requirements justify its existence.

### Context

During architecture review, the architecture_critic verifies that every `must_have` requirement from the requirements domain has at least one component mapped to it. During the implementation phase, `component_requirement` drives `implementation_component_status` — if a component is complete but an attached requirement is not satisfied, there is a gap. The composite PK prevents duplicate mappings.

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `component_id` | TEXT | NOT NULL, FK → `component(id)`, part of PK | — | The implementing component. |
| `requirement_id` | TEXT | NOT NULL, FK → `requirement(id)`, part of PK | — | The requirement being satisfied. Foreign key crosses domain boundary into `requirement`. |

**Composite PK:** `(component_id, requirement_id)` — prevents duplicate mappings.

### Relationships

- **Parent (architecture domain):** `component`
- **Parent (requirements domain):** `requirement`

### MCP Tool Access

```
# Written as nested children when inserting a component via changelog_insert
# Queried via traceability_query to answer "which components satisfy REQ-005?"
traceability_query  from="requirement"  id="REQ-005"
```

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
| `component_id` | TEXT | NOT NULL, FK → `component(id)` | — | The initiating component (the one that crosses the boundary). |
| `target_component` | TEXT | NOT NULL, FK → `component(id)` | — | The receiving component (the one being called or accessed). |
| `boundary_type` | TEXT | NOT NULL | — | Mechanism of interaction. Free-form text; canonical values: `api_call` (HTTP/RPC call), `database_access` (direct DB read/write), `message_event` (message broker publish/subscribe), `file_system` (shared file I/O). Custom values are accepted for project-specific boundary types. |
| `correct_behavior` | TEXT | NOT NULL | — | Human-readable description of what a passing integration test must assert (e.g., "When the Auth Service returns 401, the API Gateway must return 403 to the caller and log the event"). |

### Relationships

- **Parents:** `component` × 2 (both `component_id` and `target_component`)
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

## 8. `technology_choice`

### Purpose

Records each language, framework, runtime, database engine, cloud service, or toolchain decision made for the system. Unlike ADRs (which capture a decision-making *process*), `technology_choice` is an enumerable *inventory* of every technology in the stack, with version pins, purpose descriptions, and rationale.

### Context

`technology_choice` is consumed by the implementation_planner to select the correct language/framework tooling for each plan phase, and by the senior_developer to know exactly which version of each library to use. The `category` field (free-text) groups choices logically (e.g., `backend-language`, `database`, `auth-library`, `ci-cd`). When a technology choice is backed by formal evaluation, it should reference an ADR via the `rationale` field or via `approved_dependency.adr_id`.

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | Iteration during which this choice was made. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | The producer-critic revision attempt that produced this row. |
| `category` | TEXT | NOT NULL | — | Logical grouping for the technology (e.g., `backend-language`, `database`, `cache`, `auth`, `testing`, `ci-cd`). Free-text — no CHECK constraint. |
| `name` | TEXT | NOT NULL | — | Technology name (e.g., `TypeScript`, `PostgreSQL 16`, `Redis`, `Jest`). |
| `purpose` | TEXT | — | NULL | One-sentence description of why this technology is in the stack. |
| `rationale` | TEXT | — | NULL | Justification for the choice. Should cite alternatives considered and the ADR ID if a formal decision record exists. |
| `version` | TEXT | — | NULL | Specific version pin or minimum version (e.g., `16.x`, `^7.3.0`). |
| `config` | TEXT | — | NULL | Key configuration notes: notable non-default settings, connection pool sizes, feature flags enabled. Free-text or JSON snippet. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp of row creation. |

### Relationships

- **Parent:** `iteration`, `revision`
- **Referenced by:** `approved_dependency` (approved third-party deps may be backed by a technology_choice category)

### MCP Tool Access

```
# Write
changelog_insert  entity_type="technology_choice"  { iteration_id, revision_id, category, name, purpose, rationale, version, config }

# Read
changelog_query   entity_type="technology_choice"  [iteration_id=N]
changelog_query   entity_type="technology_choice"  [filters={category: "database"}]
```

---

## 9. `architecture_overview`

### Purpose

Provides the top-level narrative description of the overall system architecture: its style (e.g., event-driven microservices, modular monolith, layered), its major structural concerns, and the communication patterns between subsystems. Acts as the entry point for reading the architecture domain.

### Context

There is typically one `architecture_overview` row per iteration (created at the start of the architecture phase). Architectural principles are stored inline in the `principles` JSON column, and `architecture_diagram` children are attached to it. The overview is the first thing the architecture_critic reads and the primary artifact the implementation_planner uses to understand the system's intended shape before diving into individual components.

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | The iteration this overview describes. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | The producer-critic revision attempt that produced this row. |
| `description` | TEXT | NOT NULL | — | Full prose description of the architecture: style, major subsystems, data flows, communication patterns, and key quality attributes being optimised for. |
| `principles` | TEXT | — | `'[]'` | JSON array of non-negotiable design principle strings that govern all architectural decisions in this iteration (e.g., `["Prefer async over sync for inter-service communication", "All state lives in the database"]`). Formerly stored in the `architecture_principle` child table. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp of row creation. |

### Relationships

- **Parent:** `iteration`, `revision`
- **Children:** `architecture_diagram`

### MCP Tool Access

```
# Write (principles is a direct JSON column; diagrams are nested children)
changelog_insert  entity_type="architecture_overview"  {
  iteration_id, revision_id, description,
  principles: ["Prefer async over sync", ...],
  diagrams: [{ name, path, description }, ...]
}

# Read (include_related attaches diagrams; principles are always returned inline)
changelog_query  entity_type="architecture_overview"  iteration_id=N  include_related=true
```

---

## 10. `architecture_diagram`

### Purpose

Stores references to architecture diagrams (component diagrams, sequence diagrams, data flow diagrams) produced alongside the architecture overview. Each row names a diagram, gives its file path in the repository, and provides a description of what the diagram shows.

### Context

Diagrams are referenced assets rather than inline content — the `path` column points to files committed to the repository (e.g., `docs/architecture/component-diagram.png` or a Mermaid `.mmd` file). The architecture_critic verifies that at minimum one component-level diagram exists. The `name` field is used to surface diagrams by type when the implementation_planner or senior_developer needs a visual reference.

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `overview_id` | INTEGER | NOT NULL, FK → `architecture_overview(id)` | — | The overview this diagram illustrates. |
| `name` | TEXT | NOT NULL | — | Descriptive name identifying the diagram's type and scope (e.g., `System Context Diagram`, `Component Interaction Diagram`, `Auth Sequence Diagram`). |
| `path` | TEXT | NOT NULL | — | Repository-relative path to the diagram file (e.g., `docs/architecture/system-context.mmd`). |
| `description` | TEXT | — | NULL | Brief explanation of what the diagram depicts, what audience it is intended for, and any notable conventions used. |

### Relationships

- **Parent:** `architecture_overview` (via `overview_id`)

### MCP Tool Access

```
# Written as nested children when inserting an architecture_overview via changelog_insert
# Queried as part of the architecture_overview entity
changelog_query  entity_type="architecture_overview"  ids=[1]
```

---

## Cross-Table Query Patterns

### "Why are we using X?"

The canonical traceability query traverses: `technology_choice` → `adr` (via rationale mention or `approved_dependency.adr_id`) → `adr.research_sources` JSON column.

```
traceability_query  from="adr"  id="ADR-003"
# Returns: decision, rationale, all alternatives with pros/cons, consequences, research sources
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
WHERE r.id NOT IN (SELECT requirement_id FROM component_requirement);
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
| `adr` | TEXT (ADR-XXX) | `iteration`, `revision`, self | `status` CHECK 4 values; `superseded_by` self-FK |
| `adr_alternative` | INTEGER AUTO | `adr` | `pros` and `cons` nullable TEXT (JSON arrays) |
| `component` | TEXT (COMP-XXX) | `iteration`, `revision` | `type` CHECK 8 values |
| `component_interface` | INTEGER AUTO | `component` | — |
| `component_dependency` | Composite (component_id, depends_on) | `component` × 2 | Composite PK prevents duplicate edges |
| `component_requirement` | Composite (component_id, requirement_id) | `component`, `requirement` | Composite PK prevents duplicate mappings |
| `integration_test_boundary` | INTEGER AUTO | `component` × 2 | `boundary_type` free-form TEXT |
| `technology_choice` | INTEGER AUTO | `iteration`, `revision` | — |
| `architecture_overview` | INTEGER AUTO | `iteration`, `revision` | `principles` JSON column |
| `architecture_diagram` | INTEGER AUTO | `architecture_overview` | — |
