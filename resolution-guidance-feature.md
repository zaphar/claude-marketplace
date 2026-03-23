# Feature: Add `resolution_guidance` to Code Review Findings

## Problem Statement

The code review workflow has a gap in the triage phase. When a human reviewer triages findings (accept, dismiss, downgrade, etc.), there is no field on the `code_review_finding` entity to capture **what they want done about it**. The `description` field captures what the critic found wrong. The `status` field captures the disposition (open, resolved, accepted, false-positive, deferred). But there is nowhere to record implementation guidance like "use `cenkalti/backoff/v4` for the fix" or "defer this until we wire AWS clients in iteration 6."

This means triage decisions either get lost (said in conversation, never persisted) or must be indirectly encoded elsewhere (e.g., as work item notes in a future iteration). Neither approach is reliable.

## Proposed Solution

Add a `resolution_guidance` TEXT column to the `code_review_finding` table, and wire it through the MCP server's read and write tooling so agents and humans can annotate findings during triage.

## Implementation Scope

Three files must be modified. All are in the rigor MCP server plugin directory:

```
.container-copilot/installed-plugins/_direct/rigor/mcp-server/
├── migrations/009_code_review.sql   # Schema definition
├── write-tools.js                   # Insert + update logic
└── read-tools.js                    # Query logic
```

One new migration file must be created:

```
.container-copilot/installed-plugins/_direct/rigor/mcp-server/
└── migrations/010_finding_guidance.sql   # ALTER TABLE migration
```

---

## Step-by-Step Implementation

### Step 1: Create the migration file

**Create file:** `migrations/010_finding_guidance.sql`

```sql
ALTER TABLE code_review_finding ADD COLUMN resolution_guidance TEXT;
```

This adds a nullable TEXT column. Existing rows get NULL, which is correct — unfiled findings have no guidance yet.

### Step 2: Update the schema definition

**File:** `migrations/009_code_review.sql` (lines 34-45)

The `CREATE TABLE IF NOT EXISTS code_review_finding` statement serves as the canonical schema reference. Add `resolution_guidance` after `status`:

**Current:**
```sql
CREATE TABLE IF NOT EXISTS code_review_finding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES code_review_run(id) ON DELETE CASCADE,
  tier TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  impact_level TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**New:**
```sql
CREATE TABLE IF NOT EXISTS code_review_finding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES code_review_run(id) ON DELETE CASCADE,
  tier TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  impact_level TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution_guidance TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Step 3: Update `write-tools.js` — changelog_update configuration

**File:** `write-tools.js` (lines 1222-1225)

The `ALLOWED_TYPES` configuration for `code_review_finding` currently supports status-only updates:

**Current:**
```javascript
code_review_finding: {
  table: "code_review_finding",
  statuses: ["open", "resolved", "accepted", "false-positive", "deferred"],
},
```

**New:**
```javascript
code_review_finding: {
  table: "code_review_finding",
  statuses: ["open", "resolved", "accepted", "false-positive", "deferred"],
  mutableFields: ["resolution_guidance"],
},
```

Adding `mutableFields` switches this entity from the "status-only update path" to the "multi-field update path" in the `changelogUpdate` function (lines 1251-1298). This path validates that each provided field is either `"status"` or listed in `mutableFields`, then builds SET clauses dynamically. No other changes to the update function are needed — the existing multi-field path handles this generically.

### Step 4: Update `write-tools.js` — changelog_insert function

**File:** `write-tools.js` — find the `insertCodeReviewFinding` function (around line 1095)

The INSERT statement must include the new column so guidance can optionally be provided at creation time (unlikely but should be supported for completeness).

**Current:**
```javascript
const result = db.prepare(
  `INSERT INTO code_review_finding
     (run_id, tier, category, severity, title, description, impact_level, status)
   VALUES (@run_id, @tier, @category, @severity, @title, @description, @impact_level, @status)`
).run({
  run_id: data.run_id,
  tier: data.tier,
  category: data.category,
  severity: data.severity,
  title: data.title,
  description: data.description,
  impact_level: data.impact_level,
  status: data.status ?? "open"
});
```

