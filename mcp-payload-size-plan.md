# Proposal: MCP Server Payload Size Controls (Final)

## Problem

`changelog_query` returns unbounded result sets. With 68 requirements, payloads
reach ~140k characters — exceeding what any MCP client can reliably handle inline.
The `include_related` flag doesn't meaningfully reduce payload size because large
JSON columns (`acceptance_criteria`, `goals`, `risks`, etc.) are stored inline on
parent rows and returned by `SELECT *` regardless of the flag.

## Design Constraints

- **No schema changes.** No migration framework exists. `db.js` uses
  `CREATE TABLE IF NOT EXISTS` — there is no version tracking, ALTER TABLE,
  or data migration capability. Existing `.claude/rigor.db` files must continue
  working unchanged.
- **Backward compatible by default.** Existing agents that omit `limit` must
  continue to receive results (or receive an actionable error), not silently
  truncated data.
- **No new MCP tools.** Adding tools requires frontmatter updates across agents
  in both naming conventions. The marginal value of a `changelog_count` tool
  doesn't justify the maintenance surface.
- **No arbitrary projection.** A `fields` parameter requires per-entity column
  whitelists that must be maintained in sync with the schema — the same
  maintenance burden we're trying to avoid.

## Solution: Four Application-Layer Phases

All changes are in `read-tools.js` and agent documentation. No schema changes,
no `server.js` changes, no new tools.

---

## Phase 1: Pagination (App-Level Slice)

### Goal

Add `limit` and `offset` parameters to `changelog_query`. Every response
includes a `total` field showing the full result count.

### Why App-Level, Not SQL-Level

All 26 `query*` functions follow the same pattern: build a WHERE clause,
call `db.prepare(sql).all(...params)`, return the array. `changelogQuery()`
at line 839 dispatches to these functions and receives the array.

We can paginate by slicing the array in `changelogQuery()` alone — one
function change instead of 26. The concern about "wasted" DB work is
irrelevant at these scales: SQLite queries on a local file with dozens to
low hundreds of rows are microseconds. The problem was never DB performance —
it was MCP transport and token cost.

### Implementation

**1a. Modify `changelogQuery()` (line 839, read-tools.js)**

Current:
```js
function changelogQuery(args) {
  const db = getDb(args.project_root);
  const { entity_type, iteration_id, ids, filters, include_related = false } = args;
  // ... validation ...
  const results = QUERY_DISPATCH[entity_type](db, { iteration_id, ids, filters, include_related });
  return { entity_type, results, count: results.length };
}
```

Proposed:
```js
function changelogQuery(args) {
  const db = getDb(args.project_root);
  const {
    entity_type, iteration_id, ids, filters,
    include_related = false,
    limit,
    offset = 0,
  } = args;

  // ... existing validation (unchanged) ...

  const allResults = QUERY_DISPATCH[entity_type](db, {
    iteration_id, ids, filters, include_related,
  });

  const total = allResults.length;

  // Clamp limit to [1, 100] if provided
  const effectiveLimit = limit != null
    ? Math.min(Math.max(1, limit), 100)
    : null;

  const results = effectiveLimit != null
    ? allResults.slice(offset, offset + effectiveLimit)
    : allResults;

  return {
    entity_type,
    total,
    limit: effectiveLimit,
    offset,
    results,
  };
}
```

**1b. Update inputSchema (line 1278, read-tools.js)**

Add to `changelog_query` properties (before the closing `}`):
```js
limit: {
  type: "integer",
  description:
    "Maximum number of results to return (1-100). " +
    "Omit for all results (subject to overflow protection).",
  minimum: 1,
  maximum: 100,
},
offset: {
  type: "integer",
  description:
    "Number of results to skip (default 0). Use with limit for pagination.",
  default: 0,
  minimum: 0,
},
```

Neither is added to `required`.

### Response Format Change

Before:
```json
{ "entity_type": "requirement", "results": [...], "count": 68 }
```

After:
```json
{
  "entity_type": "requirement",
  "total": 68,
  "limit": 20,
  "offset": 0,
  "results": [/* 20 items */]
}
```

- `count` → `total` (renamed for clarity: total rows matching, not rows returned)
- `limit` and `offset` are new fields (null when unpaginated)

### Files Touched

- `read-tools.js`: `changelogQuery()` function (~15 lines changed) + inputSchema
  (2 new properties)

### Effort: Low

---

## Phase 2: Fix `include_related` Semantics (JS Destructure)

### Goal

