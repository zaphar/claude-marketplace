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
  plan_critical_path: "plan_critical_path",
  plan_metadata: "plan_metadata",
  implementation_manifest: "implementation_manifest",
  traceability_mapping: "traceability_mapping",
  project_context: "project_context",
  system_io: "system_io",
  deployment_requirement: "deployment_requirement",
  operational_requirement: "operational_requirement",
  technology_constraint: "technology_constraint",
  ux_config: "ux_config",
  info_architecture: "info_architecture",
  persona_addressed: "persona_addressed",
  ux_asset: "ux_asset",
  architecture_overview: "architecture_overview",
  data_entity: "data_entity",
  architecture_config: "architecture_config",
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

// Primary key column per table (most use 'id', but some are INTEGER AUTOINCREMENT)
const TEXT_PK_TYPES = new Set([
  "persona", "requirement", "adr", "component", "user_flow", "screen",
]);

// ---------------------------------------------------------------------------
// Helper: build WHERE clause from ids + filters
// ---------------------------------------------------------------------------

function buildWhere(entityType, iterationId, ids, filters) {
  const table = ENTITY_TABLE[entityType];
  const clauses = [];
  const params = {};

  const hasIterationCol = !TEXT_PK_TYPES.has(table)
    ? true
    : ["persona", "requirement", "adr", "component", "user_flow", "screen"].includes(table);

  if (iterationId !== undefined && iterationId !== null) {
    clauses.push("iteration_id = @iteration_id");
    params.iteration_id = iterationId;
  }

  if (ids && ids.length > 0) {
    // Use IN clause — SQLite doesn't support named params in IN, so build positional
    // We'll handle this specially in the caller
    params.__ids = ids;
  }

  if (filters && typeof filters === "object") {
    for (const [field, value] of Object.entries(filters)) {
      if (value === null) {
        clauses.push(`${field} IS NULL`);
      } else {
        const key = `f_${field}`;
        clauses.push(`${field} = @${key}`);
        params[key] = value;
      }
    }
  }

  return { clauses, params };
}

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

  if (!ENTITY_TABLE[entity_type]) {
    throw new Error(
      `Unknown entity_type: "${entity_type}". Valid types: ${Object.keys(ENTITY_TABLE).join(", ")}`
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
      snapshot: JSON.parse(s.snapshot),
    }));
    return { entity_type, history: true, results, count: results.length };
  }

  const table = ENTITY_TABLE[entity_type];
  const { clauses, params } = buildWhere(entity_type, iteration_id, ids, filters);

  // Build query
  let sql = `SELECT * FROM ${table}`;

  // Handle ids via IN
  const idsParam = params.__ids;
  delete params.__ids;

  const allClauses = [...clauses];
  if (idsParam && idsParam.length > 0) {
    const placeholders = idsParam.map((_, i) => `?`).join(", ");
    allClauses.push(`id IN (${placeholders})`);
  }

  if (allClauses.length > 0) {
    sql += " WHERE " + allClauses.join(" AND ");
  }

  // Execute
  let stmt;
  let results;
  if (idsParam && idsParam.length > 0) {
    // Mix named and positional params — use positional for all
    const positionalParams = [];
    // Rebuild WHERE without named params for ids case
    let sqlPositional = `SELECT * FROM ${table}`;
    const posWhere = [];
    if (iteration_id !== undefined && iteration_id !== null) {
      posWhere.push("iteration_id = ?");
      positionalParams.push(iteration_id);
    }
    if (filters && typeof filters === "object") {
      for (const [field, value] of Object.entries(filters)) {
        posWhere.push(`${field} = ?`);
        positionalParams.push(value);
      }
    }
    posWhere.push(`id IN (${idsParam.map(() => "?").join(", ")})`);
    positionalParams.push(...idsParam);
    sqlPositional += " WHERE " + posWhere.join(" AND ");
    results = db.prepare(sqlPositional).all(...positionalParams);
  } else {
    results = db.prepare(sql).all(params);
  }

  // Attach related data when requested
  if (include_related && results.length > 0) {
    results = attachRelated(db, entity_type, results);
  }

  return { entity_type, results, count: results.length };
}

