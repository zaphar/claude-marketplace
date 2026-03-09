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
    const result = handleWriteTool("iteration_create", { project_name: "tool-test" });
    assert.ok(result.iteration_id);

    const status = handleReadTool("project_status", {});
    assert.strictEqual(status.project.project_name, "test-project"); // first wins
    assert.strictEqual(status.phases.length, 8);
  });

  it("sets requirements phase to in_progress", () => {
    const result = handleWriteTool("iteration_create", {});
    const summary = handleReadTool("iteration_summary", { iteration_id: result.iteration_id });
    const reqPhase = summary.phases.find((p) => p.name === "requirements");
    assert.strictEqual(reqPhase.status, "in_progress");
  });

  it("sets all other phases to pending", () => {
    const result = handleWriteTool("iteration_create", {});
    const summary = handleReadTool("iteration_summary", { iteration_id: result.iteration_id });
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
      iteration_id: seed.iteration_id,
      phase_name: "requirements",
      status: "completed",
      approved_by: "test-critic",
    });
    assert.strictEqual(result.status, "completed");
  });

  it("transitions a phase to skipped", () => {
    const result = handleWriteTool("phase_transition", {
      iteration_id: seed.iteration_id,
      phase_name: "ux_design",
      status: "skipped",
    });
    assert.strictEqual(result.status, "skipped");
  });

  it("records started_at when moving to in_progress", () => {
    handleWriteTool("phase_transition", {
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
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_number: 1,
        name: "auth-module",
        type: "feature",
        goal: "Implement authentication",
      },
    });
    const phases = db.prepare(
      "SELECT id FROM work_item WHERE iteration_id = ?"
    ).all(seed.iteration_id);
    const ppId = phases[0].id;

    const result = handleWriteTool("work_item_transition", {
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
        work_item_id: 99999,
        status: "implementing",
      }),
      /Work item 99999 not found/
    );
  });
});

// ───────────────────────────────────────────────────────────────
// revision_create + revision_update
// ───────────────────────────────────────────────────────────────

describe("revision_create", () => {
  it("creates a revision and returns count", () => {
    const result = handleWriteTool("revision_create", {
      phase_id: seed.phase_id,
      producer_agent: "test-agent",
    });
    assert.ok(result.revision_id);
    assert.strictEqual(result.phase_id, seed.phase_id);
    // seedIteration already created 1 revision, this is the 2nd
    assert.strictEqual(result.revision_count, 2);
  });
});

describe("revision_update", () => {
  it("records critic feedback and status", () => {
    const result = handleWriteTool("revision_update", {
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
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "commit-test", type: "feature", goal: "Test" },
    });
    const result = handleWriteTool("commit_link", {
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
      iteration_id: seed.iteration_id,
      notes: "Done",
    });
    assert.strictEqual(result.status, "closed");
    assert.ok(result.closed_at);
  });

  it("rejects closing an already-closed iteration", () => {
    handleWriteTool("iteration_close", { iteration_id: seed.iteration_id });
    assert.throws(
      () => handleWriteTool("iteration_close", { iteration_id: seed.iteration_id }),
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
        entity_type: "persona",
        entity_id: "P-1",
        updates: { status: "closed" },
      }),
      /does not support/
    );
  });
});
