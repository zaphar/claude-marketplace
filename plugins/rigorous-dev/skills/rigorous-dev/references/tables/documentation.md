# Documentation Domain — Table Design Reference

This document describes the nine tables that capture the output of the **Documentation Master** agent during the `documentation` phase of the rigorous-dev workflow. Together they record what documentation was produced, which features and requirements are covered, where assets live, and whether the documentation passed verification.

**Producer:** `documentation_master`  
**Critic:** `documentation_critic`  
**Workflow phase:** `documentation` (phase 6 of 9)  
**Role in the lifecycle:** Final dev-workflow phase before release. The documentation_master writes all user-facing documentation (README, API guides, feature docs, diagrams); the documentation_critic validates coverage, accuracy, and accessibility compliance.

---

## Table Hierarchy

```
documentation_manifest                  ← one row per revision
├── documentation_manifest_metadata     ← version metadata (1:1)
├── documentation_section               ← key/value doc-section records (1:N)
├── documentation_feature               ← per-feature documentation entries (1:N)
│   └── documentation_feature_requirement  ← feature ↔ requirement join (M:N)
├── documentation_requirement_coverage  ← per-requirement coverage record (1:N)
│   └── documentation_requirement_path  ← file paths where requirement is documented (1:N)
├── documentation_asset                 ← diagrams, screenshots, code samples (1:N)
└── documentation_verification          ← named verification checks (1:N)
```

---

## 1. `documentation_manifest`

### Purpose

The root aggregate for a documentation pass. One row is created per `changelog_insert` call with `entity_type = "documentation_manifest"`. It records the overall status (complete / partial / blocked), a count of documents created, total pages, and accessibility compliance.

### Context

Every other documentation table references this row. The manifest ties documentation artifacts back to a specific `iteration_id` and (optionally) a `revision_id`, so the full history of documentation revisions is preserved. The `documentation_critic` reads this row (and its children) to validate coverage and quality; it then calls `revision_update` with a verdict of `approved` or `rejected`.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | INTEGER | NOT NULL | autoincrement | PRIMARY KEY | Surrogate key |
| `iteration_id` | INTEGER | NOT NULL | — | REFERENCES `iteration(id)` | Which iteration this documentation belongs to |
| `revision_id` | INTEGER | NULL | — | REFERENCES `revision(id)` | Which producer-critic revision attempt produced this (nullable for initial drafts) |
| `status` | TEXT | NOT NULL | — | CHECK(`status` IN (`'complete'`, `'partial'`, `'blocked'`)) | Overall documentation completeness |
| `documents_created` | INTEGER | NULL | `0` | — | Count of documentation files/pages created |
| `total_pages` | INTEGER | NULL | — | — | Total page count across all documents (NULL if unknown) |
| `accessibility_compliant` | INTEGER | NULL | `0` | — | Boolean flag (0/1) — whether docs meet accessibility standards |
| `created_at` | TEXT | NOT NULL | — | — | ISO-8601 timestamp of insertion |

### Relationships

- **Parent:** `iteration` (via `iteration_id`), `revision` (via `revision_id`)
- **Children:** `documentation_manifest_metadata`, `documentation_section`, `documentation_feature`, `documentation_requirement_coverage`, `documentation_asset`, `documentation_verification`

### MCP Tool Access

**Write:**
```json
{
  "tool": "changelog_insert",
  "args": {
    "entity_type": "documentation_manifest",
    "iteration_id": 1,
    "revision_id": 2,
    "data": {
      "status": "complete",
      "documents_created": 5,
      "total_pages": 42,
      "accessibility_compliant": 1
    }
  }
}
```

**Read:**
```json
{
  "tool": "changelog_query",
  "args": {
    "entity_type": "documentation_manifest",
    "iteration_id": 1,
    "include_related": true
  }
}
```

---

## 2. `documentation_manifest_metadata`

### Purpose

Stores versioning metadata for a documentation manifest: the documentation version string, creation timestamp, and which versions of upstream artifacts (requirements, architecture, implementation) this documentation is based on. Also records the output format (markdown, HTML, PDF, etc.).

### Context

The documentation_master populates this immediately after creating the manifest row. It provides the traceability chain — an auditor can look at `requirements_version`, `architecture_version`, and `implementation_version` to confirm the documentation was built against the correct upstream revisions. `format` indicates how the docs were rendered.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | INTEGER | NOT NULL | autoincrement | PRIMARY KEY | Surrogate key |
| `manifest_id` | INTEGER | NOT NULL | — | REFERENCES `documentation_manifest(id)` | Parent manifest |
| `version` | TEXT | NOT NULL | — | — | Documentation version string (e.g., `"1.0.0"`) |
| `created` | TEXT | NOT NULL | — | — | ISO-8601 creation timestamp for this documentation version |
| `requirements_version` | TEXT | NOT NULL | — | — | Version of requirements spec this documentation covers |
| `architecture_version` | TEXT | NULL | — | — | Version of architecture spec referenced (NULL if not applicable) |
| `implementation_version` | TEXT | NULL | — | — | Version of implementation manifest referenced (NULL if not applicable) |
| `format` | TEXT | NULL | — | CHECK(`format` IN (`'markdown'`, `'html'`, `'pdf'`, `'docusaurus'`, `'mkdocs'`, `'other'`)) | Documentation output format |

