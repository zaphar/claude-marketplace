import { getDb } from "./db.js";

// ---------------------------------------------------------------------------
// Entity type → primary table mapping
// ---------------------------------------------------------------------------

const ENTITY_TABLE = {
  persona: "persona",
  requirement: "requirement",
  adr: "adr",
  adr_decision: "adr_decision",
  component: "component",
  user_flow: "user_flow",
  screen: "screen",
  work_item: "work_item",
  plan_overview: "plan_overview",
  plan_external_dependency: "plan_external_dependency",
  implementation_manifest: "implementation_requirement_status",
  requirement_trace: "requirement_trace",
  project_context: "project_context",
  data_exchange: "data_exchange",
  nonfunctional_requirement: "nonfunctional_requirement",
  info_architecture: "info_architecture",
  persona_addressed: "persona_addressed",
  ux_asset: "ux_asset",
  approved_dependency: "approved_dependency",
  test_report: "test_report",
  blocker: "blocker",
  project_lesson: "project_lesson",
  security_audit_finding: "security_audit_finding",
  performance_audit_finding: "performance_audit_finding",
  intermediate_asset: "intermediate_asset",
  vcs_commit: "vcs_commit",
};

// Canonical list of valid entity type names, derived from ENTITY_TABLE.
// Imported by write-tools.js for input validation.
export const VALID_ENTITY_TYPES = Object.keys(ENTITY_TABLE);

// ---------------------------------------------------------------------------
// Helper: validate and apply entity filters
// ---------------------------------------------------------------------------

function applyFilters(filters, knownFilters, entityType) {
  const clauses = [];
  const params = [];
  if (!filters || typeof filters !== "object") return { clauses, params };

  // Step 1: Reject any user-provided keys not in the spec
  for (const userKey of Object.keys(filters)) {
    if (!(userKey in knownFilters)) {
      throw new Error(
        `Unknown filter "${userKey}" for ${entityType}. Valid filters: ${Object.keys(knownFilters).join(", ")}`
      );
    }
  }

  // Step 2: Iterate over SPEC keys only -- no user string ever becomes a SQL identifier
  for (const [specKey, colDef] of Object.entries(knownFilters)) {
    if (!(specKey in filters)) continue;
    const value = filters[specKey];
    if (value === null) {
      if (!colDef.nullable) {
        throw new Error(`Filter "${specKey}" for ${entityType} does not accept null values`);
      }
      clauses.push(`${specKey} IS NULL`);
    } else {
      clauses.push(`${specKey} = ?`);
      params.push(value);
    }
  }

  return { clauses, params };
}

// ---------------------------------------------------------------------------
// Per-entity query functions -- complex types (12)
// Filter-only stubs for Phase 1; enrichment added in Phase 2.
// ---------------------------------------------------------------------------

const PERSONA_FILTERS = {
  name: { nullable: false },
  description: { nullable: false },
  technical_level: { nullable: true },
  frequency_of_use: { nullable: true },
};

function queryPersona(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM persona";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("project_id = (SELECT id FROM project LIMIT 1)"); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, PERSONA_FILTERS, "persona");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) {
    return results.map(({ goals, ...rest }) => rest);
  }
  return results.map((p) => ({
    ...p,
    goals: (() => { try { return JSON.parse(p.goals || '[]'); } catch { return p.goals; } })(),
  }));
}

const REQUIREMENT_FILTERS = {
  description: { nullable: false },
  rationale: { nullable: true },
  priority: { nullable: false },
  category: { nullable: false },
};

function queryRequirement(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM requirement";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, REQUIREMENT_FILTERS, "requirement");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) {
    return results.map(({ acceptance_criteria, ...rest }) => rest);
  }
  return results.map((r) => ({
    ...r,
    acceptance_criteria: (() => { try { return JSON.parse(r.acceptance_criteria || '[]'); } catch { return r.acceptance_criteria; } })(),
    personas: db
      .prepare("SELECT persona_id FROM requirement_persona WHERE requirement_id = ?")
      .all(r.id)
      .map((x) => x.persona_id),
    depends_on: db
      .prepare("SELECT depends_on FROM requirement_dependency WHERE requirement_id = ?")
      .all(r.id)
      .map((x) => x.depends_on),
  }));
}

const ADR_FILTERS = {
  title: { nullable: false },
  status: { nullable: false },
  date: { nullable: true },
  context: { nullable: true },
  superseded_by: { nullable: true },
};

function queryAdr(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM adr";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, ADR_FILTERS, "adr");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) {
    return results.map(({ consequences, research_sources, ...rest }) => rest);
  }
  return results.map((a) => {
    const alternatives = db
      .prepare("SELECT * FROM adr_alternative WHERE adr_id = ?")
      .all(a.id)
      .map((alt) => ({
        ...alt,
        pros: alt.pros ? (() => { try { return JSON.parse(alt.pros); } catch { return alt.pros; } })() : [],
        cons: alt.cons ? (() => { try { return JSON.parse(alt.cons); } catch { return alt.cons; } })() : [],
      }));
    const decision = db
      .prepare("SELECT * FROM adr_decision WHERE adr_id = ?")
      .get(a.id) ?? null;
    return {
      ...a,
      alternatives,
      decision,
      consequences: (() => { try { return JSON.parse(a.consequences || '[]'); } catch { return a.consequences; } })(),
      research_sources: (() => { try { return JSON.parse(a.research_sources || '[]'); } catch { return a.research_sources; } })(),
    };
  });
}

