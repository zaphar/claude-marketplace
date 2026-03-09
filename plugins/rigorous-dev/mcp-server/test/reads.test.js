import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshDb, seedIteration, getPhaseId, seedRevision } from "./helpers.js";
import { handleWriteTool } from "../write-tools.js";
import { handleReadTool } from "../read-tools.js";

let db, seed;

beforeEach(() => {
  db = freshDb();
  seed = seedIteration(db);
});

// ───────────────────────────────────────────────────────────────
// changelog_query: filters, ids, include_related
// ───────────────────────────────────────────────────────────────

describe("changelog_query", () => {
  it("filters by iteration_id", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-1", name: "Dev", description: "Dev" },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "persona",
      iteration_id: seed.iteration_id,
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].id, "P-1");
  });

  it("queries by ids", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-1", name: "Dev", description: "Dev" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-2", name: "PM", description: "PM" },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "persona",
      ids: ["P-2"],
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].id, "P-2");
  });

  it("applies field filters", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-1", description: "A", priority: "must-have", category: "functional" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-2", description: "B", priority: "nice-to-have", category: "functional" },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "requirement",
      filters: { priority: "must-have" },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].id, "REQ-1");
  });

  it("enriches with include_related", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "component",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "comp-1", name: "API", purpose: "REST", type: "service",
        interfaces: [{ name: "login", type: "rest" }],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "component",
      ids: ["comp-1"],
      include_related: true,
    });
    assert.ok(r.results[0].interfaces);
    assert.strictEqual(r.results[0].interfaces.length, 1);
  });

  it("returns history snapshots", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-1", name: "v1", description: "d" },
    });
    // Create v2 to trigger snapshot
    const rev2 = db.prepare(
      "INSERT INTO revision (phase_id, producer_agent, created_at, status) VALUES (?, 'test', datetime('now'), 'draft')"
    ).run(seed.phase_id);
    handleWriteTool("changelog_insert", {
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: Number(rev2.lastInsertRowid),
      data: { id: "P-1", name: "v2", description: "d" },
    });

    const r = handleReadTool("changelog_query", {
      entity_type: "persona",
      ids: ["P-1"],
      history: true,
    });
    assert.ok(r.history);
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].snapshot.name, "v1");
  });

  it("rejects unknown entity_type", () => {
    assert.throws(
      () => handleReadTool("changelog_query", { entity_type: "unknown_thing" }),
      /Unknown entity_type/
    );
  });
});

// ───────────────────────────────────────────────────────────────
// traceability_query: all 6 target types
// ───────────────────────────────────────────────────────────────

