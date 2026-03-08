# MCP Server Code Audit

Rigorous audit of the Node.js MCP server code in `plugins/rigorous-dev/mcp-server/`.

Scope: correctness, ergonomics, design patterns, anti-patterns, deprecated API usage.

Files audited: `db.js` (50 lines), `server.js` (93 lines), `write-tools.js` (2215 lines), `read-tools.js` (1237 lines), `package.json`.

---

## Findings Index

| # | File | Severity | Category | Finding |
|---|------|----------|----------|---------|
| 1 | `read-tools.js:61-63` | **Bug** | Dead logic | `hasIterationCol` is always `true` — computed value is a tautology |
| 2 | `read-tools.js:164` | **Bug** | Query logic | `changelogQuery` positional path drops `IS NULL` filter handling |
| 3 | `read-tools.js:677-681` | **Bug** | Redundant filter | `traceabilityQuery` for "component" applies `iteration_id` twice |
| 4 | `read-tools.js:819-823` | **Bug** | Redundant filter | `traceabilityQuery` for "adr" applies `iteration_id` twice |
| 5 | `write-tools.js:1993` | **Inconsistency** | Timestamps | `iterationClose` uses SQLite `datetime('now')` while all others use `new Date().toISOString()` |
| 6 | `read-tools.js:77-83` | **Security** | SQL injection | `buildWhere` interpolates unvalidated field names from `filters` into SQL |
| 7 | `write-tools.js:140,920` | **Anti-pattern** | SQL injection surface | Table/column names interpolated via template literals (safe today, fragile) |
| 8 | `read-tools.js:708` | **Anti-pattern** | Wildcard injection | `LIKE '%${target}%'` doesn't escape `%` or `_` in target string |
| 9 | `server.js:10-13` | **Anti-pattern** | Testability | Top-level `new Server()` + `main()` call prevent importing without side effects |
| 10 | `db.js:22` | **Minor** | Unnecessary work | `mkdirSync` called even for `:memory:` path |
| 11 | `db.js` | **Gap** | Resilience | No `busy_timeout` PRAGMA — concurrent access fails immediately |
| 12 | `db.js:29-36` | **Gap** | Migration | Schema check only tests for `project` table — partial schema undetectable |
| 13 | `write-tools.js:1128` | **Inconsistency** | Naming | `insertVcsCommit` accepts `revision_id` without underscore prefix but ignores it |
| 14 | `write-tools.js:1828-1866` | **Anti-pattern** | Performance | `changelogInsert` rebuilds `handlers` dispatch object on every call |
| 15 | `write-tools.js:553-575` | **Design smell** | Return value | Batch insert functions only return last inserted ID |
| 16 | `write-tools.js:919,1255,1418,1530` | **Design smell** | Silent coercion | `metadata` array silently takes first element |
| 17 | `write-tools.js:708` | **Design smell** | Silent coercion | Screen `components` mapping may produce `undefined` values |
| 18 | `read-tools.js:635-637` | **Gap** | Data fidelity | `attachRelated` default case returns raw JSON strings unparsed |
| 19 | `read-tools.js` | **Gap** | Scalability | No pagination on any query endpoint |
| 20 | `server.js:40-41` | **Gap** | Debuggability | `errResponse` discards stack traces |
| 21 | `server.js` | **Gap** | Lifecycle | No graceful shutdown (SIGTERM/SIGINT) handler |
| 22 | `package.json` | **Gap** | Reproducibility | No `engines` field, no lockfile |
| 23 | `write-tools.js:218-222` | **Minor** | Timestamp skew | Multiple `new Date().toISOString()` calls within single transaction |
| 24 | `read-tools.js:130-175` | **Anti-pattern** | Duplication | `changelogQuery` has two separate query-building code paths that must stay in sync |
| 25 | `write-tools.js:484` | **Design smell** | Fragile lookup | `insertDataEntity` resolves relationships by name, not ID |
| 26 | — | **Gap** | Validation | No input validation framework — each handler validates ad-hoc |
| 27 | — | **Gap** | Observability | No logging beyond startup message |
| 28 | — | **Info** | Deprecated APIs | No deprecated Node.js or better-sqlite3 APIs detected |

---

## Detailed Findings

### #1 — `hasIterationCol` is always `true` (BUG)

