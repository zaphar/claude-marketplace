import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshDb, seedIteration, getPhaseId } from "./helpers.js";
import { handleWriteTool } from "../write-tools.js";
import { handleReadTool } from "../read-tools.js";

let db, seed;

beforeEach(() => {
  db = freshDb();
  seed = seedIteration(db);
});

// ───────────────────────────────────────────────────────────────
// bulk_import — validation
// ───────────────────────────────────────────────────────────────

describe("bulk_import validation", () => {
  it("rejects empty entities array", () => {
    assert.throws(
      () => handleWriteTool("bulk_import", { project_root: "/tmp/test-project", entities: [] }),
      /non-empty array/
    );
  });

  it("rejects non-array entities", () => {
    assert.throws(
      () => handleWriteTool("bulk_import", { project_root: "/tmp/test-project", entities: "bad" }),
      /non-empty array/
    );
  });

  it("rejects entity missing entity_type", () => {
    assert.throws(
      () => handleWriteTool("bulk_import", {
        project_root: "/tmp/test-project",
        entities: [{ data: { id: "P-001", name: "X" } }],
      }),
      /must have both entity_type and data/
    );
  });

  it("rejects entity missing data", () => {
    assert.throws(
      () => handleWriteTool("bulk_import", {
        project_root: "/tmp/test-project",
        entities: [{ entity_type: "persona" }],
      }),
      /must have both entity_type and data/
    );
  });

  it("rejects unsupported entity_type", () => {
    assert.throws(
      () => handleWriteTool("bulk_import", {
        project_root: "/tmp/test-project",
        entities: [{ entity_type: "test_report", data: {} }],
      }),
      /Unsupported entity_type for bulk import/
    );
  });
});

// ───────────────────────────────────────────────────────────────
// bulk_import — bootstrapping
// ───────────────────────────────────────────────────────────────

describe("bulk_import bootstrapping", () => {
  it("uses existing active iteration (no bootstrap)", () => {
    const result = handleWriteTool("bulk_import", {
      project_root: "/tmp/test-project",
      entities: [
        { entity_type: "persona", data: { id: "P-001", name: "Dev", description: "Developer", goals: [] } },
      ],
    });
    assert.strictEqual(result.bootstrapped, false);
    assert.strictEqual(result.iteration_id, seed.iteration_id);
  });

  it("bootstraps new project + iteration when none exists", () => {
    // Use a fresh DB without seeding
    db = freshDb();

    const result = handleWriteTool("bulk_import", {
      project_root: "/tmp/test-project",
      project_name: "new-project",
      entities: [
        { entity_type: "persona", data: { id: "P-001", name: "Dev", description: "Developer", goals: [] } },
      ],
    });

    assert.strictEqual(result.bootstrapped, true);
    assert.ok(result.iteration_id);

    const status = handleReadTool("project_status", { project_root: "/tmp/test-project" });
    assert.strictEqual(status.project.project_name, "new-project");
  });

  it("bootstraps new iteration when all iterations are closed", () => {
    // Close the existing iteration
    handleWriteTool("iteration_close", {
      project_root: "/tmp/test-project",
      iteration_id: seed.iteration_id,
    });

    const result = handleWriteTool("bulk_import", {
      project_root: "/tmp/test-project",
      entities: [
        { entity_type: "persona", data: { id: "P-001", name: "Dev", description: "Developer", goals: [] } },
      ],
    });

    assert.strictEqual(result.bootstrapped, true);
    assert.notStrictEqual(result.iteration_id, seed.iteration_id);
  });
});

// ───────────────────────────────────────────────────────────────
// bulk_import — phase ordering and entity insertion
// ───────────────────────────────────────────────────────────────

