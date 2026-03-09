import { getDb } from "./db.js";

// ---------------------------------------------------------------------------
// Entity type → primary table mapping
// ---------------------------------------------------------------------------

const ENTITY_TABLE = {
  persona: "persona",
  requirement: "requirement",
  adr: "adr",
  component: "component",
  technology_choice: "technology_choice",
  user_flow: "user_flow",
  screen: "screen",
  plan_phase: "plan_phase",
  plan_overview: "plan_overview",
  plan_external_dependency: "plan_external_dependency",
  plan_metadata: "plan_metadata",
  implementation_manifest: "implementation_manifest",
  requirement_trace: "requirement_trace",
  project_context: "project_context",
  system_io: "system_io",
  nonfunctional_requirement: "nonfunctional_requirement",
  config: "config",
  info_architecture: "info_architecture",
  persona_addressed: "persona_addressed",
  ux_asset: "ux_asset",
  architecture_overview: "architecture_overview",
  data_entity: "data_entity",
  // (architecture_config merged into config)
  approved_dependency: "approved_dependency",
  test_report: "test_report",
  documentation_manifest: "documentation_manifest",
  deployment_manifest: "deployment_manifest",
  blocker: "blocker",
  project_lesson: "project_lesson",
  security_audit_finding: "security_audit_finding",
  performance_audit_finding: "performance_audit_finding",
  intermediate_asset: "intermediate_asset",
  asset_deliverable: "asset_deliverable",
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
// Per-entity query functions -- complex types (16)
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
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, PERSONA_FILTERS, "persona");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) return results;
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
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, REQUIREMENT_FILTERS, "requirement");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) return results;
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
  decision: { nullable: false },
  rationale: { nullable: false },
  superseded_by: { nullable: true },
};

function queryAdr(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM adr";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, ADR_FILTERS, "adr");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) return results;
  return results.map((a) => {
    const alternatives = db
      .prepare("SELECT * FROM adr_alternative WHERE adr_id = ?")
      .all(a.id)
      .map((alt) => ({
        ...alt,
        pros: alt.pros ? (() => { try { return JSON.parse(alt.pros); } catch { return alt.pros; } })() : [],
        cons: alt.cons ? (() => { try { return JSON.parse(alt.cons); } catch { return alt.cons; } })() : [],
      }));
    return {
      ...a,
      alternatives,
      consequences: (() => { try { return JSON.parse(a.consequences || '[]'); } catch { return a.consequences; } })(),
      research_sources: (() => { try { return JSON.parse(a.research_sources || '[]'); } catch { return a.research_sources; } })(),
    };
  });
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
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
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
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, USER_FLOW_FILTERS, "user_flow");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) return results;
  return results.map((fl) => {
    const steps = db
      .prepare("SELECT * FROM user_flow_step WHERE flow_id = ? ORDER BY step_number")
      .all(fl.id)
      .map((s) => ({
        ...s,
        branches: db
          .prepare("SELECT condition, next_step FROM user_flow_step_branch WHERE step_id = ?")
          .all(s.id),
      }));
    return {
      ...fl,
      steps,
      error_states: db
        .prepare("SELECT condition, recovery FROM user_flow_error_state WHERE flow_id = ?")
        .all(fl.id),
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
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, SCREEN_FILTERS, "screen");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) return results;
  return results.map((s) => ({
    ...s,
    components: (() => { try { return JSON.parse(s.components || '[]'); } catch { return s.components; } })(),
    states: db
      .prepare("SELECT name, description, wireframe_path FROM screen_state WHERE screen_id = ?")
      .all(s.id),
    responsive_variants: db
      .prepare("SELECT breakpoint, wireframe_path, layout_changes FROM screen_responsive_variant WHERE screen_id = ?")
      .all(s.id),
  }));
}

const PLAN_PHASE_FILTERS = {
  phase_number: { nullable: false },
  name: { nullable: false },
  phase_type: { nullable: false },
  goal: { nullable: false },
  status: { nullable: false },
  complexity: { nullable: true },
  review_checkpoint: { nullable: true },
  notes: { nullable: true },
  critical_path_sequence: { nullable: true },
};