### Relationships

- **Parent:** `documentation_manifest` (via `manifest_id`)
- No children

### MCP Tool Access

Inserted as part of the `documentation_manifest` `changelog_insert` payload (child data). Query via:
```json
{
  "tool": "changelog_query",
  "args": {
    "entity_type": "documentation_manifest",
    "iteration_id": 1,
    "include_related": true
  }
}
```

---

## 3. `documentation_section`

### Purpose

A flexible key/value store for named documentation sections within a manifest. Examples include entries like `category = "readme"`, `key = "installation"`, `value = "..."` or `category = "api"`, `key = "authentication"`, `value = "..."`. The `path` field records the file path where this section lives on disk.

### Context

The documentation_master uses this table to enumerate every discrete section of the documentation suite — README sections, API doc sections, guides, changelogs, etc. The documentation_critic scans these records to verify section coverage against the requirements and feature list.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | INTEGER | NOT NULL | autoincrement | PRIMARY KEY | Surrogate key |
| `manifest_id` | INTEGER | NOT NULL | — | REFERENCES `documentation_manifest(id)` | Parent manifest |
| `category` | TEXT | NOT NULL | — | — | Grouping label (e.g., `"readme"`, `"api"`, `"guide"`, `"changelog"`) |
| `key` | TEXT | NOT NULL | — | — | Section identifier within the category (e.g., `"installation"`, `"authentication"`) |
| `value` | TEXT | NOT NULL | — | — | Section content, description, or summary |
| `path` | TEXT | NULL | — | — | Relative file path where this section is written (NULL if in-memory or not yet written) |

### Relationships

- **Parent:** `documentation_manifest` (via `manifest_id`)
- No children

### MCP Tool Access

Inserted as child data within `changelog_insert` for `documentation_manifest`. Query with `include_related: true` on a `changelog_query` for `documentation_manifest`.

---

## 4. `documentation_feature`

### Purpose

Records a documentation entry for a single feature of the product. Captures where the feature's documentation lives (`path`) and whether it includes concrete examples and screenshots. Child rows in `documentation_feature_requirement` link each feature documentation to the requirements it satisfies.

### Context

The documentation_master creates one row per documented feature. This allows the documentation_critic to verify that every user-facing feature has documentation at a known path, with examples where required. The `includes_examples` and `includes_screenshots` flags are used in accessibility and quality checks.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | INTEGER | NOT NULL | autoincrement | PRIMARY KEY | Surrogate key |
| `manifest_id` | INTEGER | NOT NULL | — | REFERENCES `documentation_manifest(id)` | Parent manifest |
| `name` | TEXT | NOT NULL | — | — | Human-readable feature name (e.g., `"User Authentication"`) |
| `path` | TEXT | NOT NULL | — | — | Relative path to the feature's documentation file |
| `includes_examples` | INTEGER | NULL | `0` | — | Boolean flag (0/1) — feature doc includes code/usage examples |
| `includes_screenshots` | INTEGER | NULL | `0` | — | Boolean flag (0/1) — feature doc includes screenshots or UI captures |

### Relationships

- **Parent:** `documentation_manifest` (via `manifest_id`)
- **Children:** `documentation_feature_requirement` (via `feature_id`)

### MCP Tool Access

Inserted as child data within `changelog_insert` for `documentation_manifest`. To find features missing examples:
```sql
SELECT * FROM documentation_feature WHERE manifest_id = ? AND includes_examples = 0;
```

---

## 5. `documentation_feature_requirement`

### Purpose

A many-to-many join table linking documented features to the requirements they satisfy. Enables bidirectional traceability: given a feature, find its requirements; given a requirement, find which features document it.

### Context

The documentation_master populates this after recording each `documentation_feature`. The documentation_critic uses it to verify that all `must_have` requirements appear in at least one feature's documentation. The `requirement_id` is a TEXT foreign key matching the `REQ-XXX` identifiers from the `requirement` table.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| `feature_id` | INTEGER | NOT NULL | — | REFERENCES `documentation_feature(id)`, part of PRIMARY KEY | The feature being documented |
| `requirement_id` | TEXT | NOT NULL | — | REFERENCES `requirement(id)`, part of PRIMARY KEY | The requirement this feature's documentation addresses |