describe("bulk_import phase ordering", () => {
  it("processes phases in canonical order regardless of input order", () => {
    const result = handleWriteTool("bulk_import", {
      project_root: "/tmp/test-project",
      entities: [
        // planning entities first in input
        { entity_type: "plan_overview", data: { strategy: "Iterative", rationale: "De-risk" } },
        { entity_type: "work_item", data: { phase_number: 1, name: "Task 1", work_type: "feature", goal: "Build it" } },
        // then requirements
        { entity_type: "persona", data: { id: "P-001", name: "Dev", description: "Developer", goals: [] } },
        { entity_type: "requirement", data: { id: "REQ-001", description: "Login", priority: "must-have", category: "auth" } },
      ],
    });

    // Requirements should be first, planning second
    assert.deepStrictEqual(result.phases_processed, ["requirements", "planning"]);
  });

  it("inserts entities in priority order within each phase", () => {
    // Persona should be inserted before requirement (so persona FK is valid)
    const result = handleWriteTool("bulk_import", {
      project_root: "/tmp/test-project",
      entities: [
        // requirement referencing persona — listed first in input
        { entity_type: "requirement", data: { id: "REQ-001", description: "Login", priority: "must-have", category: "auth", personas: ["P-001"] } },
        // persona listed second — should still be inserted first
        { entity_type: "persona", data: { id: "P-001", name: "Dev", description: "Developer", goals: [] } },
      ],
    });

    assert.strictEqual(result.imported.persona, 1);
    assert.strictEqual(result.imported.requirement, 1);

    // Verify the persona link was created
    const reqs = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      include_related: true,
    });
    const req = reqs.results.find(r => r.id === "REQ-001");
    assert.ok(req.personas.includes("P-001"));
  });

  it("only processes phases with entities", () => {
    const result = handleWriteTool("bulk_import", {
      project_root: "/tmp/test-project",
      entities: [
        { entity_type: "persona", data: { id: "P-001", name: "Dev", description: "Developer", goals: [] } },
      ],
    });

    // Only requirements phase processed (persona belongs to requirements)
    assert.deepStrictEqual(result.phases_processed, ["requirements"]);
    assert.strictEqual(result.total_entities, 1);
  });
});

// ───────────────────────────────────────────────────────────────
// bulk_import — multi-phase import
// ───────────────────────────────────────────────────────────────

describe("bulk_import multi-phase", () => {
  it("imports across all four phases in one call", () => {
    const result = handleWriteTool("bulk_import", {
      project_root: "/tmp/test-project",
      entities: [
        { entity_type: "persona", data: { id: "P-001", name: "Dev", description: "Developer", goals: [] } },
        { entity_type: "requirement", data: { id: "REQ-001", description: "Login", priority: "must-have", category: "auth" } },
        { entity_type: "user_flow", data: { id: "FLOW-001", name: "Login flow", goal: "Authenticate" } },
        { entity_type: "screen", data: { id: "SCREEN-001", name: "Login page", purpose: "Collect credentials" } },
        { entity_type: "adr", data: { id: "ADR-001", title: "Use JWT", context: "Auth tokens", decision: "JWT" } },
        { entity_type: "component", data: { id: "COMP-001", name: "Auth", purpose: "Authentication", type: "service" } },
        { entity_type: "plan_overview", data: { strategy: "Iterative", rationale: "De-risk" } },
        { entity_type: "work_item", data: { phase_number: 1, name: "Auth module", work_type: "feature", goal: "Implement auth" } },
      ],
    });

    assert.deepStrictEqual(result.phases_processed, ["requirements", "ux_design", "architecture", "planning"]);
    assert.strictEqual(result.total_entities, 8);
    assert.strictEqual(result.imported.persona, 1);
    assert.strictEqual(result.imported.requirement, 1);
    assert.strictEqual(result.imported.user_flow, 1);
    assert.strictEqual(result.imported.screen, 1);
    assert.strictEqual(result.imported.adr, 1);
    assert.strictEqual(result.imported.component, 1);
    assert.strictEqual(result.imported.plan_overview, 1);
    assert.strictEqual(result.imported.work_item, 1);
  });

  it("creates one revision per phase", () => {
    handleWriteTool("bulk_import", {
      project_root: "/tmp/test-project",
      entities: [
        { entity_type: "persona", data: { id: "P-001", name: "Dev", description: "Developer", goals: [] } },
        { entity_type: "adr", data: { id: "ADR-001", title: "Use JWT", context: "Auth", decision: "JWT" } },
      ],
    });

    // Check revisions for requirements phase (should have seed revision + import revision)
    const reqHistory = handleReadTool("revision_history", {
      project_root: "/tmp/test-project",
      iteration_id: seed.iteration_id,
      phase_name: "requirements",
    });
    const importRevs = reqHistory.revisions.filter(r => r.producer_agent === "import");
    assert.strictEqual(importRevs.length, 1);
    assert.strictEqual(importRevs[0].status, "approved");

    // Architecture phase should also have exactly one import revision
    const archHistory = handleReadTool("revision_history", {
      project_root: "/tmp/test-project",
      iteration_id: seed.iteration_id,
      phase_name: "architecture",
    });
    const archImportRevs = archHistory.revisions.filter(r => r.producer_agent === "import");
    assert.strictEqual(archImportRevs.length, 1);
    assert.strictEqual(archImportRevs[0].status, "approved");
  });
});

