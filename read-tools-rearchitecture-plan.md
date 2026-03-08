# Rearchitecture: Concrete Query Dispatch in read-tools.js

## Problem

`buildWhere()` in `read-tools.js` interpolates user-provided filter field names directly into SQL strings. This is the only generic/unsafe piece in an otherwise concrete-per-entity codebase. The write side already has 37 concrete `insertXxx()` functions.

## Approach

Replace the generic `buildWhere()` + `attachRelated()` pattern with **37 concrete `queryXxx()` functions**, each owning its full read pipeline: filtering, SQL execution, enrichment, and error handling. `changelogQuery` becomes a thin dispatcher.

### Why Dynamic SQL Construction (Industry Context)

Every major query builder (Kysely, Knex, Prisma, Django ORM) dynamically assembles WHERE clauses from known column names. There is no way to avoid dynamic SQL when the set of filter conditions varies per call — prepared statements require a fixed query shape, and pre-preparing all 2^N permutations of N filterable columns is impractical.

**Alternatives evaluated:**
- **Knex**: Async-only API, incompatible with `better-sqlite3`'s synchronous API. 13 transitive dependencies, 874KB. Not viable.
- **Kysely**: Zero dependencies but TypeScript-only. Requires `better-sqlite3` adapter. Its own recommended pattern (`findPeople` example in docs) conditionally adds `.where()` calls per column — the same pattern as our `applyFilters`. The query builder just wraps string concatenation in a fluent API.
- **Sentinel pattern** (`WHERE (? IS NULL OR col = ?)`): Single static SQL per entity. But creates ambiguity between "don't filter" and "filter for NULL", evaluates all columns even when not filtering, and produces longer/harder-to-read SQL.
- **Pre-prepared statement cache**: Marginal benefit since `better-sqlite3` already caches prepared statements internally by SQL string.

**Conclusion**: The `applyFilters` helper with hardcoded spec keys is the standard industry pattern for this problem. It's what Kysely's own documentation recommends, just without the library wrapper.

### Design Principles

1. **Injection-safe by construction** — no user-provided strings become SQL identifiers
2. **Null filters handled per data model** — each function knows which columns are nullable and applies `IS NULL` for those; rejects null for non-nullable columns
3. **LLM-friendly errors** — every failure produces an actionable message (what went wrong, what to do)
4. **No behavioral change** — same tool schema, same response shape, same results

### What Gets Removed

- `buildWhere()` (lines 56-89, ~30 lines) — generic, unsafe
- `attachRelated()` (lines 189-638, ~450 lines) — absorbed into query functions
- Positional-rebuild hack in `changelogQuery` (lines 153-172) — eliminated
- Dead `hasIterationCol` variable (lines 61-63) — eliminated

### What Gets Created

- 37 `queryXxx(db, args)` functions
- `QUERY_DISPATCH` map: `{ entity_type → queryXxx }`
- `applyFilters(filters, knownFilters, entityType)` shared helper — validates filter keys against known set, builds clauses/params array, handles null for nullable columns, throws on unknown filters
- Error wrapper in `changelogQuery` dispatch for clear LLM-facing messages

### Error Handling Strategy

1. **Unknown filter field** → `Unknown filter "foo" for persona. Valid filters: name, description, technical_level, frequency_of_use`
2. **Null on non-nullable column** → `Filter "name" for persona does not accept null values`
3. **Unknown entity_type** → `Unknown entity_type: "foo". Valid types: persona, requirement, ...` (already exists)
4. **SQL execution failure** → Wrap in try/catch: `Failed to query persona: <sqlite error>`
5. **Empty results** → Not an error, return `{ results: [], count: 0 }` (already exists)

### Shared Helper: `applyFilters`

To avoid 37 copies of identical filter-validation boilerplate, extract a shared helper:

