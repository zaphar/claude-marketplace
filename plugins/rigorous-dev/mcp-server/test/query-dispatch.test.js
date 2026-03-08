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
          entity_type: "persona",
          filters: { name: null },
        }),
      { message: /does not accept null/ }
    );
  });

  it("accepts null filter on nullable column", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-1", name: "Dev", description: "Dev" },
    });
    // technical_level is nullable — filtering by null should work
    const r = handleReadTool("changelog_query", {
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

describe("queryTechnologyChoice (INTEGER PK, simple)", () => {
  it("filters by category", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "technology_choice",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "runtime", name: "Node.js", purpose: "Server" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "technology_choice",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "database", name: "SQLite", purpose: "Storage" },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "technology_choice",
      filters: { category: "runtime" },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].name, "Node.js");
  });

  it("filters by nullable column with null value", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "technology_choice",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "runtime", name: "Node.js" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "technology_choice",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "runtime", name: "Deno", rationale: "Modern runtime" },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "technology_choice",
      filters: { rationale: null },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].name, "Node.js");
  });
});

describe("queryPlanCriticalPath (TEXT PK on plan_phase_id, no iteration_id)", () => {
  it("queries without iteration_id clause", () => {
    const ppResult = handleWriteTool("changelog_insert", {
      entity_type: "plan_phase",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "setup", type: "feature", goal: "Setup" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "plan_critical_path",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { plan_phase_id: ppResult.id, sequence_order: 1 },
    });
    // Query with iteration_id — should be ignored since table has no iteration_id column
    const r = handleReadTool("changelog_query", {
      entity_type: "plan_critical_path",
      iteration_id: seed.iteration_id,
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].sequence_order, 1);
  });

  it("filters by sequence_order", () => {
    const pp1 = handleWriteTool("changelog_insert", {
      entity_type: "plan_phase",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "phase-a", type: "feature", goal: "A" },
    });
    const pp2 = handleWriteTool("changelog_insert", {
      entity_type: "plan_phase",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 2, name: "phase-b", type: "feature", goal: "B" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "plan_critical_path",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { plan_phase_id: pp1.id, sequence_order: 1 },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "plan_critical_path",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { plan_phase_id: pp2.id, sequence_order: 2 },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "plan_critical_path",
      filters: { sequence_order: 2 },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].plan_phase_id, pp2.id);
  });
});

describe("queryBlocker (INTEGER PK, nullable filters)", () => {
  it("filters by severity", () => {
    handleWriteTool("changelog_insert", {
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
      entity_type: "blocker",
      filters: { severity: "critical" },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].description, "Missing stakeholder");
  });

  it("filters by nullable resolved_at = null (unresolved blockers)", () => {
    handleWriteTool("changelog_insert", {
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
      blocker_id: b2.id,
      resolution_notes: "Fixed",
    });
    const r = handleReadTool("changelog_query", {
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
      entity_type: "adr",
      ids: ["ADR-1", "ADR-2"],
      filters: { status: "accepted" },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].id, "ADR-1");
  });

  it("combines ids with null filters correctly", () => {
    handleWriteTool("changelog_insert", {
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
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-1", name: "Dev", description: "Developer", goals: ["ship fast", "low bugs"] },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "persona",
      ids: ["P-1"],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    assert.deepStrictEqual(r.results[0].goals, ["ship fast", "low bugs"]);
  });

  it("returns raw goals string when include_related is false", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-2", name: "QA", description: "QA engineer", goals: ["coverage"] },
    });
    const r = handleReadTool("changelog_query", {
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
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-3", name: "Admin", description: "Admin user" },
    });
    const r = handleReadTool("changelog_query", {
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
      entity_type: "plan_phase",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "setup", type: "feature", goal: "Setup project" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "plan_phase",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 2, name: "core", type: "feature", goal: "Build core" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "plan_overview",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        strategy: "incremental",
        rationale: "reduce risk",
        assumptions: ["stable API", "team of 3"],
        risks: [
          { risk: "scope creep", mitigation: "strict backlog", plan_phase_number: 1 },
          { risk: "tech debt", mitigation: "refactor sprint" },
        ],
      },
    });
    const r = handleReadTool("changelog_query", {
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
    assert.strictEqual(overview.risks[0].plan_phase_number, 1);
    assert.strictEqual(overview.risks[1].risk, "tech debt");
    assert.strictEqual(overview.risks[1].plan_phase_number, null);
  });

  it("does not attach total_phases or risks when include_related is false", () => {
    handleWriteTool("changelog_insert", {
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
      entity_type: "plan_overview",
      iteration_id: seed.iteration_id,
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].total_phases, undefined);
    assert.strictEqual(r.results[0].risks, undefined);
    // assumptions should be raw JSON string
    assert.strictEqual(typeof r.results[0].assumptions, "string");
  });
});

