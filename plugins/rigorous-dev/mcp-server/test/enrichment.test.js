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
// queryRequirement enrichment
// ───────────────────────────────────────────────────────────────

describe("queryRequirement enrichment", () => {
  it("attaches acceptance_criteria, personas, and depends_on when include_related is true", () => {
    // Create prerequisite persona
    handleWriteTool("changelog_insert", {
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-1", name: "Dev", description: "Developer" },
    });
    // Create dependency requirement
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-DEP", description: "Dependency", priority: "must-have", category: "functional" },
    });
    // Create main requirement with acceptance criteria, persona links, and dependency
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "REQ-1",
        description: "User login",
        priority: "must-have",
        category: "functional",
        acceptance_criteria: ["User can log in with email", "Session persists across refreshes"],
        personas: ["P-1"],
        depends_on: ["REQ-DEP"],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "requirement",
      ids: ["REQ-1"],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const req = r.results[0];

    // Acceptance criteria — parsed from JSON
    assert.deepStrictEqual(req.acceptance_criteria, [
      "User can log in with email",
      "Session persists across refreshes",
    ]);

    // Personas — mapped to persona_id string array
    assert.deepStrictEqual(req.personas, ["P-1"]);

    // Dependencies — mapped to depends_on string array
    assert.deepStrictEqual(req.depends_on, ["REQ-DEP"]);
  });

  it("does not attach child data when include_related is false", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "REQ-NOENRICH",
        description: "No enrichment",
        priority: "should-have",
        category: "functional",
        acceptance_criteria: ["Something"],
        personas: [],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "requirement",
      ids: ["REQ-NOENRICH"],
    });
    assert.strictEqual(r.count, 1);
    // Without include_related, acceptance_criteria should be raw JSON string
    assert.strictEqual(typeof r.results[0].acceptance_criteria, "string");
    assert.strictEqual(r.results[0].personas, undefined);
    assert.strictEqual(r.results[0].depends_on, undefined);
  });

  it("returns empty arrays for requirement with no personas or dependencies", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-EMPTY", description: "Bare", priority: "nice-to-have", category: "functional" },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "requirement",
      ids: ["REQ-EMPTY"],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    assert.deepStrictEqual(r.results[0].acceptance_criteria, []);
    assert.deepStrictEqual(r.results[0].personas, []);
    assert.deepStrictEqual(r.results[0].depends_on, []);
  });
});

// ───────────────────────────────────────────────────────────────
// queryAdr enrichment
// ───────────────────────────────────────────────────────────────

describe("queryAdr enrichment", () => {
  it("attaches alternatives with pros/cons, consequences, and research_sources when include_related is true", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "adr",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "ADR-1",
        title: "Use PostgreSQL",
        decision: "Use PostgreSQL for data storage",
        rationale: "Battle-tested relational DB",
        consequences: ["Need DBA expertise", "Migration from SQLite"],
        research_sources: ["https://postgresql.org", "internal-benchmarks"],
        alternatives_considered: [
          { option_text: "MongoDB", pros: ["Flexible schema"], cons: ["No ACID by default"] },
          { option_text: "SQLite", pros: ["Simple"], cons: ["No concurrent writes", "Single file"] },
        ],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "adr",
      ids: ["ADR-1"],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const adr = r.results[0];

    // Alternatives — from adr_alternative table with parsed pros/cons
    assert.strictEqual(adr.alternatives.length, 2);
    const mongo = adr.alternatives.find((a) => a.option_text === "MongoDB");
    assert.deepStrictEqual(mongo.pros, ["Flexible schema"]);
    assert.deepStrictEqual(mongo.cons, ["No ACID by default"]);
    assert.ok(mongo.id); // has autoincrement id
    assert.strictEqual(mongo.adr_id, "ADR-1");
    const sqlite = adr.alternatives.find((a) => a.option_text === "SQLite");
    assert.deepStrictEqual(sqlite.cons, ["No concurrent writes", "Single file"]);

    // Consequences — parsed from JSON
    assert.deepStrictEqual(adr.consequences, ["Need DBA expertise", "Migration from SQLite"]);

    // Research sources — parsed from JSON
    assert.deepStrictEqual(adr.research_sources, ["https://postgresql.org", "internal-benchmarks"]);
  });

  it("does not attach child data when include_related is false", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "adr",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "ADR-NOENRICH",
        title: "No Enrichment",
        decision: "Just testing",
        rationale: "Verification",
        consequences: ["Something"],
        alternatives_considered: [{ option_text: "Alt" }],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "adr",
      ids: ["ADR-NOENRICH"],
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].alternatives, undefined);
    // consequences should be raw JSON string
    assert.strictEqual(typeof r.results[0].consequences, "string");
    assert.strictEqual(typeof r.results[0].research_sources, "string");
  });

  it("returns empty arrays for ADR with no alternatives or consequences", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "adr",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "ADR-EMPTY", title: "Bare", decision: "Nothing", rationale: "Testing" },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "adr",
      ids: ["ADR-EMPTY"],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    assert.deepStrictEqual(r.results[0].alternatives, []);
    assert.deepStrictEqual(r.results[0].consequences, []);
    assert.deepStrictEqual(r.results[0].research_sources, []);
  });
});

