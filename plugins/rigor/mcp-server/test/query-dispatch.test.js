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
// Filter validation: unknown keys, SQL injection, null on non-nullable
// ───────────────────────────────────────────────────────────────

describe("applyFilters validation", () => {
  it("rejects unknown filter field", () => {
    assert.throws(
      () =>
        handleReadTool("changelog_query", {
          project_root: "/tmp/test-project",
          entity_type: "persona",
          filters: { nonexistent_column: "value" },
        }),
      { message: /Unknown filter "nonexistent_column" for persona/ }
    );
  });

  it("rejects SQL injection via filter key", () => {
    assert.throws(
      () =>
        handleReadTool("changelog_query", {
          project_root: "/tmp/test-project",
          entity_type: "persona",
          filters: { "1=1 --": null },
        }),
      { message: /Unknown filter "1=1 --" for persona/ }
    );
  });

  it("rejects null filter on non-nullable column", () => {
    assert.throws(
      () =>
        handleReadTool("changelog_query", {
          project_root: "/tmp/test-project",
          entity_type: "persona",
          filters: { name: null },
        }),
      { message: /does not accept null/ }
    );
  });

  it("accepts null filter on nullable column", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-1", name: "Dev", description: "Dev" },
    });
    // technical_level is nullable — filtering by null should work
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      filters: { technical_level: null },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].id, "P-1");
  });
});

// ───────────────────────────────────────────────────────────────
// Per-function filter tests: 3 representative simple types
// ───────────────────────────────────────────────────────────────

describe("queryWorkItem filters critical_path_sequence", () => {
  it("filters by critical_path_sequence", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "phase-a", work_type: "feature", goal: "A", critical_path_sequence: 1 },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 2, name: "phase-b", work_type: "feature", goal: "B", critical_path_sequence: 2 },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 3, name: "phase-c", work_type: "feature", goal: "C" },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      filters: { critical_path_sequence: 2 },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].name, "phase-b");
  });

  it("filters by critical_path_sequence = null to find non-critical-path phases", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "critical-phase", work_type: "feature", goal: "Critical", critical_path_sequence: 1 },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 2, name: "optional-phase", work_type: "feature", goal: "Optional" },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      filters: { critical_path_sequence: null },
    });
    // All phases without critical_path_sequence
    assert.ok(r.results.every(p => p.critical_path_sequence === null));
    assert.ok(r.results.some(p => p.name === "optional-phase"));
  });
});

describe("queryBlocker (INTEGER PK, nullable filters)", () => {
  it("filters by severity", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "blocker",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_name: "requirements",
        description: "Missing stakeholder",
        severity: "critical",
        raised_by: "critic",
      },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "blocker",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_name: "requirements",
        description: "Minor formatting",
        severity: "minor",
        raised_by: "critic",
      },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "blocker",
      filters: { severity: "critical" },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].description, "Missing stakeholder");
  });

  it("filters by nullable resolved_at = null (unresolved blockers)", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "blocker",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_name: "requirements",
        description: "Unresolved",
        severity: "major",
        raised_by: "critic",
      },
    });
    // Insert a resolved blocker by using blocker_resolve
    const b2 = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "blocker",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_name: "requirements",
        description: "Resolved",
        severity: "minor",
        raised_by: "critic",
      },
    });
    handleWriteTool("blocker_resolve", {
      project_root: "/tmp/test-project",
      blocker_id: b2.id,
      resolution_notes: "Fixed",
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "blocker",
      filters: { resolved_at: null },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].description, "Unresolved");
  });
});

// ───────────────────────────────────────────────────────────────
// ids + filters combination tests
// ───────────────────────────────────────────────────────────────

describe("ids + filters combination", () => {
  it("combines ids with filters correctly", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "adr",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "ADR-1",
        title: "Use REST",
        status: "accepted",
        decision: "REST",
        rationale: "R",
      },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "adr",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "ADR-2",
        title: "Use GraphQL",
        status: "deprecated",
        decision: "GQL",
        rationale: "R",
      },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "adr",
      ids: ["ADR-1", "ADR-2"],
      filters: { status: "accepted" },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].id, "ADR-1");
  });

  it("combines ids with null filters correctly", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "adr",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "ADR-1",
        title: "Use REST",
        status: "accepted",
        decision: "REST",
        rationale: "R",
      },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "adr",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "ADR-2",
        title: "Superseded",
        status: "superseded",
        decision: "X",
        rationale: "R",
        superseded_by: "ADR-1",
      },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "adr",
      ids: ["ADR-1", "ADR-2"],
      filters: { superseded_by: null },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].id, "ADR-1");
  });
});