function queryAdrDecision(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM adr_decision";
  const clauses = [];
  const params = [];
  if (iteration_id != null) {
    clauses.push("adr_id IN (SELECT id FROM adr WHERE iteration_id = ?)");
    params.push(iteration_id);
  }
  if (ids?.length) { clauses.push(`adr_id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

const COMPONENT_FILTERS = {
  name: { nullable: false },
  purpose: { nullable: false },
  component_type: { nullable: false },
};

function queryComponent(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM component";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, COMPONENT_FILTERS, "component");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) return results;
  return results.map((c) => ({
    ...c,
    interfaces: db
      .prepare("SELECT * FROM component_interface WHERE component_id = ?")
      .all(c.id),
    dependencies: db
      .prepare("SELECT depends_on FROM component_dependency WHERE component_id = ?")
      .all(c.id)
      .map((x) => x.depends_on),
    requirements_addressed: db
      .prepare("SELECT requirement_id FROM requirement_trace WHERE addressed_by = ? AND addressed_by_type = 'component'")
      .all(c.id)
      .map((x) => x.requirement_id),
    integration_test_boundaries: db
      .prepare("SELECT * FROM integration_test_boundary WHERE component_id = ?")
      .all(c.id),
  }));
}

const USER_FLOW_FILTERS = {
  name: { nullable: false },
  goal: { nullable: false },
  persona_id: { nullable: true },
  entry_point: { nullable: true },
  success_state: { nullable: true },
};

function queryUserFlow(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM user_flow";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, USER_FLOW_FILTERS, "user_flow");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) {
    return results.map(({ data_dependencies, error_states, ...rest }) => rest);
  }
  return results.map((fl) => {
    const steps = db
      .prepare("SELECT * FROM user_flow_step WHERE flow_id = ? ORDER BY step_number")
      .all(fl.id)
      .map((s) => ({
        ...s,
        branches: (() => { try { return JSON.parse(s.branches || '[]'); } catch { return s.branches; } })(),
      }));
    return {
      ...fl,
      steps,
      error_states: (() => { try { return JSON.parse(fl.error_states || '[]'); } catch { return fl.error_states; } })(),
      requirements: db
        .prepare("SELECT requirement_id FROM requirement_trace WHERE addressed_by = ? AND addressed_by_type = 'flow'")
        .all(fl.id)
        .map((x) => x.requirement_id),
      data_dependencies: (() => { try { return JSON.parse(fl.data_dependencies || '[]'); } catch { return fl.data_dependencies; } })(),
    };
  });
}

const SCREEN_FILTERS = {
  name: { nullable: false },
  purpose: { nullable: false },
  wireframe_path: { nullable: true },
  mockup_path: { nullable: true },
};

function queryScreen(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM screen";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, SCREEN_FILTERS, "screen");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) {
    return results.map(({ components, ...rest }) => rest);
  }
  return results.map((s) => ({
    ...s,
    components: (() => { try { return JSON.parse(s.components || '[]'); } catch { return s.components; } })(),
  }));
}

const WORK_ITEM_FILTERS = {
  phase_number: { nullable: false },
  name: { nullable: false },
  work_type: { nullable: false },
  goal: { nullable: false },
  status: { nullable: false },
  complexity: { nullable: true },
  review_checkpoint: { nullable: true },
  notes: { nullable: true },
  critical_path_sequence: { nullable: true },
  plan_version: { nullable: false },
};

function queryWorkItem(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM work_item";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  // Extract special filters before applyFilters (which only handles column equality)
  const { superseded, status_not, ...standardFilters } = filters || {};
  const f = applyFilters(standardFilters, WORK_ITEM_FILTERS, "work_item");
  clauses.push(...f.clauses);
  params.push(...f.params);
  // Handle superseded boolean filter
  if (superseded === true) {
    clauses.push("superseded_at IS NOT NULL");
  } else if (superseded === false) {
    clauses.push("superseded_at IS NULL");
  }
  // If filters.superseded is null/undefined, no filter applied (return all)

  // Handle status_not exclusion filter
  if (status_not != null) {
    clauses.push("status != ?");
    params.push(status_not);
  }
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) {
    return results.map(({ entry_criteria, exit_criteria, checkpoint_focus, risks, ...rest }) => rest);
  }
  return results.map((p) => ({
    ...p,
    requirements: db
      .prepare("SELECT requirement_id, priority, notes FROM work_item_requirement WHERE work_item_id = ?")
      .all(p.id)
      .map((x) => x.priority || x.notes
        ? { requirement_id: x.requirement_id, priority: x.priority, notes: x.notes }
        : x.requirement_id),
    components: db
      .prepare("SELECT component_id FROM work_item_component WHERE work_item_id = ?")
      .all(p.id)
      .map((x) => x.component_id),
    entry_criteria: (() => { try { return JSON.parse(p.entry_criteria || '[]'); } catch { return p.entry_criteria; } })(),
    exit_criteria: (() => { try { return JSON.parse(p.exit_criteria || '[]'); } catch { return p.exit_criteria; } })(),
    risks: (() => { try { return JSON.parse(p.risks || '[]'); } catch { return p.risks; } })(),
    checkpoint_focus: (() => { try { return JSON.parse(p.checkpoint_focus || '[]'); } catch { return p.checkpoint_focus; } })(),
  }));
}

const PLAN_OVERVIEW_FILTERS = {
  strategy: { nullable: false },
  rationale: { nullable: false },
  phase_one_approach: { nullable: true },
  plan_version: { nullable: false },
};

function queryPlanOverview(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM plan_overview";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, PLAN_OVERVIEW_FILTERS, "plan_overview");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) {
    return results.map(({ assumptions, risks, ...rest }) => rest);
  }
  return results.map((o) => ({
    ...o,
    total_phases: (() => {
        if (!o.iteration_id) return 0;
        return db.prepare(
          "SELECT COUNT(*) AS cnt FROM work_item WHERE iteration_id = ? AND superseded_at IS NULL"
        ).get(o.iteration_id).cnt;
      })(),
    risks: (() => { try { return JSON.parse(o.risks || '[]'); } catch { return o.risks; } })(),
    assumptions: (() => { try { return JSON.parse(o.assumptions || '[]'); } catch { return o.assumptions; } })(),
  }));
}

const PERSONA_ADDRESSED_FILTERS = {
  persona_id: { nullable: false },
  goal: { nullable: false },
  how_addressed: { nullable: false },
};

function queryPersonaAddressed(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM persona_addressed";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, PERSONA_ADDRESSED_FILTERS, "persona_addressed");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) return results;
  return results.map((pa) => ({
    ...pa,
    flows: db
      .prepare("SELECT flow_id FROM persona_addressed_flow WHERE persona_addressed_id = ?")
      .all(pa.id)
      .map((x) => x.flow_id),
  }));
}

const INFO_ARCHITECTURE_FILTERS = {
  category: { nullable: false },
  key: { nullable: false },
  value: { nullable: false },
  parent_id: { nullable: true },
};

function queryInfoArchitecture(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM info_architecture";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, INFO_ARCHITECTURE_FILTERS, "info_architecture");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) return results;
  return results.map((ia) => ({
    ...ia,
    children: db
      .prepare("SELECT id, category, key, value FROM info_architecture WHERE parent_id = ?")
      .all(ia.id),
  }));
}

const IMPLEMENTATION_MANIFEST_FILTERS = {};

function queryImplementationManifest(db, { iteration_id, ids, filters = {}, include_related = false }) {
  // No parent implementation_manifest table — gather iteration_ids from the surviving child tables
  let sql = "SELECT DISTINCT iteration_id FROM implementation_requirement_status";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");

  // Also check blockers and component status for iterations that have those but no requirement status
  const iterationIds = new Set(
    db.prepare(sql).all(...params).map(r => r.iteration_id)
  );
  const blockerIterations = db.prepare(
    "SELECT DISTINCT iteration_id FROM implementation_blocker" + (iteration_id != null ? " WHERE iteration_id = ?" : "")
  ).all(...(iteration_id != null ? [iteration_id] : []));
  for (const r of blockerIterations) iterationIds.add(r.iteration_id);
  const compIterations = db.prepare(
    "SELECT DISTINCT iteration_id FROM implementation_component_status" + (iteration_id != null ? " WHERE iteration_id = ?" : "")
  ).all(...(iteration_id != null ? [iteration_id] : []));
  for (const r of compIterations) iterationIds.add(r.iteration_id);

  if (ids?.length) {
    const idSet = new Set(ids.map(Number));
    for (const iid of iterationIds) {
      if (!idSet.has(iid)) iterationIds.delete(iid);
    }
  }

  const results = [...iterationIds].map(iid => ({ iteration_id: iid }));
  if (!include_related) return results;

  return results.map((m) => {
    const requirement_status = db
      .prepare("SELECT * FROM implementation_requirement_status WHERE iteration_id = ?")
      .all(m.iteration_id);
    const component_status = db
      .prepare("SELECT * FROM implementation_component_status WHERE iteration_id = ?")
      .all(m.iteration_id);
    const blockers = db
      .prepare("SELECT * FROM implementation_blocker WHERE iteration_id = ?")
      .all(m.iteration_id)
      .map((b) => ({
        ...b,
        requirements: db
          .prepare("SELECT requirement_id FROM implementation_blocker_requirement WHERE blocker_id = ?")
          .all(b.id)
          .map((x) => x.requirement_id),
      }));
    return {
      ...m,
      requirement_status,
      component_status,
      blockers,
    };
  });
}

const TEST_REPORT_FILTERS = {
  total_tests: { nullable: false },
  passed_count: { nullable: false },
  failed: { nullable: false },
  skipped: { nullable: false },
  coverage_line: { nullable: true },
  coverage_branch: { nullable: true },
  coverage_function: { nullable: true },
  duration_seconds: { nullable: true },
  status: { nullable: false },
  version: { nullable: true },
  document_date: { nullable: true },
  requirements_version: { nullable: true },
  architecture_version: { nullable: true },
  commit_sha: { nullable: true },
};

function queryTestReport(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM test_report";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, TEST_REPORT_FILTERS, "test_report");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

// ---------------------------------------------------------------------------
// Per-entity query functions -- simple types
// Complete implementations, no enrichment needed.
// ---------------------------------------------------------------------------

const PLAN_EXTERNAL_DEPENDENCY_FILTERS = {
  name: { nullable: false },
  description: { nullable: false },
  work_item_id: { nullable: true },
  risk_level: { nullable: false },
  mitigation: { nullable: true },
};

function queryPlanExternalDependency(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM plan_external_dependency";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, PLAN_EXTERNAL_DEPENDENCY_FILTERS, "plan_external_dependency");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

const REQUIREMENT_TRACE_FILTERS = {
  requirement_id: { nullable: false },
  addressed_by: { nullable: false },
  addressed_by_type: { nullable: false },
  notes: { nullable: true },
};

function queryRequirementTrace(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM requirement_trace";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, REQUIREMENT_TRACE_FILTERS, "requirement_trace");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

const PROJECT_CONTEXT_FILTERS = {
  key: { nullable: false },
  value: { nullable: false },
  category: { nullable: true },
};

function queryProjectContext(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM project_context";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, PROJECT_CONTEXT_FILTERS, "project_context");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

const DATA_EXCHANGE_FILTERS = {
  direction: { nullable: false },
  name: { nullable: false },
  description: { nullable: false },
  source: { nullable: true },
  destination: { nullable: true },
  data_format: { nullable: true },
};

function queryDataExchange(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM data_exchange";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, DATA_EXCHANGE_FILTERS, "data_exchange");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

const NONFUNCTIONAL_REQUIREMENT_FILTERS = {
  nfr_type: { nullable: false },
  item: { nullable: false },
  category: { nullable: true },
  value: { nullable: true },
  notes: { nullable: true },
};

function queryNonfunctionalRequirement(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM nonfunctional_requirement";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, NONFUNCTIONAL_REQUIREMENT_FILTERS, "nonfunctional_requirement");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

const UX_ASSET_FILTERS = {
  name: { nullable: false },
  path: { nullable: false },
  asset_type: { nullable: false },
  screen_id: { nullable: true },
  description: { nullable: true },
};

function queryUxAsset(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM ux_asset";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, UX_ASSET_FILTERS, "ux_asset");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

const APPROVED_DEPENDENCY_FILTERS = {
  package: { nullable: false },
  version_constraint: { nullable: true },
  purpose: { nullable: false },
  justification: { nullable: false },
  adr_id: { nullable: true },
  license: { nullable: true },
  category: { nullable: true },
  maintenance_activity: { nullable: true },
  community_adoption: { nullable: true },
  transitive_deps: { nullable: true },
  single_maintainer_risk: { nullable: true },
  status: { nullable: false },
};

function queryApprovedDependency(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM approved_dependency";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, APPROVED_DEPENDENCY_FILTERS, "approved_dependency");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

const BLOCKER_FILTERS = {
  phase_name: { nullable: false },
  description: { nullable: false },
  severity: { nullable: false },
  raised_by: { nullable: false },
  resolved_at: { nullable: true },
  resolution_notes: { nullable: true },
};

function queryBlocker(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM blocker";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, BLOCKER_FILTERS, "blocker");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

const PROJECT_LESSON_FILTERS = {
  phase_name: { nullable: false },
  category: { nullable: false },
  lesson: { nullable: false },
  recurring: { nullable: false },
};

function queryProjectLesson(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM project_lesson";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, PROJECT_LESSON_FILTERS, "project_lesson");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

const SECURITY_AUDIT_FINDING_FILTERS = {
  category: { nullable: false },
  severity: { nullable: false },
  title: { nullable: false },
  description: { nullable: false },
  location: { nullable: true },
  recommendation: { nullable: false },
  cve: { nullable: true },
  status: { nullable: false },
};

function querySecurityAuditFinding(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM security_audit_finding";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, SECURITY_AUDIT_FINDING_FILTERS, "security_audit_finding");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

const PERFORMANCE_AUDIT_FINDING_FILTERS = {
  category: { nullable: false },
  severity: { nullable: false },
  title: { nullable: false },
  description: { nullable: false },
  location: { nullable: true },
  metric_name: { nullable: true },
  baseline_value: { nullable: true },
  actual_value: { nullable: true },
  recommendation: { nullable: false },
  status: { nullable: false },
};

function queryPerformanceAuditFinding(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM performance_audit_finding";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, PERFORMANCE_AUDIT_FINDING_FILTERS, "performance_audit_finding");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

const INTERMEDIATE_ASSET_FILTERS = {
  phase_id: { nullable: true },
  asset_type: { nullable: false },
  title: { nullable: false },
  content: { nullable: true },
};

function queryIntermediateAsset(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM intermediate_asset";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, INTERMEDIATE_ASSET_FILTERS, "intermediate_asset");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

const VCS_COMMIT_FILTERS = {
  work_item_id: { nullable: false },
  revision_id: { nullable: false },
  commit_sha: { nullable: false },
  message: { nullable: true },
};

function queryVcsCommit(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM vcs_commit";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, VCS_COMMIT_FILTERS, "vcs_commit");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

// ---------------------------------------------------------------------------
// Query dispatch map
// ---------------------------------------------------------------------------

const QUERY_DISPATCH = {
  persona: queryPersona,
  requirement: queryRequirement,
  adr: queryAdr,
  adr_decision: queryAdrDecision,
  component: queryComponent,
  user_flow: queryUserFlow,
  screen: queryScreen,
  work_item: queryWorkItem,
  plan_overview: queryPlanOverview,
  persona_addressed: queryPersonaAddressed,
  info_architecture: queryInfoArchitecture,
  implementation_manifest: queryImplementationManifest,
  test_report: queryTestReport,
  plan_external_dependency: queryPlanExternalDependency,
  requirement_trace: queryRequirementTrace,
  project_context: queryProjectContext,
  data_exchange: queryDataExchange,
  nonfunctional_requirement: queryNonfunctionalRequirement,
  ux_asset: queryUxAsset,
  approved_dependency: queryApprovedDependency,
  blocker: queryBlocker,
  project_lesson: queryProjectLesson,
  security_audit_finding: querySecurityAuditFinding,
  performance_audit_finding: queryPerformanceAuditFinding,
  intermediate_asset: queryIntermediateAsset,
  vcs_commit: queryVcsCommit,
};

// ---------------------------------------------------------------------------
// Tool 1: changelog_query
// ---------------------------------------------------------------------------

function changelogQuery(args) {
  const db = getDb(args.project_root);
  const {
    entity_type,
    iteration_id,
    ids,
    filters,
    include_related = false,
    limit,
    offset = 0,
  } = args;

  if (!QUERY_DISPATCH[entity_type]) {
    throw new Error(
      `Unknown entity_type: "${entity_type}". Valid types: ${Object.keys(QUERY_DISPATCH).join(", ")}`
    );
  }

  try {
    const allResults = QUERY_DISPATCH[entity_type](db, { iteration_id, ids, filters, include_related });

    const total = allResults.length;

    // Clamp limit to [1, 100] if provided; guard against non-numeric values
    const effectiveLimit = limit != null && Number.isFinite(limit)
      ? Math.min(Math.max(1, Math.floor(limit)), 100)
      : null;

    // Clamp offset to >= 0; always apply (even without limit)
    const effectiveOffset = Math.max(0, Math.floor(offset) || 0);

    const results = effectiveLimit != null
      ? allResults.slice(effectiveOffset, effectiveOffset + effectiveLimit)
      : allResults.slice(effectiveOffset);

    // Overflow guard: check response size for ALL queries
    if (results.length > 0) {
      const serialized = JSON.stringify(results);
      const THRESHOLD = 50_000;

      if (serialized.length > THRESHOLD) {
        const avgRowSize = Math.ceil(serialized.length / results.length);
        const suggestedLimit = Math.max(1, Math.floor(THRESHOLD / avgRowSize));
        const err = new Error(
          `Query would return ~${serialized.length.toLocaleString()} chars ` +
          `(${results.length} rows). Use limit/offset to paginate, or ids to fetch ` +
          `specific items. Suggested limit: ${suggestedLimit}.`
        );
        err.code = "PAYLOAD_TOO_LARGE";
        err.details = { entity_type, total, estimated_chars: serialized.length, suggested_limit: suggestedLimit };
        throw err;
      }
    }

    return {
      entity_type,
      total,
      count: results.length,  // backward compat (matches returned page size)
      limit: effectiveLimit,
      offset: effectiveOffset,
      results,
    };
  } catch (err) {
    if (err.code === "PAYLOAD_TOO_LARGE") throw err;
    throw new Error(`Failed to query ${entity_type}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Tool 2: traceability_query
// ---------------------------------------------------------------------------

function traceabilityQuery(args) {
  const db = getDb(args.project_root);
  const { target, target_type, iteration_id } = args;

  const iterParam = iteration_id ? [iteration_id] : [];

  const chain = [];

  switch (target_type) {
    case "component": {
      const comp = db
        .prepare("SELECT * FROM component WHERE id = ?" + (iteration_id ? " AND iteration_id = ?" : ""))
        .get(target, ...iterParam);
      if (!comp) break;
      chain.push({ type: "component", data: comp });

      const reqIds = db
        .prepare("SELECT requirement_id FROM requirement_trace WHERE addressed_by = ? AND addressed_by_type = 'component'")
        .all(comp.id)
        .map((x) => x.requirement_id);

      const compIterationId = comp.iteration_id;

      if (reqIds.length > 0) {
        const reqs = db
          .prepare(`SELECT * FROM requirement WHERE id IN (${reqIds.map(() => "?").join(",")})`)
          .all(...reqIds);
        chain.push({ type: "requirements_addressed", data: reqs });

        // Find ADRs in the same iteration as this component
        if (compIterationId) {
          const adrs = db
            .prepare(
              "SELECT * FROM adr WHERE iteration_id = ?"
            )
            .all(compIterationId);
          if (adrs.length > 0) chain.push({ type: "related_adrs", data: adrs });
        }
      }

      const iterMeta = compIterationId
        ? db
            .prepare("SELECT key, value, category FROM project_context WHERE iteration_id = ?")
            .all(compIterationId)
        : [];
      if (iterMeta.length > 0) chain.push({ type: "project_context", data: iterMeta });
      break;
    }

    case "technology": {
      // Technology choices are now tracked via approved_dependency (with category column)
      // and ADRs. Find ADRs whose title/context or linked adr_decision.rationale mentions
      // the technology name, then follow to approved dependencies.
      const adrs = db
        .prepare(
          "SELECT * FROM adr WHERE (title LIKE ? OR context LIKE ? OR id IN (SELECT adr_id FROM adr_decision WHERE rationale LIKE ?))" +
            (iteration_id ? " AND iteration_id = ?" : "")
        )
        .all(`%${target}%`, `%${target}%`, `%${target}%`, ...iterParam);
      if (adrs.length > 0) chain.push({ type: "related_adrs", data: adrs });

      // Find approved dependencies matching the technology name
      const deps = db
        .prepare(
          "SELECT * FROM approved_dependency WHERE (package LIKE ? OR purpose LIKE ?)" +
            (iteration_id ? " AND iteration_id = ?" : "")
        )
        .all(`%${target}%`, `%${target}%`, ...iterParam);
      if (deps.length > 0) chain.push({ type: "approved_dependencies", data: deps });

      // Find approved dependencies linked to the related ADRs
      const adrIds = adrs.map((a) => a.id);
      if (adrIds.length > 0) {
        const adrDeps = db
          .prepare(
            `SELECT * FROM approved_dependency WHERE adr_id IN (${adrIds.map(() => "?").join(",")})` +
              (iteration_id ? " AND iteration_id = ?" : "")
          )
          .all(...adrIds, ...iterParam);
        // Merge with existing deps (avoid duplicates by ID)
        const existingIds = new Set(deps.map((d) => d.id));
        const newDeps = adrDeps.filter((d) => !existingIds.has(d.id));
        if (newDeps.length > 0) {
          if (deps.length > 0) {
            // Append to existing approved_dependencies entry
            chain.find((c) => c.type === "approved_dependencies").data.push(...newDeps);
          } else {
            chain.push({ type: "approved_dependencies", data: newDeps });
          }
        }
      }
      break;
    }

    case "requirement": {
      const req = db
        .prepare("SELECT * FROM requirement WHERE id = ?" + (iteration_id ? " AND iteration_id = ?" : ""))
        .get(target, ...iterParam);
      if (!req) break;
      chain.push({ type: "requirement", data: req });

      const acceptanceCriteria = (() => { try { return JSON.parse(req.acceptance_criteria || '[]'); } catch { return []; } })();
      if (acceptanceCriteria.length > 0)
        chain.push({ type: "acceptance_criteria", data: acceptanceCriteria });

      // What addresses this requirement — single query from requirement_trace
      const mappings = db
        .prepare(
          "SELECT * FROM requirement_trace WHERE requirement_id = ?" +
            (iteration_id ? " AND iteration_id = ?" : "")
        )
        .all(req.id, ...iterParam);
      if (mappings.length > 0) chain.push({ type: "addressed_by", data: mappings });

      // Which work_item includes it
      const phases = db
        .prepare(
          `SELECT pp.* FROM work_item pp
           JOIN work_item_requirement ppr ON ppr.work_item_id = pp.id
           WHERE ppr.requirement_id = ?` +
            (iteration_id ? " AND pp.iteration_id = ?" : "")
        )
        .all(req.id, ...iterParam);
      if (phases.length > 0) chain.push({ type: "work_items", data: phases });

      // Which components implement it
      const components = db
        .prepare(
          `SELECT c.* FROM component c
           JOIN requirement_trace rt ON rt.addressed_by = c.id AND rt.addressed_by_type = 'component'
           WHERE rt.requirement_id = ?` +
            (iteration_id ? " AND c.iteration_id = ?" : "")
        )
        .all(req.id, ...iterParam);
      if (components.length > 0) chain.push({ type: "implementing_components", data: components });
      break;
    }

    case "adr": {
      const adr = db
        .prepare("SELECT * FROM adr WHERE id = ?" + (iteration_id ? " AND iteration_id = ?" : ""))
        .get(target, ...iterParam);
      if (!adr) break;
      chain.push({ type: "adr", data: adr });

      const alternatives = db
        .prepare("SELECT * FROM adr_alternative WHERE adr_id = ?")
        .all(adr.id)
        .map((alt) => ({
          ...alt,
          pros: alt.pros ? (() => { try { return JSON.parse(alt.pros); } catch { return []; } })() : [],
          cons: alt.cons ? (() => { try { return JSON.parse(alt.cons); } catch { return []; } })() : [],
        }));
      if (alternatives.length > 0) chain.push({ type: "alternatives", data: alternatives });

      const consequences = (() => { try { return JSON.parse(adr.consequences || '[]'); } catch { return []; } })();
      if (consequences.length > 0) chain.push({ type: "consequences", data: consequences });

      // Components in the same iteration as this ADR
      const adrIterationId = adr.iteration_id;
      const components = adrIterationId ? db
        .prepare(
          "SELECT * FROM component WHERE iteration_id = ?"
        )
        .all(adrIterationId) : [];
      if (components.length > 0) chain.push({ type: "components_in_same_iteration", data: components });
      break;
    }

    case "flow": {
      const flow = db
        .prepare("SELECT * FROM user_flow WHERE id = ?" + (iteration_id ? " AND iteration_id = ?" : ""))
        .get(target, ...iterParam);
      if (!flow) break;
      chain.push({ type: "user_flow", data: flow });

      const reqIds = db
        .prepare("SELECT requirement_id FROM requirement_trace WHERE addressed_by = ? AND addressed_by_type = 'flow'")
        .all(flow.id)
        .map((x) => x.requirement_id);
      if (reqIds.length > 0) {
        const reqs = db
          .prepare(`SELECT * FROM requirement WHERE id IN (${reqIds.map(() => "?").join(",")})`)
          .all(...reqIds);
        chain.push({ type: "requirements", data: reqs });
      }

      // Steps and screens referenced
      const steps = db
        .prepare("SELECT * FROM user_flow_step WHERE flow_id = ? ORDER BY step_number")
        .all(flow.id);
      if (steps.length > 0) {
        const screenNames = [...new Set(steps.map((s) => s.surface).filter(Boolean))];
        chain.push({ type: "steps", data: steps });
        if (screenNames.length > 0) {
          const screens = db
            .prepare(
              `SELECT * FROM screen WHERE name IN (${screenNames.map(() => "?").join(",")})` +
                (iteration_id ? " AND iteration_id = ?" : "")
            )
            .all(...screenNames, ...iterParam);
          if (screens.length > 0) chain.push({ type: "referenced_screens", data: screens });
        }
      }

      // Related traceability — single query from requirement_trace
      if (reqIds.length > 0) {
        const mappings = db
          .prepare(
            `SELECT * FROM requirement_trace WHERE requirement_id IN (${reqIds.map(() => "?").join(",")})` +
              (iteration_id ? " AND iteration_id = ?" : "")
          )
          .all(...reqIds, ...iterParam);
        if (mappings.length > 0) chain.push({ type: "requirement_traces", data: mappings });
      }
      break;
    }

    case "screen": {
      const scr = db
        .prepare("SELECT * FROM screen WHERE id = ?" + (iteration_id ? " AND iteration_id = ?" : ""))
        .get(target, ...iterParam);
      if (!scr) break;
      chain.push({ type: "screen", data: scr });

      // Flows that reference this screen name in steps
      const steps = db
        .prepare("SELECT DISTINCT flow_id FROM user_flow_step WHERE surface = ?")
        .all(scr.name);
      const flowIds = steps.map((s) => s.flow_id);
      if (flowIds.length > 0) {
        const flows = db
          .prepare(
            `SELECT * FROM user_flow WHERE id IN (${flowIds.map(() => "?").join(",")})` +
              (iteration_id ? " AND iteration_id = ?" : "")
          )
          .all(...flowIds, ...iterParam);
        chain.push({ type: "flows_referencing_screen", data: flows });

        // Trace to requirements via those flows
        const reqIds = db
          .prepare(
            `SELECT DISTINCT rt.requirement_id FROM requirement_trace rt
             WHERE rt.addressed_by_type = 'flow' AND rt.addressed_by IN (${flowIds.map(() => "?").join(",")})`
          )
          .all(...flowIds)
          .map((x) => x.requirement_id);
        if (reqIds.length > 0) {
          const reqs = db
            .prepare(`SELECT * FROM requirement WHERE id IN (${reqIds.map(() => "?").join(",")})`)
            .all(...reqIds);
          chain.push({ type: "requirements", data: reqs });
        }
      }
      break;
    }

    default:
      throw new Error(
        `Unknown target_type: "${target_type}". Valid: component, technology, requirement, adr, flow, screen`
      );
  }

  return { target, target_type, chain };
}

// ---------------------------------------------------------------------------
// Tool 3: revision_history
// ---------------------------------------------------------------------------

function revisionHistory(args) {
  const db = getDb(args.project_root);
  const { phase_id, iteration_id, phase_name } = args;

  let resolvedPhaseId = phase_id;

  if (!resolvedPhaseId && iteration_id && phase_name) {
    const ph = db
      .prepare("SELECT id FROM phase WHERE iteration_id = ? AND name = ?")
      .get(iteration_id, phase_name);
    if (!ph) {
      throw new Error(
        `Phase "${phase_name}" not found in iteration ${iteration_id}`
      );
    }
    resolvedPhaseId = ph.id;
  }

  if (!resolvedPhaseId) {
    throw new Error("Provide phase_id, or both iteration_id and phase_name");
  }

  const phase = db.prepare("SELECT * FROM phase WHERE id = ?").get(resolvedPhaseId);
  if (!phase) throw new Error(`Phase ${resolvedPhaseId} not found`);

  const revisions = db
    .prepare(
      `SELECT id, producer_agent, status, critic_agent,
              critic_feedback, created_at, reviewed_at
       FROM revision WHERE phase_id = ? ORDER BY id`
    )
    .all(resolvedPhaseId);

  return { phase, revisions };
}

// ---------------------------------------------------------------------------
// Tool 4: iteration_summary
// ---------------------------------------------------------------------------

function iterationSummary(args) {
  const db = getDb(args.project_root);
  const { iteration_id } = args;

  if (!iteration_id) {
    throw new Error("Provide iteration_id");
  }

  const iteration = db.prepare("SELECT * FROM iteration WHERE id = ?").get(iteration_id);
  if (!iteration) throw new Error(`Iteration ${iteration_id} not found`);

  // Phases with revision counts
  const phases = db
    .prepare(
      `SELECT p.name, p.status, p.approved_by,
              COUNT(r.id) AS revision_count
       FROM phase p
       LEFT JOIN revision r ON r.phase_id = p.id
       WHERE p.iteration_id = ?
       GROUP BY p.id
       ORDER BY p.id`
    )
    .all(iteration_id);

  // Decision counts
  const countFor = (table) =>
    db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE iteration_id = ?`)
      .get(iteration_id).n;

  const decisions = {
    requirements: countFor("requirement"),
    adrs: countFor("adr"),
    components: countFor("component"),
    user_flows: countFor("user_flow"),
    screens: countFor("screen"),
    work_items: countFor("work_item"),
    approved_dependencies: countFor("approved_dependency"),
    requirement_traces: countFor("requirement_trace"),
    security_audit_findings: countFor("security_audit_finding"),
    performance_audit_findings: countFor("performance_audit_finding"),
  };

  const commits = db
    .prepare("SELECT commit_sha, message, created_at FROM vcs_commit WHERE iteration_id = ? ORDER BY created_at")
    .all(iteration_id);

  return { iteration, phases, decisions, commits };
}

// ---------------------------------------------------------------------------
// Tool 5: project_status
// ---------------------------------------------------------------------------

function projectStatus(args) {
  const db = getDb(args.project_root);

  const project = db.prepare("SELECT * FROM project WHERE id = 1").get();
  if (!project) throw new Error("Project not found — run iteration_create first");

  let currentIteration = db
    .prepare(
      "SELECT * FROM iteration WHERE status = 'active' ORDER BY id DESC LIMIT 1"
    )
    .get();

  if (!currentIteration) {
    currentIteration = db
      .prepare("SELECT * FROM iteration ORDER BY id DESC LIMIT 1")
      .get();
  }

  const targetIterationId = currentIteration?.id;

  const phases = targetIterationId
    ? db
        .prepare(
          `SELECT p.name, p.status, p.started_at, p.completed_at, p.approved_by,
                  COUNT(r.id) AS revision_count
           FROM phase p
           LEFT JOIN revision r ON r.phase_id = p.id
           WHERE p.iteration_id = ?
           GROUP BY p.id
           ORDER BY p.id`
        )
        .all(targetIterationId)
    : [];

  return { project, current_iteration: currentIteration ?? null, phases };
}

// ---------------------------------------------------------------------------
// Tool 6: list_iterations
// ---------------------------------------------------------------------------

function listIterations(args) {
  const db = getDb(args.project_root);

  const iterations = db
    .prepare(
      `SELECT i.id, i.status, i.created_at, i.closed_at, i.notes, i.brief_path,
              COUNT(CASE WHEN p.status = 'completed' THEN 1 END) AS phases_completed,
              COUNT(CASE WHEN p.status = 'skipped' THEN 1 END) AS phases_skipped,
              COUNT(CASE WHEN p.status = 'in_progress' THEN 1 END) AS phases_in_progress,
              COUNT(CASE WHEN p.status = 'pending' THEN 1 END) AS phases_pending
       FROM iteration i
       LEFT JOIN phase p ON p.iteration_id = i.id
       GROUP BY i.id
       ORDER BY i.id`
    )
    .all();

  return { total: iterations.length, iterations };
}

// ---------------------------------------------------------------------------
// MCP tool definitions
// ---------------------------------------------------------------------------

export const READ_TOOLS = [
  {
    name: "changelog_query",
    description:
      "Flexible query of the changelog database. Primary read tool for agents. " +
      "Query any entity type with optional iteration, ID, and field filters. " +
      "Supports limit/offset pagination; returns total count in every response. " +
      "Set include_related=true to attach child table data (acceptance criteria, interfaces, alternatives, etc.); " +
      "false returns base columns only, stripping large inline JSON fields for lightweight index scans.",
    inputSchema: {
      type: "object",
      properties: {
        entity_type: {
          type: "string",
          description: "Entity type to query",
          enum: Object.keys(ENTITY_TABLE),
        },
        iteration_id: {
          type: "number",
          description: "Filter results to a specific iteration ID",
        },
        ids: {
          type: "array",
          items: { type: "string" },
          description: 'Specific IDs to retrieve, e.g. ["REQ-001", "REQ-003"]',
        },
        filters: {
          type: "object",
          description:
            'Field→value filters, e.g. { "category": "security", "priority": "must-have" }. ' +
            "work_item queries also support: superseded (boolean — true for superseded-only, false for active-only), " +
            "status_not (string — exclude a status value), and plan_version (integer — specific plan version).",
          additionalProperties: true,
        },
        include_related: {
          type: "boolean",
          description:
            "If true, attach child/related table data (acceptance criteria, interfaces, etc.). More tokens but complete data.",
          default: false,
        },
        limit: {
          type: "integer",
          description:
            "Maximum number of results to return (1-100). Omit for all results (subject to overflow protection).",
          minimum: 1,
          maximum: 100,
        },
        offset: {
          type: "integer",
          description:
            "Number of results to skip (default 0). Use with limit for pagination.",
          default: 0,
          minimum: 0,
        },
      },
      required: ["entity_type"],
    },
  },
  {
    name: "traceability_query",
    description:
      'Answers "why" questions by tracing through the decision chain. ' +
      "Given a component, technology, requirement, ADR, user flow, or screen, " +
      "returns the full chain of related decisions and entities.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: 'The item to trace, e.g. "COMP-001", "Go", "REQ-005"',
        },
        target_type: {
          type: "string",
          description: "Type of the target",
          enum: ["component", "technology", "requirement", "adr", "flow", "screen"],
        },
        iteration_id: {
          type: "number",
          description: "Scope trace to a specific iteration",
        },
      },
      required: ["target", "target_type"],
    },
  },
  {
    name: "revision_history",
    description:
      "Get the full revision history for a phase (producer-critic loops). " +
      "Shows every revision with producer, status, critic feedback, and timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        phase_id: {
          type: "number",
          description: "Direct phase ID",
        },
        iteration_id: {
          type: "number",
          description: "Iteration ID (use with phase_name to look up the phase)",
        },
        phase_name: {
          type: "string",
          description:
            "Phase name (use with iteration_id). One of: requirements, ux_design, architecture, planning, implementation, documentation, qa, audit",
        },
      },
    },
  },
  {
    name: "iteration_summary",
    description:
      "Summarize what an iteration produced: phases with status, decision counts per entity type, and VCS commits.",
    inputSchema: {
      type: "object",
      properties: {
        iteration_id: {
          type: "number",
          description: "Iteration ID (auto-incremented primary key)",
        },
      },
      required: ["iteration_id"],
    },
  },
  {
    name: "project_status",
    description:
      "Get project overview. Returns project metadata (name, critic_model, notes, artifacts_directory), the current active iteration (if any), and all phases with status, timestamps, and revision counts. No parameters needed.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "list_iterations",
    description:
      "List all iterations for the project. Returns every iteration with its status, timestamps, notes, and phase summary. Use this to discover iteration IDs before calling iteration_summary.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

// Inject project_root into every tool schema
for (const tool of READ_TOOLS) {
  tool.inputSchema.properties = {
    project_root: { type: "string", description: "Absolute path to the project root directory" },
    ...tool.inputSchema.properties,
  };
  tool.inputSchema.required = ["project_root", ...(tool.inputSchema.required ?? [])];
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function handleReadTool(name, args) {
  switch (name) {
    case "changelog_query":
      return changelogQuery(args);
    case "traceability_query":
      return traceabilityQuery(args);
    case "revision_history":
      return revisionHistory(args);
    case "iteration_summary":
      return iterationSummary(args);
    case "project_status":
      return projectStatus(args);
    case "list_iterations":
      return listIterations(args);
    default:
      throw new Error(`Unknown read tool: "${name}"`);
  }
}
