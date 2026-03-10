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
// queryRequirement enrichment
// ───────────────────────────────────────────────────────────────

describe("queryRequirement enrichment", () => {
  it("attaches acceptance_criteria, personas, and depends_on when include_related is true", () => {
    // Create prerequisite persona
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-1", name: "Dev", description: "Developer" },
    });
    // Create dependency requirement
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-DEP", description: "Dependency", priority: "must-have", category: "functional" },
    });
    // Create main requirement with acceptance criteria, persona links, and dependency
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "REQ-1",
        description: "User login",
        priority: "must-have",
        category: "functional",
        acceptance_criteria: ["User can log in with email", "Session persists across refreshes"],
        personas: ["P-1"],
        depends_on: ["REQ-DEP"],
      },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      ids: ["REQ-1"],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const req = r.results[0];

    // Acceptance criteria — parsed from JSON
    assert.deepStrictEqual(req.acceptance_criteria, [
      "User can log in with email",
      "Session persists across refreshes",
    ]);

    // Personas — mapped to persona_id string array
    assert.deepStrictEqual(req.personas, ["P-1"]);

    // Dependencies — mapped to depends_on string array
    assert.deepStrictEqual(req.depends_on, ["REQ-DEP"]);
  });

  it("does not attach child data when include_related is false", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "REQ-NOENRICH",
        description: "No enrichment",
        priority: "should-have",
        category: "functional",
        acceptance_criteria: ["Something"],
        personas: [],
      },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      ids: ["REQ-NOENRICH"],
    });
    assert.strictEqual(r.count, 1);
    // Without include_related, acceptance_criteria should be raw JSON string
    assert.strictEqual(typeof r.results[0].acceptance_criteria, "string");
    assert.strictEqual(r.results[0].personas, undefined);
    assert.strictEqual(r.results[0].depends_on, undefined);
  });

  it("returns empty arrays for requirement with no personas or dependencies", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-EMPTY", description: "Bare", priority: "nice-to-have", category: "functional" },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      ids: ["REQ-EMPTY"],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    assert.deepStrictEqual(r.results[0].acceptance_criteria, []);
    assert.deepStrictEqual(r.results[0].personas, []);
    assert.deepStrictEqual(r.results[0].depends_on, []);
  });
});

// ───────────────────────────────────────────────────────────────
// queryAdr enrichment
// ───────────────────────────────────────────────────────────────

describe("queryAdr enrichment", () => {
  it("attaches alternatives with pros/cons, consequences, and research_sources when include_related is true", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "adr",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "ADR-1",
        title: "Use PostgreSQL",
        decision: "Use PostgreSQL for data storage",
        rationale: "Battle-tested relational DB",
        consequences: ["Need DBA expertise", "Migration from SQLite"],
        research_sources: ["https://postgresql.org", "internal-benchmarks"],
        alternatives_considered: [
          { option_text: "MongoDB", pros: ["Flexible schema"], cons: ["No ACID by default"] },
          { option_text: "SQLite", pros: ["Simple"], cons: ["No concurrent writes", "Single file"] },
        ],
      },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "adr",
      ids: ["ADR-1"],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const adr = r.results[0];

    // Alternatives — from adr_alternative table with parsed pros/cons
    assert.strictEqual(adr.alternatives.length, 2);
    const mongo = adr.alternatives.find((a) => a.option_text === "MongoDB");
    assert.deepStrictEqual(mongo.pros, ["Flexible schema"]);
    assert.deepStrictEqual(mongo.cons, ["No ACID by default"]);
    assert.ok(mongo.id); // has autoincrement id
    assert.strictEqual(mongo.adr_id, "ADR-1");
    const sqlite = adr.alternatives.find((a) => a.option_text === "SQLite");
    assert.deepStrictEqual(sqlite.cons, ["No concurrent writes", "Single file"]);

    // Consequences — parsed from JSON
    assert.deepStrictEqual(adr.consequences, ["Need DBA expertise", "Migration from SQLite"]);

    // Research sources — parsed from JSON
    assert.deepStrictEqual(adr.research_sources, ["https://postgresql.org", "internal-benchmarks"]);
  });

  it("does not attach child data when include_related is false", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "adr",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "ADR-NOENRICH",
        title: "No Enrichment",
        decision: "Just testing",
        rationale: "Verification",
        consequences: ["Something"],
        alternatives_considered: [{ option_text: "Alt" }],
      },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "adr",
      ids: ["ADR-NOENRICH"],
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].alternatives, undefined);
    // consequences should be raw JSON string
    assert.strictEqual(typeof r.results[0].consequences, "string");
    assert.strictEqual(typeof r.results[0].research_sources, "string");
  });

  it("returns empty arrays for ADR with no alternatives or consequences", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "adr",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "ADR-EMPTY", title: "Bare", decision: "Nothing", rationale: "Testing" },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "adr",
      ids: ["ADR-EMPTY"],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    assert.deepStrictEqual(r.results[0].alternatives, []);
    assert.deepStrictEqual(r.results[0].consequences, []);
    assert.deepStrictEqual(r.results[0].research_sources, []);
  });
});

// queryScreen enrichment — screen_state and screen_responsive_variant tables dropped
// queryTestReport enrichment — child tables (test_suite, test_case, etc.) dropped
// queryDocumentationManifest enrichment — entity type removed entirely
