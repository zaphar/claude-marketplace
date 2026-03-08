# MCP Server Internals

Persistence layer mechanics for the rigorous-dev MCP server.

> This document covers the persistence layer mechanics. For the data model (tables, columns, domains), see `skills/rigorous-dev/references/schemas-overview.md`.

---

## 1. Library: better-sqlite3

`better-sqlite3` is a native C/C++ N-API addon wrapping the actual SQLite C library — not a JavaScript reimplementation.

**Synchronous execution model.** `.run()`, `.get()`, `.all()` block the Node.js event loop. This is by design: eliminating async overhead makes it faster than async alternatives for single-process use.

**Prepared statements.** `db.prepare(sql)` compiles SQL once. Reusing a prepared statement via `stmt.run(...)` in a loop is the fast path. This codebase follows this pattern consistently — see any `insertXxx()` function in `write-tools.js` for examples (e.g., `insertComponent` prepares once, then loops over interfaces, dependencies, requirements, and test boundaries).

**Transactions.** `db.transaction(() => { ... })` creates an implicit `BEGIN IMMEDIATE ... COMMIT` block with automatic rollback on throw. Used in `iterationCreate` (wraps project + iteration + 9 phase inserts) and by `changelogInsert` (wraps each entity handler call).

**Return values.** `.run()` returns `{ changes, lastInsertRowid }`. The codebase chains parent→child inserts via `lastInsertRowid` — for example, `iterationCreate` captures the iteration ID from the insert result and uses it for all subsequent phase inserts.

**Named parameters.** `@param` syntax, bound via an object. The codebase mixes named (`@param`) and positional (`?`) parameters across different functions. `buildWhere` in `read-tools.js` has to work around the fact that SQLite does not allow mixing both in one statement — when `ids` are present, it falls back to a fully-positional query rebuild (see the `idsParam` branching at line ~141 of `read-tools.js`).

## 2. Database Initialization (db.js)

**Singleton pattern.** A module-level `_db` variable, lazy-initialized by `getDb()`.

**Path resolution.** `$RIGOROUS_DEV_DB_PATH` environment variable, or `.claude/rigorous-dev.db` relative to `process.cwd()`. `mkdirSync` with `recursive: true` ensures the parent directory exists.

**PRAGMAs set on every connection:**

| PRAGMA | Effect |
|--------|--------|
| `journal_mode=WAL` | Write-ahead logging. Allows concurrent readers during writes. WAL file can grow unbounded (SQLite auto-checkpoints at ~1000 pages). Since this is a single-process stdio server, WAL mainly prevents corruption on crash. |
| `foreign_keys=ON` | Every FK is validated on insert/update/delete. Combined with `ON DELETE CASCADE`, deleting an iteration cascades through all child tables. |

**Schema bootstrap.** Checks whether the `project` table exists in `sqlite_master`. If not, reads `schema.sql` from disk and executes the entire DDL via `db.exec(ddl)`.

**Teardown.** `closeDb()` closes the connection and resets the singleton to `null`.

## 3. Primary Key Strategies

Three PK strategies coexist, each serving a different purpose:

| Strategy | Count | Tables | Purpose |
|----------|-------|--------|---------|
| `TEXT PRIMARY KEY` | 6 | `persona`, `requirement`, `adr`, `component`, `user_flow`, `screen` | Semantic IDs (e.g., `REQ-001`, `COMP-AUTH`) — agent-friendly, stable across revisions |
| `INTEGER PRIMARY KEY AUTOINCREMENT` | 89 | Everything else (88 AUTOINCREMENT + 1 `project` with `CHECK(id = 1)`) | Surrogate keys for internal tables |
| Composite `PRIMARY KEY` | 16 | Junction/mapping tables | e.g., `(requirement_id, persona_id)`, `(plan_phase_id, component_id)` |

The `TEXT_PK_TYPES` set in `read-tools.js` tracks the 6 text-PK entities. This matters because `snapshotIfExists` and the upsert write pattern only apply to these types, and `buildWhere` adjusts query construction based on membership.

