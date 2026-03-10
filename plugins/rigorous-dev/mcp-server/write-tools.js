import { getDb } from "./db.js";
import { VALID_ENTITY_TYPES } from "./read-tools.js";

const PHASES = [
  "requirements",
  "ux_design",
  "architecture",
  "planning",
  "implementation",
  "documentation",
  "qa",
  "audit",
];

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

function iterationCreate(args) {
  const db = getDb();
  const { project_name, critic_model } = args;
  const now = new Date().toISOString();

  const run = db.transaction(() => {
    // Ensure project singleton exists
    const existing = db
      .prepare("SELECT id FROM project WHERE id = 1")
      .get();

    if (!existing) {
      db.prepare(
        `INSERT INTO project (id, project_name, created_at, updated_at, status, critic_model, notes)
         VALUES (1, @project_name, @created_at, @updated_at, 'active', @critic_model, '')`
      ).run({ project_name: project_name || "default", created_at: now, updated_at: now, critic_model: critic_model || "sonnet" });
    }

    // Create iteration
    const iterResult = db
      .prepare(
        `INSERT INTO iteration (status, created_at, notes)
         VALUES ('active', @created_at, '')`
      )
      .run({ created_at: now });

    const iteration_id = iterResult.lastInsertRowid;

    // Create all 8 phase records
    const insertPhase = db.prepare(
      `INSERT INTO phase (iteration_id, name, status) VALUES (@iteration_id, @name, @status)`
    );
    const setInProgress = db.prepare(
      `UPDATE phase SET status = 'in_progress', started_at = @now WHERE iteration_id = @iteration_id AND name = 'requirements'`
    );

    for (const name of PHASES) {
      insertPhase.run({ iteration_id, name, status: "pending" });
    }

    setInProgress.run({ now, iteration_id });

    return { iteration_id };
  });

  return run();
}

function phaseTransition(args) {
  const db = getDb();
  const {
    iteration_id,
    phase_name,
    status,
    approved_by,
    notes,
  } = args;
  const now = new Date().toISOString();

  const run = db.transaction(() => {
    // Verify the phase exists before attempting update
    const existing = db
      .prepare("SELECT id, name, status FROM phase WHERE iteration_id = @iteration_id AND name = @phase_name")
      .get({ iteration_id, phase_name });
    if (!existing) throw new Error(`Phase "${phase_name}" not found in iteration ${iteration_id}`);

    // Already in the requested status — return early with a message
    if (existing.status === status) {
      return { phase_id: existing.id, name: existing.name, status: existing.status, message: `Phase already in status: ${status}` };
    }

    const sets = ["status = @status"];
    const params = { status, iteration_id, phase_name };

    if (status === "in_progress") {
      sets.push("started_at = @now");
      params.now = now;
    }
    if (status === "completed") {
      sets.push("completed_at = @now");
      params.now = now;
    }
    if (approved_by !== undefined) {
      sets.push("approved_by = @approved_by");
      params.approved_by = approved_by;
    }
    if (notes !== undefined) {
      sets.push("notes = @notes");
      params.notes = notes;
    }

    db.prepare(
      `UPDATE phase SET ${sets.join(", ")} WHERE iteration_id = @iteration_id AND name = @phase_name`
    ).run(params);

    return { phase_id: existing.id, name: existing.name, status };
  });

  return run();
}

function workItemTransition(args) {
  const db = getDb();
  const { work_item_id, status } = args;

  const row = db.prepare("SELECT id, phase_number, name, status FROM work_item WHERE id = @work_item_id").get({ work_item_id });
  if (!row) throw new Error(`Work item ${work_item_id} not found`);

  db.prepare(
    "UPDATE work_item SET status = @status WHERE id = @work_item_id"
  ).run({ status, work_item_id });

  return { work_item_id: row.id, phase_number: row.phase_number, name: row.name, status };
}

function revisionCreate(args) {
  const db = getDb();
  const { phase_id, producer_agent } = args;
  const now = new Date().toISOString();

  const run = db.transaction(() => {
    const phase = db.prepare("SELECT id FROM phase WHERE id = @phase_id").get({ phase_id });
    if (!phase) {
      throw new Error(`phase_id ${phase_id} does not exist`);
    }

    const result = db
      .prepare(
        `INSERT INTO revision (phase_id, producer_agent, created_at, status)
         VALUES (@phase_id, @producer_agent, @created_at, 'draft')`
      )
      .run({ phase_id, producer_agent, created_at: now });

    const revision_count = db
      .prepare("SELECT COUNT(*) AS n FROM revision WHERE phase_id = @phase_id")
      .get({ phase_id }).n;

    return { revision_id: result.lastInsertRowid, revision_count, phase_id };
  });

  return run();
}

function revisionUpdate(args) {
  const db = getDb();
  const { revision_id, status, critic_agent, critic_feedback } = args;
  const now = new Date().toISOString();

  const sets = ["status = @status"];
  const params = { status, revision_id };

  if (status === "approved" || status === "rejected") {
    sets.push("reviewed_at = @now");
    params.now = now;
  }
  if (critic_agent !== undefined) {
    sets.push("critic_agent = @critic_agent");
    params.critic_agent = critic_agent;
  }
  if (critic_feedback !== undefined) {
    sets.push("critic_feedback = @critic_feedback");
    params.critic_feedback = critic_feedback;
  }

  db.prepare(
    `UPDATE revision SET ${sets.join(", ")} WHERE id = @revision_id`
  ).run(params);

  return { revision_id, status };
}

// ---------------------------------------------------------------------------
// changelog_insert handlers per entity type
// ---------------------------------------------------------------------------

// Snapshot helper: captures old row as JSON before an upsert overwrites it
function existsForUpsert(db, table, entityId) {
  return db.prepare(`SELECT 1 FROM ${table} WHERE id = @id`).get({ id: entityId });
}