**File:** `read-tools.js:61-63`

```js
const hasIterationCol = !TEXT_PK_TYPES.has(table)
  ? true
  : ["persona", "requirement", "adr", "component", "user_flow", "screen"].includes(table);
```

The ternary's false-branch array is the exact same set as `TEXT_PK_TYPES`. If the table is NOT in `TEXT_PK_TYPES`, result is `true`. If it IS in `TEXT_PK_TYPES`, it checks whether it's in the same set — which is also `true`. So `hasIterationCol` is always `true`, making the variable and its computation dead code.

The variable is never referenced after computation anyway — it's assigned but unused. This looks like a leftover from an earlier design where some tables might not have had `iteration_id`.

**Impact:** None (dead code), but it misleads readers into thinking the codepath matters.

**Fix:** Remove the variable entirely.

---

### #2 — Positional path drops `IS NULL` handling (BUG)

**File:** `read-tools.js:153-172`

When `ids` are present, `changelogQuery` abandons named params and rebuilds the query with positional params. The named-param path handles `null` filter values:

```js
// Named path (line 78-79) — correct
if (value === null) {
  clauses.push(`${field} IS NULL`);
}
```

But the positional path does not:

```js
// Positional path (line 164-167) — bug
for (const [field, value] of Object.entries(filters)) {
  posWhere.push(`${field} = ?`);     // Always uses = ?, even for null
  positionalParams.push(value);
}
```

Passing `null` to `= ?` in SQLite evaluates to `NULL = NULL` → `NULL` (falsy), so it matches nothing. This means `changelog_query` with both `ids` AND a `null` filter will silently return no results when the named-param path would have found rows.

**Impact:** Data loss in query results when combining `ids` with `null` filters.

**Fix:** Add the `IS NULL` branch to the positional path.

---

### #3 & #4 — Double `iteration_id` filter in traceabilityQuery (BUG)

**File:** `read-tools.js:675-681` (component → ADRs) and `read-tools.js:819-823` (ADR → components)

```js
// Component target_type, querying ADRs:
const adrs = db.prepare(
  "SELECT * FROM adr WHERE iteration_id = ?" +
    (iteration_id ? " AND iteration_id = ?" : "")
).all(comp.iteration_id, ...iterParam);
```

When `iteration_id` is provided, this produces `WHERE iteration_id = ? AND iteration_id = ?` with two separate values: `comp.iteration_id` and `iteration_id`. If they're the same value, it's redundant but harmless. If they differ (e.g. the component was loaded from a different iteration than the filter), it would return nothing.

The same pattern appears in the "adr" branch for querying components.

**Impact:** Harmless in current usage (the values are always the same), but logically incorrect and confusing. If the schema ever allows cross-iteration queries, this would silently break.

**Fix:** Use only `comp.iteration_id` (or only the user-provided `iteration_id`), not both.

---

### #5 — Mixed timestamp sources (INCONSISTENCY)

**File:** `write-tools.js:1993`

```js
// iterationClose
const sets = ["status = 'closed'", "closed_at = datetime('now')"];
```

Every other function in the codebase uses JavaScript's `new Date().toISOString()` to generate timestamps. `iterationClose` uses SQLite's `datetime('now')` instead. These produce slightly different formats:

| Source | Format |
|--------|--------|
| `new Date().toISOString()` | `2024-01-15T10:30:45.123Z` |
| `datetime('now')` | `2024-01-15 10:30:45` |

The JavaScript version includes milliseconds and the `T`/`Z` delimiters. The SQLite version uses spaces and no milliseconds. Any downstream code comparing timestamps (e.g., sorting, filtering date ranges) may produce unexpected results if mixing these formats.

**Impact:** Inconsistent timestamp format for `iteration.closed_at` vs all other timestamps in the database.

**Fix:** Use `new Date().toISOString()` consistently, or normalize both through a shared helper.

---

### #6 — SQL injection via `filters` field names (SECURITY)

**File:** `read-tools.js:77-83`

```js
for (const [field, value] of Object.entries(filters)) {
  if (value === null) {
    clauses.push(`${field} IS NULL`);
  } else {
    const key = `f_${field}`;
    clauses.push(`${field} = @${key}`);
    params[key] = value;
  }
}
```