// ───────────────────────────────────────────────────────────────
// Phase 2a: include_related enrichment tests (6 simple complex types)
// ───────────────────────────────────────────────────────────────

describe("queryPersona enrichment", () => {
  it("parses goals JSON when include_related is true", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-1", name: "Dev", description: "Developer", goals: ["ship fast", "low bugs"] },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      ids: ["P-1"],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    assert.deepStrictEqual(r.results[0].goals, ["ship fast", "low bugs"]);
  });

  it("returns raw goals string when include_related is false", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-2", name: "QA", description: "QA engineer", goals: ["coverage"] },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      ids: ["P-2"],
      include_related: false,
    });
    assert.strictEqual(r.count, 1);
    // Without include_related, goals should be the raw JSON string
    assert.strictEqual(typeof r.results[0].goals, "string");
    assert.deepStrictEqual(JSON.parse(r.results[0].goals), ["coverage"]);
  });

  it("handles empty goals array gracefully", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-3", name: "Admin", description: "Admin user" },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      ids: ["P-3"],
      include_related: true,
    });
    assert.deepStrictEqual(r.results[0].goals, []);
  });
});

describe("queryPlanOverview enrichment", () => {
  it("attaches total_phases, risks, and parsed assumptions when include_related is true", () => {
    // Insert plan phases first so COUNT works
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "setup", work_type: "feature", goal: "Setup project" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 2, name: "core", work_type: "feature", goal: "Build core" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "plan_overview",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        strategy: "incremental",
        rationale: "reduce risk",
        assumptions: ["stable API", "team of 3"],
        risks: [
          { risk: "scope creep", mitigation: "strict backlog", work_item_id: 1 },
          { risk: "tech debt", mitigation: "refactor sprint" },
        ],
      },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "plan_overview",
      iteration_id: seed.iteration_id,
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const overview = r.results[0];
    assert.strictEqual(overview.total_phases, 2);
    assert.deepStrictEqual(overview.assumptions, ["stable API", "team of 3"]);
    assert.strictEqual(overview.risks.length, 2);
    assert.strictEqual(overview.risks[0].risk, "scope creep");
    assert.strictEqual(overview.risks[0].mitigation, "strict backlog");
    assert.strictEqual(overview.risks[0].work_item_id, 1);
    assert.strictEqual(overview.risks[1].risk, "tech debt");
    assert.strictEqual(overview.risks[1].work_item_id, undefined);
  });

  it("does not attach total_phases or risks when include_related is false", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "plan_overview",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        strategy: "big bang",
        rationale: "fast",
        risks: [{ risk: "failure", mitigation: "hope" }],
      },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "plan_overview",
      iteration_id: seed.iteration_id,
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].total_phases, undefined);
    // risks is now a JSON column — returned as raw JSON string when not enriched
    assert.strictEqual(typeof r.results[0].risks, "string");
    const parsedRisks = JSON.parse(r.results[0].risks);
    assert.strictEqual(parsedRisks.length, 1);
    assert.strictEqual(parsedRisks[0].risk, "failure");
    // assumptions should be raw JSON string
    assert.strictEqual(typeof r.results[0].assumptions, "string");
  });
});

describe("queryPersonaAddressed enrichment", () => {
  it("attaches flows when include_related is true", () => {
    // Need a persona and user_flow first
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-1", name: "Dev", description: "Developer" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "user_flow",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "UF-1", name: "Login", goal: "Authenticate user" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "user_flow",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "UF-2", name: "Signup", goal: "Register user" },
    });
    const paResult = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "persona_addressed",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        persona_id: "P-1",
        goal: "Quick access",
        how_addressed: "SSO login",
        flows: ["UF-1", "UF-2"],
      },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona_addressed",
      ids: [paResult.id],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    assert.deepStrictEqual(r.results[0].flows.sort(), ["UF-1", "UF-2"]);
  });

  it("does not attach flows when include_related is omitted", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-2", name: "QA", description: "QA" },
    });
    const paResult = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "persona_addressed",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { persona_id: "P-2", goal: "Test", how_addressed: "Automation" },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "persona_addressed",
      ids: [paResult.id],
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].flows, undefined);
  });
});

