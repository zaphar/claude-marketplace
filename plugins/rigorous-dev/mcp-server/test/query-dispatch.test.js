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

// ───────────────────────────────────────────────────────────────
// Filter validation: unknown keys, SQL injection, null on non-nullable
// ───────────────────────────────────────────────────────────────

describe("applyFilters validation", () => {
  it("rejects unknown filter field", () => {
    assert.throws(
      () =>
        handleReadTool("changelog_query", {
          entity_type: "persona",
          filters: { nonexistent_column: "value" },
        }),
      { message: /Unknown filter "nonexistent_column" for persona/ }
    );
  });

  it("rejects SQL injection via filter key", () => {
    assert.throws(
      () =>
        handleReadTool("changelog_query", {
          entity_type: "persona",
          filters: { "1=1 --": null },
        }),
      { message: /Unknown filter "1=1 --" for persona/ }
    );
  });

  it("rejects null filter on non-nullable column", () => {
    assert.throws(
      () =>
        handleReadTool("changelog_query", {
          entity_type: "persona",
          filters: { name: null },
        }),
      { message: /does not accept null/ }
    );
  });

  it("accepts null filter on nullable column", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-1", name: "Dev", description: "Dev" },
    });
    // technical_level is nullable — filtering by null should work
    const r = handleReadTool("changelog_query", {
      entity_type: "persona",
      filters: { technical_level: null },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].id, "P-1");
  });
});

// ───────────────────────────────────────────────────────────────
// Per-function filter tests: 3 representative simple types
// ───────────────────────────────────────────────────────────────

describe("queryTechnologyChoice (INTEGER PK, simple)", () => {
  it("filters by category", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "technology_choice",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "runtime", name: "Node.js", purpose: "Server" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "technology_choice",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "database", name: "SQLite", purpose: "Storage" },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "technology_choice",
      filters: { category: "runtime" },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].name, "Node.js");
  });

  it("filters by nullable column with null value", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "technology_choice",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "runtime", name: "Node.js" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "technology_choice",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "runtime", name: "Deno", rationale: "Modern runtime" },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "technology_choice",
      filters: { rationale: null },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].name, "Node.js");
  });
});

describe("queryPlanCriticalPath (TEXT PK on plan_phase_id, no iteration_id)", () => {
  it("queries without iteration_id clause", () => {
    const ppResult = handleWriteTool("changelog_insert", {
      entity_type: "plan_phase",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "setup", type: "feature", goal: "Setup" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "plan_critical_path",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { plan_phase_id: ppResult.id, sequence_order: 1 },
    });
    // Query with iteration_id — should be ignored since table has no iteration_id column
    const r = handleReadTool("changelog_query", {
      entity_type: "plan_critical_path",
      iteration_id: seed.iteration_id,
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].sequence_order, 1);
  });

  it("filters by sequence_order", () => {
    const pp1 = handleWriteTool("changelog_insert", {
      entity_type: "plan_phase",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "phase-a", type: "feature", goal: "A" },
    });
    const pp2 = handleWriteTool("changelog_insert", {
      entity_type: "plan_phase",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 2, name: "phase-b", type: "feature", goal: "B" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "plan_critical_path",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { plan_phase_id: pp1.id, sequence_order: 1 },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "plan_critical_path",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { plan_phase_id: pp2.id, sequence_order: 2 },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "plan_critical_path",
      filters: { sequence_order: 2 },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].plan_phase_id, pp2.id);
  });
});

describe("queryBlocker (INTEGER PK, nullable filters)", () => {
  it("filters by severity", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "blocker",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_name: "requirements",
        description: "Missing stakeholder",
        severity: "critical",
        raised_by: "critic",
      },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "blocker",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_name: "requirements",
        description: "Minor formatting",
        severity: "minor",
        raised_by: "critic",
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "blocker",
      filters: { severity: "critical" },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].description, "Missing stakeholder");
  });

  it("filters by nullable resolved_at = null (unresolved blockers)", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "blocker",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_name: "requirements",
        description: "Unresolved",
        severity: "major",
        raised_by: "critic",
      },
    });
    // Insert a resolved blocker by using blocker_resolve
    const b2 = handleWriteTool("changelog_insert", {
      entity_type: "blocker",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_name: "requirements",
        description: "Resolved",
        severity: "minor",
        raised_by: "critic",
      },
    });
    handleWriteTool("blocker_resolve", {
      blocker_id: b2.id,
      resolution_notes: "Fixed",
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "blocker",
      filters: { resolved_at: null },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].description, "Unresolved");
  });
});

// ───────────────────────────────────────────────────────────────
// ids + filters combination tests
// ───────────────────────────────────────────────────────────────

describe("ids + filters combination", () => {
  it("combines ids with filters correctly", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "adr",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "ADR-1",
        title: "Use REST",
        status: "accepted",
        decision: "REST",
        rationale: "R",
      },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "adr",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "ADR-2",
        title: "Use GraphQL",
        status: "deprecated",
        decision: "GQL",
        rationale: "R",
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "adr",
      ids: ["ADR-1", "ADR-2"],
      filters: { status: "accepted" },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].id, "ADR-1");
  });

  it("combines ids with null filters correctly", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "adr",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "ADR-1",
        title: "Use REST",
        status: "accepted",
        decision: "REST",
        rationale: "R",
      },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "adr",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "ADR-2",
        title: "Superseded",
        status: "superseded",
        decision: "X",
        rationale: "R",
        superseded_by: "ADR-1",
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "adr",
      ids: ["ADR-1", "ADR-2"],
      filters: { superseded_by: null },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].id, "ADR-1");
  });
});