describe("traceability_query", () => {
  // Seed data shared by multiple traceability tests
  function seedTraceabilityData() {
    handleWriteTool("changelog_insert", {
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-1", name: "Dev", description: "Developer" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "REQ-1", description: "Auth", priority: "must-have", category: "functional",
        acceptance_criteria: ["Login works"],
      },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "adr",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "ADR-1", title: "Use JWT", decision: "Use JWT for auth",
        rationale: "Industry standard",
        alternatives_considered: [{ option_text: "Session cookies" }],
      },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "component",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "auth-svc", name: "Auth Service", purpose: "Authentication", type: "service",
        requirements_addressed: ["REQ-1"],
      },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "approved_dependency",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { package: "jsonwebtoken", purpose: "JWT token auth", justification: "Industry standard JWT library", adr_id: "ADR-1" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "screen",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "login-scr", name: "Login", purpose: "Authentication screen" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "user_flow",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "login-flow", name: "Login Flow", goal: "Authenticate",
        steps: [{ step_number: 1, action: "Enter creds", surface: "Login" }],
        requirements_addressed: ["REQ-1"],
      },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "project_context",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { key: "language", value: "TypeScript", category: "tech" },
    });
  }

  it("traces component → requirements → ADRs", () => {
    seedTraceabilityData();
    const r = handleReadTool("traceability_query", {
      target: "auth-svc",
      target_type: "component",
      iteration_id: seed.iteration_id,
    });
    assert.ok(r.chain.length >= 1);
    assert.strictEqual(r.chain[0].type, "component");
    const reqChain = r.chain.find((c) => c.type === "requirements_addressed");
    assert.ok(reqChain, "Should have requirements_addressed in chain");
  });

  it("traces technology → ADRs", () => {
    seedTraceabilityData();
    const r = handleReadTool("traceability_query", {
      target: "JWT",
      target_type: "technology",
      iteration_id: seed.iteration_id,
    });
    assert.ok(r.chain.length >= 1);
    assert.strictEqual(r.chain[0].type, "related_adrs");
    const adrChain = r.chain.find((c) => c.type === "related_adrs");
    assert.ok(adrChain, "Should find ADRs mentioning JWT");
  });

  it("traces requirement → components", () => {
    seedTraceabilityData();
    const r = handleReadTool("traceability_query", {
      target: "REQ-1",
      target_type: "requirement",
      iteration_id: seed.iteration_id,
    });
    assert.strictEqual(r.chain[0].type, "requirement");
    const implComps = r.chain.find((c) => c.type === "implementing_components");
    assert.ok(implComps, "Should find implementing components");
  });

  it("traces adr → alternatives → components", () => {
    seedTraceabilityData();
    const r = handleReadTool("traceability_query", {
      target: "ADR-1",
      target_type: "adr",
      iteration_id: seed.iteration_id,
    });
    assert.strictEqual(r.chain[0].type, "adr");
    const alts = r.chain.find((c) => c.type === "alternatives");
    assert.ok(alts, "Should have alternatives");
  });

  it("traces flow → steps → screens → requirements", () => {
    seedTraceabilityData();
    const r = handleReadTool("traceability_query", {
      target: "login-flow",
      target_type: "flow",
      iteration_id: seed.iteration_id,
    });
    assert.strictEqual(r.chain[0].type, "user_flow");
    const stepsChain = r.chain.find((c) => c.type === "steps");
    assert.ok(stepsChain, "Should have steps");
  });

  it("traces screen → flows → requirements", () => {
    seedTraceabilityData();
    const r = handleReadTool("traceability_query", {
      target: "login-scr",
      target_type: "screen",
      iteration_id: seed.iteration_id,
    });
    assert.strictEqual(r.chain[0].type, "screen");
    const flowsChain = r.chain.find((c) => c.type === "flows_referencing_screen");
    assert.ok(flowsChain, "Should find flows referencing screen");
  });

  it("rejects unknown target_type", () => {
    assert.throws(
      () => handleReadTool("traceability_query", {
        target: "x", target_type: "invalid_type",
      }),
      /Unknown target_type/
    );
  });
});

// ───────────────────────────────────────────────────────────────
// revision_history
// ───────────────────────────────────────────────────────────────

describe("revision_history", () => {
  it("returns revisions for a phase by id", () => {
    const r = handleReadTool("revision_history", { phase_id: seed.phase_id });
    assert.ok(r.phase);
    assert.strictEqual(r.revisions.length, 1);
    assert.strictEqual(r.revisions[0].producer_agent, "test-producer");
  });

  it("resolves by iteration_id + phase_name", () => {
    const r = handleReadTool("revision_history", {
      iteration_id: seed.iteration_id,
      phase_name: "requirements",
    });
    assert.ok(r.phase);
    assert.strictEqual(r.revisions.length, 1);
  });

  it("shows multiple revisions", () => {
    seedRevision(db, seed.phase_id);
    seedRevision(db, seed.phase_id);
    const r = handleReadTool("revision_history", { phase_id: seed.phase_id });
    assert.strictEqual(r.revisions.length, 3);
  });
});

// ───────────────────────────────────────────────────────────────
// iteration_summary
// ───────────────────────────────────────────────────────────────

describe("iteration_summary", () => {
  it("returns iteration with phases and entity counts", () => {
    // Insert some entities
    handleWriteTool("changelog_insert", {
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-1", name: "Dev", description: "Dev" },
    });
    const r = handleReadTool("iteration_summary", { iteration_id: seed.iteration_id });
    assert.ok(r.iteration);
    assert.strictEqual(r.phases.length, 8);
    assert.ok(r.decisions);
    assert.strictEqual(r.decisions.requirements, 0);  // none inserted in this test
  });
});

// ───────────────────────────────────────────────────────────────
// project_status
// ───────────────────────────────────────────────────────────────

describe("project_status", () => {
  it("returns project, current iteration, phases", () => {
    const r = handleReadTool("project_status", {});
    assert.ok(r.project);
    assert.strictEqual(r.project.project_name, "test-project");
    assert.strictEqual(r.phases.length, 8);
    assert.ok(r.current_iteration);
  });
});