## 4. Write Patterns (write-tools.js)

`changelogInsert` dispatches to a per-entity-type `insertXxx()` function and wraps each call in `db.transaction()` (line ~1873). Four distinct patterns are used within these handlers:

### a. Upsert + Snapshot (TEXT PK entities only)

Before overwriting a text-PK entity, `snapshotIfExists()` captures the complete old row as JSON into the `entity_snapshot` table. Then `INSERT ... ON CONFLICT(id) DO UPDATE SET ...` performs the upsert. This provides a full audit trail queryable via `changelog_query` with `history: true`. Only the 6 `TEXT_PK_TYPES` entities use this pattern.

### b. Delete-and-Reinsert (child tables)

When upserting a parent entity that already exists, all child rows are deleted first, then re-inserted from the new data. Example: updating a component deletes all `component_interface`, `component_dependency`, `component_requirement`, and `integration_test_boundary` rows, then re-inserts from the incoming data. This is simpler than per-row diffing and safe because `changelogInsert` wraps the handler in a transaction.

### c. Append-Only (INTEGER PK entities)

Most tables use plain `INSERT` — they accumulate records rather than updating in place. Examples: `technology_choice`, `architecture_config`, `plan_phase`.

### d. Batch-Capable Inserters

Ten insert functions accept arrays via the `Array.isArray(data) ? data : [data]` pattern: `insertArchitectureConfig`, `insertApprovedDependency`, `insertProjectContext`, `insertSystemIo`, `insertDeploymentRequirement`, `insertOperationalRequirement`, `insertTechnologyConstraint`, `insertUxConfig`, `insertInfoArchitecture`, `insertUxAsset`. Each iterates and inserts every entry using a shared prepared statement.

### Transaction usage

- `iterationCreate` wraps project creation + iteration + 9 phase inserts in an explicit `db.transaction()`.
- `changelogInsert` wraps each `insertXxx()` handler call in `db.transaction()` — the snapshot + upsert + child delete/reinsert sequence for text-PK entities is atomic.
- `changelogUpdate` and `phaseTransition` run individual prepared statements without an explicit transaction wrapper (each is a single UPDATE).

## 5. Read Patterns (read-tools.js)

### a. Dynamic Query Building (`buildWhere` + `changelogQuery`)

Builds WHERE clauses from `iteration_id`, `ids`, and `filters`. Has a notable complexity around mixing named (`@param`) and positional (`?`) parameters: when `ids` are present, `changelogQuery` abandons named params entirely and rebuilds the query with all-positional parameters to avoid SQLite's parameter mixing limitation. See the `idsParam` branching block starting at line ~137.

### b. N+1 Query Pattern (`attachRelated`)

When `include_related: true`, flat result rows are enriched with child table data via per-row queries. For complex entities like `implementation_manifest`, this means 11+ additional queries per result row (files, per-file requirements, requirement status, component status, API endpoints, per-endpoint requirements, blockers, per-blocker requirements, dependencies added, DB migrations, review checklist). This is an intentional design choice — acceptable because datasets are small (typically <100 entities per iteration) and SQLite is in-process with zero network overhead.

### c. Traceability Graph Traversal (`traceabilityQuery`)

Given a starting entity (one of 6 target types: `component`, `technology`, `requirement`, `adr`, `flow`, `screen`), follows relationships through junction tables and FKs to build a chain of related decisions. Uses LIKE queries for text-based matching (e.g., finding ADRs whose `decision` or `rationale` mentions a technology name).

## 6. JSON-in-TEXT Columns

Arrays that don't need relational querying are stored as JSON-serialized TEXT columns: `goals`, `acceptance_criteria`, `consequences`, `research_sources`, `components`, `data_dependencies`, `targets`, `platforms`, `steps`, `channels`, `config_files`, `triggers`, `test_ids`, `paths`, `entry_criteria`, `exit_criteria`, `checkpoint_focus`, `assumptions`, `principles`, etc. Serialized with `JSON.stringify()` on write, `JSON.parse()` on read.