describe("queryInfoArchitecture enrichment", () => {
  it("attaches children when include_related is true", () => {
    const parentResult = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "info_architecture",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "navigation", key: "main-menu", value: "Top nav bar" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "info_architecture",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "navigation", key: "sub-item-1", value: "Dashboard", parent_id: parentResult.id },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "info_architecture",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "navigation", key: "sub-item-2", value: "Settings", parent_id: parentResult.id },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "info_architecture",
      ids: [parentResult.id],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].children.length, 2);
    const keys = r.results[0].children.map((c) => c.key).sort();
    assert.deepStrictEqual(keys, ["sub-item-1", "sub-item-2"]);
    // Each child should have id, category, key, value
    assert.ok(r.results[0].children[0].id);
    assert.strictEqual(r.results[0].children[0].category, "navigation");
  });

  it("does not attach children when include_related is false", () => {
    const parentResult = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "info_architecture",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "nav", key: "top", value: "TopNav" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "info_architecture",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "nav", key: "child", value: "ChildNav", parent_id: parentResult.id },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "info_architecture",
      ids: [parentResult.id],
      include_related: false,
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].children, undefined);
  });
});

// ───────────────────────────────────────────────────────────────
// Phase 2b: Medium-complexity enrichment tests
// ───────────────────────────────────────────────────────────────

describe("queryComponent enrichment", () => {
  it("attaches interfaces, dependencies, requirements_addressed, and integration_test_boundaries when include_related is true", () => {
    // Create prerequisite requirements
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-C1", description: "Auth", priority: "must-have", category: "security" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-C2", description: "Logging", priority: "should-have", category: "ops" },
    });
    // Create two components (one depends on the other)
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "component",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "COMP-DEP", name: "Logger", purpose: "Logging", type: "library" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "component",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "COMP-1",
        name: "AuthService",
        purpose: "Handle authentication",
        type: "service",
        interfaces: [
          { name: "login", type: "API", description: "Login endpoint" },
          { name: "logout", type: "API" },
        ],
        dependencies: ["COMP-DEP"],
        requirements_addressed: ["REQ-C1", "REQ-C2"],
        integration_test_boundaries: [
          { target_component_id: "COMP-DEP", boundary_type: "API", correct_behavior: "Returns log ID" },
        ],
      },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "component",
      ids: ["COMP-1"],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const comp = r.results[0];

    // Interfaces — SELECT * returns all columns
    assert.strictEqual(comp.interfaces.length, 2);
    const loginIface = comp.interfaces.find((i) => i.name === "login");
    assert.strictEqual(loginIface.interface_type, "API");
    assert.strictEqual(loginIface.description, "Login endpoint");
    assert.ok(loginIface.id); // has autoincrement id
    assert.strictEqual(loginIface.component_id, "COMP-1");
    const logoutIface = comp.interfaces.find((i) => i.name === "logout");
    assert.strictEqual(logoutIface.description, null);

    // Dependencies — mapped to depends_on string array
    assert.deepStrictEqual(comp.dependencies, ["COMP-DEP"]);

    // Requirements addressed — mapped to requirement_id string array
    assert.deepStrictEqual(comp.requirements_addressed.sort(), ["REQ-C1", "REQ-C2"]);

    // Integration test boundaries — SELECT * returns all columns
    assert.strictEqual(comp.integration_test_boundaries.length, 1);
    assert.strictEqual(comp.integration_test_boundaries[0].target_component_id, "COMP-DEP");
    assert.strictEqual(comp.integration_test_boundaries[0].boundary_type, "API");
    assert.strictEqual(comp.integration_test_boundaries[0].correct_behavior, "Returns log ID");
  });

  it("does not attach child data when include_related is false", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "component",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "COMP-NOENRICH",
        name: "Simple",
        purpose: "Test",
        type: "library",
        interfaces: [{ name: "foo", type: "API" }],
      },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "component",
      ids: ["COMP-NOENRICH"],
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].interfaces, undefined);
    assert.strictEqual(r.results[0].dependencies, undefined);
    assert.strictEqual(r.results[0].requirements_addressed, undefined);
    assert.strictEqual(r.results[0].integration_test_boundaries, undefined);
  });

  it("returns empty arrays for component with no children", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "component",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "COMP-EMPTY", name: "Bare", purpose: "Nothing", type: "module" },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "component",
      ids: ["COMP-EMPTY"],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    assert.deepStrictEqual(r.results[0].interfaces, []);
    assert.deepStrictEqual(r.results[0].dependencies, []);
    assert.deepStrictEqual(r.results[0].requirements_addressed, []);
    assert.deepStrictEqual(r.results[0].integration_test_boundaries, []);
  });
});