**Primary Key:** composite `(feature_id, requirement_id)` — prevents duplicate links.

### Relationships

- **Parent:** `documentation_feature` (via `feature_id`)
- **Parent:** `requirement` (via `requirement_id`)
- No children

### MCP Tool Access

Populated as part of the feature child array in `changelog_insert`. Query via raw SQL for traceability:
```sql
-- Which requirements does a feature document?
SELECT requirement_id FROM documentation_feature_requirement WHERE feature_id = ?;

-- Which features document a given requirement?
SELECT df.name, df.path
FROM documentation_feature df
JOIN documentation_feature_requirement dfr ON dfr.feature_id = df.id
WHERE dfr.requirement_id = 'REQ-001';
```

---

## 6. `documentation_requirement_coverage`

### Purpose

Records per-requirement documentation coverage status. One row per requirement that the documentation_master assessed. Records whether the requirement is documented (`documented` flag), whether it is user-facing, and any free-form notes. Child rows in `documentation_requirement_path` list the actual file paths where coverage appears.

### Context

This table is the primary coverage report used by the documentation_critic. A requirement with `documented = 0` is a gap. `user_facing = 1` flags requirements that must appear in end-user documentation (guides, README) rather than internal developer docs. The `notes` field captures reasons for non-coverage (e.g., `"internal implementation detail, no user doc needed"`).

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | INTEGER | NOT NULL | autoincrement | PRIMARY KEY | Surrogate key |
| `manifest_id` | INTEGER | NOT NULL | — | REFERENCES `documentation_manifest(id)` | Parent manifest |
| `requirement_id` | TEXT | NOT NULL | — | REFERENCES `requirement(id)` | The requirement being assessed |
| `documented` | INTEGER | NULL | `0` | — | Boolean flag (0/1) — requirement has documentation |
| `user_facing` | INTEGER | NULL | `0` | — | Boolean flag (0/1) — requirement requires end-user documentation |
| `notes` | TEXT | NULL | — | — | Free-form notes on coverage status or exceptions |

### Relationships

- **Parent:** `documentation_manifest` (via `manifest_id`)
- **Parent:** `requirement` (via `requirement_id`)
- **Children:** `documentation_requirement_path` (via `coverage_id`)

### MCP Tool Access

Query undocumented user-facing requirements:
```sql
SELECT rc.requirement_id, rc.notes
FROM documentation_requirement_coverage rc
WHERE rc.manifest_id = ?
  AND rc.user_facing = 1
  AND rc.documented = 0;
```

---

## 7. `documentation_requirement_path`

### Purpose

Stores one or more file paths for each `documentation_requirement_coverage` record — the actual locations in the documentation tree where a given requirement is addressed. A requirement may be documented in multiple places (e.g., README and API guide), yielding multiple rows.

### Context

The documentation_master inserts one row per file path per requirement. The documentation_critic can then verify that referenced paths actually exist on disk. This table completes the coverage picture: `documentation_requirement_coverage` says "yes this is documented", `documentation_requirement_path` says "here is exactly where".

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | INTEGER | NOT NULL | autoincrement | PRIMARY KEY | Surrogate key |
| `coverage_id` | INTEGER | NOT NULL | — | REFERENCES `documentation_requirement_coverage(id)` | Parent coverage record |
| `path` | TEXT | NOT NULL | — | — | Relative path to the file documenting this requirement |

### Relationships

- **Parent:** `documentation_requirement_coverage` (via `coverage_id`)
- No children

### MCP Tool Access

```sql
-- All paths for a given requirement's coverage record
SELECT path FROM documentation_requirement_path WHERE coverage_id = ?;

-- Full coverage with paths for a manifest
SELECT rc.requirement_id, rp.path
FROM documentation_requirement_coverage rc
JOIN documentation_requirement_path rp ON rp.coverage_id = rc.id
WHERE rc.manifest_id = ?;
```

---

## 8. `documentation_asset`

### Purpose

Catalogs generated documentation assets — diagrams, screenshots, videos, code samples, and other media — that are referenced within the documentation. Each row records the asset's file path, type, human-readable description, and accessibility alt text.

### Context