```js
function applyFilters(filters, knownFilters, entityType) {
  // knownFilters = { column_name: { nullable: true/false }, ... }
  const clauses = [];
  const params = [];

  // Step 1: Reject any user-provided keys not in the spec
  for (const userKey of Object.keys(filters)) {
    if (!(userKey in knownFilters)) {
      throw new Error(
        `Unknown filter "${userKey}" for ${entityType}. Valid filters: ${Object.keys(knownFilters).join(", ")}`
      );
    }
  }

  // Step 2: Iterate over SPEC keys (not user keys) — only spec strings reach SQL
  for (const [specKey, colDef] of Object.entries(knownFilters)) {
    if (!(specKey in filters)) continue; // user didn't provide this filter
    const value = filters[specKey];
    if (value === null) {
      if (!colDef.nullable) {
        throw new Error(`Filter "${specKey}" for ${entityType} does not accept null values`);
      }
      clauses.push(`${specKey} IS NULL`);
    } else {
      clauses.push(`${specKey} = ?`);
      params.push(value);
    }
  }

  return { clauses, params };
}
```

**Key safety property:** Step 1 validates user keys and rejects unknowns (user strings appear only in error messages). Step 2 iterates over hardcoded spec keys — only spec strings ever reach SQL. No user-provided string can become a SQL identifier, even after validation.

Each query function defines its filter spec as a plain object — the column names are hardcoded in source, never from user input:

```js
const PERSONA_FILTERS = {
  name:             { nullable: false },
  description:      { nullable: false },
  technical_level:  { nullable: true },
  frequency_of_use: { nullable: true },
};
```

---

## Phase 1: Scaffold & Simple Types (21 entities)

### Step 1a: Create `applyFilters` helper

Add the shared `applyFilters(filters, knownFilters, entityType)` helper at the top of `read-tools.js` (replacing `buildWhere`).

### Step 1b: Create 21 simple query functions

Each function follows this template (no child queries, no JSON enrichment):

```js
const TECHNOLOGY_CHOICE_FILTERS = {
  category: { nullable: false },
  name:     { nullable: false },
  purpose:  { nullable: true },
  rationale: { nullable: true },
  version:  { nullable: true },
  config:   { nullable: true },
};

function queryTechnologyChoice(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM technology_choice";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, TECHNOLOGY_CHOICE_FILTERS, "technology_choice");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}
```

**All 21 simple entities with their filter specs:**

1. **technology_choice** — Filterable: category, name, purpose (nullable), rationale (nullable), version (nullable), config (nullable)
2. **plan_external_dependency** — Filterable: name, description, plan_phase_number (nullable), risk_level, mitigation (nullable)
3. **plan_critical_path** — Filterable: plan_phase_id, sequence_order (PK is plan_phase_id TEXT, no iteration_id column — special case)
4. **plan_metadata** — Filterable: title, version, document_date, status, requirements_version, architecture_version, ux_specification_version, document_updated (nullable)
5. **traceability_mapping** — Filterable: requirement_id, addressed_by, addressed_by_type, notes (nullable)
6. **project_context** — Filterable: key, value, category (nullable)
7. **system_io** — Filterable: direction, name, description, source (nullable), destination (nullable), data_format (nullable)
8. **deployment_requirement** — Filterable: target (nullable), description, notes (nullable)
9. **operational_requirement** — Filterable: item, category, notes (nullable)
10. **technology_constraint** — Filterable: constraint_type, value
11. **ux_config** — Filterable: config_type, category, key, value
12. **ux_asset** — Filterable: name, path, type, screen_id (nullable), description (nullable)
13. **architecture_config** — Filterable: config_type, target (nullable), category, key, value
14. **approved_dependency** — Filterable: package, version_constraint (nullable), purpose, justification, adr_id (nullable), license (nullable), maintenance_activity (nullable), community_adoption (nullable), transitive_deps (nullable), single_maintainer_risk (nullable)
15. **blocker** — Filterable: phase_name, description, severity, raised_by, resolved_at (nullable), resolution_notes (nullable)
16. **project_lesson** — Filterable: phase_name, category, lesson, recurring
17. **security_audit_finding** — Filterable: category, severity, title, description, location (nullable), recommendation, cve (nullable), status
18. **performance_audit_finding** — Filterable: category, severity, title, description, location (nullable), metric_name (nullable), baseline_value (nullable), actual_value (nullable), recommendation, status
19. **intermediate_asset** — Filterable: phase_id (nullable), asset_type, title, content (nullable)
20. **asset_deliverable** — Filterable: phase_id (nullable), asset_type, file_path, description (nullable), commit_sha (nullable)
21. **vcs_commit** — Filterable: phase_id (nullable), commit_sha, message (nullable)