// ───────────────────────────────────────────────────────────────
// queryScreen enrichment
// ───────────────────────────────────────────────────────────────

describe("queryScreen enrichment", () => {
  it("attaches components, states, and responsive_variants when include_related is true", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "screen",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "SCR-1",
        name: "Dashboard",
        purpose: "Main user dashboard",
        components: ["Sidebar", "Header", "ContentArea"],
        states: [
          { name: "loading", description: "Data is loading", wireframe_path: "/wireframes/dash-loading.png" },
          { name: "loaded", description: "Data displayed" },
        ],
        responsive_variants: [
          { breakpoint: "mobile", wireframe_path: "/wireframes/dash-mobile.png", layout_changes: "Stack sidebar" },
          { breakpoint: "tablet" },
        ],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "screen",
      ids: ["SCR-1"],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const screen = r.results[0];

    // Components — parsed from JSON
    assert.deepStrictEqual(screen.components, ["Sidebar", "Header", "ContentArea"]);

    // States — from screen_state table
    assert.strictEqual(screen.states.length, 2);
    const loading = screen.states.find((s) => s.name === "loading");
    assert.strictEqual(loading.description, "Data is loading");
    assert.strictEqual(loading.wireframe_path, "/wireframes/dash-loading.png");
    const loaded = screen.states.find((s) => s.name === "loaded");
    assert.strictEqual(loaded.wireframe_path, null);

    // Responsive variants — from screen_responsive_variant table
    assert.strictEqual(screen.responsive_variants.length, 2);
    const mobile = screen.responsive_variants.find((v) => v.breakpoint === "mobile");
    assert.strictEqual(mobile.wireframe_path, "/wireframes/dash-mobile.png");
    assert.strictEqual(mobile.layout_changes, "Stack sidebar");
    const tablet = screen.responsive_variants.find((v) => v.breakpoint === "tablet");
    assert.strictEqual(tablet.wireframe_path, null);
    assert.strictEqual(tablet.layout_changes, null);
  });

  it("does not attach child data when include_related is false", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "screen",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        id: "SCR-NOENRICH",
        name: "Simple",
        purpose: "Test",
        components: ["Widget"],
        states: [{ name: "default" }],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "screen",
      ids: ["SCR-NOENRICH"],
    });
    assert.strictEqual(r.count, 1);
    // components should be raw JSON string
    assert.strictEqual(typeof r.results[0].components, "string");
    assert.strictEqual(r.results[0].states, undefined);
    assert.strictEqual(r.results[0].responsive_variants, undefined);
  });

  it("returns empty arrays for screen with no children", () => {
    handleWriteTool("changelog_insert", {
      entity_type: "screen",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "SCR-EMPTY", name: "Bare", purpose: "Nothing" },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "screen",
      ids: ["SCR-EMPTY"],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    assert.deepStrictEqual(r.results[0].components, []);
    assert.deepStrictEqual(r.results[0].states, []);
    assert.deepStrictEqual(r.results[0].responsive_variants, []);
  });
});

