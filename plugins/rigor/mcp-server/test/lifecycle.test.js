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
// iteration_create
// ───────────────────────────────────────────────────────────────

describe("iteration_create", () => {
  it("creates project singleton + iteration + 8 phases", () => {
    // freshDb + seedIteration already created iteration 1 via raw SQL.
    // Use handleWriteTool to create a SECOND iteration via the tool interface.
    const result = handleWriteTool("iteration_create", { project_root: "/tmp/test-project", project_name: "tool-test" });
    assert.ok(result.iteration_id);

    const status = handleReadTool("project_status", { project_root: "/tmp/test-project" });
    assert.strictEqual(status.project.project_name, "test-project"); // first wins
    assert.strictEqual(status.phases.length, 8);
  });

  it("sets requirements phase to in_progress", () => {
    const result = handleWriteTool("iteration_create", { project_root: "/tmp/test-project" });
    const summary = handleReadTool("iteration_summary", { project_root: "/tmp/test-project", iteration_id: result.iteration_id });
    const reqPhase = summary.phases.find((p) => p.name === "requirements");
    assert.strictEqual(reqPhase.status, "in_progress");
  });

  it("sets all other phases to pending", () => {
    const result = handleWriteTool("iteration_create", { project_root: "/tmp/test-project" });
    const summary = handleReadTool("iteration_summary", { project_root: "/tmp/test-project", iteration_id: result.iteration_id });
    const nonReq = summary.phases.filter((p) => p.name !== "requirements");
    assert.strictEqual(nonReq.length, 7);
    for (const p of nonReq) {
      assert.strictEqual(p.status, "pending", `${p.name} should be pending`);
    }
  });
});

// ───────────────────────────────────────────────────────────────
// phase_transition
// ───────────────────────────────────────────────────────────────

describe("phase_transition", () => {
  it("transitions a phase to completed", () => {
    const result = handleWriteTool("phase_transition", {
      project_root: "/tmp/test-project",
      iteration_id: seed.iteration_id,
      phase_name: "requirements",
      status: "completed",
      approved_by: "test-critic",
    });
    assert.strictEqual(result.status, "completed");
  });

  it("transitions a phase to skipped", () => {
    const result = handleWriteTool("phase_transition", {
      project_root: "/tmp/test-project",
      iteration_id: seed.iteration_id,
      phase_name: "ux_design",
      status: "skipped",
    });
    assert.strictEqual(result.status, "skipped");
  });

  it("records started_at when moving to in_progress", () => {
    handleWriteTool("phase_transition", {
      project_root: "/tmp/test-project",
      iteration_id: seed.iteration_id,
      phase_name: "architecture",
      status: "in_progress",
    });
    const phase = db.prepare(
      "SELECT started_at FROM phase WHERE iteration_id = ? AND name = 'architecture'"
    ).get(seed.iteration_id);
    assert.ok(phase.started_at);
  });

  it("records completed_at when moving to completed", () => {
    handleWriteTool("phase_transition", {
      project_root: "/tmp/test-project",
      iteration_id: seed.iteration_id,
      phase_name: "requirements",
      status: "completed",
    });
    const phase = db.prepare(
      "SELECT completed_at FROM phase WHERE iteration_id = ? AND name = 'requirements'"
    ).get(seed.iteration_id);
    assert.ok(phase.completed_at);
  });

  it("throws when phase_name does not exist", () => {
    assert.throws(
      () => handleWriteTool("phase_transition", {
        project_root: "/tmp/test-project",
        iteration_id: seed.iteration_id,
        phase_name: "nonexistent_phase",
        status: "in_progress",
      }),
      /Phase "nonexistent_phase" not found in iteration/
    );
  });
});

// ───────────────────────────────────────────────────────────────
// work_item_transition
// ───────────────────────────────────────────────────────────────