Make `include_related=false` actually exclude large inline data by stripping
JSON child-data columns from results before returning.

### Root Cause

The `include_related` flag controls two things:
1. Whether related-table JOINs run (personas, dependencies, alternatives, etc.)
2. Whether inline JSON is parsed from strings into objects

But it does NOT control whether inline JSON columns are present in the result.
`SELECT *` always returns `acceptance_criteria`, `goals`, `consequences`, etc.
as raw JSON strings. The flag's documented behavior — "attach child table data
(acceptance criteria, interfaces, alternatives, etc.)" — implies these should
be excluded when false. They aren't.

### Classification of JSON Columns

**Inline JSON that represents child/related data** (should be controlled by
`include_related`):

| Table | Column | Shape |
|-------|--------|-------|
| requirement | acceptance_criteria | `[{criterion, testable}]` |
| persona | goals | `["Goal 1", ...]` |
| adr | consequences | `["Consequence 1", ...]` |
| adr | research_sources | `["Source 1", ...]` |
| user_flow | data_dependencies | `["Dep 1", ...]` |
| user_flow | error_states | `[{condition, recovery}]` |
| screen | components | `["COMP-001", ...]` |
| work_item | entry_criteria | `["Criterion 1", ...]` |
| work_item | exit_criteria | `["Criterion 1", ...]` |
| work_item | checkpoint_focus | `["Focus 1", ...]` |
| work_item | risks | `[{risk, mitigation}]` |
| plan_overview | assumptions | `["Assumption 1", ...]` |
| plan_overview | risks | `[{risk, mitigation, ...}]` |

**Why not normalize these into child tables?** No migration framework exists.
`db.js` uses `CREATE TABLE IF NOT EXISTS` with no version tracking. Existing
databases would have JSON data on the parent row and empty child tables. This
is a valid future improvement if a migration framework is built.

### Implementation

For each query function that has inline JSON child data, strip those columns
when `include_related=false`. The change is a one-line destructure per function.

**queryRequirement (line 113):**

Current:
```js
const results = db.prepare(sql).all(...params);
if (!include_related) return results;
```

Proposed:
```js
const results = db.prepare(sql).all(...params);
if (!include_related) {
  return results.map(({ acceptance_criteria, ...rest }) => rest);
}
```

**queryPersona (line 88):**
```js
if (!include_related) {
  return results.map(({ goals, ...rest }) => rest);
}
```

**queryAdr (line 147):**
```js
if (!include_related) {
  return results.map(({ consequences, research_sources, ...rest }) => rest);
}
```

**queryUserFlow (line 239):**
```js
if (!include_related) {
  return results.map(({ data_dependencies, error_states, ...rest }) => rest);
}
```

**queryScreen (line 279):**
```js
if (!include_related) {
  return results.map(({ components, ...rest }) => rest);
}
```

**queryWorkItem (line 309):**
```js
if (!include_related) {
  return results.map(({
    entry_criteria, exit_criteria, checkpoint_focus, risks,
    ...rest
  }) => rest);
}
```

**queryPlanOverview (line 346):**
```js
if (!include_related) {
  return results.map(({ assumptions, risks, ...rest }) => rest);
}
```

### What This Achieves

Estimated payload reduction for `include_related=false` on worst-case entities:

| Entity | Before (per row) | After (per row) | Reduction |
|--------|-----------------|-----------------|-----------|
| requirement | ~2,000 chars | ~500 chars | ~75% |
| work_item | ~3,000 chars | ~800 chars | ~73% |
| adr | ~2,500 chars | ~600 chars | ~76% |
| plan_overview | ~4,000 chars | ~1,000 chars | ~75% |

With 68 requirements:
- Before: ~136,000 chars (over any reasonable limit)
- After (include_related=false): ~34,000 chars (manageable)
- After (include_related=false + limit=20): ~10,000 chars (lightweight)

### Functions NOT Changed (no inline JSON child data)

15 entity types have no `include_related` logic and no large inline JSON:
adr_decision, test_report, plan_external_dependency, requirement_trace,
project_context, data_exchange, nonfunctional_requirement, ux_asset,
approved_dependency, blocker, project_lesson, security_audit_finding,
performance_audit_finding, intermediate_asset, vcs_commit.

These are left as-is. Their per-row payloads are naturally small.

### Entity Types With include_related That Have No Inline JSON

Two entity types have `include_related` enrichment (JOIN queries) but no
inline JSON to strip: `persona_addressed` and `info_architecture`. These
are left as-is — the flag already works correctly for them.