// ───────────────────────────────────────────────────────────────
// queryTestReport enrichment
// ───────────────────────────────────────────────────────────────

describe("queryTestReport enrichment", () => {
  it("attaches all child data with nested structure when include_related is true", () => {
    // Create prerequisite requirement for coverage and case links
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-TR1", description: "Auth flow", priority: "must-have", category: "functional" },
    });
    // Insert test report with all child types
    const writeResult = handleWriteTool("changelog_insert", {
      entity_type: "test_report",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        total_tests: 25,
        passed_count: 23,
        failed: 1,
        skipped: 1,
        status: "fail",
        coverage: [
          {
            requirement_id: "REQ-TR1",
            status: "partial",
            criteria: [
              { criterion: "Login works", status: "pass", test_ids: ["t1", "t2"] },
              { criterion: "Session persists", status: "fail", notes: "Timeout issue" },
            ],
          },
        ],
        suites: [
          {
            name: "Auth Suite",
            type: "integration",
            cases: [
              { test_id: "t1", name: "login-success", status: "pass", duration_ms: 150, requirements: ["REQ-TR1"] },
              { test_id: "t2", name: "login-fail", status: "fail", error_message: "Timeout", requirements: ["REQ-TR1"] },
            ],
          },
        ],
        security_findings: [
          { category: "xss", description: "Reflected XSS in search", recommendation: "Sanitize input", severity: "high" },
        ],
        performance_benchmarks: [
          { name: "login-latency", metric: "p99", measured_value: 250, unit: "ms", threshold: 500, status: "pass" },
        ],
        blockers: [
          { description: "Auth timeout", severity: "critical", recommendation: "Increase timeout", requirements: ["REQ-TR1"] },
        ],
        recommendations: [
          { category: "reliability", description: "Add retry logic", priority: "high" },
        ],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "test_report",
      ids: [writeResult.id],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const report = r.results[0];

    // Coverage — test_requirement_coverage with nested criteria
    assert.strictEqual(report.coverage.length, 1);
    assert.strictEqual(report.coverage[0].requirement_id, "REQ-TR1");
    assert.strictEqual(report.coverage[0].status, "partial");
    assert.strictEqual(report.coverage[0].criteria.length, 2);
    const loginCrit = report.coverage[0].criteria.find((c) => c.criterion === "Login works");
    assert.strictEqual(loginCrit.status, "pass");
    assert.deepStrictEqual(loginCrit.test_ids, ["t1", "t2"]);
    const sessionCrit = report.coverage[0].criteria.find((c) => c.criterion === "Session persists");
    assert.strictEqual(sessionCrit.notes, "Timeout issue");

    // Suites — test_suite with nested cases and case requirements
    assert.strictEqual(report.suites.length, 1);
    assert.strictEqual(report.suites[0].name, "Auth Suite");
    assert.strictEqual(report.suites[0].suite_type, "integration");
    assert.strictEqual(report.suites[0].cases.length, 2);
    const loginCase = report.suites[0].cases.find((c) => c.test_id === "t1");
    assert.strictEqual(loginCase.name, "login-success");
    assert.strictEqual(loginCase.status, "pass");
    assert.strictEqual(loginCase.duration_ms, 150);
    assert.deepStrictEqual(loginCase.requirements, ["REQ-TR1"]);
    const failCase = report.suites[0].cases.find((c) => c.test_id === "t2");
    assert.strictEqual(failCase.error_message, "Timeout");
    assert.deepStrictEqual(failCase.requirements, ["REQ-TR1"]);

    // Security findings
    assert.strictEqual(report.security_findings.length, 1);
    assert.strictEqual(report.security_findings[0].category, "xss");
    assert.strictEqual(report.security_findings[0].severity, "high");

    // Performance benchmarks
    assert.strictEqual(report.performance_benchmarks.length, 1);
    assert.strictEqual(report.performance_benchmarks[0].name, "login-latency");
    assert.strictEqual(report.performance_benchmarks[0].measured_value, 250);
    assert.strictEqual(report.performance_benchmarks[0].status, "pass");

    // Blockers — with nested requirements
    assert.strictEqual(report.blockers.length, 1);
    assert.strictEqual(report.blockers[0].description, "Auth timeout");
    assert.deepStrictEqual(report.blockers[0].requirements, ["REQ-TR1"]);

    // Recommendations
    assert.strictEqual(report.recommendations.length, 1);
    assert.strictEqual(report.recommendations[0].category, "reliability");
    assert.strictEqual(report.recommendations[0].priority, "high");
  });

  it("does not attach child data when include_related is false", () => {
    const writeResult = handleWriteTool("changelog_insert", {
      entity_type: "test_report",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        total_tests: 5,
        passed_count: 5,
        failed: 0,
        skipped: 0,
        status: "pass",
        suites: [{ name: "Unit", type: "unit", cases: [{ test_id: "t1", name: "test", status: "pass" }] }],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "test_report",
      ids: [writeResult.id],
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].coverage, undefined);
    assert.strictEqual(r.results[0].suites, undefined);
    assert.strictEqual(r.results[0].security_findings, undefined);
    assert.strictEqual(r.results[0].performance_benchmarks, undefined);
    assert.strictEqual(r.results[0].blockers, undefined);
    assert.strictEqual(r.results[0].recommendations, undefined);
  });

  it("returns empty arrays for report with no children", () => {
    const writeResult = handleWriteTool("changelog_insert", {
      entity_type: "test_report",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { total_tests: 0, passed_count: 0, failed: 0, skipped: 0, status: "pass" },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "test_report",
      ids: [writeResult.id],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const report = r.results[0];
    assert.deepStrictEqual(report.coverage, []);
    assert.deepStrictEqual(report.suites, []);
    assert.deepStrictEqual(report.security_findings, []);
    assert.deepStrictEqual(report.performance_benchmarks, []);
    assert.deepStrictEqual(report.blockers, []);
    assert.deepStrictEqual(report.recommendations, []);
  });
});

// ───────────────────────────────────────────────────────────────
// queryDocumentationManifest enrichment
// ───────────────────────────────────────────────────────────────

describe("queryDocumentationManifest enrichment", () => {
  it("attaches all child data with nested requirements when include_related is true", () => {
    // Create prerequisite requirement for feature and coverage links
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-DOC1", description: "Auth docs", priority: "must-have", category: "functional" },
    });
    // Insert documentation manifest with all child types
    const writeResult = handleWriteTool("changelog_insert", {
      entity_type: "documentation_manifest",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        status: "complete",
        total_pages: 12,
        sections: [
          { category: "guide", key: "getting-started", value: "Setup steps", path: "/docs/getting-started.md" },
          { category: "reference", key: "api", value: "API reference" },
        ],
        features: [
          {
            name: "Authentication",
            path: "/docs/auth.md",
            includes_examples: true,
            includes_screenshots: false,
            requirements: ["REQ-DOC1"],
          },
        ],
        coverage: [
          {
            requirement_id: "REQ-DOC1",
            documented: true,
            user_facing: true,
            notes: "Full coverage",
            paths: ["/docs/auth.md", "/docs/getting-started.md"],
          },
        ],
        assets: [
          { path: "/docs/img/login.png", type: "screenshot", description: "Login page", alt_text: "Login form" },
        ],
        verification: [
          { check_name: "links_valid", passed: true },
          { check_name: "spelling_check", passed: false },
        ],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "documentation_manifest",
      ids: [writeResult.id],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const manifest = r.results[0];

    // documents_created — count of sections
    assert.strictEqual(manifest.documents_created, 2);

    // Sections — from documentation_section table
    assert.strictEqual(manifest.sections.length, 2);
    const guide = manifest.sections.find((s) => s.key === "getting-started");
    assert.strictEqual(guide.category, "guide");
    assert.strictEqual(guide.value, "Setup steps");
    assert.strictEqual(guide.path, "/docs/getting-started.md");
    const api = manifest.sections.find((s) => s.key === "api");
    assert.strictEqual(api.path, null);

    // Features — from documentation_feature with nested requirements
    assert.strictEqual(manifest.features.length, 1);
    assert.strictEqual(manifest.features[0].name, "Authentication");
    assert.strictEqual(manifest.features[0].path, "/docs/auth.md");
    assert.strictEqual(manifest.features[0].includes_examples, 1);
    assert.strictEqual(manifest.features[0].includes_screenshots, 0);
    assert.deepStrictEqual(manifest.features[0].requirements, ["REQ-DOC1"]);

    // Coverage — from documentation_requirement_coverage with parsed paths
    assert.strictEqual(manifest.coverage.length, 1);
    assert.strictEqual(manifest.coverage[0].requirement_id, "REQ-DOC1");
    assert.strictEqual(manifest.coverage[0].documented, 1);
    assert.strictEqual(manifest.coverage[0].user_facing, 1);
    assert.strictEqual(manifest.coverage[0].notes, "Full coverage");
    assert.deepStrictEqual(manifest.coverage[0].paths, ["/docs/auth.md", "/docs/getting-started.md"]);

    // Assets — from documentation_asset table
    assert.strictEqual(manifest.assets.length, 1);
    assert.strictEqual(manifest.assets[0].path, "/docs/img/login.png");
    assert.strictEqual(manifest.assets[0].asset_type, "screenshot");
    assert.strictEqual(manifest.assets[0].alt_text, "Login form");

    // Verification — from documentation_review_checklist table
    assert.strictEqual(manifest.verification.length, 2);
    const linksCheck = manifest.verification.find((v) => v.check_name === "links_valid");
    assert.strictEqual(linksCheck.passed, 1);
    const spellCheck = manifest.verification.find((v) => v.check_name === "spelling_check");
    assert.strictEqual(spellCheck.passed, 0);
  });

  it("does not attach child data when include_related is false", () => {
    const writeResult = handleWriteTool("changelog_insert", {
      entity_type: "documentation_manifest",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: {
        status: "partial",
        sections: [{ category: "guide", key: "intro", value: "Intro" }],
        features: [{ name: "Feature", path: "/docs/feat.md" }],
      },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "documentation_manifest",
      ids: [writeResult.id],
    });
    assert.strictEqual(r.count, 1);
    assert.strictEqual(r.results[0].sections, undefined);
    assert.strictEqual(r.results[0].features, undefined);
    assert.strictEqual(r.results[0].coverage, undefined);
    assert.strictEqual(r.results[0].assets, undefined);
    assert.strictEqual(r.results[0].verification, undefined);
    assert.strictEqual(r.results[0].documents_created, undefined);
  });

  it("returns empty arrays for manifest with no children", () => {
    const writeResult = handleWriteTool("changelog_insert", {
      entity_type: "documentation_manifest",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { status: "blocked" },
    });
    const r = handleReadTool("changelog_query", {
      entity_type: "documentation_manifest",
      ids: [writeResult.id],
      include_related: true,
    });
    assert.strictEqual(r.count, 1);
    const manifest = r.results[0];
    assert.strictEqual(manifest.documents_created, 0);
    assert.deepStrictEqual(manifest.sections, []);
    assert.deepStrictEqual(manifest.features, []);
    assert.deepStrictEqual(manifest.coverage, []);
    assert.deepStrictEqual(manifest.assets, []);
    assert.deepStrictEqual(manifest.verification, []);
  });
});