// ---------------------------------------------------------------------------
// attachRelated: enrich results with child table rows
// ---------------------------------------------------------------------------

function attachRelated(db, entityType, results) {
  switch (entityType) {
    case "requirement":
      return results.map((r) => ({
        ...r,
        acceptance_criteria: JSON.parse(r.acceptance_criteria || '[]'),
        personas: db
          .prepare("SELECT persona_id FROM requirement_persona WHERE requirement_id = ?")
          .all(r.id)
          .map((x) => x.persona_id),
        depends_on: db
          .prepare("SELECT depends_on FROM requirement_dependency WHERE requirement_id = ?")
          .all(r.id)
          .map((x) => x.depends_on),
      }));

    case "component":
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
          .prepare("SELECT requirement_id FROM component_requirement WHERE component_id = ?")
          .all(c.id)
          .map((x) => x.requirement_id),
        integration_test_boundaries: db
          .prepare("SELECT * FROM integration_test_boundary WHERE component_id = ?")
          .all(c.id),
      }));

    case "adr": {
      return results.map((a) => {
        const alternatives = db
          .prepare("SELECT * FROM adr_alternative WHERE adr_id = ?")
          .all(a.id)
          .map((alt) => ({
            ...alt,
            pros: alt.pros ? JSON.parse(alt.pros) : [],
            cons: alt.cons ? JSON.parse(alt.cons) : [],
          }));
        return {
          ...a,
          alternatives,
          consequences: JSON.parse(a.consequences || '[]'),
          research_sources: JSON.parse(a.research_sources || '[]'),
        };
      });
    }

    case "user_flow":
      return results.map((f) => {
        const steps = db
          .prepare("SELECT * FROM user_flow_step WHERE flow_id = ? ORDER BY step_number")
          .all(f.id)
          .map((s) => ({
            ...s,
            branches: db
              .prepare("SELECT condition, next_step FROM user_flow_step_branch WHERE step_id = ?")
              .all(s.id),
          }));
        return {
          ...f,
          steps,
          error_states: db
            .prepare("SELECT condition, recovery FROM user_flow_error_state WHERE flow_id = ?")
            .all(f.id),
          requirements: db
            .prepare("SELECT requirement_id FROM user_flow_requirement WHERE flow_id = ?")
            .all(f.id)
            .map((x) => x.requirement_id),
          data_dependencies: JSON.parse(f.data_dependencies || '[]'),
        };
      });

    case "screen":
      return results.map((s) => ({
        ...s,
        components: JSON.parse(s.components || '[]'),
        states: db
          .prepare("SELECT name, description, wireframe_path FROM screen_state WHERE screen_id = ?")
          .all(s.id),
        responsive_variants: db
          .prepare("SELECT breakpoint, wireframe_path, layout_changes FROM screen_responsive_variant WHERE screen_id = ?")
          .all(s.id),
      }));

    case "plan_phase":
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
        entry_criteria: JSON.parse(p.entry_criteria || '[]'),
        exit_criteria: JSON.parse(p.exit_criteria || '[]'),
        api_endpoints: db
          .prepare("SELECT http_method, route, description FROM plan_phase_api_endpoint WHERE plan_phase_id = ?")
          .all(p.id),
        db_changes: db
          .prepare("SELECT id, migration_name, description, tables FROM plan_phase_db_change WHERE plan_phase_id = ?")
          .all(p.id)
          .map((dc) => ({
            ...dc,
            tables: JSON.parse(dc.tables || '[]'),
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
          .prepare("SELECT related_phase_id AS depends_on_phase_id, reason FROM plan_phase_relationship WHERE plan_phase_id = ? AND relationship_type = 'dependency'")
          .all(p.id),
        parallel_with: db
          .prepare("SELECT related_phase_id AS can_parallel_with_id FROM plan_phase_relationship WHERE plan_phase_id = ? AND relationship_type = 'parallel'")
          .all(p.id)
          .map((x) => x.can_parallel_with_id),
        checkpoint_focus: JSON.parse(p.checkpoint_focus || '[]'),
      }));

    case "plan_overview":
      return results.map((o) => ({
        ...o,
        total_phases: db
          .prepare("SELECT COUNT(*) AS cnt FROM plan_phase WHERE iteration_id = ?")
          .get(o.iteration_id).cnt,
        risks: db
          .prepare("SELECT risk, mitigation, plan_phase_number FROM plan_overview_risk WHERE plan_overview_id = ?")
          .all(o.id),
        assumptions: JSON.parse(o.assumptions || '[]'),
      }));

    case "persona":
      return results.map((p) => ({
        ...p,
        goals: JSON.parse(p.goals || '[]'),
      }));

    case "data_entity":
      return results.map((e) => ({
        ...e,
        attributes: db
          .prepare("SELECT name, data_type, is_required, description FROM data_entity_attribute WHERE entity_id = ?")
          .all(e.id),
        relationships: db
          .prepare(
            `SELECT t.name AS target_entity, r.target_entity_id, r.relationship_type, r.description
             FROM data_entity_relationship r
             JOIN data_entity t ON t.id = r.target_entity_id
             WHERE r.entity_id = ?`
          )
          .all(e.id),
      }));

    case "architecture_overview":
      return results.map((o) => ({
        ...o,
        principles: JSON.parse(o.principles || '[]'),
        diagrams: db
          .prepare("SELECT id, name, path, description FROM architecture_diagram WHERE overview_id = ?")
          .all(o.id),
      }));

    case "persona_addressed":
      return results.map((pa) => ({
        ...pa,
        flows: db
          .prepare("SELECT flow_id FROM persona_addressed_flow WHERE persona_addressed_id = ?")
          .all(pa.id)
          .map((x) => x.flow_id),
      }));

    case "info_architecture":
      return results.map((ia) => ({
        ...ia,
        children: db
          .prepare("SELECT id, category, key, value FROM info_architecture WHERE parent_id = ?")
          .all(ia.id),
      }));

    case "implementation_manifest":
      return results.map((m) => {
        const files = db
          .prepare("SELECT * FROM implementation_file WHERE manifest_id = ?")
          .all(m.id)
          .map((f) => ({
            ...f,
            requirements: db
              .prepare("SELECT requirement_id FROM implementation_file_requirement WHERE file_id = ?")
              .all(f.id)
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
          files_created: files.filter((f) => f.file_operation === "created").length,
          files_modified: files.filter((f) => f.file_operation === "modified").length,
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

    case "test_report":
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
                test_ids: JSON.parse(cr.test_ids || '[]'),
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

    case "documentation_manifest":
      return results.map((m) => {
        // documentation_feature → documentation_feature_requirement
        const features = db
          .prepare("SELECT * FROM documentation_feature WHERE manifest_id = ?")
          .all(m.id)
          .map((f) => ({
            ...f,
            requirements: db
              .prepare("SELECT requirement_id FROM documentation_feature_requirement WHERE feature_id = ?")
              .all(f.id)
              .map((x) => x.requirement_id),
          }));
        // documentation_requirement_coverage (with inline paths)
        const coverage = db
          .prepare("SELECT * FROM documentation_requirement_coverage WHERE manifest_id = ?")
          .all(m.id)
          .map((cov) => ({
            ...cov,
            paths: JSON.parse(cov.paths || '[]'),
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

    case "deployment_manifest":
      return results.map((m) => {
        // deployment_pipeline → config_files, stages
        //   deployment_pipeline_stage → triggers, steps, quality_gates
        const pipelines = db
          .prepare("SELECT * FROM deployment_pipeline WHERE manifest_id = ?")
          .all(m.id)
          .map((p) => ({
            ...p,
            config_files: JSON.parse(p.config_files || '[]'),
            stages: db
              .prepare("SELECT * FROM deployment_pipeline_stage WHERE pipeline_id = ?")
              .all(p.id)
              .map((s) => ({
                ...s,
                triggers: JSON.parse(s.triggers || '[]'),
                steps: JSON.parse(s.steps || '[]'),
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
            platforms: JSON.parse(a.platforms || '[]'),
          }));
        // deployment_local_executable → platforms, channels
        const local_executables = db
          .prepare("SELECT * FROM deployment_local_executable WHERE manifest_id = ?")
          .all(m.id)
          .map((le) => ({
            ...le,
            platforms: JSON.parse(le.platforms || '[]'),
            channels: JSON.parse(le.channels || '[]'),
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
          targets: JSON.parse(m.targets || '[]'),
          blockers: JSON.parse(m.blockers || '[]'),
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

    default:
      return results;
  }
}

// ---------------------------------------------------------------------------
// Tool 2: traceability_query
// ---------------------------------------------------------------------------

function traceabilityQuery(args) {
  const db = getDb();
  const { target, target_type, iteration_id } = args;

  const iterFilter = iteration_id
    ? " AND iteration_id = ?"
    : "";
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
        .prepare("SELECT requirement_id FROM component_requirement WHERE component_id = ?")
        .all(comp.id)
        .map((x) => x.requirement_id);

      if (reqIds.length > 0) {
        const reqs = db
          .prepare(`SELECT * FROM requirement WHERE id IN (${reqIds.map(() => "?").join(",")})`)
          .all(...reqIds);
        chain.push({ type: "requirements_addressed", data: reqs });

        // Find ADRs in the same iteration as this component
        const adrs = db
          .prepare(
            "SELECT * FROM adr WHERE iteration_id = ?" +
              (iteration_id ? " AND iteration_id = ?" : "")
          )
          .all(comp.iteration_id, ...iterParam);
        if (adrs.length > 0) chain.push({ type: "related_adrs", data: adrs });
      }

      const iterMeta = comp.iteration_id
        ? db
            .prepare("SELECT key, value, category FROM project_context WHERE iteration_id = ?")
            .all(comp.iteration_id)
        : [];
      if (iterMeta.length > 0) chain.push({ type: "project_context", data: iterMeta });
      break;
    }

    case "technology": {
      const techRows = db
        .prepare(
          "SELECT * FROM technology_choice WHERE name = ?" +
            (iteration_id ? " AND iteration_id = ?" : "")
        )
        .all(target, ...iterParam);
      if (!techRows.length) break;
      chain.push({ type: "technology_choice", data: techRows });

      // Find ADRs whose decision text mentions the technology name
      const adrs = db
        .prepare(
          "SELECT * FROM adr WHERE (decision LIKE ? OR rationale LIKE ?)" +
            (iteration_id ? " AND iteration_id = ?" : "")
        )
        .all(`%${target}%`, `%${target}%`, ...iterParam);
      if (adrs.length > 0) chain.push({ type: "related_adrs", data: adrs });

      // Find requirements linked via ADR traceability
      const adrIds = adrs.map((a) => a.id);
      if (adrIds.length > 0) {
        const approved = db
          .prepare(
            `SELECT * FROM approved_dependency WHERE adr_id IN (${adrIds.map(() => "?").join(",")})` +
              (iteration_id ? " AND iteration_id = ?" : "")
          )
          .all(...adrIds, ...iterParam);
        if (approved.length > 0) chain.push({ type: "approved_dependencies", data: approved });
      }
      break;
    }

    case "requirement": {
      const req = db
        .prepare("SELECT * FROM requirement WHERE id = ?" + (iteration_id ? " AND iteration_id = ?" : ""))
        .get(target, ...iterParam);
      if (!req) break;
      chain.push({ type: "requirement", data: req });

      const acceptanceCriteria = JSON.parse(req.acceptance_criteria || '[]');
      if (acceptanceCriteria.length > 0)
        chain.push({ type: "acceptance_criteria", data: acceptanceCriteria });

      // What addresses this requirement — source from traceability_mapping for
      // non-junction types, and from junction tables for component/flow types
      const tmRows = db
        .prepare(
          "SELECT * FROM traceability_mapping WHERE requirement_id = ? AND addressed_by_type NOT IN ('component', 'flow')" +
            (iteration_id ? " AND iteration_id = ?" : "")
        )
        .all(req.id, ...iterParam);

      const crRows = db
        .prepare(
          `SELECT NULL as id, c.iteration_id, c.revision_id, cr.requirement_id,
                  cr.component_id as addressed_by, 'component' as addressed_by_type,
                  NULL as notes, c.created_at
           FROM component_requirement cr
           JOIN component c ON c.id = cr.component_id
           WHERE cr.requirement_id = ?` +
            (iteration_id ? " AND c.iteration_id = ?" : "")
        )
        .all(req.id, ...iterParam);

      const ufrRows = db
        .prepare(
          `SELECT NULL as id, uf.iteration_id, uf.revision_id, ufr.requirement_id,
                  ufr.flow_id as addressed_by, 'flow' as addressed_by_type,
                  NULL as notes, uf.created_at
           FROM user_flow_requirement ufr
           JOIN user_flow uf ON uf.id = ufr.flow_id
           WHERE ufr.requirement_id = ?` +
            (iteration_id ? " AND uf.iteration_id = ?" : "")
        )
        .all(req.id, ...iterParam);

      const mappings = [...tmRows, ...crRows, ...ufrRows];
      if (mappings.length > 0) chain.push({ type: "addressed_by", data: mappings });

      // Which plan_phase includes it
      const phases = db
        .prepare(
          `SELECT pp.* FROM plan_phase pp
           JOIN plan_phase_requirement ppr ON ppr.plan_phase_id = pp.id
           WHERE ppr.requirement_id = ?` +
            (iteration_id ? " AND pp.iteration_id = ?" : "")
        )
        .all(req.id, ...iterParam);
      if (phases.length > 0) chain.push({ type: "plan_phases", data: phases });

      // Which components implement it
      const components = db
        .prepare(
          `SELECT c.* FROM component c
           JOIN component_requirement cr ON cr.component_id = c.id
           WHERE cr.requirement_id = ?` +
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
          pros: alt.pros ? JSON.parse(alt.pros) : [],
          cons: alt.cons ? JSON.parse(alt.cons) : [],
        }));
      if (alternatives.length > 0) chain.push({ type: "alternatives", data: alternatives });

      const consequences = JSON.parse(adr.consequences || '[]');
      if (consequences.length > 0) chain.push({ type: "consequences", data: consequences });

      // Components in the same iteration as this ADR
      const components = db
        .prepare(
          "SELECT * FROM component WHERE iteration_id = ?" +
            (iteration_id ? " AND iteration_id = ?" : "")
        )
        .all(adr.iteration_id, ...(iteration_id ? [iteration_id] : []));
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
        .prepare("SELECT requirement_id FROM user_flow_requirement WHERE flow_id = ?")
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

      // Related traceability — combine traceability_mapping (non-junction types)
      // with junction tables for component and flow types
      if (reqIds.length > 0) {
        const tmRows = db
          .prepare(
            `SELECT * FROM traceability_mapping WHERE requirement_id IN (${reqIds.map(() => "?").join(",")}) AND addressed_by_type NOT IN ('component', 'flow')` +
              (iteration_id ? " AND iteration_id = ?" : "")
          )
          .all(...reqIds, ...iterParam);

        const crRows = db
          .prepare(
            `SELECT NULL as id, c.iteration_id, c.revision_id, cr.requirement_id,
                    cr.component_id as addressed_by, 'component' as addressed_by_type,
                    NULL as notes, c.created_at
             FROM component_requirement cr
             JOIN component c ON c.id = cr.component_id
             WHERE cr.requirement_id IN (${reqIds.map(() => "?").join(",")})` +
              (iteration_id ? " AND c.iteration_id = ?" : "")
          )
          .all(...reqIds, ...iterParam);

        const ufrRows = db
          .prepare(
            `SELECT NULL as id, uf.iteration_id, uf.revision_id, ufr.requirement_id,
                    ufr.flow_id as addressed_by, 'flow' as addressed_by_type,
                    NULL as notes, uf.created_at
             FROM user_flow_requirement ufr
             JOIN user_flow uf ON uf.id = ufr.flow_id
             WHERE ufr.requirement_id IN (${reqIds.map(() => "?").join(",")})` +
              (iteration_id ? " AND uf.iteration_id = ?" : "")
          )
          .all(...reqIds, ...iterParam);

        const mappings = [...tmRows, ...crRows, ...ufrRows];
        if (mappings.length > 0) chain.push({ type: "traceability_mappings", data: mappings });
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
            `SELECT DISTINCT ufr.requirement_id FROM user_flow_requirement ufr
             WHERE ufr.flow_id IN (${flowIds.map(() => "?").join(",")})`
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
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE iteration_id = ?`)
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
    traceability_mappings: countFor("traceability_mapping"),
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
