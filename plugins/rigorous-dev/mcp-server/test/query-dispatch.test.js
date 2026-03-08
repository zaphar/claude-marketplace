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
