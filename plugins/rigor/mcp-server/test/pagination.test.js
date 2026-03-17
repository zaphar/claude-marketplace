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

// Helper: insert N personas
function insertPersonas(n) {
  for (let i = 1; i <= n; i++) {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: `P-${String(i).padStart(3, "0")}`,
        name: `Persona ${i}`,
        description: `Description for persona ${i}`,
      },
    });
  }
}

// ───────────────────────────────────────────────────────────────
// Response envelope structure
// ───────────────────────────────────────────────────────────────

describe("changelog_query response envelope", () => {
  it("returns total, count, limit, offset, and results", () => {
    insertPersonas(3);
    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
    });
    assert.ok(Array.isArray(result.results), "results should be an array");
    assert.strictEqual(result.total, 3);
    assert.strictEqual(result.count, 3);
    assert.strictEqual(result.entity_type, "persona");
    assert.strictEqual(result.offset, 0);
    assert.strictEqual(result.limit, null);
  });

  it("returns empty results with correct envelope", () => {
    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
    });
    assert.strictEqual(result.total, 0);
    assert.strictEqual(result.count, 0);
    assert.deepStrictEqual(result.results, []);
  });
});

// ───────────────────────────────────────────────────────────────
// Limit parameter
// ───────────────────────────────────────────────────────────────

describe("changelog_query limit", () => {
  it("limits results when specified", () => {
    insertPersonas(10);
    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      limit: 3,
    });
    assert.strictEqual(result.count, 3);
    assert.strictEqual(result.total, 10);
    assert.strictEqual(result.limit, 3);
    assert.strictEqual(result.results.length, 3);
  });

  it("clamps limit to maximum of 100", () => {
    insertPersonas(5);
    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      limit: 200,
    });
    assert.strictEqual(result.limit, 100);
    assert.strictEqual(result.count, 5); // only 5 exist
  });

  it("clamps limit to minimum of 1", () => {
    insertPersonas(5);
    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      limit: 0,
    });
    assert.strictEqual(result.limit, 1);
    assert.strictEqual(result.count, 1);
  });

  it("clamps negative limit to 1", () => {
    insertPersonas(5);
    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      limit: -5,
    });
    assert.strictEqual(result.limit, 1);
    assert.strictEqual(result.count, 1);
  });

  it("ignores non-numeric limit", () => {
    insertPersonas(3);
    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      limit: "abc",
    });
    assert.strictEqual(result.limit, null);
    assert.strictEqual(result.count, 3);
  });
});

// ───────────────────────────────────────────────────────────────
// Offset parameter
// ───────────────────────────────────────────────────────────────

describe("changelog_query offset", () => {
  it("skips rows with offset", () => {
    insertPersonas(5);
    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      offset: 2,
    });
    assert.strictEqual(result.total, 5);
    assert.strictEqual(result.count, 3);
    assert.strictEqual(result.offset, 2);
    assert.strictEqual(result.results[0].id, "P-003");
  });

  it("clamps negative offset to 0", () => {
    insertPersonas(3);
    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      offset: -10,
    });
    assert.strictEqual(result.offset, 0);
    assert.strictEqual(result.count, 3);
  });

  it("returns empty when offset exceeds total", () => {
    insertPersonas(3);
    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      offset: 100,
    });
    assert.strictEqual(result.total, 3);
    assert.strictEqual(result.count, 0);
    assert.deepStrictEqual(result.results, []);
  });

  it("works with limit and offset together", () => {
    insertPersonas(10);
    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      limit: 3,
      offset: 5,
    });
    assert.strictEqual(result.total, 10);
    assert.strictEqual(result.count, 3);
    assert.strictEqual(result.limit, 3);
    assert.strictEqual(result.offset, 5);
    assert.strictEqual(result.results[0].id, "P-006");
    assert.strictEqual(result.results[2].id, "P-008");
  });

  it("returns partial page when offset + limit exceeds total", () => {
    insertPersonas(5);
    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      limit: 10,
      offset: 3,
    });
    assert.strictEqual(result.total, 5);
    assert.strictEqual(result.count, 2);
    assert.strictEqual(result.results[0].id, "P-004");
    assert.strictEqual(result.results[1].id, "P-005");
  });
});

