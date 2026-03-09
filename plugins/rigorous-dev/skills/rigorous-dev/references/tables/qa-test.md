# QA / Test Domain — Table Reference

This domain captures the output of the **qa_engineer** agent during the `qa` phase of the release workflow. Test execution results are recorded in a single `test_report` table with raw test runner output captured in `stdout` and `stderr` columns.

**Producer:** `qa_engineer`
**Critic:** `qa_critic` (validates completeness, correctness, and coverage)

**Phase:** `qa` (7th of 8 phases in each iteration)

---

## Table Index

| Table | Purpose |
|-------|---------|
| [`test_report`](#test_report) | Root entity — overall pass/fail counts, coverage percentages, stdout/stderr output, and version provenance metadata |

---

## test_report

### Purpose

The single entity for a QA run. One `test_report` row represents the aggregate outcome of a full test execution for a given iteration. Raw test runner output is captured in `stdout` and `stderr` for detailed analysis by the critic.

### Context

The `qa_engineer` creates exactly one `test_report` per iteration (possibly revised across multiple revisions). The `status` field is the aggregate outcome signal: `pass` means all tests passed and no critical blockers exist; `fail` means failures occurred; `blocked` means testing could not complete.

### Columns

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | The producer-critic revision that created this report. |
| `total_tests` | INTEGER | NOT NULL | `0` | Total number of tests executed |
| `passed_count` | INTEGER | NOT NULL | `0` | Count of tests that passed |
| `failed` | INTEGER | NOT NULL | `0` | Count of tests that failed |
| `skipped` | INTEGER | NOT NULL | `0` | Count of tests that were skipped |
| `coverage_line` | REAL | — | NULL | Line coverage percentage (0.0–100.0) |
| `coverage_branch` | REAL | — | NULL | Branch coverage percentage (0.0–100.0) |
| `coverage_function` | REAL | — | NULL | Function coverage percentage (0.0–100.0) |
| `duration_seconds` | REAL | — | NULL | Total test suite execution time in seconds |
| `status` | TEXT | NOT NULL, CHECK(`pass`, `fail`, `blocked`) | — | Overall verdict for this test run |
| `stdout` | TEXT | — | NULL | Raw stdout from the test runner |
| `stderr` | TEXT | — | NULL | Raw stderr from the test runner |
| `version` | TEXT | — | NULL | Version label for this report (e.g., `1.0.0`, `r3`). |
| `document_date` | TEXT | — | NULL | ISO 8601 creation timestamp for this report version. |
| `requirements_version` | TEXT | — | NULL | Version of the requirements artifact used. |
| `architecture_version` | TEXT | — | NULL | Version of the architecture artifact used. |
| `commit_sha` | TEXT | — | NULL | Git/VCS commit SHA of the code under test. |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO 8601 timestamp when the report was created |

### Relationships

- **Parent:** `revision` (via `revision_id`). Iteration derived via revision → phase → iteration (or via `entity_context` VIEW).
- **No children.** All detailed test data (coverage, suites, findings, benchmarks, blockers, recommendations) is captured in the test runner's `stdout`/`stderr` output rather than in separate database tables.

### MCP Tool Access

**Write:** `changelog_insert` with `entity_type: "test_report"`. The `data` object includes aggregate metrics (`total_tests`, `passed_count`, `failed`, `skipped`, coverage percentages), `status`, `stdout`, `stderr`, and provenance metadata (`version`, `document_date`, `requirements_version`, `architecture_version`, `commit_sha`). The handler can also accept metadata in a nested `metadata` object.

**Read:** `changelog_query` with `entity_type: "test_report"`. Supports filtering by `iteration_id`, `ids`, or field `filters`.

### Design Decision

Previously, 10 child tables modeled test suites, cases, coverage, findings, benchmarks, blockers, and recommendations. This granular modeling added schema complexity without proportional value — the QA critic can review raw test output in `stdout`/`stderr` directly, and detailed test results are better captured in committed test files and CI artifacts than in a relational schema.