describe("queryUserFlow enrichment", () => {
  it("attaches steps with branches, error_states, requirements, and parsed data_dependencies when include_related is true", () => {
    // Prerequisites
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-UF1", description: "Login req", priority: "must-have", category: "auth" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-UF2", description: "MFA req", priority: "should-have", category: "auth" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "user_flow",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "UF-LOGIN",
        name: "Login Flow",
        goal: "Authenticate user",
        entry_point: "Login page",
        success_state: "Dashboard",
        data_dependencies: ["user_session", "auth_token"],
        steps: [
          { step_number: 1, action: "Enter credentials", surface: "LoginScreen" },
          {
            step_number: 2, action: "Submit form", surface: "LoginScreen",
            is_decision_point: true,
            branches: [
              { condition: "Valid credentials", next_step: 3 },
              { condition: "Invalid credentials", next_step: 1 },
            ],
          },
          { step_number: 3, action: "Redirect to dashboard", surface: "Dashboard" },
        ],
        error_states: [
          { condition: "Network timeout", recovery: "Retry with backoff" },
          { condition: "Account locked", recovery: "Show unlock instructions" },
        ],
        requirements_addressed: ["REQ-UF1", "REQ-UF2"],
      },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "user_flow",
      ids: ["UF-LOGIN"],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const flow = r.results[0];

    // data_dependencies — parsed JSON array
    assert.deepStrictEqual(flow.data_dependencies, ["user_session", "auth_token"]);

    // steps — ordered by step_number, SELECT * columns
    assert.strictEqual(flow.steps.length, 3);
    assert.strictEqual(flow.steps[0].step_number, 1);
    assert.strictEqual(flow.steps[0].action, "Enter credentials");
    assert.ok(flow.steps[0].id); // autoincrement id present
    assert.strictEqual(flow.steps[0].flow_id, "UF-LOGIN");

    // branches on step 2
    assert.strictEqual(flow.steps[1].branches.length, 2);
    assert.strictEqual(flow.steps[1].branches[0].condition, "Valid credentials");
    assert.strictEqual(flow.steps[1].branches[0].next_step, 3);
    assert.strictEqual(flow.steps[1].branches[1].condition, "Invalid credentials");
    assert.strictEqual(flow.steps[1].branches[1].next_step, 1);
    // step 1 and 3 have no branches
    assert.deepStrictEqual(flow.steps[0].branches, []);
    assert.deepStrictEqual(flow.steps[2].branches, []);

    // error_states — condition and recovery only
    assert.strictEqual(flow.error_states.length, 2);
    assert.strictEqual(flow.error_states[0].condition, "Network timeout");
    assert.strictEqual(flow.error_states[0].recovery, "Retry with backoff");
    // error_states should NOT have id or flow_id (only condition, recovery selected)
    assert.strictEqual(flow.error_states[0].id, undefined);

    // requirements — mapped to requirement_id string array
    assert.deepStrictEqual(flow.requirements.sort(), ["REQ-UF1", "REQ-UF2"]);
  });

  it("does not attach child data when include_related is false", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "user_flow",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "UF-NOENRICH",
        name: "Simple Flow",
        goal: "Test",
        data_dependencies: ["some_dep"],
        steps: [{ step_number: 1, action: "Do thing" }],
      },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "user_flow",
      ids: ["UF-NOENRICH"],
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].steps, undefined);
    assert.strictEqual(r.results[0].error_states, null);
    assert.strictEqual(r.results[0].requirements, undefined);
    // data_dependencies should remain raw JSON string
    assert.strictEqual(typeof r.results[0].data_dependencies, "string");
  });

  it("returns empty arrays for flow with no children", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "user_flow",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "UF-EMPTY", name: "Empty", goal: "Nothing" },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "user_flow",
      ids: ["UF-EMPTY"],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    assert.deepStrictEqual(r.results[0].steps, []);
    assert.deepStrictEqual(r.results[0].error_states, []);
    assert.deepStrictEqual(r.results[0].requirements, []);
    assert.deepStrictEqual(r.results[0].data_dependencies, []);
  });
});

