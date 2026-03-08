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

// Helper: insert an entity and query it back
function insertAndQuery(entityType, data, queryOpts = {}) {
  const writeResult = handleWriteTool("changelog_insert", {
    entity_type: entityType,
    iteration_id: seed.iteration_id,
    revision_id: seed.revision_id,
    data,
  });
  assert.strictEqual(writeResult.entity_type, entityType);

  const readResult = handleReadTool("changelog_query", {
    entity_type: entityType,
    iteration_id: seed.iteration_id,
    ...queryOpts,
  });
  assert.ok(readResult.results.length > 0, `Expected results for ${entityType}`);
  return { writeResult, readResult };
}

// ───────────────────────────────────────────────────────────────
// TEXT-PK entity types (upsert + snapshot)
// ───────────────────────────────────────────────────────────────

describe("persona", () => {
  it("inserts and queries back", () => {
    const { readResult } = insertAndQuery("persona", {
      id: "P-1",
      name: "Developer",
      description: "Builds software",
      technical_level: "expert",
    });
    assert.strictEqual(readResult.results[0].id, "P-1");
    assert.strictEqual(readResult.results[0].name, "Developer");
  });
});

describe("requirement", () => {
  it("inserts with personas and dependencies", () => {
    // Insert persona first as FK target
    handleWriteTool("changelog_insert", {
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-1", name: "Dev", description: "Developer" },
    });
    const { readResult } = insertAndQuery(
      "requirement",
      {
        id: "REQ-1",
        description: "Must handle auth",
        priority: "must-have",
        category: "functional",
        acceptance_criteria: ["Login works"],
        personas: ["P-1"],
      },
      { include_related: true }
    );
    assert.strictEqual(readResult.results[0].id, "REQ-1");
    assert.strictEqual(readResult.results[0].priority, "must-have");
  });
});

describe("adr", () => {
  it("inserts with alternatives", () => {
    const { readResult } = insertAndQuery(
      "adr",
      {
        id: "ADR-1",
        title: "Use SQLite",
        decision: "We will use SQLite",
        rationale: "Simple and embedded",
        alternatives_considered: [
          { option_text: "PostgreSQL", pros: ["scalable"], cons: ["complex"] },
        ],
      },
      { include_related: true }
    );
    assert.strictEqual(readResult.results[0].id, "ADR-1");
    assert.strictEqual(readResult.results[0].title, "Use SQLite");
  });
});

describe("component", () => {
  it("inserts with interfaces and dependencies", () => {
    const { readResult } = insertAndQuery(
      "component",
      {
        id: "auth-service",
        name: "Auth Service",
        purpose: "Handles authentication",
        type: "service",
        interfaces: [{ name: "login", type: "api", description: "Login endpoint" }],
      },
      { include_related: true }
    );
    assert.strictEqual(readResult.results[0].id, "auth-service");
  });
});

describe("user_flow", () => {
  it("inserts with steps, error states, branches", () => {
    const { readResult } = insertAndQuery(
      "user_flow",
      {
        id: "login-flow",
        name: "Login Flow",
        goal: "User authenticates",
        steps: [
          { step_number: 1, action: "Enter credentials", branches: [{ condition: "valid", next_step: 2 }] },
          { step_number: 2, action: "Dashboard shown" },
        ],
        error_states: [{ condition: "wrong password", recovery: "Show error" }],
      },
      { include_related: true }
    );
    assert.strictEqual(readResult.results[0].id, "login-flow");
  });
});

describe("screen", () => {
  it("inserts with states and variants", () => {
    const { readResult } = insertAndQuery(
      "screen",
      {
        id: "login-screen",
        name: "Login Screen",
        purpose: "User authentication",
        states: [{ name: "empty", description: "Initial state" }],
        responsive_variants: [{ breakpoint: "mobile", layout_changes: "stack" }],
      },
      { include_related: true }
    );
    assert.strictEqual(readResult.results[0].id, "login-screen");
  });
});

// ───────────────────────────────────────────────────────────────
// INTEGER-PK entity types (append-only)
// ───────────────────────────────────────────────────────────────

describe("architecture_overview", () => {
  it("inserts with diagrams", () => {
    const { readResult } = insertAndQuery(
      "architecture_overview",
      {
        description: "Monolith architecture",
        principles: ["simplicity"],
        diagrams: [{ name: "overview", path: "/docs/arch.png" }],
      },
      { include_related: true }
    );
    assert.strictEqual(readResult.results[0].description, "Monolith architecture");
  });
});

