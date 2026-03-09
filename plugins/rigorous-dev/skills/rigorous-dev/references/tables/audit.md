# Audit Domain — Table Reference

This domain captures the complete output of the **security_auditor** and **performance_auditor** agents during the `audit` phase of the release workflow. It models individual audit findings — security vulnerabilities and performance bottlenecks — discovered through deep code-level analysis that goes beyond requirement-driven testing.

**Producers:** `security_auditor` (security findings), `performance_auditor` (performance findings)
**Critics:** `security_audit_critic`, `performance_audit_critic`

**Phase:** `audit` (8th of 8 phases in each iteration)

---

## Table Index

| Table | Purpose |
|-------|---------|
| [`security_audit_finding`](#security_audit_finding) | Individual security vulnerability findings from deep code-level audit |
| [`performance_audit_finding`](#performance_audit_finding) | Individual performance bottleneck findings from deep code-level audit |

---

## security_audit_finding

### Purpose

Records a single security vulnerability or concern discovered during the audit phase. Each finding is an independent row — auditors record findings incrementally as they complete each OWASP category or code area.

### Context

The `security_auditor` performs a deep code-level security audit (OWASP Top 10, data flow tracing, dependency audit, configuration review) and records each finding individually via `changelog_insert`. Audit findings come from manual expert code review during the audit phase.

The `security_audit_critic` queries all findings for the current iteration to validate completeness, accuracy, and actionability.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | The producer-critic revision that created this finding |
| `category` | TEXT | NOT NULL | — | OWASP category or custom category (e.g., `"Injection"`, `"Broken Access Control"`, `"Dependency Audit"`) |
| `severity` | TEXT | NOT NULL, CHECK(`critical`, `high`, `medium`, `low`, `informational`) | — | Impact severity of the finding |
| `title` | TEXT | NOT NULL | — | Short descriptive title (e.g., `"SQL Injection in User Search"`) |
| `description` | TEXT | NOT NULL | — | Full description including attack scenario and evidence (code snippets, traces) |
| `location` | TEXT | — | NULL | File path and line number where the vulnerability exists (e.g., `"src/api/users.js:42"`) |
| `recommendation` | TEXT | NOT NULL | — | Specific remediation steps with code examples |
| `cve` | TEXT | — | NULL | CVE identifier if the finding relates to a known vulnerability (e.g., `"CVE-2024-12345"`) |
| `status` | TEXT | NOT NULL, CHECK(`open`, `resolved`, `accepted`, `false-positive`) | `'open'` | Current status: `open` (needs fix), `resolved` (fixed), `accepted` (risk accepted), `false-positive` (not a real issue) |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO 8601 timestamp when the finding was recorded |

### Relationships

- **Parent:** `revision` (via `revision_id`). Iteration derived via revision → phase → iteration (or via `entity_context` VIEW).
- **Children:** none (flat table)

### MCP Tool Access

**Write:** `changelog_insert` with `entity_type: "security_audit_finding"`, `iteration_id`, `revision_id`, and `data` containing: `category`, `severity`, `title`, `description`, `recommendation`, and optionally `location`, `cve`, `status`.

**Read:** `changelog_query` with `entity_type: "security_audit_finding"`. Supports filtering by `iteration_id`, `ids`, or field `filters` (e.g., `{ "severity": "critical" }`, `{ "status": "open" }`).

---

## performance_audit_finding

### Purpose

Records a single performance bottleneck, anti-pattern, or optimization opportunity discovered during the audit phase. Each finding is an independent row — auditors record findings incrementally as they complete each performance area.

### Context

The `performance_auditor` performs a deep code-level performance audit (database queries, memory patterns, concurrency, API design, algorithm analysis) and records each finding individually via `changelog_insert`. Audit findings identify code-level anti-patterns and bottlenecks regardless of requirements.

The `performance_audit_critic` queries all findings for the current iteration to validate completeness, evidence backing, and actionability.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | The producer-critic revision that created this finding |
| `category` | TEXT | NOT NULL | — | Performance area (e.g., `"database"`, `"memory"`, `"concurrency"`, `"api"`, `"frontend"`, `"algorithm"`, `"logging"`) |
| `severity` | TEXT | NOT NULL, CHECK(`critical`, `high`, `medium`, `low`, `informational`) | — | Impact severity of the finding |
| `title` | TEXT | NOT NULL | — | Short descriptive title (e.g., `"N+1 Query in Task List Endpoint"`) |
| `description` | TEXT | NOT NULL | — | Full description including impact estimate and evidence (code snippets, complexity analysis, benchmark data) |
| `location` | TEXT | — | NULL | File path and line number where the issue exists (e.g., `"src/api/tasks.js:87"`) |
| `metric_name` | TEXT | — | NULL | Metric identifier when quantifiable (e.g., `"query_count_per_request"`, `"p95_latency_ms"`, `"memory_growth_mb"`) |
| `baseline_value` | REAL | — | NULL | Expected or threshold value for the metric (e.g., `1`, `100`, `50`) |
| `actual_value` | REAL | — | NULL | Measured or observed value (e.g., `15`, `850`, `120`) |
| `recommendation` | TEXT | NOT NULL | — | Specific remediation steps with code examples |
| `status` | TEXT | NOT NULL, CHECK(`open`, `resolved`, `accepted`, `deferred`) | `'open'` | Current status: `open` (needs fix), `resolved` (fixed), `accepted` (risk accepted), `deferred` (postponed to future iteration) |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO 8601 timestamp when the finding was recorded |

### Relationships

- **Parent:** `revision` (via `revision_id`). Iteration derived via revision → phase → iteration (or via `entity_context` VIEW).
- **Children:** none (flat table)

### MCP Tool Access

**Write:** `changelog_insert` with `entity_type: "performance_audit_finding"`, `iteration_id`, `revision_id`, and `data` containing: `category`, `severity`, `title`, `description`, `recommendation`, and optionally `location`, `metric_name`, `baseline_value`, `actual_value`, `status`.

**Read:** `changelog_query` with `entity_type: "performance_audit_finding"`. Supports filtering by `iteration_id`, `ids`, or field `filters` (e.g., `{ "severity": "high" }`, `{ "category": "database" }`, `{ "status": "open" }`).

---

## Entity Hierarchy

```
revision  (→ phase → iteration)
├── security_audit_finding  (1:N, flat — each finding is independent)
└── performance_audit_finding  (1:N, flat — each finding is independent)
```

Unlike the QA domain where all test data hangs off a single `test_report` root entity, audit findings are recorded individually. This design supports incremental recording (one finding at a time as the auditor works through each area) and direct querying (filter by severity, category, or status without navigating a parent entity). Neither table carries a direct `iteration_id` column — the iteration is derived via the `revision → phase → iteration` chain (or the `entity_context` VIEW). The MCP tools accept `iteration_id` as a query-level filter parameter, resolving it internally.

---

## MCP Tool Summary

| Operation | Tool | Key Parameters |
|-----------|------|----------------|
| Record a security finding | `changelog_insert` | `entity_type: "security_audit_finding"`, `iteration_id`, `revision_id`, `data` |
| Record a performance finding | `changelog_insert` | `entity_type: "performance_audit_finding"`, `iteration_id`, `revision_id`, `data` |
| Read all security findings for an iteration | `changelog_query` | `entity_type: "security_audit_finding"`, `iteration_id` |
| Read all performance findings for an iteration | `changelog_query` | `entity_type: "performance_audit_finding"`, `iteration_id` |
| Filter by severity | `changelog_query` | `entity_type: "security_audit_finding"`, `filters: { "severity": "critical" }` |
| Filter by status | `changelog_query` | `entity_type: "performance_audit_finding"`, `filters: { "status": "open" }` |
| Check overall audit phase status | `iteration_summary` | `iteration_id` — shows audit phase completion and approval |

## Distinction from QA Domain

| Aspect | QA (`test_report`) | Audit (`security_audit_finding` / `performance_audit_finding`) |
|--------|-----|------|
| Phase | `qa` | `audit` |
| Producer | `qa_engineer` | `security_auditor` / `performance_auditor` |
| Method | Automated tools (test runners) | Manual expert code review |
| Provenance | Aggregate report with stdout/stderr | Independent entity with own `revision_id` (iteration derived via revision → phase → iteration) |
| Scope | Verifies requirements are met | Finds issues requirements didn't anticipate |
| Status tracking | Report-level status (pass/fail/blocked) | `status` column tracks resolution lifecycle |
