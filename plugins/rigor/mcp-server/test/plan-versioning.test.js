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

// Helper: insert a work_item and return its id
function insertWorkItem(overrides = {}) {
  const result = handleWriteTool("changelog_insert", {
    project_root: "/tmp/test-project",
    entity_type: "work_item",
    iteration_id: seed.iteration_id,
    revision_id: seed.revision_id,
    data: {
      phase_number: 1,
      work_type: "feature",
      goal: "Default goal",
      ...overrides,
    },
  });
  return result.id;
}

// ───────────────────────────────────────────────────────────────
// work_item_transition to superseded
// ───────────────────────────────────────────────────────────────

describe("work_item_transition to superseded", () => {
  it("sets status and superseded_at", () => {
    const wiId = insertWorkItem({ name: "to-supersede" });

    const result = handleWriteTool("work_item_transition", {
      project_root: "/tmp/test-project",
      work_item_id: wiId,
      status: "superseded",
    });
    assert.strictEqual(result.status, "superseded");

    const row = db
      .prepare("SELECT status, superseded_at FROM work_item WHERE id = ?")
      .get(wiId);
    assert.strictEqual(row.status, "superseded");
    assert.ok(row.superseded_at, "superseded_at should be set");
  });
});

// ───────────────────────────────────────────────────────────────
// Guard: cannot supersede a completed work item
// ───────────────────────────────────────────────────────────────

describe("guard: cannot supersede completed work item", () => {
  it("throws when attempting to supersede a completed work item", () => {
    const wiId = insertWorkItem({ name: "complete-then-supersede" });

    // Transition through: pending → test_writing → implementing → completed
    for (const status of ["test_writing", "implementing", "completed"]) {
      handleWriteTool("work_item_transition", {
        project_root: "/tmp/test-project",
        work_item_id: wiId,
        status,
      });
    }

    assert.throws(
      () =>
        handleWriteTool("work_item_transition", {
          project_root: "/tmp/test-project",
          work_item_id: wiId,
          status: "superseded",
        }),
      /Cannot supersede completed/
    );
  });
});

// ───────────────────────────────────────────────────────────────
// Guard: superseded is terminal
// ───────────────────────────────────────────────────────────────

describe("guard: superseded is terminal", () => {
  it("throws when attempting to transition from superseded", () => {
    const wiId = insertWorkItem({ name: "superseded-terminal" });

    handleWriteTool("work_item_transition", {
      project_root: "/tmp/test-project",
      work_item_id: wiId,
      status: "superseded",
    });

    assert.throws(
      () =>
        handleWriteTool("work_item_transition", {
          project_root: "/tmp/test-project",
          work_item_id: wiId,
          status: "pending",
        }),
      /superseded is terminal/
    );
  });
});

// ───────────────────────────────────────────────────────────────
// changelog_insert with plan_version
// ───────────────────────────────────────────────────────────────

describe("changelog_insert with plan_version", () => {
  it("stores explicit plan_version", () => {
    const wiId = insertWorkItem({ name: "versioned-wi", plan_version: 2 });

    const row = db
      .prepare("SELECT plan_version FROM work_item WHERE id = ?")
      .get(wiId);
    assert.strictEqual(row.plan_version, 2);
  });

  it("defaults plan_version to 1", () => {
    const wiId = insertWorkItem({ name: "default-version-wi" });

    const row = db
      .prepare("SELECT plan_version FROM work_item WHERE id = ?")
      .get(wiId);
    assert.strictEqual(row.plan_version, 1);
  });
});

// ───────────────────────────────────────────────────────────────
// UNIQUE constraint allows same name across plan versions
// ───────────────────────────────────────────────────────────────

describe("UNIQUE constraint allows same name across plan versions", () => {
  it("creates two work items with same name but different plan_version", () => {
    insertWorkItem({ name: "auth-module", plan_version: 1 });
    insertWorkItem({ name: "auth-module", plan_version: 2 });

    const rows = db
      .prepare(
        "SELECT id, plan_version FROM work_item WHERE iteration_id = ? AND name = 'auth-module' ORDER BY plan_version"
      )
      .all(seed.iteration_id);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].plan_version, 1);
    assert.strictEqual(rows[1].plan_version, 2);
  });
});

// ───────────────────────────────────────────────────────────────
// UNIQUE constraint rejects same name within same plan version
// ───────────────────────────────────────────────────────────────

describe("UNIQUE constraint rejects same name within same plan version", () => {
  it("throws on duplicate name + plan_version", () => {
    insertWorkItem({ name: "auth-module", plan_version: 1 });

    assert.throws(
      () => insertWorkItem({ name: "auth-module", plan_version: 1 }),
      /UNIQUE constraint/
    );
  });
});

// ───────────────────────────────────────────────────────────────
// plan_overview with plan_version
// ───────────────────────────────────────────────────────────────