describe("queryArchitectureOverview enrichment", () => {
  it("parses principles and attaches diagrams when include_related is true", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "architecture_overview",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        description: "Microservices architecture",
        principles: ["loose coupling", "high cohesion"],
        diagrams: [
          { name: "system-context", path: "/docs/system.svg", description: "System context diagram" },
          { name: "container", path: "/docs/container.svg" },
        ],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "architecture_overview",
      iteration_id: seed.iteration_id,
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const ao = r.results[0];
    assert.deepStrictEqual(ao.principles, ["loose coupling", "high cohesion"]);
    assert.strictEqual(ao.diagrams.length, 2);
    const byName = Object.fromEntries(ao.diagrams.map((d) => [d.name, d]));
    assert.strictEqual(byName["system-context"].path, "/docs/system.svg");
    assert.strictEqual(byName["system-context"].description, "System context diagram");
    assert.ok(byName["system-context"].id); // id column should be present
    assert.strictEqual(byName["container"].name, "container");
    assert.strictEqual(byName["container"].description, null);
  });

  it("does not parse principles or attach diagrams when include_related is false", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "architecture_overview",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        description: "Monolith",
        principles: ["simplicity"],
        diagrams: [{ name: "overview", path: "/d.svg" }],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "architecture_overview",
      iteration_id: seed.iteration_id,
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(typeof r.results[0].principles, "string");
    assert.strictEqual(r.results[0].diagrams, undefined);
  });
});

describe("queryPersonaAddressed enrichment", () => {
  it("attaches flows when include_related is true", () => {
    // Need a persona and user_flow first
    handleWriteTool("changelog_insert", {
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-1", name: "Dev", description: "Developer" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "user_flow",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "UF-1", name: "Login", goal: "Authenticate user" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "user_flow",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "UF-2", name: "Signup", goal: "Register user" },
    });
    const paResult = handleWriteTool("changelog_insert", {
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
      entity_type: "persona_addressed",
      ids: [paResult.id],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    assert.deepStrictEqual(r.results[0].flows.sort(), ["UF-1", "UF-2"]);
  });

  it("does not attach flows when include_related is omitted", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-2", name: "QA", description: "QA" },
    });
    const paResult = handleWriteTool("changelog_insert", {
      entity_type: "persona_addressed",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { persona_id: "P-2", goal: "Test", how_addressed: "Automation" },
    });
    const r = handleReadTool("changelog_query", {
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
      entity_type: "info_architecture",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "navigation", key: "main-menu", value: "Top nav bar" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "info_architecture",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "navigation", key: "sub-item-1", value: "Dashboard", parent_id: parentResult.id },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "info_architecture",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "navigation", key: "sub-item-2", value: "Settings", parent_id: parentResult.id },
    });
    const r = handleReadTool("changelog_query", {
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
      entity_type: "info_architecture",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "nav", key: "top", value: "TopNav" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "info_architecture",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { category: "nav", key: "child", value: "ChildNav", parent_id: parentResult.id },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "info_architecture",
      ids: [parentResult.id],
      include_related: false,
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].children, undefined);
  });
});