describe("queryWorkItem enrichment", () => {
  it("attaches all child data and parses JSON when include_related is true", () => {
    // Prerequisites: requirements, components, user flows, screens
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-PP1", description: "Core feature", priority: "must-have", category: "feature" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-PP2", description: "Nice extra", priority: "nice-to-have", category: "feature" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "component",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "COMP-PP1", name: "API", purpose: "REST API", type: "service" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "user_flow",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "UF-PP1", name: "Setup", goal: "Init system" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "screen",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "SCR-PP1", name: "SetupScreen", purpose: "Configuration" },
    });

    // Create phase 1 first (needed as dependency target)
    const phase1Result = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_number: 1,
        name: "Foundation",
        work_type: "implementation",
        goal: "Set up foundation",
      },
    });
    const phase1Id = phase1Result.id;

    // Create phase 2 (depends on phase 1, parallel with none yet)
    const phase2Result = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_number: 2,
        name: "Core Features",
        work_type: "implementation",
        goal: "Build core features",
        complexity: "L",
        review_checkpoint: true,
        notes: "Critical phase",
        entry_criteria: ["Foundation complete", "Tests pass"],
        exit_criteria: ["All REQs met", "Coverage > 80%"],
        checkpoint_focus: ["API stability", "Performance"],
        requirements: [
          "REQ-PP1",
          { requirement_id: "REQ-PP2", priority: "high", notes: "Stretch goal" },
        ],
        components: ["COMP-PP1"],
        risks: [
          { risk: "API breaking changes", mitigation: "Versioned endpoints" },
          { risk: "Performance regression" },
        ],
      },
    });
    const phase2Id = phase2Result.id;

    // Query phase 2 with full enrichment
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      ids: [phase2Id],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const phase = r.results[0];

    // JSON parsed fields
    assert.deepStrictEqual(phase.entry_criteria, ["Foundation complete", "Tests pass"]);
    assert.deepStrictEqual(phase.exit_criteria, ["All REQs met", "Coverage > 80%"]);
    assert.deepStrictEqual(phase.checkpoint_focus, ["API stability", "Performance"]);

    // Requirements — conditional shaping: string or object
    assert.strictEqual(phase.requirements.length, 2);
    // REQ-PP1 inserted as plain string → just requirement_id
    assert.strictEqual(phase.requirements.find((x) => x === "REQ-PP1" || (x.requirement_id === "REQ-PP1")), "REQ-PP1");
    // REQ-PP2 inserted with priority/notes → object
    const reqObj = phase.requirements.find((x) => typeof x === "object" && x.requirement_id === "REQ-PP2");
    assert.ok(reqObj);
    assert.strictEqual(reqObj.priority, "high");
    assert.strictEqual(reqObj.notes, "Stretch goal");

    // Components — mapped to component_id array
    assert.deepStrictEqual(phase.components, ["COMP-PP1"]);

    // Risks
    assert.strictEqual(phase.risks.length, 2);
    assert.strictEqual(phase.risks[0].risk, "API breaking changes");
    assert.strictEqual(phase.risks[0].mitigation, "Versioned endpoints");
    assert.strictEqual(phase.risks[1].mitigation, undefined);
  });

  it("does not attach child data when include_related is false", () => {
    const result = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_number: 10,
        name: "NoEnrich",
        work_type: "implementation",
        goal: "Test no enrichment",
        entry_criteria: ["foo"],
        risks: [{ risk: "bar", mitigation: "baz" }],
      },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      ids: [result.id],
    });
    assert.strictEqual(r.count, 1);
    const phase = r.results[0];
    // JSON fields should be raw strings
    assert.strictEqual(typeof phase.entry_criteria, "string");
    assert.strictEqual(typeof phase.exit_criteria, "string");
    assert.strictEqual(typeof phase.checkpoint_focus, "string");
    // Child data should not be present
    assert.strictEqual(phase.requirements, undefined);
    assert.strictEqual(phase.components, undefined);
    // risks is now a JSON column on the row — raw string when not enriched
    assert.strictEqual(typeof phase.risks, "string");
  });

  it("returns empty arrays for work_item with no children", () => {
    const result = handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_number: 99,
        name: "Empty Phase",
        work_type: "implementation",
        goal: "Nothing",
      },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "work_item",
      ids: [result.id],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const phase = r.results[0];
    assert.deepStrictEqual(phase.requirements, []);
    assert.deepStrictEqual(phase.components, []);
    assert.deepStrictEqual(phase.risks, []);
    assert.deepStrictEqual(phase.entry_criteria, []);
    assert.deepStrictEqual(phase.exit_criteria, []);
    assert.deepStrictEqual(phase.checkpoint_focus, []);
  });
});