### Files Touched

- `read-tools.js`: 7 query functions, ~1-4 lines each

### Effort: Low

---

## Phase 3: Agent Guidance Updates

### Goal

Add pagination guidance to the 4 agents missing it entirely. Add a pagination
reference to SKILL.md.

### Current State

- 16/20 agents have "Avoid loading all entities at once" guidance
- 5 agents document a two-pass pattern (list IDs → fetch by ID)
- 4 agents have NO guidance on query size management:
  - `requirements_critic.agent.md`
  - `qa_critic.agent.md`
  - `implementation_plan_critic.agent.md`
  - `documentation_critic.agent.md`
- 0 agents mention `limit`/`offset` (because the feature doesn't exist yet)

### Changes

**3a. Add pagination guidance to 4 agents**

Add to each agent's context management / MCP tool note section:

```markdown
**Pagination:** `changelog_query` supports `limit` and `offset` parameters.
Every response includes a `total` field showing the full result count.
- **Index pass:** Query with `include_related: false` to get IDs and
  metadata only.
- **Detail pass:** Fetch specific items by `ids: [...]` with
  `include_related: true`.
- **Full review:** Paginate with `limit: 20`, process each page, then
  fetch next with `offset: 20`, etc.
- **Never omit `limit`** for open-ended queries (no `ids` filter).
```

**3b. Add pagination section to SKILL.md**

Add a "Query Patterns" section to the "Data Flow" area of SKILL.md:

```markdown
### Query Patterns

`changelog_query` supports pagination via `limit` (1-100) and `offset`
(default 0). Every response includes `total` (full row count regardless
of pagination).

**Index scan** (lightweight, for planning):
```
changelog_query(entity_type: "requirement", include_related: false, limit: 50)
→ { total: 68, limit: 50, offset: 0, results: [id, priority, category...] }
```

**Detail fetch** (full data for specific items):
```
changelog_query(entity_type: "requirement", ids: ["REQ-001", "REQ-005"],
                include_related: true)
```

**Paginated full review** (for critics):
```
changelog_query(entity_type: "requirement", include_related: true, limit: 20, offset: 0)
→ process page 1
changelog_query(..., offset: 20) → process page 2
changelog_query(..., offset: 40) → process page 3
changelog_query(..., offset: 60) → process page 4 (8 remaining)
```
```

### Files Touched

- `agents/requirements_critic.agent.md`
- `agents/qa_critic.agent.md`
- `agents/implementation_plan_critic.agent.md`
- `agents/documentation_critic.agent.md`
- `skills/workflow/SKILL.md`

### Effort: Low

---

## Phase 4: Overflow Error Threshold

### Goal

If an unpaginated response exceeds a character threshold, return a structured
error instead of the oversized payload. This is a safety net — the primary
mechanism is pagination (Phase 1), but the overflow error catches cases where
agents forget to paginate.

### Implementation

Add overflow check in `changelogQuery()`, after pagination but before return:

```js
function changelogQuery(args) {
  // ... existing code from Phase 1 ...

  const allResults = QUERY_DISPATCH[entity_type](db, { ... });
  const total = allResults.length;

  // ... pagination slice ...

  // Overflow guard: if no limit was specified, check response size
  if (effectiveLimit == null && results.length > 0) {
    const serialized = JSON.stringify(results);
    const THRESHOLD = 50_000;

    if (serialized.length > THRESHOLD) {
      const avgRowSize = Math.ceil(serialized.length / results.length);
      return {
        error: "PAYLOAD_TOO_LARGE",
        entity_type,
        total_count: total,
        estimated_chars: serialized.length,
        suggested_limit: Math.max(1, Math.floor(THRESHOLD / avgRowSize)),
        message:
          `Query would return ~${serialized.length.toLocaleString()} chars ` +
          `(${total} rows). Use limit/offset to paginate, or ids to fetch ` +
          `specific items. Suggested limit: ${Math.max(1, Math.floor(THRESHOLD / avgRowSize))}.`,
      };
    }
  }

  return { entity_type, total, limit: effectiveLimit, offset, results };
}
```

### Design Choices

- **Threshold: 50,000 chars.** Generous for moderate queries (20 full
  requirements ≈ 40k chars), strict enough to catch the 140k problem.
- **Only triggers when `limit` is omitted.** If the caller explicitly
  paginated, they've opted in to the contract — even if one page happens
  to be large.
- **Returns a structured object, not an MCP error.** The response uses
  `isError: false` (via `okResponse`). The `error` field in the payload
  signals the problem to the agent without causing MCP-level failures that
  some clients may not surface clearly. The agent sees an actionable message
  in its tool response and can retry with pagination.
- **`suggested_limit`** is computed from threshold ÷ average row size, giving
  agents a concrete number to use.

### Files Touched

- `read-tools.js`: `changelogQuery()` function only (~15 lines added)

### Effort: Low

---

## Combined `changelogQuery()` (All Phases)

For reference, here is the complete function after all four phases:

```js
function changelogQuery(args) {
  const db = getDb(args.project_root);
  const {
    entity_type,
    iteration_id,
    ids,
    filters,
    include_related = false,
    limit,
    offset = 0,
  } = args;

  if (!QUERY_DISPATCH[entity_type]) {
    throw new Error(
      `Unknown entity_type: "${entity_type}". Valid types: ` +
      Object.keys(QUERY_DISPATCH).join(", ")
    );
  }

  try {
    const allResults = QUERY_DISPATCH[entity_type](db, {
      iteration_id, ids, filters, include_related,
    });

    const total = allResults.length;

    // Phase 1: Pagination
    const effectiveLimit = limit != null
      ? Math.min(Math.max(1, limit), 100)
      : null;

    const results = effectiveLimit != null
      ? allResults.slice(offset, offset + effectiveLimit)
      : allResults;

    // Phase 4: Overflow guard (only when unpaginated)
    if (effectiveLimit == null && results.length > 0) {
      const serialized = JSON.stringify(results);
      const THRESHOLD = 50_000;

      if (serialized.length > THRESHOLD) {
        const avgRowSize = Math.ceil(serialized.length / results.length);
        return {
          error: "PAYLOAD_TOO_LARGE",
          entity_type,
          total_count: total,
          estimated_chars: serialized.length,
          suggested_limit: Math.max(1, Math.floor(THRESHOLD / avgRowSize)),
          message:
            `Query would return ~${serialized.length.toLocaleString()} chars ` +
            `(${total} rows). Use limit/offset to paginate, or ids to fetch ` +
            `specific items. Suggested limit: ` +
            `${Math.max(1, Math.floor(THRESHOLD / avgRowSize))}.`,
        };
      }
    }

    return { entity_type, total, limit: effectiveLimit, offset, results };
  } catch (err) {
    throw new Error(`Failed to query ${entity_type}: ${err.message}`);
  }
}
```

---

## Alternatives Considered and Rejected

### Default limit (analysis document recommends limit=20, max=50)
Rejected. A hard default silently changes behavior — a critic reviewing all
requirements would get only 20 and produce an incomplete review without knowing
it missed 48. The overflow error (Phase 4) is a better enforcement mechanism:
it fails explicitly with instructions.

### SQL-level pagination (LIMIT/OFFSET in each query function)
Rejected. Would require modifying all 26 query functions with COUNT queries
and parameter threading. At SQLite scales (< 1000 rows), app-level slicing in
`changelogQuery()` achieves the same result with one function change.

### Projection / `fields` parameter
Rejected. Requires per-entity column whitelists maintained in sync with
schema.sql. Adds API surface complexity agents must learn. Phase 2's
`include_related` fix already provides a two-tier column control (index vs
full) that covers ~95% of use cases.

### `changelog_count` pre-flight tool
Rejected. After Phase 1, `changelog_query(limit: 1)` returns `total` in the
response envelope — sufficient for planning pagination strategy. A dedicated
tool adds frontmatter maintenance across ~10 agents for marginal value.

### Schema normalization (move JSON columns to child tables)
Rejected for now. No migration framework exists. `db.js` uses
`CREATE TABLE IF NOT EXISTS` with no version tracking. Existing databases
would have data in the JSON column and empty child tables. Valid future
improvement if a migration framework is built.

---

## Summary

| Phase | Fix | Files | Lines Changed |
|-------|-----|-------|---------------|
| 1 | Pagination (app-level slice) | read-tools.js | ~20 |
| 2 | Fix `include_related` (JS destructure) | read-tools.js | ~30 |
| 3 | Agent guidance (4 agents + SKILL.md) | 5 .md files | ~50 |
| 4 | Overflow error threshold | read-tools.js | ~15 |

Total: ~115 lines across 6 files. All application-layer. No schema changes.
No new tools. No breaking changes (one field rename: `count` → `total`).

All four phases are complementary and non-breaking. They can ship as a single
PR or be split into Phase 1+2+4 (server code) and Phase 3 (documentation).