The `field` variable comes from user-supplied `filters` keys and is interpolated directly into the SQL string. While the `value` is properly parameterized, the column **name** is not. A malicious or buggy caller could pass:

```json
{ "filters": { "1=1; DROP TABLE persona; --": "x" } }
```

This would produce `1=1; DROP TABLE persona; -- = @f_...` in the WHERE clause.

**Mitigating factors:** The MCP protocol is LLM-to-server (not user-facing), and `better-sqlite3`'s `prepare()` only compiles single statements (semicolons cause a compile error), so the `DROP TABLE` example would actually fail. However, boolean-based injection (`1=1 OR `) could still leak data or bypass filters.

**Impact:** Low in current deployment (LLM-mediated access only), but this is a real injection vector if the server is ever exposed to untrusted input.

**Fix:** Validate `field` against a whitelist of known column names for the entity type.

---

### #7 — Table name interpolation pattern (ANTI-PATTERN)

**File:** `write-tools.js:216`, `write-tools.js:920`, `read-tools.js:134`, `read-tools.js:1023`

Multiple functions interpolate table names into SQL via template literals:

```js
db.prepare(`SELECT * FROM ${table} WHERE id = ?`)          // snapshotIfExists
db.prepare(`UPDATE ${config.table} SET ...`)                 // changelogUpdate
db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ...`)   // countFor
```

All current usages are safe because the table names come from hardcoded maps (`ENTITY_TABLE`, `ALLOWED_TYPES`). However, this establishes a pattern where new code might follow the same approach with less-controlled sources.

**Impact:** No current vulnerability, but creates a risky pattern.

**Fix:** Add an assertion or comment at each interpolation site confirming the source is trusted, or create a small helper that validates against a table whitelist.

---

### #8 — LIKE query wildcard injection (ANTI-PATTERN)

**File:** `read-tools.js:706-709`

```js
const adrs = db.prepare(
  "SELECT * FROM adr WHERE (decision LIKE ? OR rationale LIKE ?)" + ...
).all(`%${target}%`, `%${target}%`, ...iterParam);
```

If `target` contains `%` or `_` (valid SQLite LIKE wildcards), the query behavior changes. A target of `%` would match every row. A target of `_` would match any single character.

**Impact:** Query returns unexpected results with special characters in technology names.

**Fix:** Escape `%` and `_` in `target` before constructing the LIKE pattern, or use SQLite's `ESCAPE` clause: `LIKE ? ESCAPE '\'`.

---

### #9 — Top-level side effects prevent testability (ANTI-PATTERN)

**File:** `server.js:10-13, 84-93`

```js
const server = new Server(...);            // runs at import
server.setRequestHandler(...);             // runs at import
// ...
main().catch(...)                          // runs at import
```

The entire module executes side effects at import time: creates a `Server` instance, registers handlers, creates a transport, and connects to stdio. This means you cannot import `server.js` in a test without starting the MCP server.

The test harness works around this by importing `write-tools.js` and `read-tools.js` directly, bypassing `server.js` entirely. This means the dispatch logic in `server.js` (the `switch` statement) is untested.

**Impact:** The MCP protocol layer (tool name dispatch, `okResponse`/`errResponse` formatting) is untestable without refactoring.

**Fix:** Extract the server setup into a factory function (e.g., `createServer()`) and only call it when the module is the main entry point:

```js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(...)
}
```

---

### #10 — `mkdirSync` on `:memory:` path (MINOR)

**File:** `db.js:22`

```js
mkdirSync(path.dirname(dbPath), { recursive: true });
```

When `dbPath` is `:memory:`, `path.dirname(":memory:")` is `"."`. This calls `mkdirSync(".", { recursive: true })` which is a no-op but still a filesystem syscall on every database initialization.

**Impact:** Negligible performance cost, but reveals that the `:memory:` case wasn't considered in the original design.

**Fix:** Guard with `if (dbPath !== ':memory:')`.

---

### #11 — No `busy_timeout` PRAGMA (GAP)

**File:** `db.js`

The database sets `journal_mode=WAL` and `foreign_keys=ON` but not `busy_timeout`. Without it, if another process holds a write lock (e.g., a debugging tool inspecting the database), all queries fail immediately with `SQLITE_BUSY`.

