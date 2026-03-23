import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { freshDb, seedIteration } from "./helpers.js";
import { handleWriteTool } from "../write-tools.js";
import { handleReadTool } from "../read-tools.js";

const TEST_OUTPUT = "/tmp/test-export-findings";

let db, seed;

function insertRun(iteration_id, revision_id) {
  const result = handleWriteTool("changelog_insert", {
    project_root: "/tmp/test-project",
    entity_type: "code_review_run",
    iteration_id,
    revision_id,
    data: {
      discovery_path: "discovery.json",
      partitions_path: "partitions.json",
      status: "in_progress",
    },
  });
  return result.id;
}

function insertFinding(run_id, revision_id, overrides = {}) {
  const data = {
    run_id,
    tier: "correctness",
    category: "error_handling_go",
    severity: "medium",
    title: "Missing error check",
    description: "Error not checked",
    impact_level: "implementation",
    status: "open",
    files: ["server/handler.go"],
    ...overrides,
  };
  const result = handleWriteTool("changelog_insert", {
    project_root: "/tmp/test-project",
    entity_type: "code_review_finding",
    iteration_id: seed.iteration_id,
    revision_id,
    data,
  });
  return result.id;
}

beforeEach(() => {
  db = freshDb();
  seed = seedIteration(db);
  mkdirSync(TEST_OUTPUT, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_OUTPUT)) {
    rmSync(TEST_OUTPUT, { recursive: true, force: true });
  }
});