describe("plan_overview with plan_version", () => {
  it("creates plan_overview entries with different plan_versions", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "plan_overview",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        strategy: "Incremental v1",
        rationale: "Low risk",
        plan_version: 1,
      },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "plan_overview",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        strategy: "Incremental v2",
        rationale: "Revised",
        plan_version: 2,
      },
    });

    const rows = db
      .prepare(
        "SELECT plan_version, strategy FROM plan_overview WHERE iteration_id = ? ORDER BY plan_version"
      )
      .all(seed.iteration_id);
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].plan_version, 1);
    assert.strictEqual(rows[1].plan_version, 2);
  });
});

// ───────────────────────────────────────────────────────────────
// changelog_query superseded filter (false — active only)
// ───────────────────────────────────────────────────────────────

describe("changelog_query superseded filter (active only)", () => {
  it("excludes superseded work items when superseded=false", () => {
    insertWorkItem({ name: "WI-A" });
    const bId = insertWorkItem({ name: "WI-B" });
    insertWorkItem({ name: "WI-C" });

    handleWriteTool("work_item_transition", {
      project_root: "/tmp/test-project",
      work_item_id: bId,
      status: "superseded",
    });

    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      filters: { superseded: false },
    });

    const names = result.results.map((r) => r.name);
    assert.ok(names.includes("WI-A"), "WI-A should be present");
    assert.ok(!names.includes("WI-B"), "WI-B should be excluded (superseded)");
    assert.ok(names.includes("WI-C"), "WI-C should be present");
  });
});

// ───────────────────────────────────────────────────────────────
// changelog_query superseded filter (true — superseded only)
// ───────────────────────────────────────────────────────────────

describe("changelog_query superseded filter (superseded only)", () => {
  it("returns only superseded work items when superseded=true", () => {
    insertWorkItem({ name: "WI-A" });
    const bId = insertWorkItem({ name: "WI-B" });
    insertWorkItem({ name: "WI-C" });

    handleWriteTool("work_item_transition", {
      project_root: "/tmp/test-project",
      work_item_id: bId,
      status: "superseded",
    });

    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      filters: { superseded: true },
    });

    const names = result.results.map((r) => r.name);
    assert.strictEqual(names.length, 1);
    assert.ok(names.includes("WI-B"), "Only WI-B should be returned");
  });
});

// ───────────────────────────────────────────────────────────────
// changelog_query status_not filter
// ───────────────────────────────────────────────────────────────

describe("changelog_query status_not filter", () => {
  it("excludes work items with the specified status", () => {
    insertWorkItem({ name: "WI-pending-1" });
    const completedId = insertWorkItem({ name: "WI-completed" });
    insertWorkItem({ name: "WI-pending-2" });

    // Complete one: pending → test_writing → implementing → completed
    for (const status of ["test_writing", "implementing", "completed"]) {
      handleWriteTool("work_item_transition", {
        project_root: "/tmp/test-project",
        work_item_id: completedId,
        status,
      });
    }

    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      filters: { superseded: false, status_not: "completed" },
    });

    const names = result.results.map((r) => r.name);
    assert.ok(names.includes("WI-pending-1"), "WI-pending-1 should be present");
    assert.ok(names.includes("WI-pending-2"), "WI-pending-2 should be present");
    assert.ok(
      !names.includes("WI-completed"),
      "WI-completed should be excluded"
    );
  });
});

// ───────────────────────────────────────────────────────────────
// changelog_query plan_version filter
// ───────────────────────────────────────────────────────────────

describe("changelog_query plan_version filter", () => {
  it("returns only work items matching the specified plan_version", () => {
    insertWorkItem({ name: "v1-item-a", plan_version: 1 });
    insertWorkItem({ name: "v2-item-a", plan_version: 2 });
    insertWorkItem({ name: "v2-item-b", plan_version: 2 });

    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      filters: { plan_version: 2 },
    });

    const names = result.results.map((r) => r.name);
    assert.strictEqual(names.length, 2);
    assert.ok(names.includes("v2-item-a"));
    assert.ok(names.includes("v2-item-b"));
  });
});

// ───────────────────────────────────────────────────────────────
// plan_overview total_phases excludes superseded WIs
// ───────────────────────────────────────────────────────────────

describe("plan_overview total_phases excludes superseded WIs", () => {
  it("counts only non-superseded work items", () => {
    insertWorkItem({ name: "wi-1" });
    insertWorkItem({ name: "wi-2" });
    const supersededId = insertWorkItem({ name: "wi-3" });

    handleWriteTool("work_item_transition", {
      project_root: "/tmp/test-project",
      work_item_id: supersededId,
      status: "superseded",
    });

    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "plan_overview",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { strategy: "Test strategy", rationale: "Test rationale" },
    });

    const result = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "plan_overview",
      iteration_id: seed.iteration_id,
      include_related: true,
    });

    assert.strictEqual(result.results[0].total_phases, 2);
  });
});