describe("queryDataEntity enrichment", () => {
  it("attaches attributes and relationships when include_related is true", () => {
    // Insert target entity first (for relationship)
    handleWriteTool("changelog_insert", {
      entity_type: "data_entity",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { name: "Address", description: "Physical address" },
    });
    // Insert main entity with attributes and relationship
    handleWriteTool("changelog_insert", {
      entity_type: "data_entity",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        name: "User",
        description: "Application user",
        attributes: [
          { name: "email", data_type: "TEXT", is_required: 1, description: "User email" },
          { name: "age", data_type: "INTEGER", is_required: 0 },
        ],
        relationships: [
          { target_entity: "Address", cardinality: "one-to-many", description: "User addresses" },
        ],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "data_entity",
      filters: { name: "User" },
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const entity = r.results[0];

    // Check attributes
    assert.strictEqual(entity.attributes.length, 2);
    const emailAttr = entity.attributes.find((a) => a.name === "email");
    assert.strictEqual(emailAttr.data_type, "TEXT");
    assert.strictEqual(emailAttr.is_required, 1);
    assert.strictEqual(emailAttr.description, "User email");
    const ageAttr = entity.attributes.find((a) => a.name === "age");
    assert.strictEqual(ageAttr.is_required, 0);

    // Check relationships
    assert.strictEqual(entity.relationships.length, 1);
    assert.strictEqual(entity.relationships[0].target_entity, "Address");
    assert.strictEqual(entity.relationships[0].cardinality, "one-to-many");
    assert.strictEqual(entity.relationships[0].description, "User addresses");
    assert.ok(entity.relationships[0].target_entity_id);
  });

  it("does not attach attributes or relationships when include_related is omitted", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "data_entity",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        name: "Product",
        description: "A product",
        attributes: [{ name: "sku", data_type: "TEXT", is_required: 1 }],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "data_entity",
      filters: { name: "Product" },
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].attributes, undefined);
    assert.strictEqual(r.results[0].relationships, undefined);
  });

  it("returns empty arrays for entity with no attributes or relationships", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "data_entity",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { name: "Empty", description: "No attrs" },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "data_entity",
      filters: { name: "Empty" },
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    assert.deepStrictEqual(r.results[0].attributes, []);
    assert.deepStrictEqual(r.results[0].relationships, []);
  });
});

// ───────────────────────────────────────────────────────────────
// Phase 2b: Medium-complexity enrichment tests
// ───────────────────────────────────────────────────────────────