**New:**
```javascript
const result = db.prepare(
  `INSERT INTO code_review_finding
     (run_id, tier, category, severity, title, description, impact_level, status, resolution_guidance)
   VALUES (@run_id, @tier, @category, @severity, @title, @description, @impact_level, @status, @resolution_guidance)`
).run({
  run_id: data.run_id,
  tier: data.tier,
  category: data.category,
  severity: data.severity,
  title: data.title,
  description: data.description,
  impact_level: data.impact_level,
  status: data.status ?? "open",
  resolution_guidance: data.resolution_guidance ?? null
});
```

### Step 5: Update `write-tools.js` — tool description in inputSchema

**File:** `write-tools.js` (lines 1869-1910)

The `changelog_update` tool's `description` string and `inputSchema.properties.updates` object must document the new field. Find the tool registration object for `changelog_update`.

Add to the `updates.properties` block:

```javascript
resolution_guidance: {
  description: "code_review_finding: human triage guidance on how to resolve this finding",
  type: "string"
},
```

Also update the tool's `description` string to mention `code_review_finding` supports `resolution_guidance` updates. The description is a long string listing all entity types and their mutable fields — find the `code_review_finding` mention and append `(resolution_guidance)` or similar.

### Step 6: Update `read-tools.js` — query filters

**File:** `read-tools.js` (lines 855-864)

Add `resolution_guidance` to the filter allowlist so queries can filter by it:

**Current:**
```javascript
const CODE_REVIEW_FINDING_FILTERS = {
  run_id: { nullable: false },
  tier: { nullable: false },
  category: { nullable: false },
  severity: { nullable: false },
  title: { nullable: false },
  description: { nullable: false },
  impact_level: { nullable: false },
  status: { nullable: false },
};
```

**New:**
```javascript
const CODE_REVIEW_FINDING_FILTERS = {
  run_id: { nullable: false },
  tier: { nullable: false },
  category: { nullable: false },
  severity: { nullable: false },
  title: { nullable: false },
  description: { nullable: false },
  impact_level: { nullable: false },
  status: { nullable: false },
  resolution_guidance: { nullable: true },
};
```

Note `nullable: true` — findings without guidance should be queryable via null filter.

### Step 7: Update `read-tools.js` — query function SELECT

**File:** `read-tools.js` — find `queryCodeReviewFinding` function (lines 866-887)

The query already uses `SELECT f.*` so the new column will be included in results automatically. **No change needed here** — but verify this is the case. If the function uses an explicit column list instead of `*`, add `resolution_guidance` to it.

---

## Verification

After implementation, verify with these MCP tool calls:

1. **Update a finding with guidance:**
```json
{
  "tool": "changelog_update",
  "args": {
    "project_root": "/work",
    "entity_type": "code_review_finding",
    "entity_id": 191,
    "updates": {
      "status": "accepted",
      "resolution_guidance": "Use cenkalti/backoff/v4 for exponential backoff. Add ctx.Done() select in the polling loop."
    }
  }
}
```

2. **Query it back:**
```json
{
  "tool": "changelog_query",
  "args": {
    "project_root": "/work",
    "entity_type": "code_review_finding",
    "ids": ["191"],
    "include_related": true
  }
}
```

The response should include `"resolution_guidance": "Use cenkalti/backoff/v4..."`.

3. **Verify null guidance is fine:**
```json
{
  "tool": "changelog_query",
  "args": {
    "project_root": "/work",
    "entity_type": "code_review_finding",
    "ids": ["1"],
    "include_related": true
  }
}
```

Should return `"resolution_guidance": null`.

---

## What NOT to Change

- **Do not modify the `code_review_finding_file` junction table** — it is unrelated.
- **Do not change any other entity type's configuration** — this is scoped to `code_review_finding` only.
- **Do not add resolution_guidance to the INSERT validation as required** — it must remain optional (nullable).
- **Do not add a default value** — NULL is the correct default for "no guidance provided yet."

## Migration Safety

The `ALTER TABLE ... ADD COLUMN` migration is safe for SQLite:
- Existing rows get NULL for the new column
- No data is modified
- No indexes need updating
- The column is nullable so no NOT NULL constraint violations
- SQLite supports ADD COLUMN natively (no table rebuild needed)