In WAL mode, readers don't block writers, but writers still block other writers. Since this is a single-process server, this mostly doesn't matter — but it does if anyone opens the database file with another tool during a write.

**Impact:** Low — single-process usage minimizes contention. But a simple `db.pragma('busy_timeout=5000')` would make it more resilient.

---

### #12 — Schema bootstrap only checks `project` table (GAP)

**File:** `db.js:29-36`

```js
const tableExists = db
  .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project'")
  .get();

if (!tableExists) {
  const ddl = readFileSync(SCHEMA_PATH, "utf8");
  db.exec(ddl);
}
```

If schema application is interrupted (power loss, crash mid-`exec`), some tables may exist but not others. Since the check only looks for `project` (which is created early in `schema.sql`), a partial schema would pass the check and the missing tables would cause cryptic errors later.

There's also no migration strategy — no schema version tracking, no ALTER TABLE support. Adding a column to an existing table requires manual intervention or wiping the database.

**Impact:** Low (schema.sql runs in a single `db.exec()` which is transactional in SQLite), but if the DDL ever grows beyond a single transaction, this becomes a real problem.

---

### #13 — `insertVcsCommit` parameter naming inconsistency (INCONSISTENCY)

**File:** `write-tools.js:1128`

```js
function insertVcsCommit(db, iteration_id, revision_id, data) {
```

Other functions that ignore `revision_id` use the underscore-prefix convention: `_revision_id`. This function accepts `revision_id` without the prefix, suggesting it intends to use it, but never does. The `vcs_commit` table's INSERT doesn't include `revision_id`.

Compare with `insertPlanExternalDependency(db, iteration_id, _revision_id, data)` which correctly signals the unused parameter.

**Impact:** Misleading to readers; suggests a bug where `revision_id` was meant to be stored.

---

### #14 — Handler dispatch object rebuilt per call (ANTI-PATTERN)

**File:** `write-tools.js:1828-1866`

```js
function changelogInsert(args) {
  const db = getDb();
  const { entity_type, iteration_id, revision_id, data } = args;

  const handlers = {     // Rebuilt every call
    persona: insertPersona,
    requirement: insertRequirement,
    // ... 35 more entries
  };
```

The `handlers` object is a static mapping of entity types to functions. It doesn't depend on `args`, `db`, or any per-call state. Rebuilding it on every `changelogInsert` call creates ~37 property assignments and a new object allocation each time.

**Impact:** Negligible performance cost (V8 optimizes object literals well), but it's a code smell — the mapping is conceptually a constant.

**Fix:** Move to module scope as `const CHANGELOG_HANDLERS = { ... }`.

---

### #15 — Batch inserts only return last ID (DESIGN SMELL)

**File:** `write-tools.js:553-575` and similar batch functions

```js
function insertArchitectureConfig(db, iteration_id, revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  let lastId;
  for (const entry of entries) {
    const result = insert.run(...);
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "architecture_config", id: lastId };
}
```

Ten batch-capable functions follow this pattern. When inserting multiple entries, only the last `lastInsertRowid` is returned. The caller has no way to know:
- How many entries were actually inserted
- What IDs were assigned to earlier entries

**Impact:** Information loss — callers can't reference individual inserted rows after a batch insert.

**Fix:** Collect all IDs: `const ids = []; ... ids.push(result.lastInsertRowid); ... return { entity_type, ids, count: ids.length }`. This is a breaking change to the return shape.

---

### #16 — Silent `metadata` array coercion (DESIGN SMELL)

**File:** `write-tools.js:919, 1255, 1418, 1530`

```js
const meta = Array.isArray(data.metadata) ? data.metadata[0] : data.metadata;
```

Four manifest insert functions (`insertImplementationManifest`, `insertTestReport`, `insertDocumentationManifest`, `insertDeploymentManifest`) silently take the first element if `metadata` is an array. If someone passes `[metaA, metaB]`, `metaB` is silently dropped.

**Impact:** Silent data loss if the caller provides multiple metadata entries.

---

### #17 — Screen components mapping may produce `undefined` (DESIGN SMELL)

**File:** `write-tools.js:708`

```js
JSON.stringify((data.components ?? []).map(comp =>
  typeof comp === "string" ? comp : comp.component_name ?? comp.name
))
```

