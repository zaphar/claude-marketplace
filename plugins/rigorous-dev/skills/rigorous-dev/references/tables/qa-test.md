# QA / Test Domain — Table Reference

This domain captures the complete output of the **qa_engineer** agent during the `qa` phase of the release workflow. It models test execution results, requirement coverage, acceptance criterion verification, individual test suites and cases, security findings, performance benchmarks, blockers, and recommendations.

**Producer:** `qa_engineer`
**Critic:** `qa_critic` (validates completeness, correctness, and coverage)
**Consumer:** `release_engineer` (reads this data to determine release readiness)

**Phase:** `qa` (8th of 9 phases in each iteration)

---

## Table Index

| Table | Purpose |
|-------|---------|
| [`test_report`](#test_report) | Root entity — overall pass/fail counts, coverage percentages, status, and version provenance metadata |
| [`test_requirement_coverage`](#test_requirement_coverage) | Per-requirement test coverage status |
| [`test_acceptance_criterion_result`](#test_acceptance_criterion_result) | Pass/fail result for each acceptance criterion |
| [`test_suite`](#test_suite) | Named test suites grouped by type (unit, integration, e2e, etc.) |
| [`test_case`](#test_case) | Individual test cases with status, timing, and failure details |
| [`test_case_requirement`](#test_case_requirement) | Many-to-many: links test cases to the requirements they verify |
| [`test_security_finding`](#test_security_finding) | Security issues discovered during testing (vuln scans, dep audits) |
| [`test_performance_benchmark`](#test_performance_benchmark) | Performance measurements vs. defined thresholds |
| [`test_blocker`](#test_blocker) | Blockers preventing a pass verdict |
| [`test_blocker_requirement`](#test_blocker_requirement) | Many-to-many: links blockers to affected requirements |
| [`test_recommendation`](#test_recommendation) | QA improvement recommendations |

---

## test_report

### Purpose

The root entity for a QA run. One `test_report` row represents the aggregate outcome of a full test execution for a given iteration. All other test-domain tables reference this row.

### Context

The `qa_engineer` creates exactly one `test_report` per iteration (possibly revised across multiple revisions). The `status` field is the single signal the `release_engineer` uses to gate release: `pass` means all tests passed and no critical blockers exist; `fail` means failures occurred; `blocked` means testing could not complete.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | The iteration this report belongs to |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | The producer-critic revision that created this report. |
| `total_tests` | INTEGER | NOT NULL | `0` | Total number of tests executed |
| `passed` | INTEGER | NOT NULL | `0` | Count of tests that passed |
| `failed` | INTEGER | NOT NULL | `0` | Count of tests that failed |
| `skipped` | INTEGER | NOT NULL | `0` | Count of tests that were skipped |
| `coverage_line` | REAL | — | NULL | Line coverage percentage (0.0–100.0) |
| `coverage_branch` | REAL | — | NULL | Branch coverage percentage (0.0–100.0) |
| `coverage_function` | REAL | — | NULL | Function coverage percentage (0.0–100.0) |
| `duration_seconds` | REAL | — | NULL | Total test suite execution time in seconds |
| `status` | TEXT | NOT NULL, CHECK(`pass`, `fail`, `blocked`) | — | Overall verdict for this test run |
| `version` | TEXT | — | NULL | Version label for this report (e.g., `1.0.0`, `r3`). Formerly in `test_report_metadata`. |
| `document_date` | TEXT | — | NULL | ISO 8601 creation timestamp for this report version. Formerly `created` in `test_report_metadata`. |
| `requirements_version` | TEXT | — | NULL | Version of the requirements artifact used. Formerly in `test_report_metadata`. |
| `architecture_version` | TEXT | — | NULL | Version of the architecture artifact used. Formerly in `test_report_metadata`. |
| `commit_sha` | TEXT | — | NULL | Git/VCS commit SHA of the code under test. Formerly in `test_report_metadata`. |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO 8601 timestamp when the report was created |

### Relationships

- **Parent:** `iteration` (via `iteration_id`), `revision` (via `revision_id`)
- **Children:** `test_requirement_coverage` (1:N), `test_suite` (1:N), `test_security_finding` (1:N), `test_performance_benchmark` (1:N), `test_blocker` (1:N), `test_recommendation` (1:N)

### MCP Tool Access

**Write:** `changelog_insert` with `entity_type: "test_report"`. The `data` object maps to the non-key, non-audit columns above, plus nested child structures (suites, cases, findings, etc.) that the handler normalizes into child tables.

**Read:** `changelog_query` with `entity_type: "test_report"`. Supports filtering by `iteration_id`, `ids`, or field `filters`. Returns all child data nested: `coverage` (with nested `criteria`, each with `test_ids` JSON array), `suites` (with nested `cases`, each with `requirements`), `security_findings`, `performance_benchmarks`, `blockers` (with nested `requirements`), and `recommendations`. Metadata columns (`version`, `document_date`, `requirements_version`, `architecture_version`, `commit_sha`) are returned as flat fields on the report row.

---

## test_requirement_coverage

### Purpose

Records whether each requirement has been exercised by the test suite. Provides per-requirement test traceability at the requirement level (as opposed to per-criterion detail in `test_acceptance_criterion_result`).

### Context

The `qa_engineer` creates one row per requirement. The `qa_critic` cross-checks this list against the full requirement set in `requirement` to detect untested requirements. The `release_engineer` uses this table to confirm that all `must_have` requirements have at least a `pass` or `partial` coverage status.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key |
| `report_id` | INTEGER | NOT NULL, FK → `test_report(id)` | — | The report this coverage row belongs to |
| `requirement_id` | TEXT | NOT NULL, FK → `requirement(id)` | — | The requirement being tracked (e.g., `REQ-001`) |
| `status` | TEXT | NOT NULL, CHECK(`pass`, `fail`, `partial`, `not_tested`) | — | Coverage verdict for this requirement |

### Relationships

- **Parent:** `test_report` (via `report_id`), `requirement` (via `requirement_id`)
- **Children:** `test_acceptance_criterion_result` (1:N per coverage row)

### MCP Tool Access

Inserted as part of the nested `coverage` array within a `changelog_insert` `test_report` payload. Query via the parent `test_report` using `changelog_query`.

---

## test_acceptance_criterion_result

### Purpose

Records the pass/fail status of a single acceptance criterion for a given requirement coverage entry. This is the finest level of requirement traceability in the test domain.

### Context

Each requirement has one or more acceptance criteria (stored as the `acceptance_criteria` JSON array on the `requirement` table). The `qa_engineer` must produce a result row for every criterion. Unverified criteria appear as `not_tested`. The `criterion` text is copied from the source requirement to make the report self-contained.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key |
| `coverage_id` | INTEGER | NOT NULL, FK → `test_requirement_coverage(id)` | — | The requirement coverage entry this result belongs to |
| `criterion` | TEXT | NOT NULL | — | The acceptance criterion text (verbatim from the requirement) |
| `status` | TEXT | NOT NULL, CHECK(`pass`, `fail`, `not_tested`) | — | Whether this criterion was satisfied |
| `notes` | TEXT | — | NULL | Optional evidence, failure details, or explanation |
| `test_ids` | TEXT | NOT NULL | `'[]'` | JSON array of test case identifier strings that verify this criterion (e.g., `["auth.login.valid_credentials", "auth.login.expired_token"]`). Each value should match a `test_case.test_id`. Replaces the former `test_acceptance_criterion_test_id` child table. |

### Relationships

- **Parent:** `test_requirement_coverage` (via `coverage_id`)
- **JSON array:** `test_ids` (inline on this table) — cross-references `test_case.test_id` (soft reference, no FK enforced)

### MCP Tool Access

Inserted as nested items within the `coverage[].criteria` array of a `changelog_insert` `test_report` payload.

---

## test_suite

### Purpose

Groups test cases into named suites by their testing type. Each suite belongs to exactly one test report and contains one or more test cases.

### Context

The `qa_engineer` organizes test cases into suites reflecting the testing strategy (unit tests, integration tests, end-to-end, security scans, performance benchmarks). Suites are the second level of the hierarchy: `test_report → test_suite → test_case`.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key |
| `report_id` | INTEGER | NOT NULL, FK → `test_report(id)` | — | The report this suite belongs to |
| `name` | TEXT | NOT NULL | — | Human-readable suite name (e.g., `"Unit: Auth Module"`) |
| `type` | TEXT | NOT NULL | — | Category of tests in this suite (e.g. `unit`, `integration`, `e2e`, `security`, `performance`). Free text — no enum constraint. |

### Relationships

- **Parent:** `test_report` (via `report_id`)
- **Children:** `test_case` (1:N)

### MCP Tool Access

Inserted as items in the `suites` array of a `changelog_insert` `test_report` payload. Query via the parent `test_report`.

---

## test_case

### Purpose

Stores the result of a single test case execution, including its status, timing, and any failure diagnostics.

### Context

Each `test_case` belongs to a suite. The `test_id` is the canonical identifier used by the test runner (e.g., `"auth.login.valid_credentials"`). Flaky tests (intermittently passing/failing) are captured with the `flaky` status and a `retry_count`. Full stack traces are preserved to support root-cause analysis.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key |
| `suite_id` | INTEGER | NOT NULL, FK → `test_suite(id)` | — | The suite this test case belongs to |
| `test_id` | TEXT | NOT NULL, UNIQUE with `suite_id` | — | Test runner identifier (used as cross-reference in `test_acceptance_criterion_result.test_ids` JSON array) |
| `name` | TEXT | NOT NULL | — | Short human-readable test name |
| `description` | TEXT | — | NULL | Longer description of what the test verifies |
| `status` | TEXT | NOT NULL, CHECK(`pass`, `fail`, `skipped`, `flaky`) | — | Execution result |
| `duration_ms` | REAL | — | NULL | Execution time in milliseconds |
| `error_message` | TEXT | — | NULL | Error or assertion failure message (populated on `fail`) |
| `stack_trace` | TEXT | — | NULL | Full stack trace (populated on `fail`) |
| `retry_count` | INTEGER | — | NULL | Number of retries attempted (relevant for `flaky` status) |

**Constraints:**
- `UNIQUE(suite_id, test_id)` — prevents recording the same test case identifier twice within a suite.

### Relationships

- **Parent:** `test_suite` (via `suite_id`)
- **Children:** `test_case_requirement` (M:N bridge to `requirement`)
- **Cross-referenced by:** `test_acceptance_criterion_result.test_ids` JSON array

### MCP Tool Access

Inserted as items in the `cases` array of each suite within a `changelog_insert` `test_report` payload. Query via the parent `test_report`.

---

## test_case_requirement

### Purpose

Many-to-many bridge table linking test cases to the requirements they verify. Enables requirement-centric queries ("which test cases cover REQ-042?") and test-centric queries ("what requirements does this test verify?").

### Context

The `qa_engineer` populates this for each test case that directly verifies a requirement. Together with `test_requirement_coverage` and `test_acceptance_criterion_result`, this forms the full traceability chain: `requirement ↔ test case ↔ test suite ↔ test report`.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `test_case_id` | INTEGER | NOT NULL, FK → `test_case(id)`, part of PK | — | The test case |
| `requirement_id` | TEXT | NOT NULL, FK → `requirement(id)`, part of PK | — | The requirement this test verifies (e.g., `REQ-007`) |

**Primary Key:** `(test_case_id, requirement_id)` — composite, prevents duplicate mappings.

### Relationships

- **Parent A:** `test_case` (via `test_case_id`)
- **Parent B:** `requirement` (via `requirement_id`)

### MCP Tool Access

Inserted as items in the `requirements` array of each test case within a `changelog_insert` `test_report` payload.

---

## test_security_finding

### Purpose

Records a security issue discovered during the QA phase, either from a vulnerability scanner or a dependency audit tool.

### Context

The `qa_engineer` runs security tooling (e.g., SAST scanners, `npm audit`, `pip-audit`) and records each finding here. Critical or high severity findings typically populate the `test_blocker` table as well. The `release_engineer` checks this table for unresolved critical findings before approving release.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key |
| `report_id` | INTEGER | NOT NULL, FK → `test_report(id)` | — | The report this finding belongs to |
| `category` | TEXT | NOT NULL | — | Whether this came from a code scan or a dependency audit (e.g. `vulnerability_scan`, `dependency_audit`). Free text — no enum constraint. |
| `tool` | TEXT | — | NULL | Name of the tool that found this issue (e.g., `"snyk"`, `"npm audit"`) |
| `severity` | TEXT | CHECK(`critical`, `high`, `medium`, `low`, `info`) | NULL | Severity level of the finding |
| `description` | TEXT | — | NULL | Human-readable description of the vulnerability or issue |
| `location` | TEXT | — | NULL | File path or code location where the issue was found (for `vulnerability_scan`) |
| `recommendation` | TEXT | — | NULL | Suggested remediation |
| `package` | TEXT | — | NULL | Affected package name (for `dependency_audit`) |
| `advisory` | TEXT | — | NULL | CVE or advisory identifier (e.g., `"CVE-2024-12345"`) |

### Relationships

- **Parent:** `test_report` (via `report_id`)

### MCP Tool Access

Inserted as items in the `security_findings` array of a `changelog_insert` `test_report` payload. Query via the parent `test_report`.

---

## test_performance_benchmark

### Purpose

Stores a measured performance metric alongside its target threshold and a pass/fail verdict. One row per benchmark measurement.

### Context

The `qa_engineer` runs benchmarks defined by performance requirements (from the `requirement` table with `category = 'performance'`). Each metric (e.g., p95 response time, throughput) is recorded with its actual value, the threshold from the requirement, and whether it passed. Failed benchmarks typically become blockers.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key |
| `report_id` | INTEGER | NOT NULL, FK → `test_report(id)` | — | The report this benchmark belongs to |
| `name` | TEXT | NOT NULL | — | Benchmark name (e.g., `"API p95 response time"`) |
| `metric` | TEXT | NOT NULL | — | Metric identifier (e.g., `"p95_latency_ms"`, `"throughput_rps"`) |
| `value` | REAL | NOT NULL | — | Measured value |
| `unit` | TEXT | NOT NULL | — | Unit of measurement (e.g., `"ms"`, `"rps"`, `"MB"`) |
| `threshold` | REAL | — | NULL | Target threshold value from the performance requirement |
| `status` | TEXT | CHECK(`pass`, `fail`) | NULL | Whether the measured value met the threshold |

### Relationships

- **Parent:** `test_report` (via `report_id`)

### MCP Tool Access

Inserted as items in the `performance_benchmarks` array of a `changelog_insert` `test_report` payload. Query via the parent `test_report`.

---

## test_blocker

### Purpose

Records an issue that prevents the test report from achieving a `pass` status. Each blocker has a severity level and an optional recommendation for resolution.

### Context

The `qa_engineer` creates blocker rows for critical failures, unresolved security findings, or missing test coverage that disqualify the build from release. The `release_engineer` checks for open blockers before proceeding. The `qa_critic` validates that every `fail` status in `test_requirement_coverage` has a corresponding blocker.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key |
| `report_id` | INTEGER | NOT NULL, FK → `test_report(id)` | — | The report this blocker belongs to |
| `description` | TEXT | NOT NULL | — | Clear description of what is blocking release |
| `severity` | TEXT | NOT NULL, CHECK(`critical`, `major`, `minor`) | — | Impact level: `critical` blocks release entirely |
| `recommendation` | TEXT | — | NULL | Suggested fix or workaround |

### Relationships

- **Parent:** `test_report` (via `report_id`)
- **Children:** `test_blocker_requirement` (M:N bridge to `requirement`)

### MCP Tool Access

Inserted as items in the `blockers` array of a `changelog_insert` `test_report` payload. Query via the parent `test_report`.

---

## test_blocker_requirement

### Purpose

Many-to-many bridge linking blockers to the requirements they affect. Allows the `release_engineer` to identify exactly which requirements are at risk due to each blocker.

### Context

When a blocker is related to a specific requirement (e.g., a failed functional test for REQ-012), the `qa_engineer` records that link here. A blocker may affect multiple requirements; a requirement may be referenced by multiple blockers.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `blocker_id` | INTEGER | NOT NULL, FK → `test_blocker(id)`, part of PK | — | The blocker |
| `requirement_id` | TEXT | NOT NULL, FK → `requirement(id)`, part of PK | — | The affected requirement (e.g., `REQ-015`) |

**Primary Key:** `(blocker_id, requirement_id)` — composite, prevents duplicate mappings.

### Relationships

- **Parent A:** `test_blocker` (via `blocker_id`)
- **Parent B:** `requirement` (via `requirement_id`)

### MCP Tool Access

Inserted as items in the `requirements` array of each blocker within a `changelog_insert` `test_report` payload.

---

## test_recommendation

### Purpose

Captures QA improvement suggestions that are not blocking but should be addressed in future iterations. Categorized and prioritized for easy triage.

### Context

The `qa_engineer` and `qa_critic` identify weaknesses in the test suite (gaps in coverage, reliability issues, missing performance benchmarks, etc.) and record them here. The `release_engineer` reviews high-priority recommendations when deciding whether to release or request a follow-up iteration. Unlike blockers, recommendations do not prevent release.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key |
| `report_id` | INTEGER | NOT NULL, FK → `test_report(id)` | — | The report this recommendation belongs to |
| `category` | TEXT | NOT NULL, CHECK(`coverage`, `reliability`, `performance`, `security`, `maintainability`) | — | Area of improvement |
| `description` | TEXT | NOT NULL | — | Clear description of the recommended improvement |
| `priority` | TEXT | NOT NULL, CHECK(`high`, `medium`, `low`) | — | Priority level for addressing this recommendation |

### Relationships

- **Parent:** `test_report` (via `report_id`)

### MCP Tool Access

Inserted as items in the `recommendations` array of a `changelog_insert` `test_report` payload. Query via the parent `test_report`.

---

## Entity Hierarchy

```
iteration
└── test_report
    ├── test_requirement_coverage
    │   └── test_acceptance_criterion_result  (test_ids → JSON array inline)
    ├── test_suite
    │   └── test_case
    │       └── test_case_requirement  ──→ requirement
    ├── test_security_finding
    ├── test_performance_benchmark
    ├── test_blocker
    │   └── test_blocker_requirement  ──→ requirement
    └── test_recommendation
```

---

## MCP Tool Summary

| Operation | Tool | Key Parameters |
|-----------|------|----------------|
| Create a test report (with all nested data) | `changelog_insert` | `entity_type: "test_report"`, `iteration_id`, `revision_id`, `data` |
| Read test reports for an iteration | `changelog_query` | `entity_type: "test_report"`, `iteration_id` |
| Read a specific test report by ID | `changelog_query` | `entity_type: "test_report"`, `ids: [N]` |
| Filter by status | `changelog_query` | `entity_type: "test_report"`, `filters: { status: "fail" }` |
| Trace which requirements are covered | `traceability_query` | Cross-reference `test_requirement_coverage` → `requirement` |
| Check overall QA phase status | `iteration_summary` | `iteration_id` — shows qa phase completion and approval |

> **Note:** `test_report` is the only `changelog_insert`-addressable entity type in this domain. All child tables (`test_suite`, `test_case`, `test_blocker`, etc.) are written atomically as part of the parent insert and read back through the parent query response.
