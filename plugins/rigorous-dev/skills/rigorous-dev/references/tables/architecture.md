# Architecture Domain — Table Reference

This document covers the 15 tables that capture the output of the **backend_architect** agent during the architecture phase of the rigorous-dev workflow. Together they record the complete architectural decision log, system component graph, technology selections, and high-level vision that downstream agents build upon.

**Producer:** `backend_architect`
**Critic/Validator:** `architecture_critic`
**Downstream consumers:** `implementation_planner` (builds work phases from components/requirements), `senior_developer` (implements against component interfaces and technology choices)

---

## Table of Contents

1. [adr](#1-adr)
2. [adr_alternative](#2-adr_alternative)
3. [adr_alternative_pro](#3-adr_alternative_pro)
4. [adr_alternative_con](#4-adr_alternative_con)
5. [adr_consequence](#5-adr_consequence)
6. [adr_research_source](#6-adr_research_source)
7. [component](#7-component)
8. [component_interface](#8-component_interface)
9. [component_dependency](#9-component_dependency)
10. [component_requirement](#10-component_requirement)
11. [integration_test_boundary](#11-integration_test_boundary)
12. [technology_choice](#12-technology_choice)
13. [architecture_overview](#13-architecture_overview)
14. [architecture_principle](#14-architecture_principle)
15. [architecture_diagram](#15-architecture_diagram)

---

## 1. `adr`

### Purpose

The central record for each Architecture Decision Record. An ADR captures a single significant technical decision — what was decided, why, and when — giving every future reader a permanent, auditable record of the reasoning behind the system's shape. All alternative options, pros/cons, consequences, and research citations attach to this row via child tables.

### Context

ADRs are the backbone of architectural traceability. Every major technology choice, structural pattern, or integration strategy that required deliberation should have an ADR. `adr` rows reference the current iteration and revision, so the full evolution of any decision across critic feedback rounds is preserved. The `superseded_by` self-reference creates a chain of record when an earlier decision is replaced. The `adr_research_source` child table is the key enabler of the "why are we using X?" traceability query.

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
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp of row creation. |
| `updated_at` | TEXT | — | ISO 8601 timestamp of the last UPSERT update. NULL if never updated after initial insert. |

### Relationships

- **Parent:** `iteration` (via `iteration_id`), `revision` (via `revision_id`), `adr` self-reference (via `superseded_by`)
- **Children:** `adr_alternative`, `adr_consequence`, `adr_research_source`
- **Referenced by:** `approved_dependency.adr_id` (third-party dependencies may cite a backing ADR)

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

Records each option that was explicitly considered when making an ADR decision. Every ADR should have at least two alternatives (including the chosen option) so that future readers understand what was weighed. Pros and cons for each alternative live in `adr_alternative_pro` / `adr_alternative_con`.

### Context

The alternative-with-pros-and-cons pattern is the structured form of the classic ADR "options considered" section. Splitting it into three tables (alternative, pro, con) allows normalised querying — e.g., "show me all ADRs where an alternative had the con 'vendor lock-in'".

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `adr_id` | TEXT | NOT NULL, FK → `adr(id)` | — | The ADR this alternative belongs to. |
| `option_text` | TEXT | NOT NULL | — | Name or brief description of the alternative (e.g., "Use Redis as a cache layer"). |

### Relationships

- **Parent:** `adr` (via `adr_id`)
- **Children:** `adr_alternative_pro`, `adr_alternative_con`

### MCP Tool Access

```
# Written as nested children when inserting an adr via changelog_insert
# Queried as part of the adr entity via changelog_query entity_type="adr"
```

---

## 3. `adr_alternative_pro`

### Purpose

Lists the advantages of a specific alternative under an ADR. Multiple pro rows can exist per alternative, each stating one discrete benefit.

### Context

Keeping pros as individual rows (rather than a single comma-separated string) allows the architecture_critic to flag missing considerations and enables future queries like "which alternatives were praised for performance?" Rows are ordered implicitly by insertion order.

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `alternative_id` | INTEGER | NOT NULL, FK → `adr_alternative(id)` | — | The alternative this pro belongs to. |
| `pro` | TEXT | NOT NULL | — | A single, concrete advantage (e.g., "Built-in horizontal sharding avoids manual partitioning"). |

### Relationships

- **Parent:** `adr_alternative` (via `alternative_id`)

### MCP Tool Access

```
# Written as nested children when inserting adr_alternative rows via changelog_insert
# Surfaced when querying entity_type="adr" — pro/con lists are returned inline
```

---

## 4. `adr_alternative_con`

### Purpose

Lists the disadvantages of a specific alternative. Mirrors `adr_alternative_pro` in structure.

### Context

Explicit cons are critical for demonstrating that the chosen alternative's drawbacks were acknowledged and accepted rather than overlooked. The architecture_critic will reject ADRs whose chosen option has no stated cons or where the cons of rejected alternatives were not properly weighed.

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `alternative_id` | INTEGER | NOT NULL, FK → `adr_alternative(id)` | — | The alternative this con belongs to. |
| `con` | TEXT | NOT NULL | — | A single, concrete disadvantage (e.g., "Requires additional operational expertise to tune query planner"). |

### Relationships

- **Parent:** `adr_alternative` (via `alternative_id`)

### MCP Tool Access

```
# Written as nested children when inserting adr_alternative rows via changelog_insert
# Surfaced when querying entity_type="adr" — pro/con lists are returned inline
```

---

## 5. `adr_consequence`

### Purpose

Records known consequences of accepting a decision — effects on the system, team, or process that will play out downstream. Unlike pros/cons (which apply to alternatives), consequences apply to the **chosen decision** and describe what the system must now live with.

### Context

Consequences bridge ADRs and the broader system: they are often the starting point for follow-up ADRs, new `component` entries, or `technology_constraint` rows. The implementation_planner can use consequence text to identify risk items.

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `adr_id` | TEXT | NOT NULL, FK → `adr(id)` | — | The ADR whose consequences these are. |
| `consequence` | TEXT | NOT NULL | — | A single concrete consequence (e.g., "All services must implement circuit-breaker logic when calling the external payment gateway"). |

### Relationships

- **Parent:** `adr` (via `adr_id`)

### MCP Tool Access

```
# Written as nested children when inserting an adr via changelog_insert
# Queried as part of the adr entity via changelog_query entity_type="adr"
```

---

## 6. `adr_research_source`

### Purpose

Stores citations — URLs, paper references, blog posts, internal docs — that informed an ADR. This is the key enabler of the **"why are we using X?"** traceability query: given any technology or pattern in the codebase, a developer can trace it back to its ADR and then to the primary sources that justified the choice.

### Context

Research sources distinguish evidence-based architecture from cargo-cult decisions. The architecture_critic checks that non-trivial ADRs have at least one cited source. The `traceability_query` MCP tool follows the chain: `component` → `technology_choice` → `adr` → `adr_research_source`, surfacing all relevant citations in one call.

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `adr_id` | TEXT | NOT NULL, FK → `adr(id)` | — | The ADR this source supports. |
| `source` | TEXT | NOT NULL | — | Citation text: a URL, paper title and author, RFC number, or internal document path. Free-form but should be specific enough to be locatable. |

### Relationships

- **Parent:** `adr` (via `adr_id`)

### MCP Tool Access

```
# Written as nested children when inserting an adr via changelog_insert
# Surfaced by traceability_query — the primary "why are we using X?" path terminates here
changelog_query  entity_type="adr"  ids=["ADR-001"]   # returns research_sources inline
```

---

## 7. `component`

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
| `type` | TEXT | NOT NULL, CHECK(`type` IN `'api'`, `'service'`, `'worker'`, `'database'`, `'cache'`, `'queue'`, `'external'`, `'library'`) | — | Classification: `api` = HTTP/RPC boundary; `service` = internal service with no direct external exposure; `worker` = async/background processor; `database` = persistent data store; `cache` = volatile data store; `queue` = message broker; `external` = third-party dependency outside system boundary; `library` = shared code, not a process. |
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

## 8. `component_interface`

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

## 9. `component_dependency`

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

## 10. `component_requirement`

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

## 11. `integration_test_boundary`

### Purpose

Identifies the interaction points between components where integration tests are mandatory. Each row names a source component, a target component, the type of boundary being crossed, and the correct observable behaviour that tests must verify.

### Context

Integration test boundaries are a direct output of architectural decomposition: wherever two components communicate, there is a test boundary. By recording these boundaries explicitly during the architecture phase, the backend_architect ensures the test_writer knows exactly which component interactions need contract or integration-level coverage. The `boundary_type` CHECK constraint ensures only well-understood crossing types are recorded.

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `component_id` | TEXT | NOT NULL, FK → `component(id)` | — | The initiating component (the one that crosses the boundary). |
| `target_component` | TEXT | NOT NULL, FK → `component(id)` | — | The receiving component (the one being called or accessed). |
| `boundary_type` | TEXT | NOT NULL, CHECK(`boundary_type` IN `'api_call'`, `'database_access'`, `'message_event'`, `'file_system'`) | — | Mechanism of interaction: `api_call` = HTTP/RPC call; `database_access` = direct DB read/write; `message_event` = message broker publish/subscribe; `file_system` = shared file I/O. |
| `correct_behavior` | TEXT | NOT NULL | — | Human-readable description of what a passing integration test must assert (e.g., "When the Auth Service returns 401, the API Gateway must return 403 to the caller and log the event"). |

### Relationships

- **Parents:** `component` × 2 (both `component_id` and `target_component`)
- **Consumed by:** `test_writer` (derives integration test scaffolding from this table)

### MCP Tool Access

```
# Written as nested children when inserting a component via changelog_insert
# Queried as part of the component entity
changelog_query  entity_type="component"  ids=["COMP-001"]

# Cross-component query — all boundaries involving a given component
changelog_query  entity_type="integration_test_boundary"  [component_id="COMP-001"]
```

---

## 12. `technology_choice`

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

## 13. `architecture_overview`

### Purpose

Provides the top-level narrative description of the overall system architecture: its style (e.g., event-driven microservices, modular monolith, layered), its major structural concerns, and the communication patterns between subsystems. Acts as the entry point for reading the architecture domain.

### Context

There is typically one `architecture_overview` row per iteration (created at the start of the architecture phase) with `architecture_principle` and `architecture_diagram` children attached to it. The overview is the first thing the architecture_critic reads and the primary artifact the implementation_planner uses to understand the system's intended shape before diving into individual components.

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | The iteration this overview describes. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | The producer-critic revision attempt that produced this row. |
| `description` | TEXT | NOT NULL | — | Full prose description of the architecture: style, major subsystems, data flows, communication patterns, and key quality attributes being optimised for. |
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp of row creation. |

### Relationships

- **Parent:** `iteration`, `revision`
- **Children:** `architecture_principle`, `architecture_diagram`

### MCP Tool Access

```
# Write
changelog_insert  entity_type="architecture_overview"  { iteration_id, revision_id, description }

# Read
changelog_query   entity_type="architecture_overview"  [iteration_id=N]
```

---

## 14. `architecture_principle`

### Purpose

Enumerates the non-negotiable design principles that govern all architectural decisions in this iteration. Principles are short, memorable axioms (e.g., "Prefer async over sync for inter-service communication", "All state lives in the database, never in application memory") that constrain future decisions.

### Context

Principles are attached to an `architecture_overview` and serve as the rubric the architecture_critic applies when evaluating component designs and ADRs. If a proposed component or technology choice violates a stated principle, the critic should reject it. Multiple principles can share one overview (typical: 4–8 principles per iteration).

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `overview_id` | INTEGER | NOT NULL, FK → `architecture_overview(id)` | — | The overview this principle belongs to. |
| `principle` | TEXT | NOT NULL | — | The principle stated as a declarative rule or guideline. Should be specific enough to be actionable during design review. |

### Relationships

- **Parent:** `architecture_overview` (via `overview_id`)

### MCP Tool Access

```
# Written as nested children when inserting an architecture_overview via changelog_insert
# Queried as part of the architecture_overview entity
changelog_query  entity_type="architecture_overview"  ids=[1]
```

---

## 15. `architecture_diagram`

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

The canonical traceability query traverses: `technology_choice` → `adr` (via rationale mention or `approved_dependency.adr_id`) → `adr_research_source`.

```
traceability_query  from="adr"  id="ADR-003"
# Returns: decision, rationale, all alternatives with pros/cons, consequences, research sources
```

### "What does component COMP-002 do and what does it need?"

```
changelog_query  entity_type="component"  ids=["COMP-002"]
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
changelog_query  entity_type="integration_test_boundary"  filters={component_id: "COMP-001"}
# Returns all target components, boundary types, and correct_behavior assertions
```

---

## Domain Summary

| Table | PK Type | Parent Tables | Key Constraints |
|-------|---------|---------------|-----------------|
| `adr` | TEXT (ADR-XXX) | `iteration`, `revision`, self | `status` CHECK 4 values; `superseded_by` self-FK |
| `adr_alternative` | INTEGER AUTO | `adr` | — |
| `adr_alternative_pro` | INTEGER AUTO | `adr_alternative` | — |
| `adr_alternative_con` | INTEGER AUTO | `adr_alternative` | — |
| `adr_consequence` | INTEGER AUTO | `adr` | — |
| `adr_research_source` | INTEGER AUTO | `adr` | — |
| `component` | TEXT (COMP-XXX) | `iteration`, `revision` | `type` CHECK 8 values |
| `component_interface` | INTEGER AUTO | `component` | — |
| `component_dependency` | Composite (component_id, depends_on) | `component` × 2 | Composite PK prevents duplicate edges |
| `component_requirement` | Composite (component_id, requirement_id) | `component`, `requirement` | Composite PK prevents duplicate mappings |
| `integration_test_boundary` | INTEGER AUTO | `component` × 2 | `boundary_type` CHECK 4 values |
| `technology_choice` | INTEGER AUTO | `iteration`, `revision` | — |
| `architecture_overview` | INTEGER AUTO | `iteration`, `revision` | — |
| `architecture_principle` | INTEGER AUTO | `architecture_overview` | — |
| `architecture_diagram` | INTEGER AUTO | `architecture_overview` | — |