describe("data_entity", () => {
  it("inserts with attributes", () => {
    const { readResult } = insertAndQuery(
      "data_entity",
      {
        name: "User",
        description: "Application user",
        attributes: [
          { name: "email", data_type: "string", is_required: 1 },
        ],
      },
      { include_related: true }
    );
    assert.strictEqual(readResult.results[0].name, "User");
  });
});

describe("technology_choice", () => {
  it("inserts and queries back", () => {
    const { readResult } = insertAndQuery("technology_choice", {
      category: "runtime",
      name: "Node.js",
      purpose: "Server runtime",
      rationale: "JavaScript ecosystem",
      version: "18",
    });
    assert.strictEqual(readResult.results[0].name, "Node.js");
  });
});

describe("requirement_trace", () => {
  it("inserts mapping from requirement to component", () => {
    // Insert requirement + component first
    handleWriteTool("changelog_insert", {
      entity_type: "requirement",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "REQ-1", description: "Auth", priority: "must-have", category: "functional" },
    });
    handleWriteTool("changelog_insert", {
      entity_type: "component",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "auth-svc", name: "Auth", purpose: "Auth", type: "service" },
    });
    const { readResult } = insertAndQuery("requirement_trace", {
      requirement_id: "REQ-1",
      addressed_by: "auth-svc",
      addressed_by_type: "component",
    });
    assert.strictEqual(readResult.results[0].requirement_id, "REQ-1");
  });
});

// ───────────────────────────────────────────────────────────────
// Batch inserters (accept arrays)
// ───────────────────────────────────────────────────────────────

describe("architecture_config", () => {
  it("inserts batch of configs", () => {
    const { writeResult, readResult } = insertAndQuery("architecture_config", [
      { config_type: "security", category: "tls", key: "TLS", value: "required", target: "api" },
      { config_type: "observability", category: "logging", key: "level", value: "info" },
    ]);
    assert.ok(readResult.results.length >= 2);
  });
});

describe("approved_dependency", () => {
  it("inserts single dependency", () => {
    const { readResult } = insertAndQuery("approved_dependency", {
      package: "better-sqlite3",
      purpose: "SQLite driver",
      justification: "Sync API",
      version_constraint: "^11.0.0",
    });
    assert.strictEqual(readResult.results[0].package, "better-sqlite3");
  });
});

describe("project_context", () => {
  it("inserts key-value context", () => {
    const { readResult } = insertAndQuery("project_context", {
      key: "language",
      value: "TypeScript",
      category: "tech",
    });
    assert.strictEqual(readResult.results[0].key, "language");
  });
});

describe("system_io", () => {
  it("inserts I/O entries", () => {
    const { readResult } = insertAndQuery("system_io", {
      direction: "input",
      name: "HTTP Request",
      description: "Incoming API call",
    });
    assert.strictEqual(readResult.results[0].direction, "input");
  });
});

describe("deployment_requirement", () => {
  it("inserts deployment requirement", () => {
    const { readResult } = insertAndQuery("deployment_requirement", {
      description: "Node 18+ required",
      target: "production",
    });
    assert.strictEqual(readResult.results[0].description, "Node 18+ required");
  });
});

describe("operational_requirement", () => {
  it("inserts operational requirement", () => {
    const { readResult } = insertAndQuery("operational_requirement", {
      item: "Log rotation",
      category: "logging",
    });
    assert.strictEqual(readResult.results[0].item, "Log rotation");
  });
});

describe("technology_constraint", () => {
  it("inserts technology constraint", () => {
    const { readResult } = insertAndQuery("technology_constraint", {
      constraint_type: "min_node_version",
      value: "18",
    });
    assert.strictEqual(readResult.results[0].value, "18");
  });
});

describe("ux_config", () => {
  it("inserts UX config", () => {
    const { readResult } = insertAndQuery("ux_config", {
      config_type: "design_system",
      category: "theme",
      key: "primary",
      value: "#0066cc",
    });
    assert.strictEqual(readResult.results[0].key, "primary");
  });
});

describe("info_architecture", () => {
  it("inserts info architecture entry", () => {
    const { readResult } = insertAndQuery("info_architecture", {
      category: "navigation",
      key: "main-menu",
      value: "Dashboard, Settings",
    });
    assert.strictEqual(readResult.results[0].key, "main-menu");
  });
});

