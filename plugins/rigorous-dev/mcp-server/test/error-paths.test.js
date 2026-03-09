import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { freshDb, seedIteration } from "./helpers.js";
import { handleWriteTool } from "../write-tools.js";

let db, seed;

beforeEach(() => {
  db = freshDb();
  seed = seedIteration(db);
});

// ───────────────────────────────────────────────────────────────
// Invalid entity_type
// ───────────────────────────────────────────────────────────────

describe("changelog_insert invalid entity_type", () => {
  it("rejects a completely unknown entity_type", () => {
    assert.throws(
      () =>
        handleWriteTool("changelog_insert", {
          entity_type: "nonexistent_entity",
          iteration_id: seed.iteration_id,
          revision_id: seed.revision_id,
          data: { name: "test" },
        }),
      /Unsupported entity_type/
    );
  });

  it("rejects an empty string entity_type", () => {
    assert.throws(
      () =>
        handleWriteTool("changelog_insert", {
          entity_type: "",
          iteration_id: seed.iteration_id,
          revision_id: seed.revision_id,
          data: { name: "test" },
        }),
      /Unsupported entity_type/
    );
  });
});

// ───────────────────────────────────────────────────────────────
// Missing required fields
// ───────────────────────────────────────────────────────────────

describe("changelog_insert missing required fields", () => {
  it("rejects persona without required name", () => {
    assert.throws(
      () =>
        handleWriteTool("changelog_insert", {
          entity_type: "persona",
          iteration_id: seed.iteration_id,
          revision_id: seed.revision_id,
          data: { id: "P-1", description: "A persona" },
        }),
      /NOT NULL/
    );
  });

  it("rejects persona without required description", () => {
    assert.throws(
      () =>
        handleWriteTool("changelog_insert", {
          entity_type: "persona",
          iteration_id: seed.iteration_id,
          revision_id: seed.revision_id,
          data: { id: "P-1", name: "Dev" },
        }),
      /NOT NULL/
    );
  });

  it("rejects requirement without required description", () => {
    assert.throws(
      () =>
        handleWriteTool("changelog_insert", {
          entity_type: "requirement",
          iteration_id: seed.iteration_id,
          revision_id: seed.revision_id,
          data: { id: "REQ-1", priority: "must-have", category: "functional" },
        }),
      /NOT NULL/
    );
  });

  it("rejects adr without required title", () => {
    assert.throws(
      () =>
        handleWriteTool("changelog_insert", {
          entity_type: "adr",
          iteration_id: seed.iteration_id,
          revision_id: seed.revision_id,
          data: { id: "ADR-1", decision: "Use X", rationale: "Because" },
        }),
      /NOT NULL/
    );
  });

  it("rejects component without required name", () => {
    assert.throws(
      () =>
        handleWriteTool("changelog_insert", {
          entity_type: "component",
          iteration_id: seed.iteration_id,
          revision_id: seed.revision_id,
          data: { id: "C-1", description: "A component" },
        }),
      /NOT NULL/
    );
  });
});

// ───────────────────────────────────────────────────────────────
// FK violations — non-existent revision_id
// ───────────────────────────────────────────────────────────────

describe("changelog_insert FK violations", () => {
  it("rejects persona with non-existent revision_id", () => {
    assert.throws(
      () =>
        handleWriteTool("changelog_insert", {
          entity_type: "persona",
          iteration_id: seed.iteration_id,
          revision_id: 99999,
          data: { id: "P-1", name: "Dev", description: "Developer" },
        }),
      /FOREIGN KEY/
    );
  });

  it("rejects requirement with non-existent revision_id", () => {
    assert.throws(
      () =>
        handleWriteTool("changelog_insert", {
          entity_type: "requirement",
          iteration_id: seed.iteration_id,
          revision_id: 99999,
          data: { id: "REQ-1", description: "X", priority: "must-have", category: "functional" },
        }),
      /FOREIGN KEY/
    );
  });

});

// ───────────────────────────────────────────────────────────────
// CHECK constraint violations
// ───────────────────────────────────────────────────────────────

describe("changelog_insert CHECK constraint violations", () => {
  it("rejects requirement_trace with invalid addressed_by_type", () => {
    // Insert a requirement first so that FK is satisfied
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-1", description: "X", priority: "must-have", category: "functional" },
    });
    assert.throws(
      () =>
        handleWriteTool("changelog_insert", {
          entity_type: "requirement_trace",
          iteration_id: seed.iteration_id,
          revision_id: seed.revision_id,
          data: {
            requirement_id: "REQ-1",
            addressed_by: "some-thing",
            addressed_by_type: "invalid_type",
          },
        }),
      /Invalid addressed_by_type/
    );
  });

  it("rejects requirement with invalid priority", () => {
    assert.throws(
      () =>
        handleWriteTool("changelog_insert", {
          entity_type: "requirement",
          iteration_id: seed.iteration_id,
          revision_id: seed.revision_id,
          data: { id: "REQ-1", description: "X", priority: "critical", category: "functional" },
        }),
      /CHECK constraint/
    );
  });

  it("rejects data_exchange with invalid direction", () => {
    assert.throws(
      () =>
        handleWriteTool("changelog_insert", {
          entity_type: "data_exchange",
          iteration_id: seed.iteration_id,
          revision_id: seed.revision_id,
          data: { name: "API", direction: "sideways", protocol: "HTTP", description: "ext" },
        }),
      /CHECK constraint/
    );
  });
});
