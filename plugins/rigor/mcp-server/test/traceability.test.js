import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshDb, seedIteration } from "./helpers.js";
import { handleReadTool } from "../read-tools.js";

let db, seed;

beforeEach(() => {
  db = freshDb();
  seed = seedIteration(db);
});

// ───────────────────────────────────────────────────────────────
// traceability_query: empty chain for non-existent entities
// ───────────────────────────────────────────────────────────────

describe("traceability_query empty chain", () => {
  it("returns empty chain for non-existent component", () => {
    const r = handleReadTool("traceability_query", {
      project_root: "/tmp/test-project",
      target: "NONEXISTENT-999",
      target_type: "component",
      iteration_id: seed.iteration_id,
    });
    assert.strictEqual(r.target, "NONEXISTENT-999");
    assert.strictEqual(r.target_type, "component");
    assert.deepStrictEqual(r.chain, []);
  });

  it("returns empty chain for non-existent technology", () => {
    const r = handleReadTool("traceability_query", {
      project_root: "/tmp/test-project",
      target: "NONEXISTENT-TECH",
      target_type: "technology",
      iteration_id: seed.iteration_id,
    });
    assert.strictEqual(r.target, "NONEXISTENT-TECH");
    assert.strictEqual(r.target_type, "technology");
    assert.deepStrictEqual(r.chain, []);
  });

  it("returns empty chain for non-existent requirement", () => {
    const r = handleReadTool("traceability_query", {
      project_root: "/tmp/test-project",
      target: "REQ-NONEXISTENT-999",
      target_type: "requirement",
      iteration_id: seed.iteration_id,
    });
    assert.strictEqual(r.target, "REQ-NONEXISTENT-999");
    assert.strictEqual(r.target_type, "requirement");
    assert.deepStrictEqual(r.chain, []);
  });

  it("returns empty chain for non-existent ADR", () => {
    const r = handleReadTool("traceability_query", {
      project_root: "/tmp/test-project",
      target: "ADR-NONEXISTENT-999",
      target_type: "adr",
      iteration_id: seed.iteration_id,
    });
    assert.strictEqual(r.target, "ADR-NONEXISTENT-999");
    assert.strictEqual(r.target_type, "adr");
    assert.deepStrictEqual(r.chain, []);
  });

  it("returns empty chain for non-existent flow", () => {
    const r = handleReadTool("traceability_query", {
      project_root: "/tmp/test-project",
      target: "FLOW-NONEXISTENT-999",
      target_type: "flow",
      iteration_id: seed.iteration_id,
    });
    assert.strictEqual(r.target, "FLOW-NONEXISTENT-999");
    assert.strictEqual(r.target_type, "flow");
    assert.deepStrictEqual(r.chain, []);
  });

  it("returns empty chain for non-existent screen", () => {
    const r = handleReadTool("traceability_query", {
      project_root: "/tmp/test-project",
      target: "SCR-NONEXISTENT-999",
      target_type: "screen",
      iteration_id: seed.iteration_id,
    });
    assert.strictEqual(r.target, "SCR-NONEXISTENT-999");
    assert.strictEqual(r.target_type, "screen");
    assert.deepStrictEqual(r.chain, []);
  });

  it("returns empty chain without iteration_id filter", () => {
    const r = handleReadTool("traceability_query", {
      project_root: "/tmp/test-project",
      target: "NONEXISTENT-999",
      target_type: "component",
    });
    assert.strictEqual(r.target, "NONEXISTENT-999");
    assert.strictEqual(r.target_type, "component");
    assert.deepStrictEqual(r.chain, []);
  });
});