The documentation_master creates one row per asset it generates or references. The `alt_text` field is specifically required for accessibility compliance (`accessibility_compliant = 1` on the manifest). The documentation_critic checks that all assets of type `screenshot` or `diagram` have non-null `alt_text`. The `type` CHECK constraint enforces a closed vocabulary aligned with the output formats the workflow supports.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | INTEGER | NOT NULL | autoincrement | PRIMARY KEY | Surrogate key |
| `manifest_id` | INTEGER | NOT NULL | — | REFERENCES `documentation_manifest(id)` | Parent manifest |
| `path` | TEXT | NOT NULL | — | — | Relative path to the asset file |
| `type` | TEXT | NOT NULL | — | CHECK(`type` IN (`'screenshot'`, `'diagram'`, `'video'`, `'code-sample'`, `'other'`)) | Asset type |
| `description` | TEXT | NULL | — | — | Human-readable description of what the asset depicts |
| `alt_text` | TEXT | NULL | — | — | Accessibility alt text (required for images to achieve `accessibility_compliant = 1`) |

### Relationships

- **Parent:** `documentation_manifest` (via `manifest_id`)
- No children

### MCP Tool Access

Find assets missing alt text (accessibility gap):
```sql
SELECT path, type, description
FROM documentation_asset
WHERE manifest_id = ?
  AND type IN ('screenshot', 'diagram')
  AND (alt_text IS NULL OR alt_text = '');
```

---

## 9. `documentation_verification`

### Purpose

Records the results of named verification checks run against the documentation. Each row is a single check (e.g., `"all_requirements_documented"`, `"links_valid"`, `"examples_compile"`) with a boolean `passed` flag. The full set of rows for a manifest forms the documentation quality gate.

### Context

The documentation_critic populates this table (or the documentation_master self-validates and the critic confirms). A manifest is ready for release only when all critical checks have `passed = 1`. The check names are free-form strings, giving flexibility to add new checks without schema changes. The documentation_critic's rejection feedback will reference specific failed check names from this table.

### Columns

| Column | Type | Nullable | Default | Constraints | Description |
|---|---|---|---|---|---|
| `id` | INTEGER | NOT NULL | autoincrement | PRIMARY KEY | Surrogate key |
| `manifest_id` | INTEGER | NOT NULL | — | REFERENCES `documentation_manifest(id)` | Parent manifest |
| `check_name` | TEXT | NOT NULL | — | — | Name of the verification check (e.g., `"all_requirements_documented"`, `"links_valid"`, `"alt_text_present"`) |
| `passed` | INTEGER | NULL | `0` | — | Boolean flag (0/1) — whether the check passed |

### Relationships

- **Parent:** `documentation_manifest` (via `manifest_id`)
- No children

### MCP Tool Access

Find failed checks for a manifest:
```sql
SELECT check_name
FROM documentation_verification
WHERE manifest_id = ?
  AND passed = 0;
```

Count pass/fail summary:
```sql
SELECT
  SUM(passed) AS passed_count,
  SUM(1 - passed) AS failed_count,
  COUNT(*) AS total
FROM documentation_verification
WHERE manifest_id = ?;
```

---

## Cross-Table Query Patterns

### Full coverage report for an iteration

```sql
SELECT
  r.id AS requirement_id,
  r.priority,
  rc.documented,
  rc.user_facing,
  rc.notes,
  GROUP_CONCAT(rp.path, ', ') AS doc_paths
FROM requirement r
LEFT JOIN documentation_requirement_coverage rc
  ON rc.requirement_id = r.id
  AND rc.manifest_id = (
    SELECT id FROM documentation_manifest WHERE iteration_id = ? ORDER BY id DESC LIMIT 1
  )
LEFT JOIN documentation_requirement_path rp ON rp.coverage_id = rc.id
WHERE r.iteration_id = ?
GROUP BY r.id;
```

### Feature documentation completeness

```sql
SELECT
  df.name,
  df.path,
  df.includes_examples,
  df.includes_screenshots,
  COUNT(dfr.requirement_id) AS requirement_count
FROM documentation_feature df
LEFT JOIN documentation_feature_requirement dfr ON dfr.feature_id = df.id
WHERE df.manifest_id = ?
GROUP BY df.id;
```

### Verification gate — all checks

```sql
SELECT check_name, passed
FROM documentation_verification
WHERE manifest_id = ?
ORDER BY passed ASC, check_name ASC;
```

---

## Summary

| Table | Rows per manifest | Key constraint | Written by |
|---|---|---|---|
| `documentation_manifest` | 1 | `status` CHECK | documentation_master |
| `documentation_manifest_metadata` | 1 | `format` CHECK | documentation_master |
| `documentation_section` | 1 per doc section | — | documentation_master |
| `documentation_feature` | 1 per feature | — | documentation_master |
| `documentation_feature_requirement` | 1 per feature×requirement pair | composite PK (no duplicates) | documentation_master |
| `documentation_requirement_coverage` | 1 per requirement assessed | — | documentation_master |
| `documentation_requirement_path` | 1 per file path per requirement | — | documentation_master |
| `documentation_asset` | 1 per asset | `type` CHECK | documentation_master |
| `documentation_verification` | 1 per check | — | documentation_master / documentation_critic |