// ───────────────────────────────────────────────────────────────
// bulk_import — phase state management
// ───────────────────────────────────────────────────────────────

describe("bulk_import phase state management", () => {
  it("completes pending phases after import", () => {
    handleWriteTool("bulk_import", {
      project_root: "/tmp/test-project",
      entities: [
        // architecture phase is pending in seed
        { entity_type: "adr", data: { id: "ADR-001", title: "Use JWT", context: "Auth", decision: "JWT" } },
      ],
    });

    const archPhaseId = getPhaseId(db, seed.iteration_id, "architecture");
    const phase = db.prepare("SELECT status, approved_by FROM phase WHERE id = ?").get(archPhaseId);
    assert.strictEqual(phase.status, "completed");
    assert.strictEqual(phase.approved_by, "import");
  });

  it("does not complete in-progress phases", () => {
    // requirements is already in_progress from seed
    handleWriteTool("bulk_import", {
      project_root: "/tmp/test-project",
      entities: [
        { entity_type: "persona", data: { id: "P-001", name: "Dev", description: "Developer", goals: [] } },
      ],
    });

    const reqPhaseId = getPhaseId(db, seed.iteration_id, "requirements");
    const phase = db.prepare("SELECT status FROM phase WHERE id = ?").get(reqPhaseId);
    assert.strictEqual(phase.status, "in_progress");
  });

  it("does not complete already-completed phases", () => {
    // Complete the architecture phase first
    handleWriteTool("phase_transition", {
      project_root: "/tmp/test-project",
      iteration_id: seed.iteration_id,
      phase_name: "architecture",
      status: "in_progress",
    });
    handleWriteTool("phase_transition", {
      project_root: "/tmp/test-project",
      iteration_id: seed.iteration_id,
      phase_name: "architecture",
      status: "completed",
      approved_by: "test-critic",
    });

    // Now bulk import into it
    handleWriteTool("bulk_import", {
      project_root: "/tmp/test-project",
      entities: [
        { entity_type: "adr", data: { id: "ADR-001", title: "Use JWT", context: "Auth", decision: "JWT" } },
      ],
    });

    // Still completed, approved_by unchanged
    const archPhaseId = getPhaseId(db, seed.iteration_id, "architecture");
    const phase = db.prepare("SELECT status, approved_by FROM phase WHERE id = ?").get(archPhaseId);
    assert.strictEqual(phase.status, "completed");
    assert.strictEqual(phase.approved_by, "test-critic");
  });
});

// ───────────────────────────────────────────────────────────────
// bulk_import — atomicity
// ───────────────────────────────────────────────────────────────

