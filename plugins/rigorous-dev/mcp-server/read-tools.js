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
  implementation_manifest: "implementation_manifest",
  traceability_mapping: "traceability_mapping",
  iteration_metadata: "iteration_metadata",
  design_system: "design_system",
  architecture_overview: "architecture_overview",
  data_entity: "data_entity",
  security_config: "security_config",
  deployment_config: "deployment_config",
  observability_config: "observability_config",
  approved_dependency: "approved_dependency",
  test_report: "test_report",
  documentation_manifest: "documentation_manifest",
  deployment_manifest: "deployment_manifest",
  blocker: "blocker",
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
      sql += ` AND entity_id IN (${ids.map(() => "?").join(", ")})`;
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
        acceptance_criteria: db
          .prepare("SELECT criterion FROM requirement_acceptance_criterion WHERE requirement_id = ?")
          .all(r.id)
          .map((x) => x.criterion),
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
      }));

    case "adr": {
      return results.map((a) => {
        const alternatives = db
          .prepare("SELECT * FROM adr_alternative WHERE adr_id = ?")
          .all(a.id)
          .map((alt) => ({
            ...alt,
            pros: db
              .prepare("SELECT pro FROM adr_alternative_pro WHERE alternative_id = ?")
              .all(alt.id)
              .map((x) => x.pro),
            cons: db
              .prepare("SELECT con FROM adr_alternative_con WHERE alternative_id = ?")
              .all(alt.id)
              .map((x) => x.con),
          }));
        return {
          ...a,
          alternatives,
          consequences: db
            .prepare("SELECT consequence FROM adr_consequence WHERE adr_id = ?")
            .all(a.id)
            .map((x) => x.consequence),
          research_sources: db
            .prepare("SELECT source FROM adr_research_source WHERE adr_id = ?")
            .all(a.id)
            .map((x) => x.source),
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
          data_dependencies: db
            .prepare("SELECT dependency FROM user_flow_data_dependency WHERE flow_id = ?")
            .all(f.id)
            .map((x) => x.dependency),
        };
      });

    case "screen":
      return results.map((s) => ({
        ...s,
        components: db
          .prepare("SELECT component_name FROM screen_component WHERE screen_id = ?")
          .all(s.id)
          .map((x) => x.component_name),
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
          .prepare("SELECT requirement_id FROM plan_phase_requirement WHERE plan_phase_id = ?")
          .all(p.id)
          .map((x) => x.requirement_id),
        components: db
          .prepare("SELECT component_id FROM plan_phase_component WHERE plan_phase_id = ?")
          .all(p.id)
          .map((x) => x.component_id),
        entry_criteria: db
          .prepare("SELECT criterion FROM plan_phase_entry_criterion WHERE plan_phase_id = ?")
          .all(p.id)
          .map((x) => x.criterion),
        exit_criteria: db
          .prepare("SELECT criterion FROM plan_phase_exit_criterion WHERE plan_phase_id = ?")
          .all(p.id)
          .map((x) => x.criterion),
        api_endpoints: db
          .prepare("SELECT method, path, description FROM plan_phase_api_endpoint WHERE plan_phase_id = ?")
          .all(p.id),
        db_changes: db
          .prepare("SELECT migration_name, description FROM plan_phase_db_change WHERE plan_phase_id = ?")
          .all(p.id),
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
          .prepare("SELECT depends_on_phase, reason FROM plan_phase_dependency WHERE plan_phase_id = ?")
          .all(p.id),
        parallel_with: db
          .prepare("SELECT can_parallel_with FROM plan_phase_parallel WHERE plan_phase_id = ?")
          .all(p.id)
          .map((x) => x.can_parallel_with),
        checkpoint_focus: db
          .prepare("SELECT focus FROM plan_checkpoint_focus WHERE plan_phase_id = ?")
          .all(p.id)
          .map((x) => x.focus),
      }));

    case "plan_overview":
      return results.map((o) => ({
        ...o,
        risks: db
          .prepare("SELECT risk, mitigation, phase FROM plan_overview_risk WHERE plan_overview_id = ?")
          .all(o.id),
        assumptions: db
          .prepare("SELECT assumption FROM plan_overview_assumption WHERE plan_overview_id = ?")
          .all(o.id)
          .map((x) => x.assumption),
      }));

    case "persona":
      return results.map((p) => ({
        ...p,
        goals: db
          .prepare("SELECT goal FROM persona_goal WHERE persona_id = ?")
          .all(p.id)
          .map((x) => x.goal),
      }));

    case "data_entity":
      return results.map((e) => ({
        ...e,
        attributes: db
          .prepare("SELECT name, type, is_required, description FROM data_entity_attribute WHERE entity_id = ?")
          .all(e.id),
        relationships: db
          .prepare("SELECT target_entity, relationship_type, description FROM data_entity_relationship WHERE entity_id = ?")
          .all(e.id),
      }));

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

        // Find ADRs referencing these requirements (via decision text heuristic or traceability)
        const adrs = db
          .prepare(
            `SELECT DISTINCT a.* FROM adr a
             JOIN traceability_mapping tm ON tm.iteration_id = a.iteration_id
             WHERE tm.addressed_by = ? AND tm.addressed_by_type = 'component'` +
              (iteration_id ? " AND a.iteration_id = ?" : "")
          )
          .all(comp.id, ...iterParam);
        if (adrs.length > 0) chain.push({ type: "related_adrs", data: adrs });
      }

      const iterMeta = comp.iteration_id
        ? db
            .prepare("SELECT key, value, category FROM iteration_metadata WHERE iteration_id = ?")
            .all(comp.iteration_id)
        : [];
      if (iterMeta.length > 0) chain.push({ type: "iteration_context", data: iterMeta });
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

      const acceptanceCriteria = db
        .prepare("SELECT criterion FROM requirement_acceptance_criterion WHERE requirement_id = ?")
        .all(req.id)
        .map((x) => x.criterion);
      if (acceptanceCriteria.length > 0)
        chain.push({ type: "acceptance_criteria", data: acceptanceCriteria });

      // What addresses this requirement
      const mappings = db
        .prepare(
          "SELECT * FROM traceability_mapping WHERE requirement_id = ?" +
            (iteration_id ? " AND iteration_id = ?" : "")
        )
        .all(req.id, ...iterParam);
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
        .all(adr.id);
      if (alternatives.length > 0) chain.push({ type: "alternatives", data: alternatives });

      const consequences = db
        .prepare("SELECT consequence FROM adr_consequence WHERE adr_id = ?")
        .all(adr.id)
        .map((x) => x.consequence);
      if (consequences.length > 0) chain.push({ type: "consequences", data: consequences });

      // Components affected (traceability_mapping pointing to components with iteration matching this ADR)
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
        const screenNames = [...new Set(steps.map((s) => s.screen))];
        const screens = db
          .prepare(
            `SELECT * FROM screen WHERE name IN (${screenNames.map(() => "?").join(",")})` +
              (iteration_id ? " AND iteration_id = ?" : "")
          )
          .all(...screenNames, ...iterParam);
        chain.push({ type: "steps", data: steps });
        if (screens.length > 0) chain.push({ type: "referenced_screens", data: screens });
      }

      // Components via traceability
      const mappings = reqIds.length > 0
        ? db
            .prepare(
              `SELECT * FROM traceability_mapping WHERE requirement_id IN (${reqIds.map(() => "?").join(",")})` +
                (iteration_id ? " AND iteration_id = ?" : "")
            )
            .all(...reqIds, ...iterParam)
        : [];
      if (mappings.length > 0) chain.push({ type: "traceability_mappings", data: mappings });
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
        .prepare("SELECT DISTINCT flow_id FROM user_flow_step WHERE screen = ?")
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