describe("queryComponent enrichment", () => {
  it("attaches interfaces, dependencies, requirements_addressed, and integration_test_boundaries when include_related is true", () => {
    // Create prerequisite requirements
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-C1", description: "Auth", priority: "must-have", category: "security" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-C2", description: "Logging", priority: "should-have", category: "ops" },
    });
    // Create two components (one depends on the other)
    handleWriteTool("changelog_insert", {
      entity_type: "component",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "COMP-DEP", name: "Logger", purpose: "Logging", type: "library" },
    });
    handleWriteTool("changelog_insert", {
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
      entity_type: "component",
      ids: ["COMP-1"],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const comp = r.results[0];

    // Interfaces — SELECT * returns all columns
    assert.strictEqual(comp.interfaces.length, 2);
    const loginIface = comp.interfaces.find((i) => i.name === "login");
    assert.strictEqual(loginIface.type, "API");
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
      entity_type: "component",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "COMP-EMPTY", name: "Bare", purpose: "Nothing", type: "module" },
    });
    const r = handleReadTool("changelog_query", {
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
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-UF1", description: "Login req", priority: "must-have", category: "auth" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-UF2", description: "MFA req", priority: "should-have", category: "auth" },
    });
    handleWriteTool("changelog_insert", {
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
      entity_type: "user_flow",
      ids: ["UF-NOENRICH"],
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].steps, undefined);
    assert.strictEqual(r.results[0].error_states, undefined);
    assert.strictEqual(r.results[0].requirements, undefined);
    // data_dependencies should remain raw JSON string
    assert.strictEqual(typeof r.results[0].data_dependencies, "string");
  });

  it("returns empty arrays for flow with no children", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "user_flow",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "UF-EMPTY", name: "Empty", goal: "Nothing" },
    });
    const r = handleReadTool("changelog_query", {
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

describe("queryPlanPhase enrichment", () => {
  it("attaches all child data and parses JSON when include_related is true", () => {
    // Prerequisites: requirements, components, user flows, screens
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-PP1", description: "Core feature", priority: "must-have", category: "feature" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-PP2", description: "Nice extra", priority: "nice-to-have", category: "feature" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "component",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "COMP-PP1", name: "API", purpose: "REST API", type: "service" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "user_flow",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "UF-PP1", name: "Setup", goal: "Init system" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "screen",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "SCR-PP1", name: "SetupScreen", purpose: "Configuration" },
    });

    // Create phase 1 first (needed as dependency target)
    const phase1Result = handleWriteTool("changelog_insert", {
      entity_type: "plan_phase",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_number: 1,
        name: "Foundation",
        type: "implementation",
        goal: "Set up foundation",
      },
    });
    const phase1Id = phase1Result.id;

    // Create phase 2 (depends on phase 1, parallel with none yet)
    const phase2Result = handleWriteTool("changelog_insert", {
      entity_type: "plan_phase",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_number: 2,
        name: "Core Features",
        type: "implementation",
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
        flows: ["UF-PP1"],
        screens: ["SCR-PP1"],
        api_endpoints: [
          { http_method: "GET", route: "/api/users", description: "List users" },
          { http_method: "POST", route: "/api/users" },
        ],
        db_changes: [
          { migration_name: "001_create_users", description: "Initial schema", tables: ["users", "sessions"] },
        ],
        risks: [
          { risk: "API breaking changes", mitigation: "Versioned endpoints" },
          { risk: "Performance regression" },
        ],
        dependencies: [{ depends_on_phase_id: phase1Id, reason: "Foundation required" }],
      },
    });
    const phase2Id = phase2Result.id;

    // Create phase 3 that can be parallel with phase 2
    const phase3Result = handleWriteTool("changelog_insert", {
      entity_type: "plan_phase",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_number: 3,
        name: "Docs",
        type: "documentation",
        goal: "Write docs",
        parallel_with: [phase2Id],
      },
    });
    const phase3Id = phase3Result.id;

    // Query phase 2 with full enrichment
    const r = handleReadTool("changelog_query", {
      entity_type: "plan_phase",
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

    // Flows — mapped to flow_id array
    assert.deepStrictEqual(phase.flows, ["UF-PP1"]);

    // Screens — mapped to screen_id array
    assert.deepStrictEqual(phase.screens, ["SCR-PP1"]);

    // API endpoints
    assert.strictEqual(phase.api_endpoints.length, 2);
    const getEndpoint = phase.api_endpoints.find((e) => e.http_method === "GET");
    assert.strictEqual(getEndpoint.route, "/api/users");
    assert.strictEqual(getEndpoint.description, "List users");
    const postEndpoint = phase.api_endpoints.find((e) => e.http_method === "POST");
    assert.strictEqual(postEndpoint.description, null);

    // DB changes with parsed tables JSON
    assert.strictEqual(phase.db_changes.length, 1);
    assert.strictEqual(phase.db_changes[0].migration_name, "001_create_users");
    assert.deepStrictEqual(phase.db_changes[0].tables, ["users", "sessions"]);
    assert.ok(phase.db_changes[0].id); // has autoincrement id

    // Risks
    assert.strictEqual(phase.risks.length, 2);
    assert.strictEqual(phase.risks[0].risk, "API breaking changes");
    assert.strictEqual(phase.risks[0].mitigation, "Versioned endpoints");
    assert.strictEqual(phase.risks[1].mitigation, null);

    // Dependencies — aliased columns
    assert.strictEqual(phase.dependencies.length, 1);
    assert.strictEqual(phase.dependencies[0].depends_on_phase_id, phase1Id);
    assert.strictEqual(phase.dependencies[0].reason, "Foundation required");

    // Phase 3 query: parallel_with
    const r3 = handleReadTool("changelog_query", {
      entity_type: "plan_phase",
      ids: [phase3Id],
      include_related: true,
    });
    assert.strictEqual(r3.count, 1);
    assert.deepStrictEqual(r3.results[0].parallel_with, [phase2Id]);
  });

  it("does not attach child data when include_related is false", () => {
    const result = handleWriteTool("changelog_insert", {
      entity_type: "plan_phase",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_number: 10,
        name: "NoEnrich",
        type: "implementation",
        goal: "Test no enrichment",
        entry_criteria: ["foo"],
        risks: [{ risk: "bar", mitigation: "baz" }],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "plan_phase",
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
    assert.strictEqual(phase.api_endpoints, undefined);
    assert.strictEqual(phase.db_changes, undefined);
    assert.strictEqual(phase.risks, undefined);
    assert.strictEqual(phase.flows, undefined);
    assert.strictEqual(phase.screens, undefined);
    assert.strictEqual(phase.dependencies, undefined);
    assert.strictEqual(phase.parallel_with, undefined);
  });

  it("returns empty arrays for plan_phase with no children", () => {
    const result = handleWriteTool("changelog_insert", {
      entity_type: "plan_phase",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        phase_number: 99,
        name: "Empty Phase",
        type: "implementation",
        goal: "Nothing",
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "plan_phase",
      ids: [result.id],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const phase = r.results[0];
    assert.deepStrictEqual(phase.requirements, []);
    assert.deepStrictEqual(phase.components, []);
    assert.deepStrictEqual(phase.api_endpoints, []);
    assert.deepStrictEqual(phase.db_changes, []);
    assert.deepStrictEqual(phase.risks, []);
    assert.deepStrictEqual(phase.flows, []);
    assert.deepStrictEqual(phase.screens, []);
    assert.deepStrictEqual(phase.dependencies, []);
    assert.deepStrictEqual(phase.parallel_with, []);
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
    // Prerequisites: plan_phase, requirements, component
    const ppResult = handleWriteTool("changelog_insert", {
      entity_type: "plan_phase",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "impl-phase", type: "implementation", goal: "Build it" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-IM1", description: "Core feature", priority: "must-have", category: "feature" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-IM2", description: "API feature", priority: "should-have", category: "api" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "component",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "COMP-IM1", name: "Core", purpose: "Core logic", type: "library" },
    });

    // Insert implementation_manifest with all child data
    const mResult = handleWriteTool("changelog_insert", {
      entity_type: "implementation_manifest",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        plan_phase_id: ppResult.id,
        status: "complete",
        lines_of_code: 500,
        warnings: 2,
        build_status: "success",
        files: [
          { path: "src/main.js", file_operation: "created", purpose: "Entry point", requirements: ["REQ-IM1"] },
          { path: "src/utils.js", file_operation: "created", purpose: "Utilities" },
          { path: "src/old.js", file_operation: "modified", purpose: "Refactored", requirements: ["REQ-IM1", "REQ-IM2"] },
        ],
        requirement_status: [
          { requirement_id: "REQ-IM1", status: "implemented", notes: "Done" },
          { requirement_id: "REQ-IM2", status: "partial" },
        ],
        component_status: [
          { component_id: "COMP-IM1", status: "complete", notes: "All tests pass" },
        ],
        api_endpoints: [
          { route: "/api/items", http_method: "GET", status: "complete", requirements: ["REQ-IM2"] },
          { route: "/api/items", http_method: "POST", status: "stubbed" },
        ],
        dependencies_added: [
          { name: "express", version: "4.18.0", purpose: "HTTP server", license: "MIT" },
        ],
        db_migrations: [
          { name: "001_init", description: "Initial tables", status: "applied" },
        ],
        blockers: [
          { description: "Missing API key", severity: "major", recommendation: "Get from admin", requirements: ["REQ-IM2"] },
        ],
        review_checklist: [
          { check_name: "Tests pass", passed: true },
          { check_name: "Linter clean", passed: false },
        ],
      },
    });

    // Query with include_related
    const r = handleReadTool("changelog_query", {
      entity_type: "implementation_manifest",
      ids: [mResult.id],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const m = r.results[0];

    // Computed counts
    assert.strictEqual(m.files_created, 2);
    assert.strictEqual(m.files_modified, 1);
    assert.strictEqual(m.files_deleted, 0);

    // Files with nested requirements
    assert.strictEqual(m.files.length, 3);
    const mainFile = m.files.find((f) => f.path === "src/main.js");
    assert.ok(mainFile);
    assert.deepStrictEqual(mainFile.requirements, ["REQ-IM1"]);
    assert.strictEqual(mainFile.file_operation, "created");
    assert.ok(mainFile.id); // autoincrement id
    const oldFile = m.files.find((f) => f.path === "src/old.js");
    assert.deepStrictEqual(oldFile.requirements.sort(), ["REQ-IM1", "REQ-IM2"]);
    const utilsFile = m.files.find((f) => f.path === "src/utils.js");
    assert.deepStrictEqual(utilsFile.requirements, []);

    // Requirement status
    assert.strictEqual(m.requirement_status.length, 2);
    const rs1 = m.requirement_status.find((rs) => rs.requirement_id === "REQ-IM1");
    assert.strictEqual(rs1.status, "implemented");
    assert.strictEqual(rs1.notes, "Done");

    // Component status
    assert.strictEqual(m.component_status.length, 1);
    assert.strictEqual(m.component_status[0].component_id, "COMP-IM1");
    assert.strictEqual(m.component_status[0].status, "complete");

    // API endpoints with nested requirements
    assert.strictEqual(m.api_endpoints.length, 2);
    const getEp = m.api_endpoints.find((ep) => ep.http_method === "GET");
    assert.deepStrictEqual(getEp.requirements, ["REQ-IM2"]);
    const postEp = m.api_endpoints.find((ep) => ep.http_method === "POST");
    assert.deepStrictEqual(postEp.requirements, []);

    // Dependencies added
    assert.strictEqual(m.dependencies_added.length, 1);
    assert.strictEqual(m.dependencies_added[0].name, "express");
    assert.strictEqual(m.dependencies_added[0].license, "MIT");

    // DB migrations
    assert.strictEqual(m.db_migrations.length, 1);
    assert.strictEqual(m.db_migrations[0].name, "001_init");
    assert.strictEqual(m.db_migrations[0].status, "applied");

    // Blockers with nested requirements
    assert.strictEqual(m.blockers.length, 1);
    assert.strictEqual(m.blockers[0].description, "Missing API key");
    assert.deepStrictEqual(m.blockers[0].requirements, ["REQ-IM2"]);

    // Review checklist
    assert.strictEqual(m.review_checklist.length, 2);
    const testsCheck = m.review_checklist.find((c) => c.check_name === "Tests pass");
    assert.strictEqual(testsCheck.passed, 1);
    const lintCheck = m.review_checklist.find((c) => c.check_name === "Linter clean");
    assert.strictEqual(lintCheck.passed, 0);
  });

  it("does not attach child data when include_related is false", () => {
    const ppResult = handleWriteTool("changelog_insert", {
      entity_type: "plan_phase",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 2, name: "impl-no-enrich", type: "implementation", goal: "Test" },
    });
    const mResult = handleWriteTool("changelog_insert", {
      entity_type: "implementation_manifest",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        plan_phase_id: ppResult.id,
        status: "partial",
        files: [{ path: "a.js", file_operation: "created" }],
        review_checklist: [{ check_name: "Smoke test", passed: true }],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "implementation_manifest",
      ids: [mResult.id],
    });
    assert.strictEqual(r.count, 1);
    const m = r.results[0];
    assert.strictEqual(m.files, undefined);
    assert.strictEqual(m.files_created, undefined);
    assert.strictEqual(m.files_modified, undefined);
    assert.strictEqual(m.files_deleted, undefined);
    assert.strictEqual(m.requirement_status, undefined);
    assert.strictEqual(m.component_status, undefined);
    assert.strictEqual(m.api_endpoints, undefined);
    assert.strictEqual(m.dependencies_added, undefined);
    assert.strictEqual(m.db_migrations, undefined);
    assert.strictEqual(m.blockers, undefined);
    assert.strictEqual(m.review_checklist, undefined);
  });

  it("returns empty arrays for manifest with no children", () => {
    const ppResult = handleWriteTool("changelog_insert", {
      entity_type: "plan_phase",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 3, name: "impl-empty", type: "implementation", goal: "Empty" },
    });
    const mResult = handleWriteTool("changelog_insert", {
      entity_type: "implementation_manifest",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { plan_phase_id: ppResult.id, status: "complete" },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "implementation_manifest",
      ids: [mResult.id],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const m = r.results[0];
    assert.strictEqual(m.files_created, 0);
    assert.strictEqual(m.files_modified, 0);
    assert.strictEqual(m.files_deleted, 0);
    assert.deepStrictEqual(m.files, []);
    assert.deepStrictEqual(m.requirement_status, []);
    assert.deepStrictEqual(m.component_status, []);
    assert.deepStrictEqual(m.api_endpoints, []);
    assert.deepStrictEqual(m.dependencies_added, []);
    assert.deepStrictEqual(m.db_migrations, []);
    assert.deepStrictEqual(m.blockers, []);
    assert.deepStrictEqual(m.review_checklist, []);
  });
});

describe("queryDeploymentManifest enrichment", () => {
  it("attaches all child data with deep nesting and JSON parsing when include_related is true", () => {
    const mResult = handleWriteTool("changelog_insert", {
      entity_type: "deployment_manifest",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        status: "ready",
        targets: ["production", "staging"],
        blockers: ["DNS not configured"],
        pipelines: [
          {
            platform: "GitHub Actions",
            config_files: [".github/workflows/ci.yml"],
            stages: [
              {
                name: "build",
                purpose: "Compile and test",
                triggers: ["push to main"],
                steps: ["npm install", "npm test"],
                quality_gates: [
                  { name: "tests-pass", condition: "exit code 0", failure_action: "block" },
                ],
              },
              {
                name: "deploy",
                purpose: "Ship to production",
                triggers: ["manual"],
                steps: ["deploy.sh"],
              },
            ],
          },
        ],
        quality_gates: [
          { category: "testing", key: "coverage", value: "80%" },
        ],
        environments: [
          {
            name: "production",
            deployment_method: "kubernetes",
            url: "https://app.example.com",
            rollback_procedure: "kubectl rollback",
            infra: [
              { provider: "AWS", resource: "EKS cluster" },
            ],
            vars: [
              { name: "DATABASE_URL", value_source: "secrets-manager", description: "DB connection" },
            ],
          },
        ],
        artifacts: [
          { name: "api-image", type: "docker", registry: "ghcr.io", versioning: "semantic", platforms: ["linux/amd64", "linux/arm64"] },
        ],
        signing: [
          { enabled: true, signing_method: "cosign" },
        ],
        local_executables: [
          { installation_method: "npm install -g", update_mechanism: "npm update", platforms: ["macos", "linux"], channels: ["stable", "beta"] },
        ],
        secrets: [
          { provider: "AWS Secrets Manager", name: "DB_PASSWORD", purpose: "Database auth", rotation_policy: "90 days" },
        ],
        health_checks: [
          { name: "api-health", endpoint: "/healthz", interval: "30s" },
        ],
        alerting: [
          { provider: "PagerDuty", channel: "#ops-alerts" },
        ],
        runbooks: [
          {
            name: "Rollback Procedure",
            scenario: "Failed deployment",
            steps: [
              { step: "Check dashboard", is_rollback: false },
              { step: "Run kubectl rollback", is_rollback: true },
            ],
          },
        ],
        review_checklist: [
          { check_name: "Secrets rotated", passed: true },
          { check_name: "Rollback tested", passed: false },
        ],
      },
    });

    // Query with include_related
    const r = handleReadTool("changelog_query", {
      entity_type: "deployment_manifest",
      ids: [mResult.id],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const m = r.results[0];

    // JSON-parsed top-level fields
    assert.deepStrictEqual(m.targets, ["production", "staging"]);
    assert.deepStrictEqual(m.blockers, ["DNS not configured"]);

    // Pipelines with nested stages and quality gates
    assert.strictEqual(m.pipelines.length, 1);
    const pipeline = m.pipelines[0];
    assert.strictEqual(pipeline.platform, "GitHub Actions");
    assert.deepStrictEqual(pipeline.config_files, [".github/workflows/ci.yml"]);
    assert.ok(pipeline.id); // autoincrement id
    assert.strictEqual(pipeline.stages.length, 2);

    const buildStage = pipeline.stages.find((s) => s.name === "build");
    assert.strictEqual(buildStage.purpose, "Compile and test");
    assert.deepStrictEqual(buildStage.triggers, ["push to main"]);
    assert.deepStrictEqual(buildStage.steps, ["npm install", "npm test"]);
    assert.strictEqual(buildStage.quality_gates.length, 1);
    assert.strictEqual(buildStage.quality_gates[0].name, "tests-pass");
    assert.strictEqual(buildStage.quality_gates[0].condition, "exit code 0");
    assert.strictEqual(buildStage.quality_gates[0].failure_action, "block");

    const deployStage = pipeline.stages.find((s) => s.name === "deploy");
    assert.deepStrictEqual(deployStage.triggers, ["manual"]);
    assert.deepStrictEqual(deployStage.quality_gates, []);

    // Quality gates (top-level)
    assert.strictEqual(m.quality_gates.length, 1);
    assert.strictEqual(m.quality_gates[0].category, "testing");
    assert.strictEqual(m.quality_gates[0].key, "coverage");

    // Environments with nested infra and vars
    assert.strictEqual(m.environments.length, 1);
    const env = m.environments[0];
    assert.strictEqual(env.name, "production");
    assert.strictEqual(env.deployment_method, "kubernetes");
    assert.strictEqual(env.url, "https://app.example.com");
    assert.strictEqual(env.infra.length, 1);
    assert.strictEqual(env.infra[0].provider, "AWS");
    assert.strictEqual(env.infra[0].resource, "EKS cluster");
    assert.strictEqual(env.vars.length, 1);
    assert.strictEqual(env.vars[0].name, "DATABASE_URL");
    assert.strictEqual(env.vars[0].value_source, "secrets-manager");

    // Artifacts with parsed platforms
    assert.strictEqual(m.artifacts.length, 1);
    assert.strictEqual(m.artifacts[0].name, "api-image");
    assert.deepStrictEqual(m.artifacts[0].platforms, ["linux/amd64", "linux/arm64"]);
    assert.strictEqual(m.artifacts[0].versioning, "semantic");

    // Signing
    assert.strictEqual(m.signing.length, 1);
    assert.strictEqual(m.signing[0].enabled, 1);
    assert.strictEqual(m.signing[0].signing_method, "cosign");

    // Local executables with parsed platforms and channels
    assert.strictEqual(m.local_executables.length, 1);
    assert.deepStrictEqual(m.local_executables[0].platforms, ["macos", "linux"]);
    assert.deepStrictEqual(m.local_executables[0].channels, ["stable", "beta"]);

    // Secrets
    assert.strictEqual(m.secrets.length, 1);
    assert.strictEqual(m.secrets[0].name, "DB_PASSWORD");
    assert.strictEqual(m.secrets[0].rotation_policy, "90 days");

    // Health checks
    assert.strictEqual(m.health_checks.length, 1);
    assert.strictEqual(m.health_checks[0].name, "api-health");
    assert.strictEqual(m.health_checks[0].endpoint, "/healthz");

    // Alerting
    assert.strictEqual(m.alerting.length, 1);
    assert.strictEqual(m.alerting[0].provider, "PagerDuty");
    assert.strictEqual(m.alerting[0].channel, "#ops-alerts");

    // Runbooks with nested steps
    assert.strictEqual(m.runbooks.length, 1);
    assert.strictEqual(m.runbooks[0].name, "Rollback Procedure");
    assert.strictEqual(m.runbooks[0].scenario, "Failed deployment");
    assert.strictEqual(m.runbooks[0].steps.length, 2);
    assert.strictEqual(m.runbooks[0].steps[0].step, "Check dashboard");
    assert.strictEqual(m.runbooks[0].steps[0].is_rollback, 0);
    assert.strictEqual(m.runbooks[0].steps[1].step, "Run kubectl rollback");
    assert.strictEqual(m.runbooks[0].steps[1].is_rollback, 1);

    // Review checklist
    assert.strictEqual(m.review_checklist.length, 2);
    const secretsCheck = m.review_checklist.find((c) => c.check_name === "Secrets rotated");
    assert.strictEqual(secretsCheck.passed, 1);
  });

  it("does not attach child data when include_related is false", () => {
    const mResult = handleWriteTool("changelog_insert", {
      entity_type: "deployment_manifest",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        status: "not_ready",
        targets: ["staging"],
        pipelines: [{ platform: "CircleCI" }],
        review_checklist: [{ check_name: "Check", passed: false }],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "deployment_manifest",
      ids: [mResult.id],
    });
    assert.strictEqual(r.count, 1);
    const m = r.results[0];
    // targets and blockers should be raw JSON strings (not parsed)
    assert.strictEqual(typeof m.targets, "string");
    assert.strictEqual(typeof m.blockers, "string");
    // No child data attached
    assert.strictEqual(m.pipelines, undefined);
    assert.strictEqual(m.quality_gates, undefined);
    assert.strictEqual(m.environments, undefined);
    assert.strictEqual(m.artifacts, undefined);
    assert.strictEqual(m.signing, undefined);
    assert.strictEqual(m.local_executables, undefined);
    assert.strictEqual(m.secrets, undefined);
    assert.strictEqual(m.health_checks, undefined);
    assert.strictEqual(m.alerting, undefined);
    assert.strictEqual(m.runbooks, undefined);
    assert.strictEqual(m.review_checklist, undefined);
  });

  it("returns empty arrays for manifest with no children", () => {
    const mResult = handleWriteTool("changelog_insert", {
      entity_type: "deployment_manifest",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { status: "not_ready" },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "deployment_manifest",
      ids: [mResult.id],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const m = r.results[0];
    assert.deepStrictEqual(m.targets, []);
    assert.deepStrictEqual(m.blockers, []);
    assert.deepStrictEqual(m.pipelines, []);
    assert.deepStrictEqual(m.quality_gates, []);
    assert.deepStrictEqual(m.environments, []);
    assert.deepStrictEqual(m.artifacts, []);
    assert.deepStrictEqual(m.signing, []);
    assert.deepStrictEqual(m.local_executables, []);
    assert.deepStrictEqual(m.secrets, []);
    assert.deepStrictEqual(m.health_checks, []);
    assert.deepStrictEqual(m.alerting, []);
    assert.deepStrictEqual(m.runbooks, []);
    assert.deepStrictEqual(m.review_checklist, []);
  });
});