If `comp` is an object without `component_name` or `name` properties, the expression evaluates to `undefined`, which `JSON.stringify` converts to `null` inside an array. You get `["auth", null, "dashboard"]`.

**Impact:** Corrupt data stored in the `components` JSON column.

**Fix:** Add a fallback or throw: `comp.component_name ?? comp.name ?? (() => { throw new Error(...) })()`

---

### #18 — `attachRelated` default case doesn't parse JSON columns (GAP)

**File:** `read-tools.js:635-637`

```js
default:
  return results;
```

For entity types without a specific `attachRelated` case (e.g., `architecture_config`, `approved_dependency`, `technology_choice`, `blocker`, `project_lesson`, etc.), the raw database rows are returned as-is. Any JSON-in-TEXT columns (like `goals`, `consequences`, `acceptance_criteria`) remain as raw JSON strings rather than parsed objects.

The `include_related` flag still triggers the function, but it's a no-op for these types.

**Impact:** Inconsistent API — some entity types return parsed JSON arrays, others return stringified JSON. Callers must know which types have `attachRelated` support.

---

### #19 — No pagination on any query (GAP)

**File:** `read-tools.js` (all query functions)

`changelogQuery`, `traceabilityQuery`, `revisionHistory`, `iterationSummary`, and `projectStatus` all return complete result sets with no `LIMIT`/`OFFSET` support. The `inputSchema` definitions don't include pagination parameters.

**Impact:** Acceptable at current scale (typically <100 entities per iteration), but if iterations grow large, a single `changelog_query` with `include_related: true` could produce multi-megabyte responses.

---

### #20 — `errResponse` discards stack traces (GAP)

**File:** `server.js:38-48`

```js
function errResponse(err) {
  return {
    content: [{
      type: "text",
      text: err instanceof Error ? err.message : String(err),
    }],
    isError: true,
  };
}
```

Only `err.message` is returned. The stack trace (`err.stack`) is lost, making it difficult to diagnose where errors originated during development or debugging.

**Impact:** Reduced debuggability. When an LLM receives an error like `"Cannot read properties of undefined (reading 'id')"`, there's no indication which function or line failed.

**Fix:** Include the stack in development: `text: err instanceof Error ? err.stack : String(err)` (or toggle via an environment variable).

---

### #21 — No graceful shutdown handler (GAP)

**File:** `server.js`

There is no `process.on('SIGTERM', ...)` or `process.on('SIGINT', ...)` handler. When the server is terminated, the database connection is not explicitly closed. While SQLite with WAL mode is crash-safe, explicit cleanup via `closeDb()` ensures the WAL file is checkpointed and cleaned up.

**Impact:** WAL files may accumulate if the server is repeatedly killed without clean shutdown.

---

### #22 — No `engines` field or lockfile (GAP)