describe("bulk_import atomicity", () => {
  it("rolls back entire transaction on insert failure", () => {
    // P-001 is valid, but requirement_trace references non-existent component
    assert.throws(
      () => handleWriteTool("bulk_import", {
        project_root: "/tmp/test-project",
        entities: [
          { entity_type: "persona", data: { id: "P-001", name: "Dev", description: "Developer", goals: [] } },
          { entity_type: "requirement_trace", data: { requirement_id: "REQ-001", addressed_by: "COMP-NONEXISTENT", addressed_by_type: "component" } },
        ],
      }),
      /not found/
    );

    // P-001 should NOT exist (rolled back)
    const personas = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
    });
    const p001 = personas.results.find(p => p.id === "P-001");
    assert.strictEqual(p001, undefined);
  });

  it("does not create revisions on failure", () => {
    const beforeRevisions = db.prepare(
      "SELECT COUNT(*) AS n FROM revision WHERE phase_id = ?"
    ).get(getPhaseId(db, seed.iteration_id, "architecture")).n;

    assert.throws(
      () => handleWriteTool("bulk_import", {
        project_root: "/tmp/test-project",
        entities: [
          { entity_type: "requirement_trace", data: { requirement_id: "REQ-X", addressed_by: "COMP-NONE", addressed_by_type: "component" } },
        ],
      })
    );

    const afterRevisions = db.prepare(
      "SELECT COUNT(*) AS n FROM revision WHERE phase_id = ?"
    ).get(getPhaseId(db, seed.iteration_id, "architecture")).n;

    assert.strictEqual(afterRevisions, beforeRevisions);
  });

  it("does not change phase state on failure", () => {
    const archPhaseId = getPhaseId(db, seed.iteration_id, "architecture");
    const beforeStatus = db.prepare("SELECT status FROM phase WHERE id = ?").get(archPhaseId).status;

    assert.throws(
      () => handleWriteTool("bulk_import", {
        project_root: "/tmp/test-project",
        entities: [
          { entity_type: "component", data: { id: "COMP-001", name: "Auth", purpose: "Auth", type: "service" } },
          // This will fail: bad addressed_by_type
          { entity_type: "requirement_trace", data: { requirement_id: "REQ-001", addressed_by: "X", addressed_by_type: "invalid_type" } },
        ],
      })
    );

    const afterStatus = db.prepare("SELECT status FROM phase WHERE id = ?").get(archPhaseId).status;
    assert.strictEqual(afterStatus, beforeStatus);
  });
});

// ───────────────────────────────────────────────────────────────
// bulk_import — entity data integrity
// ───────────────────────────────────────────────────────────────

describe("bulk_import entity data integrity", () => {
  it("creates cross-phase traceability links", () => {
    handleWriteTool("bulk_import", {
      project_root: "/tmp/test-project",
      entities: [
        { entity_type: "requirement", data: { id: "REQ-001", description: "Login", priority: "must-have", category: "auth" } },
        { entity_type: "component", data: { id: "COMP-001", name: "Auth", purpose: "Authentication", type: "service", requirements_addressed: ["REQ-001"] } },
      ],
    });

    const traces = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "requirement_trace",
    });
    const trace = traces.results.find(t => t.requirement_id === "REQ-001" && t.addressed_by === "COMP-001");
    assert.ok(trace, "Expected requirement trace linking REQ-001 to COMP-001");
    assert.strictEqual(trace.addressed_by_type, "component");
  });

  it("handles upserts correctly on re-import", () => {
    // First import
    handleWriteTool("bulk_import", {
      project_root: "/tmp/test-project",
      entities: [
        { entity_type: "persona", data: { id: "P-001", name: "Developer", description: "Original", goals: ["code"] } },
      ],
    });

    // Second import with updated data
    handleWriteTool("bulk_import", {
      project_root: "/tmp/test-project",
      entities: [
        { entity_type: "persona", data: { id: "P-001", name: "Senior Developer", description: "Updated", goals: ["code", "review"] } },
      ],
    });

    const personas = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
    });
    const p = personas.results.find(p => p.id === "P-001");
    assert.strictEqual(p.name, "Senior Developer");
    assert.strictEqual(p.description, "Updated");
  });
});
