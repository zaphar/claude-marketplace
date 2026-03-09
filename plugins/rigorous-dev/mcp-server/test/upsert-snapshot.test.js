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

// entity_snapshot table dropped. Upsert still works via existsForUpsert.
// These tests verify upsert behavior (ON CONFLICT DO UPDATE) without snapshot assertions.

function upsertTest(entityType, v1Data, v2Data, checkField) {
  // Insert v1
  const r1 = handleWriteTool("changelog_insert", {
    entity_type: entityType,
    iteration_id: seed.iteration_id,
    revision_id: seed.revision_id,
    data: v1Data,
  });
  assert.strictEqual(r1.updated, false);

  // Create a new revision for v2
  const now = new Date().toISOString();
  const rev2 = db.prepare(
    "INSERT INTO revision (phase_id, producer_agent, created_at, status) VALUES (?, 'test', ?, 'draft')"
  ).run(seed.phase_id, now);
  const revision2 = Number(rev2.lastInsertRowid);

  // Insert v2 (upsert)
  const r2 = handleWriteTool("changelog_insert", {
    entity_type: entityType,
    iteration_id: seed.iteration_id,
    revision_id: revision2,
    data: v2Data,
  });
  assert.strictEqual(r2.updated, true);

  // Verify current row has v2 data
  const current = handleReadTool("changelog_query", {
    entity_type: entityType,
    ids: [v1Data.id],
  });
  assert.strictEqual(current.results[0][checkField], v2Data[checkField]);

  return { current };
}

describe("persona upsert", () => {
  it("updates to new data on conflict", () => {
    upsertTest(
      "persona",
      { id: "P-1", name: "Developer v1", description: "Original" },
      { id: "P-1", name: "Developer v2", description: "Updated" },
      "name"
    );
  });
});

describe("requirement upsert", () => {
  it("updates and cleans up child rows on conflict", () => {
    const { current } = upsertTest(
      "requirement",
      {
        id: "REQ-1", description: "v1", priority: "must-have",
        category: "functional", personas: [],
      },
      {
        id: "REQ-1", description: "v2", priority: "should-have",
        category: "functional", personas: [],
      },
      "description"
    );
    assert.strictEqual(current.results[0].priority, "should-have");
  });
});

describe("adr upsert", () => {
  it("replaces alternatives on conflict", () => {
    upsertTest(
      "adr",
      {
        id: "ADR-1", title: "v1", decision: "Use X", rationale: "Because",
        alternatives_considered: [{ option_text: "Y" }],
      },
      {
        id: "ADR-1", title: "v2", decision: "Use Z", rationale: "Better",
        alternatives_considered: [{ option_text: "W" }],
      },
      "title"
    );

    // Verify old alternatives were deleted and new ones inserted
    const alts = db.prepare("SELECT * FROM adr_alternative WHERE adr_id = 'ADR-1'").all();
    assert.strictEqual(alts.length, 1);
    assert.strictEqual(alts[0].option_text, "W");
  });
});

describe("component upsert", () => {
  it("replaces children on conflict", () => {
    upsertTest(
      "component",
      {
        id: "comp-1", name: "v1", purpose: "Original", type: "service",
        interfaces: [{ name: "api-v1", type: "rest" }],
      },
      {
        id: "comp-1", name: "v2", purpose: "Updated", type: "service",
        interfaces: [{ name: "api-v2", type: "grpc" }],
      },
      "name"
    );

    // Verify old interfaces were replaced
    const ifaces = db.prepare("SELECT * FROM component_interface WHERE component_id = 'comp-1'").all();
    assert.strictEqual(ifaces.length, 1);
    assert.strictEqual(ifaces[0].name, "api-v2");
  });
});

describe("user_flow upsert", () => {
  it("replaces steps and error states on conflict", () => {
    upsertTest(
      "user_flow",
      {
        id: "flow-1", name: "v1", goal: "Original",
        steps: [{ step_number: 1, action: "Step A" }],
        error_states: [{ condition: "error-1", recovery: "retry" }],
      },
      {
        id: "flow-1", name: "v2", goal: "Updated",
        steps: [{ step_number: 1, action: "Step B" }, { step_number: 2, action: "Step C" }],
        error_states: [],
      },
      "name"
    );

    const steps = db.prepare("SELECT * FROM user_flow_step WHERE flow_id = 'flow-1'").all();
    assert.strictEqual(steps.length, 2);
    const errors = db.prepare("SELECT * FROM user_flow_error_state WHERE flow_id = 'flow-1'").all();
    assert.strictEqual(errors.length, 0);
  });
});

describe("screen upsert", () => {
  it("updates screen data on conflict", () => {
    upsertTest(
      "screen",
      {
        id: "scr-1", name: "v1", purpose: "Original",
      },
      {
        id: "scr-1", name: "v2", purpose: "Updated",
      },
      "name"
    );
  });
});

describe("multiple upserts work correctly", () => {
  it("each overwrite updates the row", () => {
    const base = { id: "P-1", description: "d" };
    for (let i = 1; i <= 3; i++) {
      const now = new Date().toISOString();
      const rev = db.prepare(
        "INSERT INTO revision (phase_id, producer_agent, created_at, status) VALUES (?, 'test', ?, 'draft')"
      ).run(seed.phase_id, now);
      handleWriteTool("changelog_insert", {
        entity_type: "persona",
        iteration_id: seed.iteration_id,
        revision_id: i === 1 ? seed.revision_id : Number(rev.lastInsertRowid),
        data: { ...base, name: `v${i}` },
      });
    }

    // Verify current row has the latest data
    const current = handleReadTool("changelog_query", {
      entity_type: "persona",
      ids: ["P-1"],
    });
    assert.strictEqual(current.results[0].name, "v3");
  });
});