**File:** `package.json`

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "better-sqlite3": "^11.7.0"
  }
}
```

No `"engines": { "node": ">=18" }` field, no `package-lock.json` or `npm-shrinkwrap.json`. The `^` ranges mean `npm install` on different machines at different times will get different dependency versions.

`better-sqlite3` in particular has native bindings — minor version changes can introduce breaking behavior or compilation failures.

**Impact:** Non-reproducible builds; potential for "works on my machine" issues.

---

### #23 — Multiple timestamps within a single transaction (MINOR)

**File:** Various functions in `write-tools.js`

```js
function insertPersona(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  // ... uses `now` for created_at and updated_at
}
```

Most functions create a single `now` timestamp and reuse it, which is correct. However, `snapshotIfExists` (called from within insert functions) creates its own `new Date().toISOString()`:

```js
function snapshotIfExists(db, table, entityType, entityId, newRevisionId) {
  // ...
  const now = new Date().toISOString();
  // ...
}
```

This means within a single transaction, the snapshot and the entity being upserted may have slightly different timestamps. In practice, the difference is sub-millisecond, but it violates the principle that a transaction represents a single point in time.

**Impact:** Negligible — sub-millisecond differences won't affect sorting or filtering.

**Fix:** Pass the caller's `now` timestamp to `snapshotIfExists`.

---

### #24 — Duplicated query-building in `changelogQuery` (ANTI-PATTERN)

**File:** `read-tools.js:130-175`

The function has two completely separate query construction paths:

1. **Named params path** (lines 130-174): Uses `buildWhere` with `@param` syntax
2. **Positional params path** (lines 153-172): Rebuilds the query from scratch with `?` syntax

These must be kept in sync manually. Finding #2 (the `IS NULL` bug) is a direct consequence of this duplication — the positional path was written independently and missed a case.

**Fix:** Unify into a single code path. Since SQLite doesn't support mixing named and positional params, use positional params exclusively (they're more compatible with `IN` clauses).

---

### #25 — `insertDataEntity` name-based relationship resolution (DESIGN SMELL)

**File:** `write-tools.js:476-491`

```js
const lookupTarget = db.prepare(
  "SELECT id FROM data_entity WHERE name = ? AND iteration_id = ? ORDER BY id DESC LIMIT 1"
);
```

Relationships between data entities are resolved by matching the target entity's `name` string, not its `id`. If two data entities have the same name in the same iteration, the lookup returns the most recently inserted one (`ORDER BY id DESC LIMIT 1`), silently using the wrong entity.

**Impact:** Silent data corruption if entity names aren't unique within an iteration.

**Fix:** Add a UNIQUE constraint on `(name, iteration_id)` in the schema, or use IDs for relationship resolution.

---

### #26 — No input validation framework (GAP)

Handler functions perform minimal validation. Some examples of missing validation:

- `phaseTransition`: No check that `iteration_id` exists before updating
- `revisionUpdate`: No check that `revision_id` exists (the UPDATE silently affects 0 rows)
- `changelogInsert`: No check that `iteration_id` or `revision_id` exist before inserting (relies on FK constraints)
- `commitLink`: No check that `iteration_id` exists
- `blockerResolve`: Checks `changes === 0` but not whether the blocker is already resolved

FK constraints catch most of these at the database level, but the error messages from SQLite (`FOREIGN KEY constraint failed`) are less helpful than application-level validation errors.

---

### #27 — No observability beyond startup message (GAP)

The only logging in the entire codebase is:

```js
console.error("rigorous-dev-mcp server running on stdio");
```

There is no logging for:
- Tool invocations (which tool, what arguments)
- Errors (only returned to the caller, not logged)
- Performance (query timings)
- Database operations (writes, deletes)

**Impact:** Debugging production issues requires adding temporary logging. No audit trail of what operations were performed.

---

### #28 — Deprecated API scan: clean (INFO)

No deprecated Node.js or better-sqlite3 APIs were detected:

- **Node.js builtins used:** `node:fs` (`readFileSync`, `mkdirSync`), `node:path`, `node:url` (`fileURLToPath`) — all current and stable.
- **better-sqlite3 APIs used:** `new Database()`, `.prepare()`, `.run()`, `.get()`, `.all()`, `.transaction()`, `.pragma()`, `.exec()`, `.close()` — all current in v11.x.
- **MCP SDK APIs used:** `Server`, `StdioServerTransport`, `ListToolsRequestSchema`, `CallToolRequestSchema` — current in v1.12.x.
- **ES module syntax:** `import`/`export` — fully supported in Node 18+ with `"type": "module"`.
- **Nullish coalescing (`??`):** Supported since Node 14.
- **Optional chaining (`?.`):** Supported since Node 14.

---

## Summary by Severity

| Severity | Count | Findings |
|----------|-------|----------|
| Bug | 4 | #1, #2, #3, #4 |
| Security | 1 | #6 |
| Anti-pattern | 4 | #7, #8, #9, #14 |
| Inconsistency | 2 | #5, #13 |
| Design smell | 4 | #15, #16, #17, #25 |
| Gap | 8 | #11, #12, #18, #19, #20, #21, #22, #26, #27 |
| Minor | 2 | #10, #23 |
| Info | 1 | #28 |

**Bugs (#1-#4)** should be fixed — they represent incorrect or dead logic. #2 is the most impactful (silent data loss in query results).

**Security (#6)** is low-risk in current deployment but represents a real injection vector.

**Anti-patterns (#7, #8, #9, #14)** are worth addressing for maintainability but don't cause runtime issues today.

**Gaps** are missing capabilities that may matter as usage scales. None are blockers at current scale.

**No deprecated APIs** were found — the codebase uses current, stable APIs throughout.