**Trade-off:** These columns cannot be indexed or filtered with SQL WHERE clauses. If you ever need to query inside these values, they would need to be normalized into their own tables.

## 7. Constraint & Integrity Patterns

**CHECK constraints** are used extensively for enum columns (`status`, `priority`, `severity`, `file_operation`, etc.). See any `CHECK(... IN (...))` clause in `schema.sql`.

**ON DELETE CASCADE** is the default FK behavior. Deleting an iteration cascades through all ~100+ child tables.

**ON DELETE SET NULL** is used for soft references where the child should survive parent deletion:

| Column | References | Rationale |
|--------|------------|-----------|
| `adr.superseded_by` | `adr(id)` | Superseding ADR may be removed independently |
| `approved_dependency.adr_id` | `adr(id)` | Dependency record survives ADR deletion |
| `user_flow.persona_id` | `persona(id)` | Flow definition survives persona deletion |
| `ux_asset.screen_id` | `screen(id)` | Asset survives screen deletion |
| `implementation_file.component_id` | `component(id)` | File record survives component deletion |
| `vcs_commit.phase_id` | `phase(id)` | Commit record survives phase deletion |
| `intermediate_asset.phase_id` | `phase(id)` | Asset record survives phase deletion |
| `asset_deliverable.phase_id` | `phase(id)` | Deliverable record survives phase deletion |

**Soft FK (no constraint):** `user_flow_step.surface` references `screen.name` (not `screen.id`) with no foreign key constraint, because screens might not exist when flows are defined. Documented inline in `schema.sql` at the column definition.

## 8. Index Strategy

143 indexes with a clear rationale (documented in `schema.sql` comments):

- **`iteration_id`** indexes on every entity table — the primary access pattern is "everything in iteration X."
- **`revision_id`** indexes on provenance-tracking tables — "what changed in revision Y."
- **`requirement_id`** indexes on junction/mapping tables — requirements are the most cross-referenced entity.
- **`manifest_id`** / **`report_id`** / **`plan_phase_id`** on child tables — parent→child joins.
- **Composite indexes** on `traceability_mapping(iteration_id, requirement_id)` and `(iteration_id, addressed_by_type)`.
- **Explicit skip comments** where a column is already leftmost in a PK or UNIQUE constraint that SQLite auto-indexes (e.g., `component_dependency.component_id` is leftmost in its composite PK, so no separate index is needed).

## 9. Adding a New Entity Type (Checklist)

Adding a new entity type requires synchronized changes in 4+ files:

1. **`schema.sql`** — `CREATE TABLE` with FKs to `iteration(id)` and `revision(id)` + `CREATE INDEX` for `iteration_id` and `revision_id` + any child/junction tables + their indexes.
2. **`write-tools.js`** — Add to `VALID_ENTITY_TYPES` array + write an `insertXxx()` function + add the case to the `changelogInsert` dispatch `handlers` object.
3. **`read-tools.js`** — Add to `ENTITY_TABLE` mapping + optionally add to `TEXT_PK_TYPES` if using text PKs + optionally add a case in `attachRelated` for child data enrichment.
4. **Table documentation** — Add or update the relevant `skills/rigorous-dev/references/tables/<domain>.md`.
5. **`schemas-overview.md`** — Add the table to the domain listing.

## 10. Performance Considerations

- **Synchronous execution** means expensive queries block the MCP server (the agent's tool call hangs until it returns). Not a problem at current scale.
- **The N+1 pattern** in `attachRelated` would need batching if result sets grow beyond hundreds of rows.
- **No explicit WAL checkpointing** — relies on SQLite's auto-checkpoint at the default threshold (~1000 pages).
- **Prepared statements** are created inline (not cached across calls) in most functions. `better-sqlite3` handles this efficiently with its internal statement cache, so this is not a performance issue in practice.