function insertPersona(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const existed = existsForUpsert(db, "persona", data.id);

  db.prepare(
    `INSERT INTO persona (id, project_id, introduced_in_iteration_id, name, description, technical_level, frequency_of_use, goals, created_at)
     VALUES (@id, @project_id, @introduced_in_iteration_id, @name, @description, @technical_level, @frequency_of_use, @goals, @created_at)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       description = excluded.description,
       technical_level = excluded.technical_level,
       frequency_of_use = excluded.frequency_of_use,
       goals = excluded.goals,
       updated_at = @updated_at`
  ).run({
    id: data.id,
    project_id: 1,
    introduced_in_iteration_id: iteration_id ?? null,
    name: data.name,
    description: data.description,
    technical_level: data.technical_level ?? null,
    frequency_of_use: data.frequency_of_use ?? null,
    goals: JSON.stringify(data.goals ?? []),
    created_at: now,
    updated_at: now
  });

  return { entity_type: "persona", id: data.id, updated: !!existed };
}

function insertRequirement(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const existed = existsForUpsert(db, "requirement", data.id);

  db.prepare(
    `INSERT INTO requirement (id, iteration_id, description, rationale, priority, category, acceptance_criteria, created_at)
     VALUES (@id, @iteration_id, @description, @rationale, @priority, @category, @acceptance_criteria, @created_at)
     ON CONFLICT(id) DO UPDATE SET
       iteration_id = excluded.iteration_id,
       description = excluded.description,
       rationale = excluded.rationale,
       priority = excluded.priority,
       category = excluded.category,
       acceptance_criteria = excluded.acceptance_criteria,
       updated_at = @updated_at`
  ).run({
    id: data.id,
    iteration_id,
    description: data.description,
    rationale: data.rationale ?? null,
    priority: data.priority,
    category: data.category,
    acceptance_criteria: JSON.stringify(data.acceptance_criteria ?? []),
    created_at: now,
    updated_at: now
  });

  if (existed) {
    db.prepare("DELETE FROM requirement_persona WHERE requirement_id = @requirement_id").run({ requirement_id: data.id });
    db.prepare("DELETE FROM requirement_dependency WHERE requirement_id = @requirement_id").run({ requirement_id: data.id });
  }

  const insertPersonaLink = db.prepare(
    "INSERT OR IGNORE INTO requirement_persona (requirement_id, persona_id) VALUES (@requirement_id, @persona_id)"
  );
  for (const persona_id of data.personas ?? []) {
    insertPersonaLink.run({ requirement_id: data.id, persona_id });
  }

  const insertDep = db.prepare(
    "INSERT OR IGNORE INTO requirement_dependency (requirement_id, depends_on) VALUES (@requirement_id, @depends_on)"
  );
  for (const dep of data.depends_on ?? []) {
    insertDep.run({ requirement_id: data.id, depends_on: dep });
  }

  return { entity_type: "requirement", id: data.id, updated: !!existed };
}

function insertAdr(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const existed = existsForUpsert(db, "adr", data.id);

  db.prepare(
    `INSERT INTO adr (id, iteration_id, title, status, date, context, decision, rationale, superseded_by, consequences, research_sources, created_at)
     VALUES (@id, @iteration_id, @title, @status, @date, @context, @decision, @rationale, @superseded_by, @consequences, @research_sources, @created_at)
     ON CONFLICT(id) DO UPDATE SET
       iteration_id = excluded.iteration_id,
       title = excluded.title,
       status = excluded.status,
       date = excluded.date,
       context = excluded.context,
       decision = excluded.decision,
       rationale = excluded.rationale,
       superseded_by = excluded.superseded_by,
       consequences = excluded.consequences,
       research_sources = excluded.research_sources,
       updated_at = @updated_at`
  ).run({
    id: data.id,
    iteration_id,
    title: data.title,
    status: data.status ?? "proposed",
    date: data.date ?? null,
    context: data.context ?? null,
    decision: data.decision ?? null,
    rationale: data.rationale ?? null,
    superseded_by: data.superseded_by ?? null,
    consequences: JSON.stringify(data.consequences ?? []),
    research_sources: JSON.stringify(data.research_sources ?? []),
    created_at: now,
    updated_at: now
  });

  if (existed) {
    // Delete child rows
    db.prepare("DELETE FROM adr_alternative WHERE adr_id = @adr_id").run({ adr_id: data.id });
    db.prepare("DELETE FROM adr_decision WHERE adr_id = @adr_id").run({ adr_id: data.id });
  }

  const insertAlt = db.prepare(
    "INSERT INTO adr_alternative (adr_id, option_text, pros, cons) VALUES (@adr_id, @option_text, @pros, @cons)"
  );
  for (const alt of data.alternatives_considered ?? []) {
    const prosText = (alt.pros ?? []).length > 0 ? JSON.stringify(alt.pros ?? []) : null;
    const consText = (alt.cons ?? []).length > 0 ? JSON.stringify(alt.cons ?? []) : null;
    insertAlt.run({ adr_id: data.id, option_text: alt.option_text ?? alt.option ?? alt, pros: prosText, cons: consText });
  }

  return { entity_type: "adr", id: data.id, updated: !!existed };
}

function insertAdrDecision(db, _iteration_id, _revision_id, data) {
  db.prepare(
    `INSERT INTO adr_decision (adr_id, alternative_id, rationale, decided_at)
     VALUES (@adr_id, @alternative_id, @rationale, @decided_at)
     ON CONFLICT(adr_id) DO UPDATE SET
       alternative_id = excluded.alternative_id,
       rationale = excluded.rationale,
       decided_at = excluded.decided_at`
  ).run({
    adr_id: data.adr_id,
    alternative_id: data.alternative_id ?? null,
    rationale: data.rationale ?? null,
    decided_at: data.decided_at ?? new Date().toISOString()
  });

  return { entity_type: "adr_decision", id: data.adr_id };
}