describe("work_item_transition", () => {
  it("transitions a work_item status", () => {
    // Insert a work_item first
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_number: 1,
        name: "auth-module",
        work_type: "feature",
        goal: "Implement authentication",
      },
    });
    const phases = db.prepare(
      "SELECT id FROM work_item WHERE iteration_id = ?"
    ).all(seed.iteration_id);
    const ppId = phases[0].id;

    const result = handleWriteTool("work_item_transition", {
      project_root: "/tmp/test-project",
      work_item_id: ppId,
      status: "implementing",
    });
    assert.strictEqual(result.status, "implementing");

    // Read back
    const row = db.prepare("SELECT status FROM work_item WHERE id = ?").get(ppId);
    assert.strictEqual(row.status, "implementing");
  });

  it("throws when work_item_id does not exist", () => {
    assert.throws(
      () => handleWriteTool("work_item_transition", {
        project_root: "/tmp/test-project",
        work_item_id: 99999,
        status: "implementing",
      }),
      /Work item 99999 not found/
    );
  });

  it("sets updated_at when transitioning status", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "transition-updated-at", work_type: "feature", goal: "Test" },
    });
    const wi = db.prepare("SELECT id, updated_at FROM work_item WHERE name = 'transition-updated-at'").get();
    assert.strictEqual(wi.updated_at, null, "updated_at should be null before transition");

    handleWriteTool("work_item_transition", {
      project_root: "/tmp/test-project",
      work_item_id: wi.id,
      status: "implementing",
    });

    const after = db.prepare("SELECT updated_at FROM work_item WHERE id = ?").get(wi.id);
    assert.ok(after.updated_at, "updated_at should be set after transition");
  });
});

// ───────────────────────────────────────────────────────────────
// revision_create + revision_update
// ───────────────────────────────────────────────────────────────

describe("revision_create", () => {
  it("creates a revision and returns count", () => {
    const result = handleWriteTool("revision_create", {
      project_root: "/tmp/test-project",
      phase_id: seed.phase_id,
      producer_agent: "test-agent",
    });
    assert.ok(result.revision_id);
    assert.strictEqual(result.phase_id, seed.phase_id);
    // seedIteration already created 1 revision, this is the 2nd
    assert.strictEqual(result.revision_count, 2);
  });

  it("resolves phase_id from iteration_id + phase_name", () => {
    const result = handleWriteTool("revision_create", {
      project_root: "/tmp/test-project",
      iteration_id: seed.iteration_id,
      phase_name: "requirements",
      producer_agent: "test-agent",
    });
    assert.ok(result.revision_id);
    assert.strictEqual(result.phase_id, seed.phase_id);
    assert.strictEqual(result.revision_count, 2);
  });

  it("throws when phase_name not found in iteration", () => {
    assert.throws(
      () => handleWriteTool("revision_create", {
        project_root: "/tmp/test-project",
        iteration_id: 9999,
        phase_name: "requirements",
        producer_agent: "test-agent",
      }),
      /not found in iteration/
    );
  });

  it("throws when neither phase_id nor iteration_id+phase_name provided", () => {
    assert.throws(
      () => handleWriteTool("revision_create", {
        project_root: "/tmp/test-project",
        producer_agent: "test-agent",
      }),
      /Provide phase_id/
    );
  });
});

describe("revision_update", () => {
  it("records critic feedback and status", () => {
    const result = handleWriteTool("revision_update", {
      project_root: "/tmp/test-project",
      revision_id: seed.revision_id,
      status: "approved",
      critic_agent: "test-critic",
      critic_feedback: "Looks good",
    });
    assert.strictEqual(result.status, "approved");

    const row = db.prepare("SELECT * FROM revision WHERE id = ?").get(seed.revision_id);
    assert.strictEqual(row.critic_agent, "test-critic");
    assert.strictEqual(row.critic_feedback, "Looks good");
    assert.ok(row.reviewed_at);
  });

  it("sets reviewed_at only on approved/rejected", () => {
    handleWriteTool("revision_update", {
      project_root: "/tmp/test-project",
      revision_id: seed.revision_id,
      status: "submitted",
    });
    const row = db.prepare("SELECT reviewed_at FROM revision WHERE id = ?").get(seed.revision_id);
    assert.strictEqual(row.reviewed_at, null);
  });
});

// ───────────────────────────────────────────────────────────────
// commit_link
// ───────────────────────────────────────────────────────────────

describe("commit_link", () => {
  it("links a commit to a work item and revision", () => {
    const wi = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "commit-test", work_type: "feature", goal: "Test" },
    });
    const result = handleWriteTool("commit_link", {
      project_root: "/tmp/test-project",
      iteration_id: seed.iteration_id,
      work_item_id: wi.id,
      revision_id: seed.revision_id,
      commit_sha: "abc123def",
      message: "Initial commit",
    });
    assert.strictEqual(result.commit_sha, "abc123def");

    const row = db.prepare("SELECT * FROM vcs_commit WHERE commit_sha = ?").get("abc123def");
    assert.ok(row);
    assert.strictEqual(row.message, "Initial commit");
    assert.strictEqual(row.work_item_id, wi.id);
    assert.strictEqual(row.revision_id, seed.revision_id);
  });
});