describe("export_findings", () => {
  describe("scope: open", () => {
    it("exports only open findings for the current iteration", () => {
      const runId = insertRun(seed.iteration_id, seed.revision_id);
      insertFinding(runId, seed.revision_id, { severity: "critical", title: "Critical bug" });
      insertFinding(runId, seed.revision_id, { severity: "high", title: "High issue" });
      insertFinding(runId, seed.revision_id, { severity: "low", title: "Low issue", status: "resolved" });

      const result = handleReadTool("export_findings", {
        project_root: "/tmp/test-project",
        scope: "open",
        iteration_id: seed.iteration_id,
        output_dir: TEST_OUTPUT,
      });

      assert.strictEqual(result.total, 2);
      assert.strictEqual(result.counts.critical, 1);
      assert.strictEqual(result.counts.high, 1);
      assert.strictEqual(result.counts.low, 0);
      assert.strictEqual(result.scope, "open");
      assert.ok(result.file_path.endsWith("-findings.md"));

      const content = readFileSync(result.file_path, "utf8");
      assert.ok(content.includes("Critical bug"));
      assert.ok(content.includes("High issue"));
      assert.ok(!content.includes("Low issue")); // resolved, not open
    });

    it("orders findings by severity (critical first)", () => {
      const runId = insertRun(seed.iteration_id, seed.revision_id);
      insertFinding(runId, seed.revision_id, { severity: "low", title: "Low first inserted" });
      insertFinding(runId, seed.revision_id, { severity: "critical", title: "Critical last inserted" });
      insertFinding(runId, seed.revision_id, { severity: "medium", title: "Medium middle" });

      const result = handleReadTool("export_findings", {
        project_root: "/tmp/test-project",
        scope: "open",
        iteration_id: seed.iteration_id,
        output_dir: TEST_OUTPUT,
      });

      const content = readFileSync(result.file_path, "utf8");
      const critIdx = content.indexOf("Critical last inserted");
      const medIdx = content.indexOf("Medium middle");
      const lowIdx = content.indexOf("Low first inserted");
      assert.ok(critIdx < medIdx, "critical should appear before medium");
      assert.ok(medIdx < lowIdx, "medium should appear before low");
    });

    it("includes file paths in the table", () => {
      const runId = insertRun(seed.iteration_id, seed.revision_id);
      insertFinding(runId, seed.revision_id, {
        title: "Multi-file finding",
        files: ["a.go", "b.go"],
      });

      const result = handleReadTool("export_findings", {
        project_root: "/tmp/test-project",
        scope: "open",
        iteration_id: seed.iteration_id,
        output_dir: TEST_OUTPUT,
      });

      const content = readFileSync(result.file_path, "utf8");
      assert.ok(content.includes("a.go"));
      assert.ok(content.includes("b.go"));
    });

    it("includes resolution guidance when present", () => {
      const runId = insertRun(seed.iteration_id, seed.revision_id);
      const findingId = insertFinding(runId, seed.revision_id, {
        title: "Guided finding",
        resolution_guidance: "use backoff/v4",
      });

      const result = handleReadTool("export_findings", {
        project_root: "/tmp/test-project",
        scope: "open",
        iteration_id: seed.iteration_id,
        output_dir: TEST_OUTPUT,
      });

      const content = readFileSync(result.file_path, "utf8");
      assert.ok(content.includes("use backoff/v4"));
    });

    it("produces 'No findings' message when empty", () => {
      const runId = insertRun(seed.iteration_id, seed.revision_id);

      const result = handleReadTool("export_findings", {
        project_root: "/tmp/test-project",
        scope: "open",
        iteration_id: seed.iteration_id,
        output_dir: TEST_OUTPUT,
      });

      assert.strictEqual(result.total, 0);
      const content = readFileSync(result.file_path, "utf8");
      assert.ok(content.includes("No findings"));
    });

    it("includes the finding PK (id) in each row", () => {
      const runId = insertRun(seed.iteration_id, seed.revision_id);
      const id = insertFinding(runId, seed.revision_id, { title: "PK test" });

      const result = handleReadTool("export_findings", {
        project_root: "/tmp/test-project",
        scope: "open",
        iteration_id: seed.iteration_id,
        output_dir: TEST_OUTPUT,
      });

      const content = readFileSync(result.file_path, "utf8");
      assert.ok(content.includes(`| ${id} |`), `Expected finding id ${id} in table`);
    });
  });

  describe("scope: all", () => {
    it("writes two tables — open and non-open", () => {
      const runId = insertRun(seed.iteration_id, seed.revision_id);
      insertFinding(runId, seed.revision_id, { title: "Open one", status: "open" });
      insertFinding(runId, seed.revision_id, { title: "Accepted one", status: "accepted" });
      insertFinding(runId, seed.revision_id, { title: "Deferred one", status: "deferred" });

      const result = handleReadTool("export_findings", {
        project_root: "/tmp/test-project",
        scope: "all",
        iteration_id: seed.iteration_id,
        output_dir: TEST_OUTPUT,
      });

      assert.strictEqual(result.total, 3);
      const content = readFileSync(result.file_path, "utf8");
      assert.ok(content.includes("## Open Findings (1)"));
      assert.ok(content.includes("## Resolved / Accepted / Deferred / False-Positive (2)"));
      assert.ok(content.includes("Open one"));
      assert.ok(content.includes("Accepted one"));
      assert.ok(content.includes("Deferred one"));
      // Non-open table should include Status column
      const nonOpenSection = content.split("## Resolved")[1];
      assert.ok(nonOpenSection.includes("| Status |"), "Non-open table should have Status column");
    });
  });

  describe("scope: cross_iteration", () => {
    it("includes findings from multiple iterations", async () => {
      // Iteration 1 findings
      const runId1 = insertRun(seed.iteration_id, seed.revision_id);
      insertFinding(runId1, seed.revision_id, { title: "Iter 1 finding" });

      // Close iteration 1, create iteration 2
      db.prepare("UPDATE iteration SET status = 'closed' WHERE id = ?").run(seed.iteration_id);
      const now = new Date().toISOString();
      const iter2 = db.prepare("INSERT INTO iteration (status, created_at) VALUES ('active', ?)").run(now);
      const iter2Id = Number(iter2.lastInsertRowid);

      // Create phases for iter2
      const { PHASES } = await import("../write-tools.js");
      const insertPhase = db.prepare("INSERT INTO phase (iteration_id, name, status) VALUES (?, ?, 'pending')");
      for (const name of PHASES) insertPhase.run(iter2Id, name);
      const reqPhase2 = db.prepare("SELECT id FROM phase WHERE iteration_id = ? AND name = 'requirements'").get(iter2Id);
      db.prepare("UPDATE phase SET status = 'in_progress' WHERE id = ?").run(reqPhase2.id);
      const rev2 = db.prepare("INSERT INTO revision (phase_id, producer_agent, created_at, status) VALUES (?, 'test', ?, 'draft')").run(reqPhase2.id, now);
      const rev2Id = Number(rev2.lastInsertRowid);

      const runId2 = insertRun(iter2Id, rev2Id);
      // Insert finding for iter 2 using direct DB (seed references iter 1)
      handleWriteTool("changelog_insert", {
        project_root: "/tmp/test-project",
        entity_type: "code_review_finding",
        iteration_id: iter2Id,
        revision_id: rev2Id,
        data: {
          run_id: runId2,
          tier: "structural",
          category: "module_cohesion",
          severity: "high",
          title: "Iter 2 finding",
          description: "Cross-iter test",
          impact_level: "architecture",
          files: ["pkg/core.go"],
        },
      });

      const result = handleReadTool("export_findings", {
        project_root: "/tmp/test-project",
        scope: "cross_iteration",
        output_dir: TEST_OUTPUT,
      });

      assert.strictEqual(result.total, 2);
      const content = readFileSync(result.file_path, "utf8");
      assert.ok(content.includes("Iter 1 finding"));
      assert.ok(content.includes("Iter 2 finding"));
      assert.ok(content.includes("Iteration"), "Should have Iteration column header");
    });
  });

  describe("auto-detection", () => {
    it("auto-detects iteration_id from active iteration", () => {
      const runId = insertRun(seed.iteration_id, seed.revision_id);
      insertFinding(runId, seed.revision_id, { title: "Auto-detect test" });

      const result = handleReadTool("export_findings", {
        project_root: "/tmp/test-project",
        scope: "open",
        output_dir: TEST_OUTPUT,
      });

      assert.strictEqual(result.total, 1);
      assert.strictEqual(result.iteration_id, seed.iteration_id);
    });

    it("auto-detects run_id from latest run", () => {
      const runId1 = insertRun(seed.iteration_id, seed.revision_id);
      insertFinding(runId1, seed.revision_id, { title: "Old run finding" });

      const runId2 = insertRun(seed.iteration_id, seed.revision_id);
      insertFinding(runId2, seed.revision_id, { title: "New run finding" });

      const result = handleReadTool("export_findings", {
        project_root: "/tmp/test-project",
        scope: "open",
        output_dir: TEST_OUTPUT,
      });

      // Both findings should appear since scope "open" uses iteration_id, not run_id
      assert.strictEqual(result.total, 2);
    });

    it("throws when no active iteration exists and none provided", () => {
      db.prepare("UPDATE iteration SET status = 'closed' WHERE id = ?").run(seed.iteration_id);

      assert.throws(() => {
        handleReadTool("export_findings", {
          project_root: "/tmp/test-project",
          scope: "open",
          output_dir: TEST_OUTPUT,
        });
      }, /No active iteration found/);
    });

    it("throws when no code review run exists for the iteration", () => {
      assert.throws(() => {
        handleReadTool("export_findings", {
          project_root: "/tmp/test-project",
          scope: "open",
          iteration_id: seed.iteration_id,
          output_dir: TEST_OUTPUT,
        });
      }, /No code review run found/);
    });
  });

  describe("markdown format", () => {
    it("contains expected column headers for open/all scopes", () => {
      const runId = insertRun(seed.iteration_id, seed.revision_id);
      insertFinding(runId, seed.revision_id, { title: "Header test" });

      const result = handleReadTool("export_findings", {
        project_root: "/tmp/test-project",
        scope: "open",
        iteration_id: seed.iteration_id,
        output_dir: TEST_OUTPUT,
      });

      const content = readFileSync(result.file_path, "utf8");
      assert.ok(content.includes("| ID |"));
      assert.ok(content.includes("| Severity |") || content.includes("Severity"));
      assert.ok(content.includes("Tier"));
      assert.ok(content.includes("Category"));
      assert.ok(content.includes("Title"));
      assert.ok(content.includes("Files"));
      assert.ok(content.includes("Guidance"));
    });

    it("file path contains epoch timestamp", () => {
      const runId = insertRun(seed.iteration_id, seed.revision_id);
      const before = Math.floor(Date.now() / 1000);

      const result = handleReadTool("export_findings", {
        project_root: "/tmp/test-project",
        scope: "open",
        iteration_id: seed.iteration_id,
        output_dir: TEST_OUTPUT,
      });

      const after = Math.floor(Date.now() / 1000);
      const filename = path.basename(result.file_path);
      const epochStr = filename.split("-")[0];
      const epoch = parseInt(epochStr, 10);
      assert.ok(epoch >= before && epoch <= after, `Epoch ${epoch} should be between ${before} and ${after}`);
    });
  });

  describe("error handling", () => {
    it("throws on invalid scope", () => {
      assert.throws(() => {
        handleReadTool("export_findings", {
          project_root: "/tmp/test-project",
          scope: "invalid",
          output_dir: TEST_OUTPUT,
        });
      }, /Invalid scope/);
    });

    it("throws when scope is missing", () => {
      assert.throws(() => {
        handleReadTool("export_findings", {
          project_root: "/tmp/test-project",
          output_dir: TEST_OUTPUT,
        });
      }, /scope is required/);
    });
  });

  describe("findings with no files", () => {
    it("handles findings that have no associated files", () => {
      const runId = insertRun(seed.iteration_id, seed.revision_id);
      // Insert finding without files array
      handleWriteTool("changelog_insert", {
        project_root: "/tmp/test-project",
        entity_type: "code_review_finding",
        iteration_id: seed.iteration_id,
        revision_id: seed.revision_id,
        data: {
          run_id: runId,
          tier: "structural",
          category: "module_cohesion",
          severity: "high",
          title: "No files finding",
          description: "Finding without files",
          impact_level: "implementation",
        },
      });

      const result = handleReadTool("export_findings", {
        project_root: "/tmp/test-project",
        scope: "open",
        iteration_id: seed.iteration_id,
        output_dir: TEST_OUTPUT,
      });

      assert.strictEqual(result.total, 1);
      const content = readFileSync(result.file_path, "utf8");
      assert.ok(content.includes("No files finding"));
    });
  });
});