describe("persona_addressed", () => {
  it("inserts persona addressed", () => {
    // Insert persona first
    handleWriteTool("changelog_insert", {
      entity_type: "persona",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { id: "P-1", name: "Dev", description: "Developer" },
    });
    const { readResult } = insertAndQuery("persona_addressed", {
      persona_id: "P-1",
      goal: "Quick login",
      how_addressed: "SSO integration",
    });
    assert.strictEqual(readResult.results[0].goal, "Quick login");
  });
});

describe("ux_asset", () => {
  it("inserts UX asset", () => {
    const { readResult } = insertAndQuery("ux_asset", {
      name: "Logo",
      path: "/assets/logo.svg",
      type: "image",
    });
    assert.strictEqual(readResult.results[0].name, "Logo");
  });
});

// ───────────────────────────────────────────────────────────────
// Planning entities
// ───────────────────────────────────────────────────────────────

describe("plan_phase", () => {
  it("inserts with requirements and endpoints", () => {
    const { readResult } = insertAndQuery(
      "plan_phase",
      {
        phase_number: 1,
        name: "auth-module",
        type: "feature",
        goal: "Auth implementation",
        api_endpoints: [{ http_method: "POST", route: "/login" }],
        risks: [{ risk: "Scope creep", mitigation: "Strict requirements" }],
      },
      { include_related: true }
    );
    assert.strictEqual(readResult.results[0].name, "auth-module");
  });
});

describe("plan_overview", () => {
  it("inserts with risks", () => {
    const { readResult } = insertAndQuery(
      "plan_overview",
      {
        strategy: "Incremental delivery",
        rationale: "Lower risk",
        risks: [{ risk: "Integration delays" }],
      },
      { include_related: true }
    );
    assert.strictEqual(readResult.results[0].strategy, "Incremental delivery");
  });
});

describe("plan_external_dependency", () => {
  it("inserts external dependency", () => {
    const { readResult } = insertAndQuery("plan_external_dependency", {
      name: "OAuth provider",
      description: "Google OAuth API",
      risk_level: "medium",
    });
    assert.strictEqual(readResult.results[0].name, "OAuth provider");
  });
});

describe("plan_phase with critical_path_sequence", () => {
  it("inserts plan_phase with critical_path_sequence", () => {
    const { writeResult, readResult } = insertAndQuery("plan_phase", {
      phase_number: 1,
      name: "setup",
      type: "feature",
      goal: "Initial setup",
      critical_path_sequence: 1,
    });
    assert.strictEqual(writeResult.entity_type, "plan_phase");
    assert.ok(readResult.results.length > 0);
    assert.strictEqual(readResult.results[0].critical_path_sequence, 1);
  });

  it("inserts plan_phase without critical_path_sequence (defaults to null)", () => {
    const { readResult } = insertAndQuery("plan_phase", {
      phase_number: 2,
      name: "build",
      type: "feature",
      goal: "Build things",
    });
    assert.strictEqual(readResult.results[0].critical_path_sequence, null);
  });
});

describe("plan_metadata", () => {
  it("inserts plan metadata", () => {
    const { readResult } = insertAndQuery("plan_metadata", {
      title: "MVP Plan",
      version: "1.0",
      document_date: "2024-01-01",
      status: "draft",
      requirements_version: "1.0",
      architecture_version: "1.0",
      ux_specification_version: "1.0",
    });
    assert.strictEqual(readResult.results[0].title, "MVP Plan");
  });
});

// ───────────────────────────────────────────────────────────────
// Implementation / Doc / Deploy / Test manifests
// ───────────────────────────────────────────────────────────────

describe("implementation_manifest", () => {
  it("inserts with files and requirement status", () => {
    const ppResult = handleWriteTool("changelog_insert", {
      entity_type: "plan_phase",
      iteration_id: seed.iteration_id,
      revision_id: seed.revision_id,
      data: { phase_number: 1, name: "impl", type: "feature", goal: "Implement" },
    });
    const { readResult } = insertAndQuery(
      "implementation_manifest",
      {
        plan_phase_id: ppResult.id,
        status: "partial",
        files: [{ path: "src/auth.js", file_operation: "created", purpose: "Auth module" }],
      },
      { include_related: true }
    );
    assert.strictEqual(readResult.results[0].status, "partial");
  });
});

describe("test_report", () => {
  it("inserts with suites and cases", () => {
    const { readResult } = insertAndQuery(
      "test_report",
      {
        total_tests: 10,
        passed_count: 9,
        failed: 1,
        skipped: 0,
        status: "fail",
        suites: [
          {
            name: "Auth Tests",
            type: "unit",
            cases: [
              { test_id: "t1", name: "login", status: "pass" },
              { test_id: "t2", name: "logout", status: "fail", error_message: "Timeout" },
            ],
          },
        ],
      },
      { include_related: true }
    );
    assert.strictEqual(readResult.results[0].total_tests, 10);
  });
});