// ───────────────────────────────────────────────────────────────
// project_update
// ───────────────────────────────────────────────────────────────

describe("project_update", () => {
  it("updates project fields", () => {
    const result = handleWriteTool("project_update", {
      project_root: "/tmp/test-project",
      notes: "Updated notes",
      critic_model: "opus",
    });
    assert.strictEqual(result.status, "active");

    const row = db.prepare("SELECT notes, critic_model FROM project WHERE id = 1").get();
    assert.strictEqual(row.notes, "Updated notes");
    assert.strictEqual(row.critic_model, "opus");
  });
});

// ───────────────────────────────────────────────────────────────
// blocker_resolve
// ───────────────────────────────────────────────────────────────

describe("blocker_resolve", () => {
  it("resolves a blocker", () => {
    // Insert a blocker first
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "blocker",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_name: "requirements",
        description: "Missing spec",
        severity: "critical",
        raised_by: "test-critic",
      },
    });
    const blocker = db.prepare("SELECT id FROM blocker WHERE iteration_id = ?").get(seed.iteration_id);

    const result = handleWriteTool("blocker_resolve", {
      project_root: "/tmp/test-project",
      blocker_id: blocker.id,
      resolution_notes: "Spec received",
    });
    assert.ok(result.resolved_at);

    const row = db.prepare("SELECT * FROM blocker WHERE id = ?").get(blocker.id);
    assert.strictEqual(row.resolution_notes, "Spec received");
    assert.ok(row.resolved_at);
  });
});

// ───────────────────────────────────────────────────────────────
// iteration_close
// ───────────────────────────────────────────────────────────────

describe("iteration_close", () => {
  it("closes an active iteration", () => {
    const result = handleWriteTool("iteration_close", {
      project_root: "/tmp/test-project",
      iteration_id: seed.iteration_id,
      notes: "Done",
    });
    assert.strictEqual(result.status, "closed");
    assert.ok(result.closed_at);
  });

  it("rejects closing an already-closed iteration", () => {
    handleWriteTool("iteration_close", { project_root: "/tmp/test-project", iteration_id: seed.iteration_id });
    assert.throws(
      () => handleWriteTool("iteration_close", { project_root: "/tmp/test-project", iteration_id: seed.iteration_id }),
      /not active/
    );
  });
});

// ───────────────────────────────────────────────────────────────
// changelog_update
// ───────────────────────────────────────────────────────────────