function insertComponent(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const existed = existsForUpsert(db, "component", data.id);

  db.prepare(
    `INSERT INTO component (id, iteration_id, name, purpose, component_type, created_at)
     VALUES (@id, @iteration_id, @name, @purpose, @component_type, @created_at)
     ON CONFLICT(id) DO UPDATE SET
       iteration_id = excluded.iteration_id,
       name = excluded.name,
       purpose = excluded.purpose,
       component_type = excluded.component_type,
       updated_at = @updated_at`
  ).run({
    id: data.id,
    iteration_id,
    name: data.name,
    purpose: data.purpose,
    component_type: data.type ?? data.component_type,
    created_at: now,
    updated_at: now
  });

  if (existed) {
    db.prepare("DELETE FROM component_interface WHERE component_id = @component_id").run({ component_id: data.id });
    db.prepare("DELETE FROM component_dependency WHERE component_id = @component_id").run({ component_id: data.id });
    db.prepare("DELETE FROM requirement_trace WHERE addressed_by = @addressed_by AND addressed_by_type = 'component'").run({ addressed_by: data.id });
    db.prepare("DELETE FROM integration_test_boundary WHERE component_id = @component_id").run({ component_id: data.id });
  }

  const insertIface = db.prepare(
    "INSERT INTO component_interface (component_id, name, interface_type, description) VALUES (@component_id, @name, @interface_type, @description)"
  );
  for (const iface of data.interfaces ?? []) {
    insertIface.run({ component_id: data.id, name: iface.name, interface_type: iface.type ?? iface.interface_type, description: iface.description ?? null });
  }

  const insertDep = db.prepare(
    "INSERT OR IGNORE INTO component_dependency (component_id, depends_on) VALUES (@component_id, @depends_on)"
  );
  for (const dep of data.dependencies ?? []) {
    insertDep.run({ component_id: data.id, depends_on: dep });
  }

  const insertReq = db.prepare(
    "INSERT OR IGNORE INTO requirement_trace (iteration_id, requirement_id, addressed_by, addressed_by_type) VALUES (@iteration_id, @requirement_id, @addressed_by, 'component')"
  );
  for (const req_id of data.requirements_addressed ?? []) {
    insertReq.run({ iteration_id, requirement_id: req_id, addressed_by: data.id });
  }

  const insertBoundary = db.prepare(
    `INSERT INTO integration_test_boundary (component_id, target_component_id, boundary_type, correct_behavior)
     VALUES (@component_id, @target_component_id, @boundary_type, @correct_behavior)`
  );
  for (const b of data.integration_test_boundaries ?? []) {
    insertBoundary.run({ component_id: data.id, target_component_id: b.target_component_id, boundary_type: b.boundary_type, correct_behavior: b.correct_behavior });
  }

  return { entity_type: "component", id: data.id, updated: !!existed };
}

const VALID_ADDRESSED_BY_TYPES = ['component', 'flow', 'screen', 'adr', 'endpoint', 'technology'];