function queryPlanPhase(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM plan_phase";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, PLAN_PHASE_FILTERS, "plan_phase");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) return results;
  return results.map((p) => ({
    ...p,
    requirements: db
      .prepare("SELECT requirement_id, priority, notes FROM plan_phase_requirement WHERE plan_phase_id = ?")
      .all(p.id)
      .map((x) => x.priority || x.notes
        ? { requirement_id: x.requirement_id, priority: x.priority, notes: x.notes }
        : x.requirement_id),
    components: db
      .prepare("SELECT component_id FROM plan_phase_component WHERE plan_phase_id = ?")
      .all(p.id)
      .map((x) => x.component_id),
    entry_criteria: (() => { try { return JSON.parse(p.entry_criteria || '[]'); } catch { return p.entry_criteria; } })(),
    exit_criteria: (() => { try { return JSON.parse(p.exit_criteria || '[]'); } catch { return p.exit_criteria; } })(),
    api_endpoints: db
      .prepare("SELECT http_method, route, description FROM plan_phase_api_endpoint WHERE plan_phase_id = ?")
      .all(p.id),
    db_changes: db
      .prepare("SELECT id, migration_name, description, tables FROM plan_phase_db_change WHERE plan_phase_id = ?")
      .all(p.id)
      .map((dc) => ({
        ...dc,
        tables: (() => { try { return JSON.parse(dc.tables || '[]'); } catch { return dc.tables; } })(),
      })),
    risks: db
      .prepare("SELECT risk, mitigation FROM plan_phase_risk WHERE plan_phase_id = ?")
      .all(p.id),
    flows: db
      .prepare("SELECT flow_id FROM plan_phase_flow WHERE plan_phase_id = ?")
      .all(p.id)
      .map((x) => x.flow_id),
    screens: db
      .prepare("SELECT screen_id FROM plan_phase_screen WHERE plan_phase_id = ?")
      .all(p.id)
      .map((x) => x.screen_id),
    dependencies: db
      .prepare("SELECT related_phase_id AS depends_on_phase_id, reason FROM plan_phase_relationship WHERE plan_phase_id = ? AND dependency_type = 'dependency'")
      .all(p.id),
    parallel_with: db
      .prepare("SELECT related_phase_id AS can_parallel_with_id FROM plan_phase_relationship WHERE plan_phase_id = ? AND dependency_type = 'parallel'")
      .all(p.id)
      .map((x) => x.can_parallel_with_id),
    checkpoint_focus: (() => { try { return JSON.parse(p.checkpoint_focus || '[]'); } catch { return p.checkpoint_focus; } })(),
  }));
}

const PLAN_OVERVIEW_FILTERS = {
  strategy: { nullable: false },
  rationale: { nullable: false },
  phase_one_approach: { nullable: true },
};

function queryPlanOverview(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM plan_overview";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, PLAN_OVERVIEW_FILTERS, "plan_overview");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) return results;
  return results.map((o) => ({
    ...o,
    total_phases: (() => {
        const ctx = db.prepare("SELECT iteration_id FROM entity_context WHERE revision_id = ?").get(o.revision_id);
        if (!ctx) return 0;
        return db.prepare(
          "SELECT COUNT(*) AS cnt FROM plan_phase WHERE revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"
        ).get(ctx.iteration_id).cnt;
      })(),
    risks: db
      .prepare("SELECT risk, mitigation, plan_phase_id FROM plan_overview_risk WHERE plan_overview_id = ?")
      .all(o.id),
    assumptions: (() => { try { return JSON.parse(o.assumptions || '[]'); } catch { return o.assumptions; } })(),
  }));
}

const DATA_ENTITY_FILTERS = {
  name: { nullable: false },
  description: { nullable: false },
};

function queryDataEntity(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM data_entity";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, DATA_ENTITY_FILTERS, "data_entity");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) return results;
  return results.map((e) => ({
    ...e,
    attributes: db
      .prepare("SELECT name, data_type, is_required, description FROM data_entity_attribute WHERE entity_id = ?")
      .all(e.id),
    relationships: db
      .prepare(
        `SELECT t.name AS target_entity, r.target_entity_id, r.cardinality, r.description
         FROM data_entity_relationship r
         JOIN data_entity t ON t.id = r.target_entity_id
         WHERE r.entity_id = ?`
      )
      .all(e.id),
  }));
}

const ARCHITECTURE_OVERVIEW_FILTERS = {
  description: { nullable: false },
};