// ───────────────────────────────────────────────────────────────
// Phase 2c: Deep-complexity enrichment tests
// ───────────────────────────────────────────────────────────────

describe("queryImplementationManifest enrichment", () => {
  it("attaches all child data with nested requirements when include_related is true", () => {
    // Prerequisites: requirements, component
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-IM1", description: "Core feature", priority: "must-have", category: "feature" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-IM2", description: "API feature", priority: "should-have", category: "api" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "component",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "COMP-IM1", name: "Core", purpose: "Core logic", type: "library" },
    });

    // Insert implementation data (no parent manifest table — just child data)
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "implementation_manifest",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        requirement_status: [
          { requirement_id: "REQ-IM1", status: "implemented", notes: "Done" },
          { requirement_id: "REQ-IM2", status: "partial" },
        ],
        component_status: [
          { component_id: "COMP-IM1", status: "complete", notes: "All tests pass" },
        ],
        blockers: [
          { description: "Missing API key", severity: "major", recommendation: "Get from admin", requirements: ["REQ-IM2"] },
        ],
      },
    });

    // Query with include_related
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "implementation_manifest",
      iteration_id: seed.iteration_id,
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const m = r.results[0];

    // Requirement status
    assert.strictEqual(m.requirement_status.length, 2);
    const rs1 = m.requirement_status.find((rs) => rs.requirement_id === "REQ-IM1");
    assert.strictEqual(rs1.status, "implemented");
    assert.strictEqual(rs1.notes, "Done");

    // Component status
    assert.strictEqual(m.component_status.length, 1);
    assert.strictEqual(m.component_status[0].component_id, "COMP-IM1");
    assert.strictEqual(m.component_status[0].status, "complete");

    // Blockers with nested requirements
    assert.strictEqual(m.blockers.length, 1);
    assert.strictEqual(m.blockers[0].description, "Missing API key");
    assert.deepStrictEqual(m.blockers[0].requirements, ["REQ-IM2"]);
  });

  it("does not attach child data when include_related is false", () => {
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-NOREL", description: "No-relate test", priority: "must-have", category: "feature" },
    });
    handleWriteTool("changelog_insert", {
      project_root: "/tmp/test-project",
      entity_type: "implementation_manifest",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        requirement_status: [{ requirement_id: "REQ-NOREL", status: "not_started" }],
      },
    });
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "implementation_manifest",
      iteration_id: seed.iteration_id,
    });
    assert.ok(r.count >= 1);
    const m = r.results[0];
    assert.strictEqual(m.requirement_status, undefined);
    assert.strictEqual(m.component_status, undefined);
    assert.strictEqual(m.blockers, undefined);
  });

  it("returns empty arrays for iteration with no implementation data", () => {
    // Create a fresh iteration with no implementation data
    const newIter = handleWriteTool("iteration_create", {
      project_root: "/tmp/test-project",
      project_name: "Empty Impl Test",
      project_description: "Test project",
    });
    // Insert a requirement_status to have at least one iteration, then query a different one
    const r = handleReadTool("changelog_query", {
      project_root: "/tmp/test-project",
      entity_type: "implementation_manifest",
      iteration_id: newIter.iteration_id,
      include_related: true,
    });
    assert.strictEqual(r.count, 0);
  });
});