function insertRequirementTrace(db, iteration_id, revision_id, data) {
  // Validate addressed_by_type against the restricted set
  if (!VALID_ADDRESSED_BY_TYPES.includes(data.addressed_by_type)) {
    throw new Error(
      `Invalid addressed_by_type: "${data.addressed_by_type}". Must be one of: ${VALID_ADDRESSED_BY_TYPES.join(", ")}`
    );
  }
  // Code-level existence validation for types with backing tables
  const iterClause = "iteration_id = @iteration_id";
  if (data.addressed_by_type === "component") {
    const exists = db
      .prepare(`SELECT 1 FROM component WHERE id = @addressed_by AND ${iterClause}`)
      .get({ addressed_by: data.addressed_by, iteration_id });
    if (!exists) {
      throw new Error(
        `Component '${data.addressed_by}' not found in iteration ${iteration_id}`
      );
    }
  } else if (data.addressed_by_type === "flow") {
    const exists = db
      .prepare(`SELECT 1 FROM user_flow WHERE id = @addressed_by AND ${iterClause}`)
      .get({ addressed_by: data.addressed_by, iteration_id });
    if (!exists) {
      throw new Error(
        `User flow '${data.addressed_by}' not found in iteration ${iteration_id}`
      );
    }
  } else if (data.addressed_by_type === "screen") {
    const exists = db
      .prepare(`SELECT 1 FROM screen WHERE name = @addressed_by AND ${iterClause}`)
      .get({ addressed_by: data.addressed_by, iteration_id });
    if (!exists) {
      throw new Error(
        `Screen '${data.addressed_by}' not found in iteration ${iteration_id}`
      );
    }
  } else if (data.addressed_by_type === "adr") {
    const exists = db
      .prepare(`SELECT 1 FROM adr WHERE id = @addressed_by AND ${iterClause}`)
      .get({ addressed_by: data.addressed_by, iteration_id });
    if (!exists) {
      throw new Error(
        `ADR '${data.addressed_by}' not found in iteration ${iteration_id}`
      );
    }
  }
  // endpoint and technology: no validation (soft references, no standalone tables)
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO requirement_trace (iteration_id, requirement_id, addressed_by, addressed_by_type, notes, created_at)
       VALUES (@iteration_id, @requirement_id, @addressed_by, @addressed_by_type, @notes, @created_at)`
    )
    .run({
      iteration_id,
      requirement_id: data.requirement_id,
      addressed_by: data.addressed_by,
      addressed_by_type: data.addressed_by_type,
      notes: data.notes ?? null,
      created_at: now
    });
  return { entity_type: "requirement_trace", id: result.lastInsertRowid };
}

function insertApprovedDependency(db, iteration_id, revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  const now = new Date().toISOString();
  let lastId;
  const insert = db.prepare(
    `INSERT INTO approved_dependency
       (iteration_id, package, version_constraint, purpose, justification, adr_id, license, category, maintenance_activity, community_adoption, transitive_deps, single_maintainer_risk, created_at)
     VALUES (@iteration_id, @package, @version_constraint, @purpose, @justification, @adr_id, @license, @category, @maintenance_activity, @community_adoption, @transitive_deps, @single_maintainer_risk, @created_at)`
  );
  for (const entry of entries) {
    const result = insert.run({
      iteration_id,
      package: entry.package,
      version_constraint: entry.version_constraint ?? null,
      purpose: entry.purpose,
      justification: entry.justification,
      adr_id: entry.adr_id ?? null,
      license: entry.license ?? null,
      category: entry.category ?? null,
      maintenance_activity: entry.maintenance_activity ?? null,
      community_adoption: entry.community_adoption ?? null,
      transitive_deps: entry.transitive_deps ?? null,
      single_maintainer_risk: entry.single_maintainer_risk ?? 0,
      created_at: now
    });
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "approved_dependency", id: lastId };
}

function insertUserFlow(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const existed = existsForUpsert(db, "user_flow", data.id);

  db.prepare(
    `INSERT INTO user_flow (id, iteration_id, name, goal, persona_id, entry_point, success_state, data_dependencies, error_states, created_at)
     VALUES (@id, @iteration_id, @name, @goal, @persona_id, @entry_point, @success_state, @data_dependencies, @error_states, @created_at)
     ON CONFLICT(id) DO UPDATE SET
       iteration_id = excluded.iteration_id,
       name = excluded.name,
       goal = excluded.goal,
       persona_id = excluded.persona_id,
       entry_point = excluded.entry_point,
       success_state = excluded.success_state,
       data_dependencies = excluded.data_dependencies,
       error_states = excluded.error_states,
       updated_at = @updated_at`
  ).run({
    id: data.id,
    iteration_id,
    name: data.name,
    goal: data.goal,
    persona_id: data.persona_id ?? null,
    entry_point: data.entry_point ?? null,
    success_state: data.success_state ?? null,
    data_dependencies: JSON.stringify(data.data_dependencies ?? []),
    error_states: data.error_states?.length ? JSON.stringify(data.error_states) : null,
    created_at: now,
    updated_at: now
  });

  if (existed) {
    db.prepare("DELETE FROM user_flow_step WHERE flow_id = @flow_id").run({ flow_id: data.id });
    db.prepare("DELETE FROM requirement_trace WHERE addressed_by = @addressed_by AND addressed_by_type = 'flow'").run({ addressed_by: data.id });
  }

  const insertStep = db.prepare(
    `INSERT INTO user_flow_step (flow_id, step_number, action, surface, is_decision_point, branches)
     VALUES (@flow_id, @step_number, @action, @surface, @is_decision_point, @branches)`
  );
  for (const step of data.steps ?? []) {
    insertStep.run({
      flow_id: data.id,
      step_number: step.step_number,
      action: step.action,
      surface: step.surface ?? null,
      is_decision_point: step.is_decision_point ? 1 : 0,
      branches: step.branches?.length ? JSON.stringify(step.branches) : null
    });
  }

  const insertReq = db.prepare(
    "INSERT OR IGNORE INTO requirement_trace (iteration_id, requirement_id, addressed_by, addressed_by_type) VALUES (@iteration_id, @requirement_id, @addressed_by, 'flow')"
  );
  for (const req_id of data.requirements_addressed ?? []) {
    insertReq.run({ iteration_id, requirement_id: req_id, addressed_by: data.id });
  }

  return { entity_type: "user_flow", id: data.id, updated: !!existed };
}

function insertScreen(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const existed = existsForUpsert(db, "screen", data.id);

  db.prepare(
    `INSERT INTO screen (id, iteration_id, name, purpose, wireframe_path, mockup_path, components, created_at)
     VALUES (@id, @iteration_id, @name, @purpose, @wireframe_path, @mockup_path, @components, @created_at)
     ON CONFLICT(id) DO UPDATE SET
       iteration_id = excluded.iteration_id,
       name = excluded.name,
       purpose = excluded.purpose,
       wireframe_path = excluded.wireframe_path,
       mockup_path = excluded.mockup_path,
       components = excluded.components,
       updated_at = @updated_at`
  ).run({
    id: data.id,
    iteration_id,
    name: data.name,
    purpose: data.purpose,
    wireframe_path: data.wireframe_path ?? null,
    mockup_path: data.mockup_path ?? null,
    components: JSON.stringify((data.components ?? []).map(comp => typeof comp === "string" ? comp : comp.component_name ?? comp.name)),
    created_at: now,
    updated_at: now
  });

  return { entity_type: "screen", id: data.id, updated: !!existed };
}

function insertWorkItem(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO work_item (iteration_id, phase_number, name, work_type, goal, complexity, review_checkpoint, notes, entry_criteria, exit_criteria, checkpoint_focus, critical_path_sequence, work_order, risks, created_at)
       VALUES (@iteration_id, @phase_number, @name, @work_type, @goal, @complexity, @review_checkpoint, @notes, @entry_criteria, @exit_criteria, @checkpoint_focus, @critical_path_sequence, @work_order, @risks, @created_at)`
    )
    .run({
      iteration_id,
      phase_number: data.phase_number,
      name: data.name,
      work_type: data.work_type,
      goal: data.goal,
      complexity: data.complexity ?? null,
      review_checkpoint: data.review_checkpoint ? 1 : 0,
      notes: data.notes ?? null,
      entry_criteria: JSON.stringify(data.entry_criteria ?? []),
      exit_criteria: JSON.stringify(data.exit_criteria ?? []),
      checkpoint_focus: JSON.stringify(data.checkpoint_focus ?? []),
      critical_path_sequence: data.critical_path_sequence ?? null,
      work_order: data.work_order ?? null,
      risks: data.risks?.length ? JSON.stringify(data.risks) : null,
      created_at: now
    });
  const work_item_id = result.lastInsertRowid;

  const insertReq = db.prepare(
    "INSERT OR IGNORE INTO work_item_requirement (work_item_id, requirement_id, priority, notes) VALUES (@work_item_id, @requirement_id, @priority, @notes)"
  );
  for (const req of data.requirements ?? []) {
    if (typeof req === "string") {
      insertReq.run({ work_item_id, requirement_id: req, priority: null, notes: null });
    } else {
      insertReq.run({ work_item_id, requirement_id: req.requirement_id, priority: req.priority ?? null, notes: req.notes ?? null });
    }
  }

  const insertComp = db.prepare(
    "INSERT OR IGNORE INTO work_item_component (work_item_id, component_id) VALUES (@work_item_id, @component_id)"
  );
  for (const comp_id of data.components ?? []) {
    insertComp.run({ work_item_id, component_id: comp_id });
  }

  return { entity_type: "work_item", id: work_item_id };
}