function queryArchitectureOverview(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM architecture_overview";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, ARCHITECTURE_OVERVIEW_FILTERS, "architecture_overview");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) return results;
  return results.map((o) => ({
    ...o,
    principles: (() => { try { return JSON.parse(o.principles || '[]'); } catch { return o.principles; } })(),
    diagrams: db
      .prepare("SELECT id, name, path, description FROM architecture_diagram WHERE overview_id = ?")
      .all(o.id),
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
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
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
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
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

const IMPLEMENTATION_MANIFEST_FILTERS = {
  plan_phase_id: { nullable: false },
  status: { nullable: false },
  lines_of_code: { nullable: true },
  warnings: { nullable: true },
  build_status: { nullable: true },
  version: { nullable: true },
  document_date: { nullable: true },
  requirements_version: { nullable: true },
  architecture_version: { nullable: true },
  language: { nullable: true },
  commit_sha: { nullable: true },
};

function queryImplementationManifest(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM implementation_manifest";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, IMPLEMENTATION_MANIFEST_FILTERS, "implementation_manifest");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) return results;
  return results.map((m) => {
    const files = db
      .prepare("SELECT * FROM implementation_file WHERE manifest_id = ?")
      .all(m.id)
      .map((fi) => ({
        ...fi,
        requirements: db
          .prepare("SELECT requirement_id FROM implementation_file_requirement WHERE file_id = ?")
          .all(fi.id)
          .map((x) => x.requirement_id),
      }));
    const api_endpoints = db
      .prepare("SELECT * FROM implementation_api_endpoint WHERE manifest_id = ?")
      .all(m.id)
      .map((ep) => ({
        ...ep,
        requirements: db
          .prepare("SELECT requirement_id FROM implementation_api_endpoint_requirement WHERE endpoint_id = ?")
          .all(ep.id)
          .map((x) => x.requirement_id),
      }));
    const blockers = db
      .prepare("SELECT * FROM implementation_blocker WHERE manifest_id = ?")
      .all(m.id)
      .map((b) => ({
        ...b,
        requirements: db
          .prepare("SELECT requirement_id FROM implementation_blocker_requirement WHERE blocker_id = ?")
          .all(b.id)
          .map((x) => x.requirement_id),
      }));
    return {
      ...m,
      files_created: files.filter((fi) => fi.file_operation === "created").length,
      files_modified: files.filter((fi) => fi.file_operation === "modified").length,
      files_deleted: files.filter((fi) => fi.file_operation === "deleted").length,
      files,
      requirement_status: db
        .prepare("SELECT * FROM implementation_requirement_status WHERE manifest_id = ?")
        .all(m.id),
      component_status: db
        .prepare("SELECT * FROM implementation_component_status WHERE manifest_id = ?")
        .all(m.id),
      api_endpoints,
      dependencies_added: db
        .prepare("SELECT * FROM implementation_dependency_added WHERE manifest_id = ?")
        .all(m.id),
      db_migrations: db
        .prepare("SELECT * FROM implementation_db_migration WHERE manifest_id = ?")
        .all(m.id),
      blockers,
      review_checklist: db
        .prepare("SELECT * FROM implementation_review_checklist WHERE manifest_id = ?")
        .all(m.id),
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

function queryTestReport(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM test_report";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, TEST_REPORT_FILTERS, "test_report");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) return results;
  return results.map((r) => {
    // test_requirement_coverage → criterion_results → test_ids
    const coverage = db
      .prepare("SELECT * FROM test_requirement_coverage WHERE report_id = ?")
      .all(r.id)
      .map((cov) => {
        const criteria = db
          .prepare("SELECT * FROM test_acceptance_criterion_result WHERE coverage_id = ?")
          .all(cov.id)
          .map((cr) => ({
            ...cr,
            test_ids: (() => { try { return JSON.parse(cr.test_ids || '[]'); } catch { return cr.test_ids; } })(),
          }));
        return { ...cov, criteria };
      });
    // test_suite → test_case → test_case_requirement
    const suites = db
      .prepare("SELECT * FROM test_suite WHERE report_id = ?")
      .all(r.id)
      .map((s) => ({
        ...s,
        cases: db
          .prepare("SELECT * FROM test_case WHERE suite_id = ?")
          .all(s.id)
          .map((tc) => ({
            ...tc,
            requirements: db
              .prepare("SELECT requirement_id FROM test_case_requirement WHERE test_case_id = ?")
              .all(tc.id)
              .map((x) => x.requirement_id),
          })),
      }));
    // test_blocker → test_blocker_requirement
    const blockers = db
      .prepare("SELECT * FROM test_blocker WHERE report_id = ?")
      .all(r.id)
      .map((b) => ({
        ...b,
        requirements: db
          .prepare("SELECT requirement_id FROM test_blocker_requirement WHERE blocker_id = ?")
          .all(b.id)
          .map((x) => x.requirement_id),
      }));
    return {
      ...r,
      coverage,
      suites,
      security_findings: db
        .prepare("SELECT * FROM test_security_finding WHERE report_id = ?")
        .all(r.id),
      performance_benchmarks: db
        .prepare("SELECT * FROM test_performance_benchmark WHERE report_id = ?")
        .all(r.id),
      blockers,
      recommendations: db
        .prepare("SELECT * FROM test_recommendation WHERE report_id = ?")
        .all(r.id),
    };
  });
}

const DOCUMENTATION_MANIFEST_FILTERS = {
  status: { nullable: false },
  total_pages: { nullable: true },
  accessibility_compliant: { nullable: true },
  version: { nullable: true },
  document_date: { nullable: true },
  requirements_version: { nullable: true },
  architecture_version: { nullable: true },
  implementation_version: { nullable: true },
  format: { nullable: true },
};

function queryDocumentationManifest(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM documentation_manifest";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, DOCUMENTATION_MANIFEST_FILTERS, "documentation_manifest");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) return results;
  return results.map((m) => {
    // documentation_feature → documentation_feature_requirement
    const features = db
      .prepare("SELECT * FROM documentation_feature WHERE manifest_id = ?")
      .all(m.id)
      .map((feat) => ({
        ...feat,
        requirements: db
          .prepare("SELECT requirement_id FROM documentation_feature_requirement WHERE feature_id = ?")
          .all(feat.id)
          .map((x) => x.requirement_id),
      }));
    // documentation_requirement_coverage (with inline paths)
    const coverage = db
      .prepare("SELECT * FROM documentation_requirement_coverage WHERE manifest_id = ?")
      .all(m.id)
      .map((cov) => ({
        ...cov,
        paths: (() => { try { return JSON.parse(cov.paths || '[]'); } catch { return cov.paths; } })(),
      }));
    const sections = db
      .prepare("SELECT * FROM documentation_section WHERE manifest_id = ?")
      .all(m.id);
    return {
      ...m,
      documents_created: sections.length,
      sections,
      features,
      coverage,
      assets: db
        .prepare("SELECT * FROM documentation_asset WHERE manifest_id = ?")
        .all(m.id),
      verification: db
        .prepare("SELECT * FROM documentation_review_checklist WHERE manifest_id = ?")
        .all(m.id),
    };
  });
}

const DEPLOYMENT_MANIFEST_FILTERS = {
  status: { nullable: false },
  version: { nullable: true },
  document_date: { nullable: true },
  requirements_version: { nullable: true },
  architecture_version: { nullable: true },
  implementation_version: { nullable: true },
  test_report_version: { nullable: true },
};

function queryDeploymentManifest(db, { iteration_id, ids, filters = {}, include_related = false }) {
  let sql = "SELECT * FROM deployment_manifest";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, DEPLOYMENT_MANIFEST_FILTERS, "deployment_manifest");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  const results = db.prepare(sql).all(...params);
  if (!include_related) return results;
  return results.map((m) => {
    // deployment_pipeline → config_files, stages
    //   deployment_pipeline_stage → triggers, steps, quality_gates
    const pipelines = db
      .prepare("SELECT * FROM deployment_pipeline WHERE manifest_id = ?")
      .all(m.id)
      .map((p) => ({
        ...p,
        config_files: (() => { try { return JSON.parse(p.config_files || '[]'); } catch { return p.config_files; } })(),
        stages: db
          .prepare("SELECT * FROM deployment_pipeline_stage WHERE pipeline_id = ?")
          .all(p.id)
          .map((s) => ({
            ...s,
            triggers: (() => { try { return JSON.parse(s.triggers || '[]'); } catch { return s.triggers; } })(),
            steps: (() => { try { return JSON.parse(s.steps || '[]'); } catch { return s.steps; } })(),
            quality_gates: db
              .prepare("SELECT * FROM deployment_stage_quality_gate WHERE stage_id = ?")
              .all(s.id),
          })),
      }));
    // deployment_environment → infra, vars
    const environments = db
      .prepare("SELECT * FROM deployment_environment WHERE manifest_id = ?")
      .all(m.id)
      .map((e) => ({
        ...e,
        infra: db
          .prepare("SELECT * FROM deployment_env_infra WHERE environment_id = ?")
          .all(e.id),
        vars: db
          .prepare("SELECT * FROM deployment_env_var WHERE environment_id = ?")
          .all(e.id),
      }));
    // deployment_artifact → platforms
    const artifacts = db
      .prepare("SELECT * FROM deployment_artifact WHERE manifest_id = ?")
      .all(m.id)
      .map((a) => ({
        ...a,
        platforms: (() => { try { return JSON.parse(a.platforms || '[]'); } catch { return a.platforms; } })(),
      }));
    // deployment_local_executable → platforms, channels
    const local_executables = db
      .prepare("SELECT * FROM deployment_local_executable WHERE manifest_id = ?")
      .all(m.id)
      .map((le) => ({
        ...le,
        platforms: (() => { try { return JSON.parse(le.platforms || '[]'); } catch { return le.platforms; } })(),
        channels: (() => { try { return JSON.parse(le.channels || '[]'); } catch { return le.channels; } })(),
      }));
    // deployment_runbook → steps
    const runbooks = db
      .prepare("SELECT * FROM deployment_runbook WHERE manifest_id = ?")
      .all(m.id)
      .map((rb) => ({
        ...rb,
        steps: db
          .prepare("SELECT * FROM deployment_runbook_step WHERE runbook_id = ?")
          .all(rb.id),
      }));
    return {
      ...m,
      targets: (() => { try { return JSON.parse(m.targets || '[]'); } catch { return m.targets; } })(),
      blockers: (() => { try { return JSON.parse(m.blockers || '[]'); } catch { return m.blockers; } })(),
      pipelines,
      quality_gates: db
        .prepare("SELECT * FROM deployment_quality_gate WHERE manifest_id = ?")
        .all(m.id),
      environments,
      artifacts,
      signing: db
        .prepare("SELECT * FROM deployment_signing WHERE manifest_id = ?")
        .all(m.id),
      local_executables,
      secrets: db
        .prepare("SELECT * FROM deployment_secret WHERE manifest_id = ?")
        .all(m.id),
      health_checks: db
        .prepare("SELECT * FROM deployment_health_check WHERE manifest_id = ?")
        .all(m.id),
      alerting: db
        .prepare("SELECT * FROM deployment_alerting WHERE manifest_id = ?")
        .all(m.id),
      runbooks,
      review_checklist: db
        .prepare("SELECT * FROM deployment_review_checklist WHERE manifest_id = ?")
        .all(m.id),
    };
  });
}

// ---------------------------------------------------------------------------
// Per-entity query functions -- simple types (21)
// Complete implementations, no enrichment needed.
// ---------------------------------------------------------------------------

const TECHNOLOGY_CHOICE_FILTERS = {
  category: { nullable: false },
  name: { nullable: false },
  purpose: { nullable: true },
  rationale: { nullable: true },
  version: { nullable: true },
  config: { nullable: true },
};

function queryTechnologyChoice(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM technology_choice";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, TECHNOLOGY_CHOICE_FILTERS, "technology_choice");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

const PLAN_EXTERNAL_DEPENDENCY_FILTERS = {
  name: { nullable: false },
  description: { nullable: false },
  plan_phase_id: { nullable: true },
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

const PLAN_METADATA_FILTERS = {
  title: { nullable: false },
  version: { nullable: false },
  document_date: { nullable: false },
  status: { nullable: false },
  requirements_version: { nullable: false },
  architecture_version: { nullable: false },
  ux_specification_version: { nullable: false },
  document_updated: { nullable: true },
};

function queryPlanMetadata(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM plan_metadata";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, PLAN_METADATA_FILTERS, "plan_metadata");
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
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
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

const SYSTEM_IO_FILTERS = {
  direction: { nullable: false },
  name: { nullable: false },
  description: { nullable: false },
  source: { nullable: true },
  destination: { nullable: true },
  data_format: { nullable: true },
};

function querySystemIo(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM system_io";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, SYSTEM_IO_FILTERS, "system_io");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

const NONFUNCTIONAL_REQUIREMENT_FILTERS = {
  type: { nullable: false },
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

const CONFIG_FILTERS = {
  domain: { nullable: false },
  config_type: { nullable: false },
  category: { nullable: false },
  key: { nullable: false },
  value: { nullable: false },
  rationale: { nullable: true },
};

function queryConfig(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM config";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, CONFIG_FILTERS, "config");
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
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, UX_ASSET_FILTERS, "ux_asset");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

// (architecture_config merged into queryConfig — see above)

const APPROVED_DEPENDENCY_FILTERS = {
  package: { nullable: false },
  version_constraint: { nullable: true },
  purpose: { nullable: false },
  justification: { nullable: false },
  adr_id: { nullable: true },
  license: { nullable: true },
  maintenance_activity: { nullable: true },
  community_adoption: { nullable: true },
  transitive_deps: { nullable: true },
  single_maintainer_risk: { nullable: true },
};

function queryApprovedDependency(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM approved_dependency";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
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
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
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
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
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
  if (iteration_id != null) { clauses.push("revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, INTERMEDIATE_ASSET_FILTERS, "intermediate_asset");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

const ASSET_DELIVERABLE_FILTERS = {
  phase_id: { nullable: true },
  asset_type: { nullable: false },
  file_path: { nullable: false },
  description: { nullable: true },
  commit_sha: { nullable: true },
};

function queryAssetDeliverable(db, { iteration_id, ids, filters = {} }) {
  let sql = "SELECT * FROM asset_deliverable";
  const clauses = [];
  const params = [];
  if (iteration_id != null) { clauses.push("iteration_id = ?"); params.push(iteration_id); }
  if (ids?.length) { clauses.push(`id IN (${ids.map(() => "?").join(",")})`); params.push(...ids); }
  const f = applyFilters(filters, ASSET_DELIVERABLE_FILTERS, "asset_deliverable");
  clauses.push(...f.clauses);
  params.push(...f.params);
  if (clauses.length) sql += " WHERE " + clauses.join(" AND ");
  return db.prepare(sql).all(...params);
}

const VCS_COMMIT_FILTERS = {
  phase_id: { nullable: true },
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
  component: queryComponent,
  user_flow: queryUserFlow,
  screen: queryScreen,
  plan_phase: queryPlanPhase,
  plan_overview: queryPlanOverview,
  data_entity: queryDataEntity,
  architecture_overview: queryArchitectureOverview,
  persona_addressed: queryPersonaAddressed,
  info_architecture: queryInfoArchitecture,
  implementation_manifest: queryImplementationManifest,
  test_report: queryTestReport,
  documentation_manifest: queryDocumentationManifest,
  deployment_manifest: queryDeploymentManifest,
  technology_choice: queryTechnologyChoice,
  plan_external_dependency: queryPlanExternalDependency,
  plan_metadata: queryPlanMetadata,
  requirement_trace: queryRequirementTrace,
  project_context: queryProjectContext,
  system_io: querySystemIo,
  nonfunctional_requirement: queryNonfunctionalRequirement,
  config: queryConfig,
  ux_asset: queryUxAsset,
  // (architecture_config merged into config)
  approved_dependency: queryApprovedDependency,
  blocker: queryBlocker,
  project_lesson: queryProjectLesson,
  security_audit_finding: querySecurityAuditFinding,
  performance_audit_finding: queryPerformanceAuditFinding,
  intermediate_asset: queryIntermediateAsset,
  asset_deliverable: queryAssetDeliverable,
  vcs_commit: queryVcsCommit,
};

// ---------------------------------------------------------------------------
// Tool 1: changelog_query
// ---------------------------------------------------------------------------

function changelogQuery(args) {
  const db = getDb();
  const {
    entity_type,
    iteration_id,
    ids,
    filters,
    include_related = false,
    history = false,
  } = args;

  if (!QUERY_DISPATCH[entity_type]) {
    throw new Error(
      `Unknown entity_type: "${entity_type}". Valid types: ${Object.keys(QUERY_DISPATCH).join(", ")}`
    );
  }

  // History mode: query entity_snapshot table for change history
  if (history) {
    let sql = `SELECT * FROM entity_snapshot WHERE entity_type = ?`;
    const params = [entity_type];
    if (ids && ids.length > 0) {
      sql += ` AND source_id IN (${ids.map(() => "?").join(", ")})`;
      params.push(...ids);
    }
    sql += ` ORDER BY id ASC`;
    const snapshots = db.prepare(sql).all(...params);
    // Parse snapshot JSON for convenience
    const results = snapshots.map((s) => ({
      ...s,
      snapshot: (() => { try { return JSON.parse(s.snapshot); } catch { return {}; } })(),
    }));
    return { entity_type, history: true, results, count: results.length };
  }

  try {
    const results = QUERY_DISPATCH[entity_type](db, { iteration_id, ids, filters, include_related });

    return { entity_type, results, count: results.length };
  } catch (err) {
    throw new Error(`Failed to query ${entity_type}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Tool 2: traceability_query
// ---------------------------------------------------------------------------

function traceabilityQuery(args) {
  const db = getDb();
  const { target, target_type, iteration_id } = args;

  const iterParam = iteration_id ? [iteration_id] : [];

  const chain = [];

  switch (target_type) {
    case "component": {
      const comp = db
        .prepare("SELECT * FROM component WHERE id = ?" + (iteration_id ? " AND revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)" : ""))
        .get(target, ...iterParam);
      if (!comp) break;
      chain.push({ type: "component", data: comp });

      const reqIds = db
        .prepare("SELECT requirement_id FROM requirement_trace WHERE addressed_by = ? AND addressed_by_type = 'component'")
        .all(comp.id)
        .map((x) => x.requirement_id);

      const compCtx = db.prepare("SELECT iteration_id FROM entity_context WHERE revision_id = ?").get(comp.revision_id);

      if (reqIds.length > 0) {
        const reqs = db
          .prepare(`SELECT * FROM requirement WHERE id IN (${reqIds.map(() => "?").join(",")})`)
          .all(...reqIds);
        chain.push({ type: "requirements_addressed", data: reqs });

        // Find ADRs in the same iteration as this component
        if (compCtx) {
          const adrs = db
            .prepare(
              "SELECT * FROM adr WHERE revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"
            )
            .all(compCtx.iteration_id);
          if (adrs.length > 0) chain.push({ type: "related_adrs", data: adrs });
        }
      }

      const iterMeta = compCtx
        ? db
            .prepare("SELECT key, value, category FROM project_context WHERE iteration_id = ?")
            .all(compCtx.iteration_id)
        : [];
      if (iterMeta.length > 0) chain.push({ type: "project_context", data: iterMeta });
      break;
    }

    case "technology": {
      const techRows = db
        .prepare(
          "SELECT * FROM technology_choice WHERE name = ?" +
            (iteration_id ? " AND revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)" : "")
        )
        .all(target, ...iterParam);
      if (!techRows.length) break;
      chain.push({ type: "technology_choice", data: techRows });

      // Find ADRs whose decision text mentions the technology name
      const adrs = db
        .prepare(
          "SELECT * FROM adr WHERE (decision LIKE ? OR rationale LIKE ?)" +
            (iteration_id ? " AND revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)" : "")
        )
        .all(`%${target}%`, `%${target}%`, ...iterParam);
      if (adrs.length > 0) chain.push({ type: "related_adrs", data: adrs });

      // Find requirements linked via ADR traceability
      const adrIds = adrs.map((a) => a.id);
      if (adrIds.length > 0) {
        const approved = db
          .prepare(
            `SELECT * FROM approved_dependency WHERE adr_id IN (${adrIds.map(() => "?").join(",")})` +
              (iteration_id ? " AND revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)" : "")
          )
          .all(...adrIds, ...iterParam);
        if (approved.length > 0) chain.push({ type: "approved_dependencies", data: approved });
      }
      break;
    }

    case "requirement": {
      const req = db
        .prepare("SELECT * FROM requirement WHERE id = ?" + (iteration_id ? " AND revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)" : ""))
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
            (iteration_id ? " AND revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)" : "")
        )
        .all(req.id, ...iterParam);
      if (mappings.length > 0) chain.push({ type: "addressed_by", data: mappings });

      // Which plan_phase includes it
      const phases = db
        .prepare(
          `SELECT pp.* FROM plan_phase pp
           JOIN plan_phase_requirement ppr ON ppr.plan_phase_id = pp.id
           WHERE ppr.requirement_id = ?` +
            (iteration_id ? " AND pp.revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)" : "")
        )
        .all(req.id, ...iterParam);
      if (phases.length > 0) chain.push({ type: "plan_phases", data: phases });

      // Which components implement it
      const components = db
        .prepare(
          `SELECT c.* FROM component c
           JOIN requirement_trace rt ON rt.addressed_by = c.id AND rt.addressed_by_type = 'component'
           WHERE rt.requirement_id = ?` +
            (iteration_id ? " AND c.revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)" : "")
        )
        .all(req.id, ...iterParam);
      if (components.length > 0) chain.push({ type: "implementing_components", data: components });
      break;
    }

    case "adr": {
      const adr = db
        .prepare("SELECT * FROM adr WHERE id = ?" + (iteration_id ? " AND revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)" : ""))
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
      const adrCtx = db.prepare("SELECT iteration_id FROM entity_context WHERE revision_id = ?").get(adr.revision_id);
      const components = adrCtx ? db
        .prepare(
          "SELECT * FROM component WHERE revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)"
        )
        .all(adrCtx.iteration_id) : [];
      if (components.length > 0) chain.push({ type: "components_in_same_iteration", data: components });
      break;
    }

    case "flow": {
      const flow = db
        .prepare("SELECT * FROM user_flow WHERE id = ?" + (iteration_id ? " AND revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)" : ""))
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
                (iteration_id ? " AND revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)" : "")
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
              (iteration_id ? " AND revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)" : "")
          )
          .all(...reqIds, ...iterParam);
        if (mappings.length > 0) chain.push({ type: "requirement_traces", data: mappings });
      }
      break;
    }

    case "screen": {
      const scr = db
        .prepare("SELECT * FROM screen WHERE id = ?" + (iteration_id ? " AND revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)" : ""))
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
              (iteration_id ? " AND revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)" : "")
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
  const db = getDb();
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
  const db = getDb();
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
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = ?)`)
      .get(iteration_id).n;

  const decisions = {
    requirements: countFor("requirement"),
    adrs: countFor("adr"),
    components: countFor("component"),
    technology_choices: countFor("technology_choice"),
    user_flows: countFor("user_flow"),
    screens: countFor("screen"),
    plan_phases: countFor("plan_phase"),
    approved_dependencies: countFor("approved_dependency"),
    requirement_traces: countFor("requirement_trace"),
    security_audit_findings: countFor("security_audit_finding"),
    performance_audit_findings: countFor("performance_audit_finding"),
  };

  const commits = db
    .prepare("SELECT commit_sha, message, created_at FROM vcs_commit WHERE iteration_id = ? ORDER BY created_at")
    .all(iteration_id);

  const deliverables = db
    .prepare(
      "SELECT asset_type, file_path, description, commit_sha, created_at FROM asset_deliverable WHERE iteration_id = ? ORDER BY created_at"
    )
    .all(iteration_id);

  return { iteration, phases, decisions, commits, deliverables };
}

// ---------------------------------------------------------------------------
// Tool 5: project_status
// ---------------------------------------------------------------------------

function projectStatus(args) {
  const db = getDb();

  const project = db.prepare("SELECT * FROM project WHERE id = 1").get();
  if (!project) throw new Error("Project not found — run iteration_create first");

  const currentIteration = db
    .prepare(
      "SELECT * FROM iteration WHERE status = 'active' ORDER BY id DESC LIMIT 1"
    )
    .get();

  const targetIterationId = currentIteration
    ? currentIteration.id
    : db
        .prepare("SELECT id FROM iteration ORDER BY id DESC LIMIT 1")
        .get()?.id;

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
// MCP tool definitions
// ---------------------------------------------------------------------------

export const READ_TOOLS = [
  {
    name: "changelog_query",
    description:
      "Flexible query of the changelog database. Primary read tool for agents. " +
      "Query any entity type with optional iteration, ID, and field filters. " +
      "Set include_related=true to attach child table data (acceptance criteria, interfaces, alternatives, etc.).",
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
            'Field→value filters, e.g. { "category": "security", "priority": "must-have" }',
          additionalProperties: true,
        },
        include_related: {
          type: "boolean",
          description:
            "If true, attach child/related table data (acceptance criteria, interfaces, etc.). More tokens but complete data.",
          default: false,
        },
        history: {
          type: "boolean",
          description:
            "If true, return change history from entity_snapshot instead of current state. Shows how entities evolved across revisions. Use with ids to see history for specific entities.",
          default: false,
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
            "Phase name (use with iteration_id). One of: requirements, ux_design, architecture, planning, implementation, documentation, qa, audit, release",
        },
      },
    },
  },
  {
    name: "iteration_summary",
    description:
      "Summarize what an iteration produced: phases with status, decision counts per entity type, VCS commits, and asset deliverables.",
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
      "Get the full project status. Returns project metadata, the current active iteration, and all phases with status, timestamps, and revision counts. No parameters needed.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
];

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
    default:
      throw new Error(`Unknown read tool: "${name}"`);
  }
}
