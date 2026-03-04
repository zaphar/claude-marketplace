# Cross-Cutting Architecture Tables

**Domain:** Cross-cutting concerns that span the entire system — security, deployment, observability, third-party dependencies, and the traceability backbone.

**Primary producer:** `backend_architect` (architecture phase)
**Critic:** `architecture_critic`

These tables are written during the architecture phase after components and ADRs are established. They do not model any single subsystem; instead, they capture decisions and constraints that apply system-wide or that weave requirements through the full architectural stack.

---

## Table of Contents

1. [security_config](#security_config)
2. [deployment_config](#deployment_config)
3. [observability_config](#observability_config)
4. [approved_dependency](#approved_dependency)
5. [traceability_mapping](#traceability_mapping)

---

## security_config

### Purpose

Stores the security architecture decisions for the system as a flat key/value configuration scoped to a logical `category`. Each row captures one security decision or setting — for example, the authentication scheme, authorization model, encryption-at-rest policy, or secrets management strategy.

This is intentionally a key/value store rather than a strongly-typed table so that the schema does not need to change as new security concerns emerge. Categories group related decisions; keys and values carry the substance.

### Context

Written by `backend_architect` after the requirements analyst has recorded any `technology_constraint` rows with security implications. The architect reads those constraints and translates them into concrete security configuration entries.

Common category values: `authentication`, `authorization`, `data_protection`, `secrets_management`, `network`, `audit_logging`, `compliance`.

### Column Reference

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NOT NULL | autoincrement | PRIMARY KEY | Surrogate row identifier. |
| `iteration_id` | INTEGER | NOT NULL | — | FK → `iteration(id)` | The iteration that produced this entry. Scopes the config to a specific development cycle. |
| `revision_id` | INTEGER | NOT NULL | — | FK → `revision(id)` | The producer–critic revision that created this row. |
| `category` | TEXT | NOT NULL | — | — | Logical grouping for the setting (e.g., `authentication`, `authorization`, `data_protection`). |
| `key` | TEXT | NOT NULL | — | — | Setting name within the category (e.g., `scheme`, `provider`, `algorithm`). |
| `value` | TEXT | NOT NULL | — | — | Setting value (e.g., `JWT`, `OAuth2`, `AES-256-GCM`). |
| `created_at` | TEXT | NOT NULL | — | — | ISO 8601 timestamp of row insertion. |

### Relationships

- **`iteration_id` → `iteration(id)`** — Every security config entry is anchored to an iteration, enabling security posture to evolve across iterations without overwriting history.
- **`revision_id` → `revision(id)`** — Traces which producer–critic round produced the entry.
- No direct foreign keys to `requirement` or `adr`, but security decisions can be correlated via `traceability_mapping` (point `addressed_by` at a component that owns the security concern) or by reading `technology_constraint` rows that share the same `iteration_id`.

### MCP Tool Access

**Read** (`changelog_query`):
```json
{
  "entity_type": "security_config",
  "iteration_id": 1,
  "filters": { "category": "authentication" }
}
```

**Write** (`changelog_insert`):
```json
{
  "entity_type": "security_config",
  "iteration_id": 1,
  "revision_id": 3,
  "data": {
    "category": "authentication",
    "key": "scheme",
    "value": "JWT with RS256, 15-minute access tokens, 7-day refresh tokens"
  }
}
```

---

## deployment_config

### Purpose

Records the deployment architecture for every target environment the system must run in. Like `security_config`, this is a key/value store scoped by both `target` (the environment) and `category` (the concern area), enabling the architect to capture deployment decisions for dev, staging, and production independently without schema duplication.

### Context

Written by `backend_architect` after `deployment_requirement` and `deployment_infra_requirement` rows have been established by the requirements analyst. The architect translates high-level deployment requirements into concrete configuration decisions (container runtime, orchestration platform, scaling policy, network topology, etc.).

Common `target` values: `all`, `development`, `staging`, `production`.
Common `category` values: `containerization`, `orchestration`, `scaling`, `networking`, `storage`, `ci_cd`, `secrets`.

### Column Reference

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NOT NULL | autoincrement | PRIMARY KEY | Surrogate row identifier. |
| `iteration_id` | INTEGER | NOT NULL | — | FK → `iteration(id)` | Iteration that produced this entry. |
| `revision_id` | INTEGER | NOT NULL | — | FK → `revision(id)` | Revision that produced this entry. |
| `target` | TEXT | NOT NULL | — | — | Deployment environment this setting applies to (e.g., `production`, `staging`, `all`). |
| `category` | TEXT | NOT NULL | — | — | Concern area within the target (e.g., `containerization`, `scaling`, `networking`). |
| `key` | TEXT | NOT NULL | — | — | Setting name within the category (e.g., `runtime`, `min_replicas`, `ingress_controller`). |
| `value` | TEXT | NOT NULL | — | — | Setting value (e.g., `Docker`, `3`, `nginx`). |
| `created_at` | TEXT | NOT NULL | — | — | ISO 8601 timestamp of row insertion. |

### Relationships

- **`iteration_id` → `iteration(id)`** — Scopes all deployment decisions to an iteration.
- **`revision_id` → `revision(id)`** — Traces which producer–critic round produced the entry.
- Conceptually downstream of `deployment_requirement` and `deployment_infra_requirement` (same `iteration_id`), though there is no enforced FK between them.
- Technology choices that drive deployment decisions (e.g., "use Kubernetes") should have a corresponding `adr` row for auditability.

### MCP Tool Access

**Read** (`changelog_query`):
```json
{
  "entity_type": "deployment_config",
  "iteration_id": 1,
  "filters": { "target": "production", "category": "scaling" }
}
```

**Write** (`changelog_insert`):
```json
{
  "entity_type": "deployment_config",
  "iteration_id": 1,
  "revision_id": 3,
  "data": {
    "target": "production",
    "category": "scaling",
    "key": "min_replicas",
    "value": "3"
  }
}
```

---

## observability_config

### Purpose

Captures the observability strategy for the system: logging configuration, metrics collection, distributed tracing, alerting rules, and health check endpoints. Like the other config tables, this is a key/value store grouped by `category`, giving the architect flexibility to record any observability concern without schema migration.

### Context

Written by `backend_architect` alongside (or immediately after) security and deployment config. Driven by `operational_requirement` and `operational_monitoring` rows that specify what uptime/SLA targets must be met and what must be monitored. The architect translates those requirements into concrete tooling and configuration decisions.

Common `category` values: `logging`, `metrics`, `tracing`, `alerting`, `health_checks`, `dashboards`.

### Column Reference

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NOT NULL | autoincrement | PRIMARY KEY | Surrogate row identifier. |
| `iteration_id` | INTEGER | NOT NULL | — | FK → `iteration(id)` | Iteration that produced this entry. |
| `revision_id` | INTEGER | NOT NULL | — | FK → `revision(id)` | Revision that produced this entry. |
| `category` | TEXT | NOT NULL | — | — | Observability concern area (e.g., `logging`, `metrics`, `tracing`, `alerting`). |
| `key` | TEXT | NOT NULL | — | — | Setting name within the category (e.g., `format`, `aggregator`, `retention_days`, `sampling_rate`). |
| `value` | TEXT | NOT NULL | — | — | Setting value (e.g., `JSON`, `Prometheus`, `30`, `0.1`). |
| `created_at` | TEXT | NOT NULL | — | — | ISO 8601 timestamp of row insertion. |

### Relationships

- **`iteration_id` → `iteration(id)`** — Scopes observability decisions to an iteration.
- **`revision_id` → `revision(id)`** — Traces which producer–critic round produced the entry.
- Semantically downstream of `operational_requirement` and `operational_monitoring`; those tables specify *what* must be observed, this table specifies *how*.
- Technology choices for observability tooling (e.g., "use OpenTelemetry") should have corresponding `adr` rows.

### MCP Tool Access

**Read** (`changelog_query`):
```json
{
  "entity_type": "observability_config",
  "iteration_id": 1,
  "filters": { "category": "tracing" }
}
```

**Write** (`changelog_insert`):
```json
{
  "entity_type": "observability_config",
  "iteration_id": 1,
  "revision_id": 3,
  "data": {
    "category": "tracing",
    "key": "provider",
    "value": "OpenTelemetry with Jaeger backend"
  }
}
```

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
| `iteration_id` | INTEGER | NOT NULL | — | FK → `iteration(id)` | Iteration that approved this dependency. |
| `revision_id` | INTEGER | NOT NULL | — | FK → `revision(id)` | Revision that produced this row. |
| `package` | TEXT | NOT NULL | — | — | Package name as it appears in the ecosystem registry (e.g., `express`, `com.fasterxml.jackson.core:jackson-databind`). |
| `version_constraint` | TEXT | NULL | — | — | SemVer or ecosystem-specific version constraint (e.g., `^4.18.0`, `>=2.14.0 <3.0.0`). NULL means unconstrained (discouraged). |
| `purpose` | TEXT | NOT NULL | — | — | One-line description of what this dependency is used for (e.g., `HTTP server framework`, `JSON serialization`). |
| `justification` | TEXT | NOT NULL | — | — | Rationale for choosing this specific package over alternatives. Should cross-reference the relevant ADR. |
| `adr_id` | TEXT | NULL | — | FK → `adr(id)` | The ADR that decided to adopt this dependency, if one exists. |
| `license` | TEXT | NULL | — | — | SPDX license identifier (e.g., `MIT`, `Apache-2.0`, `GPL-3.0-only`). NULL means license was not checked (a gap that should be filled). |
| `maintenance_activity` | TEXT | NULL | — | — | Qualitative assessment of upstream maintenance health (e.g., `active — released 2024-11`, `sporadic — last release 18 months ago`). |
| `community_adoption` | TEXT | NULL | — | — | Qualitative measure of ecosystem adoption (e.g., `>10M weekly npm downloads`, `widely used in Go stdlib ecosystem`). |
| `transitive_deps` | INTEGER | NULL | — | — | Approximate count of transitive dependencies pulled in by this package, as a supply-chain surface area indicator. |
| `single_maintainer_risk` | INTEGER | NOT NULL | `0` | — | Boolean flag (`0` = no, `1` = yes). Set to `1` if the package has a single active maintainer, indicating bus-factor supply-chain risk. |
| `created_at` | TEXT | NOT NULL | — | — | ISO 8601 timestamp of row insertion. |

### Relationships

- **`iteration_id` → `iteration(id)`** — Approvals are scoped to an iteration; a dependency can be re-evaluated or updated in a later iteration.
- **`revision_id` → `revision(id)`** — Traces which producer–critic round produced the entry.
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
  "revision_id": 3,
  "data": {
    "package": "express",
    "version_constraint": "^4.18.0",
    "purpose": "HTTP server framework",
    "justification": "Industry-standard Node.js HTTP framework; chosen per ADR-003 over Fastify due to team familiarity and plugin ecosystem.",
    "adr_id": "ADR-003",
    "license": "MIT",
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

## traceability_mapping

### Purpose

The traceability backbone of the entire data model. Each row asserts that a specific requirement (`requirement_id`) is addressed by some named architectural element (`addressed_by`) of a given type (`addressed_by_type`). This creates the REQ → COMP/ENDPOINT/FLOW/SCREEN chain that makes the "why" query possible: given any artifact in the system, the architect can trace back to the requirement that motivated it, and forward to every other artifact that satisfies the same requirement.

This table is the primary data source for the `traceability_query` MCP tool, which is how humans and agents answer questions like "which component handles REQ-012?" or "which requirements does the payment screen address?".

### Context

Written by `backend_architect` after components, user flows, and screens have been defined. A complete architecture phase should have at least one `traceability_mapping` row per requirement — requirements with no mapping are dark requirements that cannot be verified during QA.

The `addressed_by` field is a free-text identifier that should match an existing entity ID: `COMP-XXX` for components, an endpoint path/name, a `user_flow.id`, a `screen.id`, or a descriptive label for `other`. The `addressed_by_type` CHECK constraint enforces that one of five categories is used.

### Column Reference

| Column | Type | Nullable | Default | Constraints | Description |
|--------|------|----------|---------|-------------|-------------|
| `id` | INTEGER | NOT NULL | autoincrement | PRIMARY KEY | Surrogate row identifier. |
| `iteration_id` | INTEGER | NOT NULL | — | FK → `iteration(id)` | Iteration that produced this mapping. |
| `revision_id` | INTEGER | NOT NULL | — | FK → `revision(id)` | Revision that produced this row. |
| `requirement_id` | TEXT | NOT NULL | — | FK → `requirement(id)` | The requirement being addressed (e.g., `REQ-007`). |
| `addressed_by` | TEXT | NOT NULL | — | — | Identifier of the architectural element satisfying the requirement (e.g., `COMP-002`, `POST /api/payments`, `flow-checkout`, `screen-confirmation`). |
| `addressed_by_type` | TEXT | NOT NULL | — | CHECK(`addressed_by_type` IN (`'component'`, `'endpoint'`, `'flow'`, `'screen'`, `'other'`)) | Category of the addressing element. Constrains values to five known types. |
| `notes` | TEXT | NULL | — | — | Optional free-text clarification of how or why this element addresses the requirement (e.g., partial coverage, conditions, caveats). |
| `created_at` | TEXT | NOT NULL | — | — | ISO 8601 timestamp of row insertion. |

**CHECK constraint on `addressed_by_type`:**
```sql
CHECK(addressed_by_type IN ('component', 'endpoint', 'flow', 'screen', 'other'))
```

### Relationships

- **`iteration_id` → `iteration(id)`** — Mappings are iteration-scoped; they can be extended or revised in subsequent iterations without losing prior history.
- **`revision_id` → `revision(id)`** — Traces which producer–critic round produced the entry.
- **`requirement_id` → `requirement(id)`** — Hard FK to the requirements table. A mapping row cannot exist without a valid requirement.
- **`addressed_by` (soft reference)** — The `addressed_by` value conventionally matches a `component.id` (`COMP-XXX`), `user_flow.id`, or `screen.id`, but there is no database-level FK enforcing this. This is intentional: endpoints and other addressable elements do not have their own top-level tables. The `addressed_by_type` field disambiguates which table (if any) to look up.
- The `traceability_query` tool in `read-tools.js` joins this table with `requirement`, `component`, `adr`, `user_flow`, and `screen` to build the full "why" chain for any query target.

### The REQ → COMP → ADR → SCREEN Chain

The full traceability chain is assembled by the `traceability_query` tool by combining multiple tables:

```
requirement (REQ-XXX)
    └── traceability_mapping.requirement_id → addressed_by (COMP-XXX, flow-XXX, screen-XXX)
            ├── component_requirement (COMP-XXX → REQ-XXX)   [reverse link]
            ├── adr (which ADRs reference this component?)    [via adr_consequence / adr text]
            └── screen / user_flow                            [via addressed_by_type = 'screen' | 'flow']
```

Every requirement that is not covered by at least one `traceability_mapping` row is an unaddressed requirement — a QA-phase failure condition.

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
  "entity_type": "traceability_mapping",
  "iteration_id": 1,
  "filters": { "addressed_by_type": "screen" }
}
```

**Write** (`changelog_insert`):
```json
{
  "entity_type": "traceability_mapping",
  "iteration_id": 1,
  "revision_id": 3,
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
  "entity_type": "traceability_mapping",
  "iteration_id": 1,
  "revision_id": 3,
  "data": {
    "requirement_id": "REQ-007",
    "addressed_by": "screen-payment-confirmation",
    "addressed_by_type": "screen",
    "notes": "Confirmation screen satisfies the user-visible acknowledgement half of REQ-007."
  }
}
```

---

## Common Patterns

### Querying all cross-cutting config for an iteration

All five tables share the `iteration_id` anchor. To get the full cross-cutting picture for iteration 1:

```json
{ "entity_type": "security_config",      "iteration_id": 1 }
{ "entity_type": "deployment_config",    "iteration_id": 1 }
{ "entity_type": "observability_config", "iteration_id": 1 }
{ "entity_type": "approved_dependency",  "iteration_id": 1 }
{ "entity_type": "traceability_mapping", "iteration_id": 1 }
```

### Detecting unaddressed requirements

Query all `requirement` rows and all `traceability_mapping` rows for an iteration, then find requirements whose `id` does not appear in any `traceability_mapping.requirement_id`. This is a standard QA-phase check.

### Dependency audit trail

Given a dependency, find the ADR that approved it via `approved_dependency.adr_id`, then read that ADR's context, decision, and research sources to get the full rationale chain.
