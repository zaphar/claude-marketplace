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

// All 6 TEXT-PK types use snapshotIfExists + ON CONFLICT DO UPDATE.
// This file verifies the upsert + snapshot behavior for each.

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

  // Verify snapshot was created with v1 data
  const snapshots = db.prepare(
    "SELECT * FROM entity_snapshot WHERE entity_type = ? AND source_id = ?"
  ).all(entityType, v1Data.id);
  assert.strictEqual(snapshots.length, 1);
  const snapshotData = JSON.parse(snapshots[0].snapshot);
  assert.strictEqual(snapshotData[checkField], v1Data[checkField]);

  // Verify history:true returns the snapshot
  const history = handleReadTool("changelog_query", {
    entity_type: entityType,
    ids: [v1Data.id],
    history: true,
  });
  assert.ok(history.results.length >= 1);
  assert.ok(history.results[0].snapshot);

  return { current, snapshots };
}

describe("persona upsert + snapshot", () => {
  it("snapshots old row, updates to new data", () => {
    upsertTest(
      "persona",
      { id: "P-1", name: "Developer v1", description: "Original" },
      { id: "P-1", name: "Developer v2", description: "Updated" },
      "name"
    );
  });
});

describe("requirement upsert + snapshot", () => {
  it("snapshots old row, cleans up child rows", () => {
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

describe("adr upsert + snapshot", () => {
  it("snapshots old row, replaces alternatives", () => {
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

describe("component upsert + snapshot", () => {
  it("snapshots old row, replaces children", () => {
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

describe("user_flow upsert + snapshot", () => {
  it("snapshots old row, replaces steps and error states", () => {
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

describe("screen upsert + snapshot", () => {
  it("snapshots old row, replaces states and variants", () => {
    upsertTest(
      "screen",
      {
        id: "scr-1", name: "v1", purpose: "Original",
        states: [{ name: "loading" }],
        responsive_variants: [{ breakpoint: "mobile" }],
      },
      {
        id: "scr-1", name: "v2", purpose: "Updated",
        states: [{ name: "empty" }, { name: "loaded" }],
        responsive_variants: [],
      },
      "name"
    );

    const states = db.prepare("SELECT * FROM screen_state WHERE screen_id = 'scr-1'").all();
    assert.strictEqual(states.length, 2);
    const variants = db.prepare("SELECT * FROM screen_responsive_variant WHERE screen_id = 'scr-1'").all();
    assert.strictEqual(variants.length, 0);
  });
});

describe("multiple upserts accumulate snapshots", () => {
  it("creates a snapshot for each overwrite", () => {
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

    const snapshots = db.prepare(
      "SELECT * FROM entity_snapshot WHERE entity_type = 'persona' AND source_id = 'P-1' ORDER BY id"
    ).all();
    // v1→v2 creates snapshot of v1, v2→v3 creates snapshot of v2 = 2 snapshots
    assert.strictEqual(snapshots.length, 2);
    assert.strictEqual(JSON.parse(snapshots[0].snapshot).name, "v1");
    assert.strictEqual(JSON.parse(snapshots[1].snapshot).name, "v2");
  });
});