function insertPlanOverview(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO plan_overview (iteration_id, strategy, rationale, phase_one_approach, assumptions, risks, created_at)
       VALUES (@iteration_id, @strategy, @rationale, @phase_one_approach, @assumptions, @risks, @created_at)`
    )
    .run({
      iteration_id,
      strategy: data.strategy,
      rationale: data.rationale,
      phase_one_approach: data.phase_one_approach ?? null,
      assumptions: JSON.stringify(data.assumptions ?? []),
      risks: data.risks?.length ? JSON.stringify(data.risks) : null,
      created_at: now
    });
  const plan_overview_id = result.lastInsertRowid;

  return { entity_type: "plan_overview", id: plan_overview_id };
}

function insertPlanExternalDependency(db, iteration_id, _revision_id, data) {
  const result = db
    .prepare(
      `INSERT INTO plan_external_dependency (iteration_id, name, description, work_item_id, risk_level, mitigation)
       VALUES (@iteration_id, @name, @description, @work_item_id, @risk_level, @mitigation)`
    )
    .run({
      iteration_id,
      name: data.name,
      description: data.description,
      work_item_id: data.work_item_id ?? null,
      risk_level: data.risk_level,
      mitigation: data.mitigation ?? null
    });
  return { entity_type: "plan_external_dependency", id: result.lastInsertRowid };
}

function insertImplementationManifest(db, iteration_id, _revision_id, data) {
  let lastId;

  // Requirement statuses
  const insertReqStatus = db.prepare(
    "INSERT OR REPLACE INTO implementation_requirement_status (iteration_id, requirement_id, status, notes) VALUES (@iteration_id, @requirement_id, @status, @notes)"
  );
  for (const rs of data.requirement_status ?? []) {
    const result = insertReqStatus.run({ iteration_id, requirement_id: rs.requirement_id, status: rs.status, notes: rs.notes ?? null });
    lastId = result.lastInsertRowid;
  }

  // Component statuses
  const insertCompStatus = db.prepare(
    "INSERT OR REPLACE INTO implementation_component_status (iteration_id, component_id, status, notes) VALUES (@iteration_id, @component_id, @status, @notes)"
  );
  for (const cs of data.component_status ?? []) {
    const result = insertCompStatus.run({ iteration_id, component_id: cs.component_id, status: cs.status, notes: cs.notes ?? null });
    lastId = result.lastInsertRowid;
  }

  // Blockers
  const insertBlocker = db.prepare(
    "INSERT INTO implementation_blocker (iteration_id, description, severity, recommendation, needs_escalation) VALUES (@iteration_id, @description, @severity, @recommendation, @needs_escalation)"
  );
  const insertBlockerReq = db.prepare(
    "INSERT OR IGNORE INTO implementation_blocker_requirement (blocker_id, requirement_id) VALUES (@blocker_id, @requirement_id)"
  );
  for (const blocker of data.blockers ?? []) {
    const blockerResult = insertBlocker.run({
      iteration_id,
      description: blocker.description,
      severity: blocker.severity,
      recommendation: blocker.recommendation ?? null,
      needs_escalation: blocker.needs_escalation ? 1 : 0
    });
    lastId = blockerResult.lastInsertRowid;
    for (const req_id of blocker.requirements ?? []) {
      insertBlockerReq.run({ blocker_id: blockerResult.lastInsertRowid, requirement_id: req_id });
    }
  }

  return { entity_type: "implementation_manifest", id: lastId };
}

function insertProjectContext(db, iteration_id, _revision_id, data) {
  // data may be a single entry or an array of entries
  const entries = Array.isArray(data) ? data : [data];
  let lastId;
  const insert = db.prepare(
    `INSERT OR REPLACE INTO project_context (iteration_id, key, value, category) VALUES (@iteration_id, @key, @value, @category)`
  );
  for (const entry of entries) {
    const result = insert.run({
      iteration_id,
      key: entry.key,
      value: entry.value,
      category: entry.category ?? null
    });
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "project_context", id: lastId };
}

function insertDataExchange(db, iteration_id, _revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  let lastId;
  const insert = db.prepare(
    `INSERT INTO data_exchange (iteration_id, direction, name, description, source, destination, data_format) VALUES (@iteration_id, @direction, @name, @description, @source, @destination, @data_format)`
  );
  for (const entry of entries) {
    const result = insert.run({
      iteration_id,
      direction: entry.direction,
      name: entry.name,
      description: entry.description,
      source: entry.source ?? null,
      destination: entry.destination ?? null,
      data_format: entry.data_format ?? null
    });
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "data_exchange", id: lastId };
}

function insertNonfunctionalRequirement(db, iteration_id, _revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  let lastId;
  const insert = db.prepare(
    `INSERT OR REPLACE INTO nonfunctional_requirement (iteration_id, nfr_type, item, category, value, notes) VALUES (@iteration_id, @nfr_type, @item, @category, @value, @notes)`
  );
  for (const entry of entries) {
    const result = insert.run({
      iteration_id,
      nfr_type: entry.nfr_type,
      item: entry.item,
      category: entry.category ?? null,
      value: entry.value ?? null,
      notes: entry.notes ?? null
    });
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "nonfunctional_requirement", id: lastId };
}

function insertVcsCommit(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO vcs_commit (iteration_id, work_item_id, revision_id, commit_sha, message, created_at)
       VALUES (@iteration_id, @work_item_id, @revision_id, @commit_sha, @message, @created_at)`
    )
    .run({
      iteration_id,
      work_item_id: data.work_item_id,
      revision_id,
      commit_sha: data.commit_sha,
      message: data.message ?? null,
      created_at: now
    });
  return { entity_type: "vcs_commit", id: result.lastInsertRowid };
}