describe("documentation_manifest", () => {
  it("inserts with sections and features", () => {
    const { readResult } = insertAndQuery(
      "documentation_manifest",
      {
        status: "complete",
        sections: [{ category: "guide", key: "getting-started", value: "Setup steps" }],
        features: [{ name: "Auth", path: "/docs/auth.md", includes_examples: true }],
      },
      { include_related: true }
    );
    assert.strictEqual(readResult.results[0].status, "complete");
  });
});

describe("deployment_manifest", () => {
  it("inserts with pipelines and environments", () => {
    const { readResult } = insertAndQuery(
      "deployment_manifest",
      {
        status: "ready",
        targets: ["production"],
        pipelines: [
          {
            platform: "github-actions",
            config_files: ["ci.yml"],
            stages: [
              {
                name: "build",
                purpose: "Build artifacts",
                quality_gates: [{ name: "tests", condition: "pass", failure_action: "block" }],
              },
            ],
          },
        ],
        environments: [
          {
            name: "prod",
            deployment_method: "docker",
            infra: [{ provider: "aws", resource: "ECS" }],
            vars: [{ name: "NODE_ENV", value_source: "secret", description: "Environment" }],
          },
        ],
      },
      { include_related: true }
    );
    assert.strictEqual(readResult.results[0].status, "ready");
  });
});

// ───────────────────────────────────────────────────────────────
// Remaining append-only entities
// ───────────────────────────────────────────────────────────────

describe("vcs_commit (via changelog_insert)", () => {
  it("inserts commit record", () => {
    const { readResult } = insertAndQuery("vcs_commit", {
      commit_sha: "abc123",
      message: "Initial commit",
    });
    assert.strictEqual(readResult.results[0].commit_sha, "abc123");
  });
});

describe("intermediate_asset", () => {
  it("inserts intermediate asset", () => {
    const { readResult } = insertAndQuery("intermediate_asset", {
      asset_type: "work_item",
      title: "ER Diagram",
      content: "mermaid code here",
    });
    assert.strictEqual(readResult.results[0].title, "ER Diagram");
  });
});

describe("asset_deliverable", () => {
  it("inserts asset deliverable", () => {
    const { readResult } = insertAndQuery("asset_deliverable", {
      asset_type: "documentation",
      file_path: "/docs/api.md",
      description: "API documentation",
    });
    assert.strictEqual(readResult.results[0].file_path, "/docs/api.md");
  });
});

describe("blocker (via changelog_insert)", () => {
  it("inserts workflow blocker", () => {
    const { readResult } = insertAndQuery("blocker", {
      phase_name: "requirements",
      description: "Missing stakeholder approval",
      severity: "critical",
      raised_by: "test-critic",
    });
    assert.strictEqual(readResult.results[0].severity, "critical");
  });
});

describe("project_lesson", () => {
  it("inserts project lesson", () => {
    const { readResult } = insertAndQuery("project_lesson", {
      phase_name: "implementation",
      category: "pattern",
      lesson: "Write tests first",
      recurring: true,
    });
    assert.strictEqual(readResult.results[0].lesson, "Write tests first");
  });
});

describe("security_audit_finding", () => {
  it("inserts finding", () => {
    const { readResult } = insertAndQuery("security_audit_finding", {
      category: "injection",
      severity: "high",
      title: "SQL injection risk",
      description: "Unsanitized input",
      recommendation: "Use parameterized queries",
    });
    assert.strictEqual(readResult.results[0].title, "SQL injection risk");
  });
});

describe("performance_audit_finding", () => {
  it("inserts performance finding", () => {
    const { readResult } = insertAndQuery("performance_audit_finding", {
      category: "latency",
      severity: "medium",
      title: "Slow query",
      description: "N+1 query pattern",
      recommendation: "Use JOIN",
    });
    assert.strictEqual(readResult.results[0].title, "Slow query");
  });
});

// ───────────────────────────────────────────────────────────────
// Verify unknown entity type is rejected
// ───────────────────────────────────────────────────────────────

describe("unknown entity type", () => {
  it("throws on unsupported entity_type", () => {
    assert.throws(
      () =>
        handleWriteTool("changelog_insert", {
          entity_type: "nonexistent_entity",
          iteration_id: seed.iteration_id,
          revision_id: seed.revision_id,
          data: {},
        }),
      /Unsupported entity_type/
    );
  });
});