// ───────────────────────────────────────────────────────────────
// Pagination loop termination: offset + count >= total
// ───────────────────────────────────────────────────────────────

describe("pagination loop pattern", () => {
  it("can paginate through all results", () => {
    insertPersonas(7);
    const allIds = [];
    let offset = 0;
    const limit = 3;

    while (true) {
      const page = handleReadTool("changelog_query", {
        project_root: "/tmp/test-project",
        entity_type: "persona",
        limit,
        offset,
      });
      allIds.push(...page.results.map((r) => r.id));
      if (offset + page.count >= page.total) break;
      offset += page.count;
    }

    assert.strictEqual(allIds.length, 7);
    assert.strictEqual(allIds[0], "P-001");
    assert.strictEqual(allIds[6], "P-007");
  });
});

// ───────────────────────────────────────────────────────────────
// Overflow guard (PAYLOAD_TOO_LARGE)
// ───────────────────────────────────────────────────────────────

describe("PAYLOAD_TOO_LARGE overflow guard", () => {
  // Helper: insert a requirement with a large acceptance_criteria blob
  function insertLargeRequirements(n, blobSize) {
    const bigBlob = JSON.stringify(
      Array.from({ length: blobSize }, (_, i) => ({
        criterion: `Acceptance criterion ${i} with some extra padding text to increase size`,
        testable: true,
      }))
    );
    for (let i = 1; i <= n; i++) {
      handleWriteTool("changelog_insert", {
        project_root: "/tmp/test-project",
        entity_type: "requirement",
        iteration_id: seed.iteration_id,
        revision_id: seed.revision_id,
        data: {
          id: `REQ-${String(i).padStart(3, "0")}`,
          description: `Requirement ${i}`,
          priority: "must-have",
          category: "functional",
          acceptance_criteria: JSON.parse(bigBlob),
        },
      });
    }
  }

  it("throws PAYLOAD_TOO_LARGE when response exceeds 50k chars", () => {
    // Each requirement with include_related has large acceptance_criteria
    // ~100 criteria * ~80 chars each = ~8k per row. 10 rows = ~80k > 50k threshold
    insertLargeRequirements(10, 100);
    try {
      handleReadTool("changelog_query", {
        project_root: "/tmp/test-project",
        entity_type: "requirement",
        include_related: true,
      });
      assert.fail("Expected PAYLOAD_TOO_LARGE error");
    } catch (err) {
      assert.strictEqual(err.code, "PAYLOAD_TOO_LARGE");
      assert.ok(err.details, "error should have details");
      assert.strictEqual(err.details.entity_type, "requirement");
      assert.strictEqual(err.details.total, 10);
      assert.ok(err.details.estimated_chars > 50_000);
      assert.ok(err.details.suggested_limit >= 1);
    }
  });

  it("also triggers for paginated queries that exceed threshold", () => {
    insertLargeRequirements(10, 100);
    // Even with limit:10, if the 10 rows exceed 50k, it should throw
    try {
      handleReadTool("changelog_query", {
        project_root: "/tmp/test-project",
        entity_type: "requirement",
        include_related: true,
        limit: 10,
      });
      assert.fail("Expected PAYLOAD_TOO_LARGE error");
    } catch (err) {
      assert.strictEqual(err.code, "PAYLOAD_TOO_LARGE");
    }
  });

  it("does not trigger when payload is under threshold", () => {
    insertPersonas(5);
    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
    });
    assert.ok(result.results, "should return results normally");
    assert.strictEqual(result.count, 5);
  });

  it("suggested_limit is at least 1", () => {
    // Insert one requirement with enormous acceptance_criteria
    insertLargeRequirements(1, 1000);
    try {
      handleReadTool("changelog_query", {
        project_root: "/tmp/test-project",
        entity_type: "requirement",
        include_related: true,
      });
      assert.fail("Expected PAYLOAD_TOO_LARGE error");
    } catch (err) {
      assert.strictEqual(err.code, "PAYLOAD_TOO_LARGE");
      assert.ok(err.details.suggested_limit >= 1);
    }
  });
});