**Special case — plan_critical_path:** This table has PK `plan_phase_id` (TEXT) and no `iteration_id` column. The query function must not add an `iteration_id` clause. The `ids` parameter maps to `plan_phase_id` instead of `id`.

### Step 1c: Create `QUERY_DISPATCH` map and refactor `changelogQuery`

```js
const QUERY_DISPATCH = {
  technology_choice: queryTechnologyChoice,
  plan_external_dependency: queryPlanExternalDependency,
  // ... all 37
};
```

Refactor `changelogQuery` to:
1. Keep `history` mode branch as-is (doesn't use buildWhere)
2. Replace the buildWhere/attachRelated path with dispatch:

```js
function changelogQuery(args) {
  const db = getDb();
  const { entity_type, iteration_id, ids, filters, include_related = false, history = false } = args;

  if (!QUERY_DISPATCH[entity_type]) {
    throw new Error(`Unknown entity_type: "${entity_type}". Valid types: ${Object.keys(QUERY_DISPATCH).join(", ")}`);
  }

  // History mode unchanged
  if (history) { /* ... existing code ... */ }

  try {
    const results = QUERY_DISPATCH[entity_type](db, { iteration_id, ids, filters, include_related });
    return { entity_type, results, count: results.length };
  } catch (err) {
    throw new Error(`Failed to query ${entity_type}: ${err.message}`);
  }
}
```

### Step 1d: Delete `buildWhere` and run tests

Remove `buildWhere()` (lines 56-89) and `hasIterationCol`. Run `node --test test/` — all 97 tests must pass. The 16 complex types temporarily fall through to the `default` case in `QUERY_DISPATCH` (which just does `SELECT * FROM table` with filters but no enrichment) until Phase 2.

**Wait — correction:** We can't have a fallback. All 37 must be in `QUERY_DISPATCH` from the start. For the 16 complex types, create stub functions in Phase 1 that do filtering only (no enrichment). Phase 2 adds enrichment.

---

## Phase 2: Complex Types (16 entities)

Add `include_related` enrichment logic to each of the 16 complex query functions, absorbing the corresponding `attachRelated` case. After all 16 are migrated, delete `attachRelated`.

### Detailed enrichment per entity type:

**1. persona** (currently lines 338-342)
- JSON parse: `goals`
- No child queries

**2. requirement** (currently lines 191-203)
- JSON parse: `acceptance_criteria`
- Child queries:
  - `requirement_persona` → `personas` (map to persona_id)
  - `requirement_dependency` → `depends_on` (map to depends_on)

**3. adr** (currently lines 224-241)
- JSON parse: `consequences`, `research_sources`
- Child queries:
  - `adr_alternative` → `alternatives` (each with JSON parse: pros, cons)

**4. component** (currently lines 205-222)
- No JSON parse on main table
- Child queries:
  - `component_interface` → `interfaces` (all columns)
  - `component_dependency` → `dependencies` (map to depends_on)
  - `component_requirement` → `requirements_addressed` (map to requirement_id)
  - `integration_test_boundary` → `integration_test_boundaries` (all columns)

**5. user_flow** (currently lines 243-266)
- JSON parse: `data_dependencies`
- Child queries:
  - `user_flow_step` → `steps` (ordered by step_number)
    - Nested: `user_flow_step_branch` → `branches` per step
  - `user_flow_error_state` → `error_states`
  - `user_flow_requirement` → `requirements` (map to requirement_id)

**6. screen** (currently lines 268-278)
- JSON parse: `components`
- Child queries:
  - `screen_state` → `states` (name, description, wireframe_path)
  - `screen_responsive_variant` → `responsive_variants` (breakpoint, wireframe_path, layout_changes)

**7. plan_phase** (currently lines 280-324)
- JSON parse: `entry_criteria`, `exit_criteria`, `checkpoint_focus`
- Child queries:
  - `plan_phase_requirement` → `requirements` (with conditional shaping: if priority/notes present, return object; else just requirement_id)
  - `plan_phase_component` → `components` (map to component_id)
  - `plan_phase_api_endpoint` → `api_endpoints` (http_method, route, description)
  - `plan_phase_db_change` → `db_changes` (with JSON parse: tables)
  - `plan_phase_risk` → `risks` (risk, mitigation)
  - `plan_phase_flow` → `flows` (map to flow_id)
  - `plan_phase_screen` → `screens` (map to screen_id)
  - `plan_phase_relationship` (type='dependency') → `dependencies`
  - `plan_phase_relationship` (type='parallel') → `parallel_with` (map to can_parallel_with_id)

**8. plan_overview** (currently lines 326-336)
- JSON parse: `assumptions`
- Child queries:
  - COUNT on `plan_phase` → `total_phases`
  - `plan_overview_risk` → `risks` (risk, mitigation, plan_phase_number)

**9. data_entity** (currently lines 344-358)
- No JSON parse
- Child queries:
  - `data_entity_attribute` → `attributes` (name, data_type, is_required, description)
  - `data_entity_relationship` JOIN `data_entity` → `relationships` (target_entity name, id, type, description)

**10. architecture_overview** (currently lines 360-367)
- JSON parse: `principles`
- Child queries:
  - `architecture_diagram` → `diagrams` (id, name, path, description)

**11. persona_addressed** (currently lines 369-376)
- No JSON parse
- Child queries:
  - `persona_addressed_flow` → `flows` (map to flow_id)

**12. info_architecture** (currently lines 378-384)
- No JSON parse
- Child queries:
  - Self-referential `info_architecture WHERE parent_id = ?` → `children` (id, category, key, value)

**13. implementation_manifest** (currently lines 386-441)
- No JSON parse on main table
- Child queries (deeply nested):
  - `implementation_file` → `files` (each with nested `implementation_file_requirement` → requirements)
  - `implementation_api_endpoint` → `api_endpoints` (each with nested `implementation_api_endpoint_requirement` → requirements)
  - `implementation_blocker` → `blockers` (each with nested `implementation_blocker_requirement` → requirements)
  - `implementation_requirement_status` → `requirement_status`
  - `implementation_component_status` → `component_status`
  - `implementation_dependency_added` → `dependencies_added`
  - `implementation_db_migration` → `db_migrations`
  - `implementation_review_checklist` → `review_checklist`
  - Computed: `files_created` (count where file_operation='created'), `files_modified` (count where file_operation='modified')

**14. test_report** (currently lines 443-502)
- No JSON parse on main table
- Child queries (deeply nested):
  - `test_requirement_coverage` → `coverage` (each with nested `test_acceptance_criterion_result` → criteria with JSON parse: test_ids)
  - `test_suite` → `suites` (each with nested `test_case` → cases, each with nested `test_case_requirement` → requirements)
  - `test_security_finding` → `security_findings`
  - `test_performance_benchmark` → `performance_benchmarks`
  - `test_blocker` → `blockers` (each with nested `test_blocker_requirement` → requirements)
  - `test_recommendation` → `recommendations`

**15. documentation_manifest** (currently lines 504-541)
- No JSON parse on main table
- Child queries:
  - `documentation_feature` → `features` (each with nested `documentation_feature_requirement` → requirements)
  - `documentation_requirement_coverage` → `coverage` (JSON parse: paths)
  - `documentation_section` → `sections`
  - `documentation_asset` → `assets`
  - `documentation_review_checklist` → `verification`
  - Computed: `documents_created` (count of sections)

**16. deployment_manifest** (currently lines 543-633)
- JSON parse: `targets`, `blockers`
- Child queries (deeply nested):
  - `deployment_pipeline` → `pipelines` (JSON: config_files; nested: `deployment_pipeline_stage` with JSON: triggers, steps; nested: `deployment_stage_quality_gate`)
  - `deployment_environment` → `environments` (nested: `deployment_env_infra` → infra, `deployment_env_var` → vars)
  - `deployment_artifact` → `artifacts` (JSON: platforms)
  - `deployment_local_executable` → `local_executables` (JSON: platforms, channels)
  - `deployment_runbook` → `runbooks` (nested: `deployment_runbook_step` → steps)
  - `deployment_quality_gate` → `quality_gates`
  - `deployment_signing` → `signing`
  - `deployment_secret` → `secrets`
  - `deployment_health_check` → `health_checks`
  - `deployment_alerting` → `alerting`
  - `deployment_review_checklist` → `review_checklist`

### Step 2-final: Delete `attachRelated` and run tests

Remove the entire `attachRelated` function. Run `node --test test/` — all 97 existing tests + all new tests from Phase 1 and Phase 2 must pass.

---

## Test Strategy

Tests are written alongside each change, not as a separate phase. Each phase includes its own tests that run immediately to provide prompt feedback.

### Test file: `test/query-dispatch.test.js`

Created at the start of Phase 1, uses existing patterns:
```js
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshDb, seedIteration } from "./helpers.js";
import { handleWriteTool } from "../write-tools.js";
import { handleReadTool } from "../read-tools.js";

let db, seed;
beforeEach(() => {
  db = freshDb();
  seed = seedIteration(db);
});
```

### Phase 1 tests (written with Phase 1 code)

Include with the Phase 1 work-unit:

**Per-function filter tests for the 21 simple entity types.** Each test:
1. Inserts test data via `handleWriteTool("changelog_insert", ...)`
2. Queries with an entity-specific filter via `handleReadTool("changelog_query", { entity_type, filters: { column: value } })`
3. Asserts correct results

**Unknown filter key rejection:**
```js
it("rejects unknown filter field", () => {
  assert.throws(
    () => handleReadTool("changelog_query", {
      entity_type: "persona",
      filters: { nonexistent_column: "value" }
    }),
    { message: /Unknown filter "nonexistent_column" for persona/ }
  );
});

it("rejects SQL injection via filter key", () => {
  assert.throws(
    () => handleReadTool("changelog_query", {
      entity_type: "persona",
      filters: { "1=1 --": null }
    }),
    { message: /Unknown filter "1=1 --" for persona/ }
  );
});
```

**Null filter on non-nullable column:**
```js
it("rejects null filter on non-nullable column", () => {
  assert.throws(
    () => handleReadTool("changelog_query", {
      entity_type: "persona",
      filters: { name: null }
    }),
    { message: /does not accept null/ }
  );
});
```

**ids + filters combination (covers audit Findings #1 and #9):**
```js
it("combines ids with filters correctly", () => {
  handleWriteTool("changelog_insert", {
    entity_type: "adr", iteration_id: seed.iteration_id,
    revision_id: seed.revision_id,
    data: { id: "ADR-1", title: "Use REST", status: "accepted", decision: "REST", rationale: "R" }
  });
  handleWriteTool("changelog_insert", {
    entity_type: "adr", iteration_id: seed.iteration_id,
    revision_id: seed.revision_id,
    data: { id: "ADR-2", title: "Use GraphQL", status: "rejected", decision: "GQL", rationale: "R" }
  });
  const r = handleReadTool("changelog_query", {
    entity_type: "adr",
    ids: ["ADR-1", "ADR-2"],
    filters: { status: "accepted" }
  });
  assert.strictEqual(r.count, 1);
  assert.strictEqual(r.results[0].id, "ADR-1");
});

it("combines ids with null filters correctly", () => {
  handleWriteTool("changelog_insert", {
    entity_type: "adr", iteration_id: seed.iteration_id,
    revision_id: seed.revision_id,
    data: { id: "ADR-1", title: "Use REST", status: "accepted", decision: "REST", rationale: "R" }
  });
  handleWriteTool("changelog_insert", {
    entity_type: "adr", iteration_id: seed.iteration_id,
    revision_id: seed.revision_id,
    data: { id: "ADR-2", title: "Superseded", status: "superseded", decision: "X",
            rationale: "R", superseded_by: "ADR-1" }
  });
  const r = handleReadTool("changelog_query", {
    entity_type: "adr",
    ids: ["ADR-1", "ADR-2"],
    filters: { superseded_by: null }
  });
  assert.strictEqual(r.count, 1);
  assert.strictEqual(r.results[0].id, "ADR-1");
});
```

### Phase 2 tests (written with each Phase 2 batch)

Each batch (2a, 2b, 2c) includes tests for the enrichment it adds:
- Filter tests for the 16 complex entity types (same pattern as Phase 1)
- `include_related: true` tests verifying enriched child data is attached
- `include_related: false` (or omitted) tests verifying no enrichment

Representative example:
```js
it("queryPersona enriches with addressed requirements when include_related", () => {
  // insert persona + persona_addressed rows
  const r = handleReadTool("changelog_query", {
    entity_type: "persona", include_related: true
  });
  assert.ok(r.results[0].addressed_requirements);
});
```

### Run tests at every step

Every producer change must be followed by `node --test test/` before critic review. Test failures escalate to user.

---

## Execution Workflow

Execute via the **rigor-plugin-update skill** using its Producer-Critic Loop workflow. The MCP server auditor (`rigor_mcp_server_auditor`) serves as the critic for all changes (per `modes/mcp-server-audit.md`).

### Batching Strategy

- **Phase 1**: N:1 — all 21 simple query functions + `applyFilters` + `QUERY_DISPATCH` + `changelogQuery` refactor + tests for all 21 types + error handling tests, as one logical change
- **Phase 2**: N:1 per complexity tier (each batch includes its enrichment tests):
  - Batch 2a: Simple enrichment (persona, plan_overview, architecture_overview, persona_addressed, info_architecture, data_entity) — 6 functions + tests
  - Batch 2b: Medium enrichment (requirement, adr, component, screen, user_flow, plan_phase) — 6 functions + tests
  - Batch 2c: Deep enrichment (implementation_manifest, test_report, documentation_manifest, deployment_manifest) — 4 functions + tests
  - Delete `attachRelated` after all batches pass

---

## Documentation Updates

Update `INTERNALS.md` to reflect the rearchitecture. Sections that need rewriting:

- **§5a** ("Dynamic Query Building — `buildWhere` + `changelogQuery`"): Replace with description of `QUERY_DISPATCH`, `applyFilters`, and the per-entity query function pattern. Explain spec-key-only iteration for SQL safety.
- **§5b** ("N+1 Query Pattern — `attachRelated`"): Replace with description of how enrichment is now co-located in each `queryXxx` function via `include_related`.
- **§ "Adding a New Entity"** (step 3): Update instructions — instead of "add a case in `attachRelated`", it's now "add a `queryXxx` function with filter spec and optional enrichment, and register in `QUERY_DISPATCH`".
- **§ "Known Limitations"**: Remove the `attachRelated` N+1 batching note (still N+1, but now scoped per function rather than a monolithic switch).

Documentation updates should be included in the final Phase 2 work-unit (after `attachRelated` deletion), since that's when the old patterns are fully gone.

---

## Unchanged

- `traceabilityQuery`, `revisionHistory`, `iterationSummary`, `projectStatus` — untouched
- `history` mode in `changelogQuery` — already has its own code path, doesn't use `buildWhere`
- Tool schema — identical from LLM's perspective
- `write-tools.js` — already concrete, no changes needed
- `ENTITY_TABLE` and `TEXT_PK_TYPES` constants — retained, still used by history mode and other read tools