function insertIntermediateAsset(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO intermediate_asset (phase_id, iteration_id, asset_type, title, content, created_at)
       VALUES (@phase_id, @iteration_id, @asset_type, @title, @content, @created_at)`
    )
    .run({
      phase_id: data.phase_id ?? null,
      iteration_id,
      asset_type: data.asset_type,
      title: data.title,
      content: data.content ?? null,
      created_at: now
    });
  return { entity_type: "intermediate_asset", id: result.lastInsertRowid };
}

function insertWorkflowBlocker(db, iteration_id, _revision_id, data) {
  const result = db.prepare(
    `INSERT INTO blocker (iteration_id, phase_name, description, severity, raised_by)
     VALUES (@iteration_id, @phase_name, @description, @severity, @raised_by)`
  ).run({
    iteration_id,
    phase_name: data.phase_name,
    description: data.description,
    severity: data.severity,
    raised_by: data.raised_by
  });
  return { entity_type: "blocker", id: result.lastInsertRowid };
}

function insertProjectLesson(db, iteration_id, _revision_id, data) {
  const result = db.prepare(
    `INSERT INTO project_lesson (iteration_id, phase_name, category, lesson, recurring)
     VALUES (@iteration_id, @phase_name, @category, @lesson, @recurring)`
  ).run({
    iteration_id,
    phase_name: data.phase_name,
    category: data.category,
    lesson: data.lesson,
    recurring: data.recurring ? 1 : 0
  });
  return { entity_type: "project_lesson", id: result.lastInsertRowid };
}

function insertSecurityAuditFinding(db, iteration_id, revision_id, data) {
  const result = db.prepare(
    `INSERT INTO security_audit_finding
       (iteration_id, category, severity, title, description, location, recommendation, cve, status)
     VALUES (@iteration_id, @category, @severity, @title, @description, @location, @recommendation, @cve, @status)`
  ).run({
    iteration_id,
    category: data.category,
    severity: data.severity,
    title: data.title,
    description: data.description,
    location: data.location ?? null,
    recommendation: data.recommendation,
    cve: data.cve ?? null,
    status: data.status ?? "open"
  });
  return { entity_type: "security_audit_finding", id: result.lastInsertRowid };
}

function insertPerformanceAuditFinding(db, iteration_id, revision_id, data) {
  const result = db.prepare(
    `INSERT INTO performance_audit_finding
       (iteration_id, category, severity, title, description, location, metric_name, baseline_value, actual_value, recommendation, status)
     VALUES (@iteration_id, @category, @severity, @title, @description, @location, @metric_name, @baseline_value, @actual_value, @recommendation, @status)`
  ).run({
    iteration_id,
    category: data.category,
    severity: data.severity,
    title: data.title,
    description: data.description,
    location: data.location ?? null,
    metric_name: data.metric_name ?? null,
    baseline_value: data.baseline_value ?? null,
    actual_value: data.actual_value ?? null,
    recommendation: data.recommendation,
    status: data.status ?? "open"
  });
  return { entity_type: "performance_audit_finding", id: result.lastInsertRowid };
}

function insertTestReport(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const meta = Array.isArray(data.metadata) ? data.metadata[0] : data.metadata;
  const result = db
    .prepare(
      `INSERT INTO test_report
         (iteration_id, total_tests, passed_count, failed, skipped,
          coverage_line, coverage_branch, coverage_function,
          duration_seconds, status,
          stdout, stderr,
          version, document_date, requirements_version, architecture_version, commit_sha,
          created_at)
       VALUES (@iteration_id, @total_tests, @passed_count, @failed, @skipped,
               @coverage_line, @coverage_branch, @coverage_function,
               @duration_seconds, @status,
               @stdout, @stderr,
               @version, @document_date, @requirements_version, @architecture_version, @commit_sha,
               @created_at)`
    )
    .run({
      iteration_id,
      total_tests: data.total_tests ?? 0,
      passed_count: data.passed_count ?? 0,
      failed: data.failed ?? 0,
      skipped: data.skipped ?? 0,
      coverage_line: data.coverage_line ?? null,
      coverage_branch: data.coverage_branch ?? null,
      coverage_function: data.coverage_function ?? null,
      duration_seconds: data.duration_seconds ?? null,
      status: data.status,
      stdout: data.stdout ?? null,
      stderr: data.stderr ?? null,
      version: meta?.version ?? data.version ?? null,
      document_date: meta?.document_date ?? data.document_date ?? null,
      requirements_version: meta?.requirements_version ?? data.requirements_version ?? null,
      architecture_version: meta?.architecture_version ?? data.architecture_version ?? null,
      commit_sha: meta?.commit_sha ?? data.commit_sha ?? null,
      created_at: now
    });

  return { entity_type: "test_report", id: result.lastInsertRowid };
}

function insertInfoArchitecture(db, iteration_id, revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  const now = new Date().toISOString();
  let lastId;
  const insert = db.prepare(
    `INSERT INTO info_architecture (iteration_id, category, key, value, parent_id, created_at)
     VALUES (@iteration_id, @category, @key, @value, @parent_id, @created_at)`
  );
  for (const entry of entries) {
    const result = insert.run({
      iteration_id,
      category: entry.category,
      key: entry.key,
      value: entry.value,
      parent_id: entry.parent_id ?? null,
      created_at: now
    });
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "info_architecture", id: lastId };
}

function insertPersonaAddressed(db, iteration_id, revision_id, data) {
  const result = db.prepare(
    `INSERT INTO persona_addressed (iteration_id, persona_id, goal, how_addressed)
     VALUES (@iteration_id, @persona_id, @goal, @how_addressed)`
  ).run({
    iteration_id,
    persona_id: data.persona_id,
    goal: data.goal,
    how_addressed: data.how_addressed
  });
  const persona_addressed_id = result.lastInsertRowid;

  const insertFlow = db.prepare(
    "INSERT INTO persona_addressed_flow (persona_addressed_id, flow_id) VALUES (@persona_addressed_id, @flow_id)"
  );
  for (const flow_id of data.flows ?? []) {
    insertFlow.run({ persona_addressed_id, flow_id });
  }

  return { entity_type: "persona_addressed", id: persona_addressed_id };
}

function insertUxAsset(db, iteration_id, _revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  const now = new Date().toISOString();
  let lastId;
  const insert = db.prepare(
    `INSERT OR REPLACE INTO ux_asset (iteration_id, name, path, asset_type, screen_id, description, created_at)
     VALUES (@iteration_id, @name, @path, @asset_type, @screen_id, @description, @created_at)`
  );
  for (const entry of entries) {
    const result = insert.run({
      iteration_id,
      name: entry.name,
      path: entry.path,
      asset_type: entry.type ?? entry.asset_type,
      screen_id: entry.screen_id ?? null,
      description: entry.description ?? null,
      created_at: now
    });
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "ux_asset", id: lastId };
}

// ---------------------------------------------------------------------------

function changelogInsert(args) {
  const db = getDb();
  const { entity_type, revision_id, data } = args;

  // Derive iteration_id from revision_id (for handlers that still need it)
  let iteration_id = args.iteration_id;
  if (iteration_id == null && revision_id != null) {
    const ctx = db.prepare(
      "SELECT p.iteration_id FROM revision r JOIN phase p ON r.phase_id = p.id WHERE r.id = @revision_id"
    ).get({ revision_id });
    if (ctx) iteration_id = ctx.iteration_id;
  }

  const handlers = {
    persona: insertPersona,
    requirement: insertRequirement,
    adr: insertAdr,
    adr_decision: insertAdrDecision,
    component: insertComponent,
    requirement_trace: insertRequirementTrace,
    approved_dependency: insertApprovedDependency,
    user_flow: insertUserFlow,
    screen: insertScreen,
    info_architecture: insertInfoArchitecture,
    persona_addressed: insertPersonaAddressed,
    ux_asset: insertUxAsset,
    work_item: insertWorkItem,
    plan_overview: insertPlanOverview,
    plan_external_dependency: insertPlanExternalDependency,
    implementation_manifest: insertImplementationManifest,
    project_context: insertProjectContext,
    data_exchange: insertDataExchange,
    nonfunctional_requirement: insertNonfunctionalRequirement,
    vcs_commit: insertVcsCommit,
    intermediate_asset: insertIntermediateAsset,
    blocker: insertWorkflowBlocker,
    project_lesson: insertProjectLesson,
    security_audit_finding: insertSecurityAuditFinding,
    performance_audit_finding: insertPerformanceAuditFinding,
    test_report: insertTestReport,
  };

  const handler = handlers[entity_type];
  if (!handler) {
    throw new Error(`Unsupported entity_type: ${entity_type}`);
  }

  const run = db.transaction(() => handler(db, iteration_id, revision_id, data));
  return run();
}

function changelogUpdate(args) {
  const db = getDb();
  const { entity_type, entity_id, updates } = args;

  const ALLOWED_TYPES = {
    security_audit_finding: {
      table: "security_audit_finding",
      statuses: ["open", "resolved", "accepted", "false-positive"],
    },
    performance_audit_finding: {
      table: "performance_audit_finding",
      statuses: ["open", "resolved", "accepted", "deferred"],
    },
    adr: {
      table: "adr",
      statuses: ["proposed", "accepted", "deprecated", "superseded"],
      hasUpdatedAt: true,
    },
  };

  const config = ALLOWED_TYPES[entity_type];
  if (!config) {
    throw new Error(
      `changelog_update does not support entity_type: ${entity_type}. Allowed: ${Object.keys(ALLOWED_TYPES).join(", ")}`
    );
  }

  const setClauses = [];
  const params = { entity_id };

  if (updates.status !== undefined) {
    if (!config.statuses.includes(updates.status)) {
      throw new Error(
        `Invalid status '${updates.status}' for ${entity_type}. Allowed: ${config.statuses.join(", ")}`
      );
    }
    setClauses.push("status = @status");
    params.status = updates.status;
  }

  if (setClauses.length === 0) {
    throw new Error("No valid fields provided in updates");
  }

  if (config.hasUpdatedAt) {
    setClauses.push("updated_at = @now");
    params.now = new Date().toISOString();
  }

  const sql = `UPDATE ${config.table} SET ${setClauses.join(", ")} WHERE id = @entity_id`;
  const info = db.prepare(sql).run(params);

  if (info.changes === 0) {
    throw new Error(`${entity_type} with id=${entity_id} not found`);
  }

  return { entity_type, entity_id, updated_fields: Object.keys(updates) };
}

function commitLink(args) {
  const db = getDb();
  const { iteration_id, work_item_id, revision_id, commit_sha, message } = args;
  const now = new Date().toISOString();

  const result = db
    .prepare(
      `INSERT INTO vcs_commit (iteration_id, work_item_id, revision_id, commit_sha, message, created_at)
       VALUES (@iteration_id, @work_item_id, @revision_id, @commit_sha, @message, @created_at)`
    )
    .run({ iteration_id, work_item_id, revision_id, commit_sha, message: message ?? null, created_at: now });

  return { id: result.lastInsertRowid, commit_sha };
}

function projectUpdate(args) {
  const db = getDb();
  const { status, closed_at, notes, critic_model } = args;
  const now = new Date().toISOString();

  const sets = ["updated_at = @now"];
  const params = { now };

  if (status !== undefined) { sets.push("status = @status"); params.status = status; }
  if (closed_at !== undefined) { sets.push("closed_at = @closed_at"); params.closed_at = closed_at; }
  if (notes !== undefined) { sets.push("notes = @notes"); params.notes = notes; }
  if (critic_model !== undefined) { sets.push("critic_model = @critic_model"); params.critic_model = critic_model; }

  db.prepare(
    `UPDATE project SET ${sets.join(", ")} WHERE id = 1`
  ).run(params);

  const row = db.prepare("SELECT * FROM project WHERE id = 1").get();
  if (!row) throw new Error("Project not found — run iteration_create first");
  return { status: row.status, project_name: row.project_name };
}

function blockerResolve(args) {
  const db = getDb();
  const { blocker_id, resolution_notes } = args;
  const now = new Date().toISOString();

  const info = db.prepare(
    `UPDATE blocker SET resolved_at = @now, resolution_notes = @resolution_notes WHERE id = @blocker_id`
  ).run({ now, resolution_notes: resolution_notes ?? null, blocker_id });

  if (info.changes === 0) {
    throw new Error(`Blocker with id=${blocker_id} not found`);
  }

  return { blocker_id, resolved_at: now };
}

function iterationClose(args) {
  const db = getDb();
  const { iteration_id, notes } = args;

  const run = db.transaction(() => {
    const sets = ["status = 'closed'", "closed_at = datetime('now')"];
    const params = { iteration_id };

    if (notes !== undefined) {
      sets.push("notes = @notes");
      params.notes = notes;
    }

    const info = db.prepare(
      `UPDATE iteration SET ${sets.join(", ")} WHERE id = @iteration_id AND status = 'active'`
    ).run(params);

    if (info.changes === 0) {
      const row = db.prepare("SELECT status FROM iteration WHERE id = @iteration_id").get({ iteration_id });
      if (!row) throw new Error(`Iteration with id=${iteration_id} not found`);
      throw new Error(`Iteration ${iteration_id} is not active (current status: ${row.status})`);
    }

    const updated = db.prepare("SELECT * FROM iteration WHERE id = @iteration_id").get({ iteration_id });
    return { iteration_id, status: updated.status, closed_at: updated.closed_at };
  });

  return run();
}

// ---------------------------------------------------------------------------
// Tool definitions (MCP inputSchema)
// ---------------------------------------------------------------------------

export const WRITE_TOOLS = [
  {
    name: "iteration_create",
    description:
      "Creates a new iteration. If the project doesn't exist, creates it. Creates all 8 phase records and sets requirements to in_progress. Returns the new iteration_id (auto-incremented).",
    inputSchema: {
      type: "object",
      properties: {
        project_name: { type: "string", description: "Project name (used if project must be created)" },
        critic_model: { type: "string", description: "Critic model name (default: sonnet)" },
      },
    },
  },
  {
    name: "phase_transition",
    description: "Transitions a phase's status (pending → in_progress → completed | skipped).",
    inputSchema: {
      type: "object",
      properties: {
        iteration_id: { type: "integer" },
        phase_name: {
          type: "string",
          enum: PHASES,
        },
        status: { type: "string", enum: ["pending", "in_progress", "completed", "skipped"] },
        approved_by: { type: "string" },
        notes: { type: "string" },
      },
      required: ["iteration_id", "phase_name", "status"],
    },
  },
  {
    name: "work_item_transition",
    description: "Transitions an implementation plan sub-phase's status (pending → test_writing → implementing → completed). Used during the implementation phase to track progress through each sub-phase.",
    inputSchema: {
      type: "object",
      properties: {
        work_item_id: { type: "integer", description: "The work_item row ID" },
        status: { type: "string", enum: ["pending", "test_writing", "implementing", "completed"] },
      },
      required: ["work_item_id", "status"],
    },
  },
  {
    name: "revision_create",
    description:
      "Starts a new producer-critic revision within a phase. Returns revision_id and the total revision_count for escalation checks.",
    inputSchema: {
      type: "object",
      properties: {
        phase_id: { type: "integer" },
        producer_agent: { type: "string" },
      },
      required: ["phase_id", "producer_agent"],
    },
  },
  {
    name: "revision_update",
    description: "Updates a revision's status and optionally records critic feedback.",
    inputSchema: {
      type: "object",
      properties: {
        revision_id: { type: "integer" },
        status: { type: "string", enum: ["draft", "submitted", "approved", "rejected"] },
        critic_agent: { type: "string" },
        critic_feedback: { type: "string" },
      },
      required: ["revision_id", "status"],
    },
  },
  {
    name: "changelog_insert",
    description:
      "Inserts a changelog entry for the given entity_type. The data object must contain the fields required by that entity type.",
    inputSchema: {
      type: "object",
      properties: {
        entity_type: {
          type: "string",
          enum: VALID_ENTITY_TYPES,
        },
        iteration_id: { type: "integer", description: "Optional. Derived from revision_id if omitted." },
        revision_id: { type: "integer" },
        data: { type: "object", description: "Entity-specific fields" },
      },
      required: ["entity_type", "revision_id", "data"],
    },
  },
  {
    name: "changelog_update",
    description:
      "Updates mutable fields on an existing changelog entity. Currently supports updating the status of security_audit_finding, performance_audit_finding, and adr records through their lifecycle (e.g. open → resolved, proposed → accepted).",
    inputSchema: {
      type: "object",
      properties: {
        entity_type: {
          type: "string",
          enum: ["security_audit_finding", "performance_audit_finding", "adr"],
        },
        entity_id: {
          type: ["integer", "string"],
          description: "The row ID of the entity to update (integer for audit findings, text for ADRs)",
        },
        updates: {
          type: "object",
          description: "Fields to update. Only provided fields are changed.",
          properties: {
            status: {
              type: "string",
              description:
                "New status. security_audit_finding: open|resolved|accepted|false-positive. performance_audit_finding: open|resolved|accepted|deferred. adr: proposed|accepted|deprecated|superseded.",
            },
          },
        },
      },
      required: ["entity_type", "entity_id", "updates"],
    },
  },
  {
    name: "commit_link",
    description: "Links a VCS commit to a work item and revision attempt within an iteration.",
    inputSchema: {
      type: "object",
      properties: {
        iteration_id: { type: "integer" },
        work_item_id: { type: "integer" },
        revision_id: { type: "integer" },
        commit_sha: { type: "string" },
        message: { type: "string" },
      },
      required: ["iteration_id", "work_item_id", "revision_id", "commit_sha"],
    },
  },
  {
    name: "project_update",
    description: "Updates project-level fields (status, notes, critic_model, closed_at).",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "closed"] },
        closed_at: { type: "string" },
        notes: { type: "string" },
        critic_model: { type: "string" },
      },
    },
  },
  {
    name: "blocker_resolve",
    description: "Marks an active blocker as resolved. Sets resolved_at to now and optionally records resolution notes.",
    inputSchema: {
      type: "object",
      properties: {
        blocker_id: { type: "integer", description: "The blocker row ID to resolve" },
        resolution_notes: { type: "string", description: "Optional notes describing how the blocker was resolved" },
      },
      required: ["blocker_id"],
    },
  },
  {
    name: "iteration_close",
    description: "Closes an active iteration. Sets status to 'closed' and closed_at to now. Validates the iteration exists and is currently active. Optionally updates notes.",
    inputSchema: {
      type: "object",
      properties: {
        iteration_id: { type: "integer", description: "The iteration ID to close" },
        notes: { type: "string", description: "Optional closing notes for this iteration" },
      },
      required: ["iteration_id"],
    },
  },
];

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export function handleWriteTool(name, args) {
  switch (name) {
    case "iteration_create":
      return iterationCreate(args);
    case "phase_transition":
      return phaseTransition(args);
    case "work_item_transition":
      return workItemTransition(args);
    case "revision_create":
      return revisionCreate(args);
    case "revision_update":
      return revisionUpdate(args);
    case "changelog_insert":
      return changelogInsert(args);
    case "changelog_update":
      return changelogUpdate(args);
    case "commit_link":
      return commitLink(args);
    case "project_update":
      return projectUpdate(args);
    case "blocker_resolve":
      return blockerResolve(args);
    case "iteration_close":
      return iterationClose(args);
    default:
      throw new Error(`Unknown write tool: ${name}`);
  }
}
