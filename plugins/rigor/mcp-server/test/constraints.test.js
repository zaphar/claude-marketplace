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
// FK cascade deletes
// ───────────────────────────────────────────────────────────────

describe("FK cascade deletes", () => {
  it("deleting an iteration cascades to phases and revisions", () => {
    // Verify we have phases and revisions
    const phasesBefore = db.prepare("SELECT COUNT(*) AS n FROM phase WHERE iteration_id = ?").get(seed.iteration_id);
    assert.ok(phasesBefore.n > 0);
    const revsBefore = db.prepare("SELECT COUNT(*) AS n FROM revision").get();
    assert.ok(revsBefore.n > 0);

    db.prepare("DELETE FROM iteration WHERE id = ?").run(seed.iteration_id);

    const phasesAfter = db.prepare("SELECT COUNT(*) AS n FROM phase WHERE iteration_id = ?").get(seed.iteration_id);
    assert.strictEqual(phasesAfter.n, 0);
    // Revisions should be gone too (phase cascade → revision cascade)
    const revsAfter = db.prepare("SELECT COUNT(*) AS n FROM revision").get();
    assert.strictEqual(revsAfter.n, 0);
  });

  it("deleting a phase cascades to revisions", () => {
    db.prepare("DELETE FROM phase WHERE id = ?").run(seed.phase_id);
    const revs = db.prepare("SELECT COUNT(*) AS n FROM revision WHERE phase_id = ?").get(seed.phase_id);
    assert.strictEqual(revs.n, 0);
  });

  it("deleting an iteration cascades to entity rows via revision FK", () => {
    // Insert entities that reference revision_id (which cascades from iteration → phase → revision)
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-1", description: "Test req", priority: "must-have", category: "functional" },
    });

    db.prepare("DELETE FROM iteration WHERE id = ?").run(seed.iteration_id);

    const requirements = db.prepare("SELECT COUNT(*) AS n FROM requirement").get();
    assert.strictEqual(requirements.n, 0);
  });
});

// ───────────────────────────────────────────────────────────────
// CHECK constraints
// ───────────────────────────────────────────────────────────────

describe("CHECK constraints", () => {
  it("rejects invalid requirement priority", () => {
    assert.throws(
      () =>
        handleWriteTool("changelog_insert", {
          project_root: "/tmp/test-project",
          entity_type: "requirement",
          iteration_id: seed.iteration_id,
          revision_id: seed.revision_id,
          data: { id: "REQ-1", description: "X", priority: "invalid", category: "functional" },
        }),
      /CHECK constraint/
    );
  });

  it("rejects invalid blocker severity (no CHECK but NOT NULL)", () => {
    assert.throws(
      () =>
        db.prepare("INSERT INTO blocker (iteration_id, phase_name, description, severity, raised_by) VALUES (?, 'requirements', 'x', NULL, 'test')").run(seed.iteration_id),
      /NOT NULL/
    );
  });

  it("rejects invalid phase status", () => {
    assert.throws(
      () =>
        db.prepare("UPDATE phase SET status = 'invalid' WHERE id = ?").run(seed.phase_id),
      /CHECK constraint/
    );
  });

  it("rejects invalid implementation_requirement_status status", () => {
    assert.throws(
      () =>
        handleWriteTool("changelog_insert", {
          project_root: "/tmp/test-project",
          entity_type: "implementation_manifest",
          iteration_id: seed.iteration_id,
          revision_id: seed.revision_id,
          data: { requirement_status: [{ requirement_id: "REQ-001", status: "invalid" }] },
        }),
      /CHECK constraint/
    );
  });
});

// ───────────────────────────────────────────────────────────────
// UNIQUE constraints
// ───────────────────────────────────────────────────────────────

describe("UNIQUE constraints", () => {
  it("replaces duplicate project_context (iteration_id, key, value) triple", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "project_context",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { key: "lang", value: "JS", category: "tech" },
    });
    // Same (iteration_id, key, value) → OR REPLACE triggers
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "project_context",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { key: "lang", value: "JS", category: "updated" },
    });
    const count = db.prepare(
      "SELECT COUNT(*) AS n FROM project_context WHERE iteration_id = ? AND key = 'lang' AND value = 'JS'"
    ).get(seed.iteration_id);
    assert.strictEqual(count.n, 1);
  });

  it("prevents duplicate vcs_commit sha", () => {
    const wi = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "vcs-test", work_type: "feature", goal: "Test" },
    });
    handleWriteTool("commit_link", {
      project_root: "/tmp/test-project",
      iteration_id: seed.iteration_id,
      work_item_id: wi.id,
      revision_id: seed.revision_id,
      commit_sha: "abc123",
      message: "First",
    });
    assert.throws(
      () =>
        handleWriteTool("commit_link", {
          project_root: "/tmp/test-project",
          iteration_id: seed.iteration_id,
          work_item_id: wi.id,
          revision_id: seed.revision_id,
          commit_sha: "abc123",
          message: "Duplicate",
        }),
      /UNIQUE constraint/
    );
  });
});

// ───────────────────────────────────────────────────────────────
// changelog_update tool
// ───────────────────────────────────────────────────────────────

describe("changelog_update", () => {
  it("updates adr status", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "adr",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "ADR-1", title: "Use SQLite", decision: "SQLite",
        rationale: "Simple", status: "proposed",
      },
    });
    const result = handleWriteTool("changelog_update", {
      project_root: "/tmp/test-project",
      entity_type: "adr",
      entity_id: "ADR-1",
      updates: { status: "accepted" },
    });
    assert.deepStrictEqual(result.updated_fields, ["status"]);

    const row = db.prepare("SELECT status FROM adr WHERE id = 'ADR-1'").get();
    assert.strictEqual(row.status, "accepted");
  });

  it("updates performance_audit_finding", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "performance_audit_finding",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        category: "latency", severity: "medium", title: "Slow",
        description: "N+1", recommendation: "Fix",
      },
    });
    const finding = db.prepare("SELECT id FROM performance_audit_finding LIMIT 1").get();

    handleWriteTool("changelog_update", {
      project_root: "/tmp/test-project",
      entity_type: "performance_audit_finding",
      entity_id: finding.id,
      updates: { status: "resolved" },
    });
    const row = db.prepare("SELECT status FROM performance_audit_finding WHERE id = ?").get(finding.id);
    assert.strictEqual(row.status, "resolved");
  });
});

// ───────────────────────────────────────────────────────────────
// requirement_trace soft-FK for screen
// ───────────────────────────────────────────────────────────────

describe("requirement_trace screen validation", () => {
  it("rejects mapping to nonexistent screen", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-1", description: "X", priority: "must-have", category: "functional" },
    });
    assert.throws(
      () =>
        handleWriteTool("changelog_insert", {
          project_root: "/tmp/test-project",
          entity_type: "requirement_trace",
          iteration_id: seed.iteration_id,
          revision_id: seed.revision_id,
          data: {
            requirement_id: "REQ-1",
            addressed_by: "nonexistent-screen",
            addressed_by_type: "screen",
          },
        }),
      /not found/
    );
  });
});