describe("changelog_update", () => {
  it("updates security_audit_finding status", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "security_audit_finding",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        category: "injection",
        severity: "high",
        title: "SQL injection",
        description: "Unsanitized input",
        recommendation: "Use parameterized queries",
      },
    });
    const finding = db.prepare("SELECT id FROM security_audit_finding LIMIT 1").get();

    const result = handleWriteTool("changelog_update", {
      project_root: "/tmp/test-project",
      entity_type: "security_audit_finding",
      entity_id: finding.id,
      updates: { status: "resolved" },
    });
    assert.deepStrictEqual(result.updated_fields, ["status"]);

    const row = db.prepare("SELECT status FROM security_audit_finding WHERE id = ?").get(finding.id);
    assert.strictEqual(row.status, "resolved");
  });

  it("rejects unsupported entity types", () => {
    assert.throws(
      () => handleWriteTool("changelog_update", {
        project_root: "/tmp/test-project",
        entity_type: "persona",
        entity_id: "P-1",
        updates: { status: "closed" },
      }),
      /does not support/
    );
  });

  it("sets updated_at when updating adr status", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "adr",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "ADR-UPD", title: "Test ADR", status: "proposed" },
    });
    const before = db.prepare("SELECT updated_at FROM adr WHERE id = 'ADR-UPD'").get();
    assert.strictEqual(before.updated_at, null);

    handleWriteTool("changelog_update", {
      project_root: "/tmp/test-project",
      entity_type: "adr",
      entity_id: "ADR-UPD",
      updates: { status: "accepted" },
    });
    const after = db.prepare("SELECT status, updated_at FROM adr WHERE id = 'ADR-UPD'").get();
    assert.strictEqual(after.status, "accepted");
    assert.ok(after.updated_at, "updated_at should be set after changelog_update");
  });

  // ── work_item update tests ──

  it("updates a single work_item field", () => {
    const wi = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "update-single", work_type: "feature", goal: "Test goal" },
    });

    const result = handleWriteTool("changelog_update", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      entity_id: wi.id,
      updates: { notes: "updated notes" },
    });
    assert.deepStrictEqual(result.updated_fields, ["notes"]);

    const row = db.prepare("SELECT notes, updated_at FROM work_item WHERE id = ?").get(wi.id);
    assert.strictEqual(row.notes, "updated notes");
    assert.ok(row.updated_at, "updated_at should be set");
  });

  it("updates multiple work_item fields at once", () => {
    const wi = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "update-multi", work_type: "feature", goal: "Test goal" },
    });

    const result = handleWriteTool("changelog_update", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      entity_id: wi.id,
      updates: { review_checkpoint: true, complexity: "L", notes: "revised" },
    });
    assert.deepStrictEqual(result.updated_fields, ["review_checkpoint", "complexity", "notes"]);

    const row = db.prepare("SELECT review_checkpoint, complexity, notes, updated_at FROM work_item WHERE id = ?").get(wi.id);
    assert.strictEqual(row.review_checkpoint, 1);
    assert.strictEqual(row.complexity, "L");
    assert.strictEqual(row.notes, "revised");
    assert.ok(row.updated_at, "updated_at should be set");
  });

  it("updates work_item JSON fields", () => {
    const wi = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "update-json", work_type: "feature", goal: "Test goal" },
    });

    handleWriteTool("changelog_update", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      entity_id: wi.id,
      updates: { exit_criteria: ["criterion 1", "criterion 2"] },
    });

    const row = db.prepare("SELECT exit_criteria FROM work_item WHERE id = ?").get(wi.id);
    const parsed = JSON.parse(row.exit_criteria);
    assert.deepStrictEqual(parsed, ["criterion 1", "criterion 2"]);
  });

  it("updates phase_number on work_item", () => {
    const wi = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "update-phase", work_type: "feature", goal: "Test goal" },
    });

    const result = handleWriteTool("changelog_update", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      entity_id: wi.id,
      updates: { phase_number: 2 },
    });

    assert.deepStrictEqual(result.updated_fields, ["phase_number"]);
    const row = db.prepare("SELECT phase_number FROM work_item WHERE id = ?").get(wi.id);
    assert.strictEqual(row.phase_number, 2, "phase_number should be persisted in database");
  });

  it("rejects status field on work_item", () => {
    const wi = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "reject-status", work_type: "feature", goal: "Test goal" },
    });

    assert.throws(
      () => handleWriteTool("changelog_update", {
        project_root: "/tmp/test-project",
        entity_type: "work_item",
        entity_id: wi.id,
        updates: { status: "completed" },
      }),
      /status.*not mutable/
    );
  });

  it("throws on UNIQUE constraint violation for work_item name", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "unique-name-a", work_type: "feature", goal: "Goal A" },
    });
    const wiB = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 2, name: "unique-name-b", work_type: "feature", goal: "Goal B" },
    });

    assert.throws(
      () => handleWriteTool("changelog_update", {
        project_root: "/tmp/test-project",
        entity_type: "work_item",
        entity_id: wiB.id,
        updates: { name: "unique-name-a" },
      }),
      /violate a uniqueness constraint/
    );
  });

  // ── work_item requirements update tests ──

  it("replaces requirements via changelog_update (object format)", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-A", description: "A", rationale: "r", priority: "must", category: "functional" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-B", description: "B", rationale: "r", priority: "should", category: "functional" },
    });

    const wi = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "req-replace", work_type: "feature", goal: "test", requirements: ["REQ-A"] },
    });

    const result = handleWriteTool("changelog_update", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      entity_id: wi.id,
      updates: { requirements: [{ requirement_id: "REQ-B", priority: "must", notes: "updated" }] },
    });

    assert.deepStrictEqual(result.updated_fields, ["requirements"]);
    const reqs = db.prepare("SELECT * FROM work_item_requirement WHERE work_item_id = ?").all(wi.id);
    assert.strictEqual(reqs.length, 1);
    assert.strictEqual(reqs[0].requirement_id, "REQ-B");
    assert.strictEqual(reqs[0].priority, "must");
    assert.strictEqual(reqs[0].notes, "updated");
  });

  it("replaces requirements via changelog_update (string format)", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-S1", description: "S1", rationale: "r", priority: "must", category: "functional" },
    });

    const wi = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "req-string", work_type: "feature", goal: "test" },
    });

    const result = handleWriteTool("changelog_update", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      entity_id: wi.id,
      updates: { requirements: ["REQ-S1"] },
    });

    assert.deepStrictEqual(result.updated_fields, ["requirements"]);
    const reqs = db.prepare("SELECT * FROM work_item_requirement WHERE work_item_id = ?").all(wi.id);
    assert.strictEqual(reqs.length, 1);
    assert.strictEqual(reqs[0].requirement_id, "REQ-S1");
  });

  it("clears requirements with empty array", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-CLR", description: "clear", rationale: "r", priority: "must", category: "functional" },
    });

    const wi = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "req-clear", work_type: "feature", goal: "test", requirements: ["REQ-CLR"] },
    });

    const result = handleWriteTool("changelog_update", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      entity_id: wi.id,
      updates: { requirements: [] },
    });

    assert.deepStrictEqual(result.updated_fields, ["requirements"]);
    const reqs = db.prepare("SELECT * FROM work_item_requirement WHERE work_item_id = ?").all(wi.id);
    assert.strictEqual(reqs.length, 0);
  });

  it("updates both scalar fields and requirements together", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-MIX", description: "mix", rationale: "r", priority: "must", category: "functional" },
    });

    const wi = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "req-mixed", work_type: "feature", goal: "test" },
    });

    const result = handleWriteTool("changelog_update", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      entity_id: wi.id,
      updates: { phase_number: 3, work_order: 5, requirements: ["REQ-MIX"] },
    });

    assert.ok(result.updated_fields.includes("phase_number"));
    assert.ok(result.updated_fields.includes("work_order"));
    assert.ok(result.updated_fields.includes("requirements"));
    const row = db.prepare("SELECT phase_number, work_order FROM work_item WHERE id = ?").get(wi.id);
    assert.strictEqual(row.phase_number, 3);
    assert.strictEqual(row.work_order, 5);
    const reqs = db.prepare("SELECT * FROM work_item_requirement WHERE work_item_id = ?").all(wi.id);
    assert.strictEqual(reqs.length, 1);
  });

  it("rejects non-array requirements value", () => {
    const wi = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "req-reject", work_type: "feature", goal: "test" },
    });

    assert.throws(
      () => handleWriteTool("changelog_update", {
        project_root: "/tmp/test-project",
        entity_type: "work_item",
        entity_id: wi.id,
        updates: { requirements: "REQ-001" },
      }),
      /must be an array/
    );
  });

  it("rejects requirements update with nonexistent requirement_id", () => {
    const wi = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "req-fk", work_type: "feature", goal: "test" },
    });

    assert.throws(
      () => handleWriteTool("changelog_update", {
        project_root: "/tmp/test-project",
        entity_type: "work_item",
        entity_id: wi.id,
        updates: { requirements: ["NONEXISTENT-REQ"] },
      }),
      /Requirements not found: NONEXISTENT-REQ/
    );
  });

  // ── requirement update tests ──

  it("updates requirement text fields", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-UPD-1", description: "Original desc", priority: "must-have", category: "functional" },
    });

    const result = handleWriteTool("changelog_update", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      entity_id: "REQ-UPD-1",
      updates: { description: "Updated desc", rationale: "New rationale", priority: "should-have", category: "non-functional" },
    });
    assert.deepStrictEqual(result.updated_fields, ["description", "rationale", "priority", "category"]);

    const row = db.prepare("SELECT description, rationale, priority, category, updated_at FROM requirement WHERE id = 'REQ-UPD-1'").get();
    assert.strictEqual(row.description, "Updated desc");
    assert.strictEqual(row.rationale, "New rationale");
    assert.strictEqual(row.priority, "should-have");
    assert.strictEqual(row.category, "non-functional");
    assert.ok(row.updated_at, "updated_at should be set");
  });

  it("updates requirement acceptance_criteria JSON array", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-UPD-2", description: "JSON test", priority: "must-have", category: "functional" },
    });

    const result = handleWriteTool("changelog_update", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      entity_id: "REQ-UPD-2",
      updates: { acceptance_criteria: ["criterion 1", "criterion 2"] },
    });
    assert.deepStrictEqual(result.updated_fields, ["acceptance_criteria"]);

    const row = db.prepare("SELECT acceptance_criteria FROM requirement WHERE id = 'REQ-UPD-2'").get();
    const parsed = JSON.parse(row.acceptance_criteria);
    assert.deepStrictEqual(parsed, ["criterion 1", "criterion 2"]);
  });

  it("rejects immutable field on requirement", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-UPD-3", description: "Immutable test", priority: "must-have", category: "functional" },
    });

    assert.throws(
      () => handleWriteTool("changelog_update", {
        project_root: "/tmp/test-project",
        entity_type: "requirement",
        entity_id: "REQ-UPD-3",
        updates: { iteration_id: 999 },
      }),
      /iteration_id.*not mutable/
    );
  });

  it("rejects status field on requirement", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-UPD-4", description: "Status test", priority: "must-have", category: "functional" },
    });

    assert.throws(
      () => handleWriteTool("changelog_update", {
        project_root: "/tmp/test-project",
        entity_type: "requirement",
        entity_id: "REQ-UPD-4",
        updates: { status: "closed" },
      }),
      /status.*not mutable/
    );
  });

  // ── approved_dependency update tests ──

  it("updates a single approved_dependency content field", () => {
    const dep = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "approved_dependency",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { package: "dep-single", purpose: "original purpose", justification: "needed" },
    });

    const result = handleWriteTool("changelog_update", {
      project_root: "/tmp/test-project",
      entity_type: "approved_dependency",
      entity_id: dep.id,
      updates: { purpose: "updated purpose" },
    });
    assert.deepStrictEqual(result.updated_fields, ["purpose"]);

    const row = db.prepare("SELECT purpose FROM approved_dependency WHERE id = ?").get(dep.id);
    assert.strictEqual(row.purpose, "updated purpose");
  });

  it("updates multiple approved_dependency content fields at once", () => {
    const dep = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "approved_dependency",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { package: "dep-multi", purpose: "original", justification: "original justification" },
    });

    const result = handleWriteTool("changelog_update", {
      project_root: "/tmp/test-project",
      entity_type: "approved_dependency",
      entity_id: dep.id,
      updates: {
        package: "dep-multi-renamed",
        version_constraint: "^2.0.0",
        purpose: "updated purpose",
        justification: "updated justification",
      },
    });
    assert.deepStrictEqual(result.updated_fields, [
      "package",
      "version_constraint",
      "purpose",
      "justification",
    ]);

    const row = db.prepare(
      "SELECT package, version_constraint, purpose, justification FROM approved_dependency WHERE id = ?"
    ).get(dep.id);
    assert.strictEqual(row.package, "dep-multi-renamed");
    assert.strictEqual(row.version_constraint, "^2.0.0");
    assert.strictEqual(row.purpose, "updated purpose");
    assert.strictEqual(row.justification, "updated justification");
  });

  it("updates integer fields on approved_dependency", () => {
    const dep = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "approved_dependency",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { package: "dep-int", purpose: "int test", justification: "needed" },
    });

    handleWriteTool("changelog_update", {
      project_root: "/tmp/test-project",
      entity_type: "approved_dependency",
      entity_id: dep.id,
      updates: { transitive_deps: 42, single_maintainer_risk: 1 },
    });

    const row = db.prepare(
      "SELECT transitive_deps, single_maintainer_risk FROM approved_dependency WHERE id = ?"
    ).get(dep.id);
    assert.strictEqual(row.transitive_deps, 42);
    assert.strictEqual(row.single_maintainer_risk, 1);
  });

  it("rejects unknown fields on approved_dependency", () => {
    const dep = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "approved_dependency",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { package: "dep-reject", purpose: "reject test", justification: "needed" },
    });

    assert.throws(
      () => handleWriteTool("changelog_update", {
        project_root: "/tmp/test-project",
        entity_type: "approved_dependency",
        entity_id: dep.id,
        updates: { nonexistent_field: "value" },
      }),
      /not mutable/
    );
  });

  it("throws on UNIQUE constraint violation for approved_dependency package", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "approved_dependency",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { package: "unique-pkg-a", purpose: "purpose A", justification: "justification A" },
    });
    const depB = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "approved_dependency",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { package: "unique-pkg-b", purpose: "purpose B", justification: "justification B" },
    });

    assert.throws(
      () => handleWriteTool("changelog_update", {
        project_root: "/tmp/test-project",
        entity_type: "approved_dependency",
        entity_id: depB.id,
        updates: { package: "unique-pkg-a" },
      }),
      /violate a uniqueness constraint/
    );
  });
});
