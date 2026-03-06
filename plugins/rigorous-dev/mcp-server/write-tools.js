import { getDb } from "./db.js";

const PHASES = [
  "requirements",
  "ux_design",
  "architecture",
  "planning",
  "implementation",
  "documentation",
  "qa",
  "audit",
  "release",
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
         VALUES (1, ?, ?, ?, 'active', ?, '')`
      ).run(project_name || "default", now, now, critic_model || "sonnet");
    }

    // Create iteration
    const iterResult = db
      .prepare(
        `INSERT INTO iteration (status, started_at, notes)
         VALUES ('active', ?, '')`
      )
      .run(now);

    const iteration_id = iterResult.lastInsertRowid;

    // Create all 9 phase records
    const insertPhase = db.prepare(
      `INSERT INTO phase (iteration_id, name, status) VALUES (?, ?, ?)`
    );
    const setInProgress = db.prepare(
      `UPDATE phase SET status = 'in_progress', started_at = ? WHERE iteration_id = ? AND name = 'requirements'`
    );

    for (const name of PHASES) {
      insertPhase.run(iteration_id, name, "pending");
    }

    setInProgress.run(now, iteration_id);

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

  const row = db
    .prepare("SELECT id, name, status FROM phase WHERE iteration_id = ? AND name = ?")
    .get(iteration_id, phase_name);

  return { phase_id: row.id, name: row.name, status: row.status };
}

function planPhaseTransition(args) {
  const db = getDb();
  const { plan_phase_id, status } = args;

  db.prepare(
    "UPDATE plan_phase SET status = ? WHERE id = ?"
  ).run(status, plan_phase_id);

  const row = db.prepare("SELECT id, phase_number, name, status FROM plan_phase WHERE id = ?").get(plan_phase_id);
  if (!row) throw new Error(`Plan phase ${plan_phase_id} not found`);
  return { plan_phase_id: row.id, phase_number: row.phase_number, name: row.name, status: row.status };
}

function revisionCreate(args) {
  const db = getDb();
  const { phase_id, producer_agent } = args;
  const now = new Date().toISOString();

  const result = db
    .prepare(
      `INSERT INTO revision (phase_id, producer_agent, created_at, status)
       VALUES (?, ?, ?, 'draft')`
    )
    .run(phase_id, producer_agent, now);

  const revision_count = db
    .prepare("SELECT COUNT(*) AS n FROM revision WHERE phase_id = ?")
    .get(phase_id).n;

  return { revision_id: result.lastInsertRowid, revision_count, phase_id };
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
function snapshotIfExists(db, table, entityType, entityId, newRevisionId) {
  const existing = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(entityId);
  if (existing) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO entity_snapshot (entity_type, entity_id, revision_id, snapshot, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(entityType, entityId, newRevisionId, JSON.stringify(existing), now);
  }
  return existing;
}

function insertPersona(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const existed = snapshotIfExists(db, "persona", "persona", data.id, revision_id);

  db.prepare(
    `INSERT INTO persona (id, iteration_id, revision_id, name, description, technical_level, frequency_of_use, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       revision_id = excluded.revision_id,
       name = excluded.name,
       description = excluded.description,
       technical_level = excluded.technical_level,
       frequency_of_use = excluded.frequency_of_use,
       updated_at = ?`
  ).run(
    data.id,
    iteration_id,
    revision_id ?? null,
    data.name,
    data.description,
    data.technical_level ?? null,
    data.frequency_of_use ?? null,
    now,
    now
  );

  if (existed) {
    db.prepare("DELETE FROM persona_goal WHERE persona_id = ?").run(data.id);
  }
  const insertGoal = db.prepare(
    "INSERT INTO persona_goal (persona_id, goal) VALUES (?, ?)"
  );
  for (const goal of data.goals ?? []) {
    insertGoal.run(data.id, goal);
  }

  return { entity_type: "persona", id: data.id, updated: !!existed };
}

function insertRequirement(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const existed = snapshotIfExists(db, "requirement", "requirement", data.id, revision_id);

  db.prepare(
    `INSERT INTO requirement (id, iteration_id, revision_id, description, rationale, priority, category, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       revision_id = excluded.revision_id,
       description = excluded.description,
       rationale = excluded.rationale,
       priority = excluded.priority,
       category = excluded.category,
       updated_at = ?`
  ).run(
    data.id,
    iteration_id,
    revision_id ?? null,
    data.description,
    data.rationale ?? null,
    data.priority,
    data.category,
    now,
    now
  );

  if (existed) {
    db.prepare("DELETE FROM requirement_acceptance_criterion WHERE requirement_id = ?").run(data.id);
    db.prepare("DELETE FROM requirement_persona WHERE requirement_id = ?").run(data.id);
    db.prepare("DELETE FROM requirement_dependency WHERE requirement_id = ?").run(data.id);
  }

  const insertCriterion = db.prepare(
    "INSERT INTO requirement_acceptance_criterion (requirement_id, criterion) VALUES (?, ?)"
  );
  for (const criterion of data.acceptance_criteria ?? []) {
    insertCriterion.run(data.id, criterion);
  }

  const insertPersonaLink = db.prepare(
    "INSERT OR IGNORE INTO requirement_persona (requirement_id, persona_id) VALUES (?, ?)"
  );
  for (const persona_id of data.personas ?? []) {
    insertPersonaLink.run(data.id, persona_id);
  }

  const insertDep = db.prepare(
    "INSERT OR IGNORE INTO requirement_dependency (requirement_id, depends_on) VALUES (?, ?)"
  );
  for (const dep of data.depends_on ?? []) {
    insertDep.run(data.id, dep);
  }

  return { entity_type: "requirement", id: data.id, updated: !!existed };
}

function insertAdr(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const existed = snapshotIfExists(db, "adr", "adr", data.id, revision_id);

  db.prepare(
    `INSERT INTO adr (id, iteration_id, revision_id, title, status, date, context, decision, rationale, superseded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       revision_id = excluded.revision_id,
       title = excluded.title,
       status = excluded.status,
       date = excluded.date,
       context = excluded.context,
       decision = excluded.decision,
       rationale = excluded.rationale,
       superseded_by = excluded.superseded_by,
       updated_at = ?`
  ).run(
    data.id,
    iteration_id,
    revision_id ?? null,
    data.title,
    data.status ?? "proposed",
    data.date ?? null,
    data.context ?? null,
    data.decision,
    data.rationale,
    data.superseded_by ?? null,
    now,
    now
  );

  if (existed) {
    // Delete child rows
    db.prepare("DELETE FROM adr_alternative WHERE adr_id = ?").run(data.id);
    db.prepare("DELETE FROM adr_consequence WHERE adr_id = ?").run(data.id);
    db.prepare("DELETE FROM adr_research_source WHERE adr_id = ?").run(data.id);
  }

  const insertAlt = db.prepare(
    "INSERT INTO adr_alternative (adr_id, option_text, pros, cons) VALUES (?, ?, ?, ?)"
  );
  for (const alt of data.alternatives_considered ?? []) {
    const prosText = (alt.pros ?? []).length > 0 ? JSON.stringify(alt.pros ?? []) : null;
    const consText = (alt.cons ?? []).length > 0 ? JSON.stringify(alt.cons ?? []) : null;
    insertAlt.run(data.id, alt.option_text ?? alt.option ?? alt, prosText, consText);
  }

  const insertConsequence = db.prepare(
    "INSERT INTO adr_consequence (adr_id, consequence) VALUES (?, ?)"
  );
  for (const consequence of data.consequences ?? []) {
    insertConsequence.run(data.id, consequence);
  }

  const insertSource = db.prepare(
    "INSERT INTO adr_research_source (adr_id, source) VALUES (?, ?)"
  );
  for (const source of data.research_sources ?? []) {
    insertSource.run(data.id, source);
  }

  return { entity_type: "adr", id: data.id, updated: !!existed };
}

function insertComponent(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const existed = snapshotIfExists(db, "component", "component", data.id, revision_id);

  db.prepare(
    `INSERT INTO component (id, iteration_id, revision_id, name, purpose, type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       revision_id = excluded.revision_id,
       name = excluded.name,
       purpose = excluded.purpose,
       type = excluded.type,
       updated_at = ?`
  ).run(
    data.id,
    iteration_id,
    revision_id ?? null,
    data.name,
    data.purpose,
    data.type,
    now,
    now
  );

  if (existed) {
    db.prepare("DELETE FROM component_interface WHERE component_id = ?").run(data.id);
    db.prepare("DELETE FROM component_dependency WHERE component_id = ?").run(data.id);
    db.prepare("DELETE FROM component_requirement WHERE component_id = ?").run(data.id);
    db.prepare("DELETE FROM integration_test_boundary WHERE component_id = ?").run(data.id);
  }

  const insertIface = db.prepare(
    "INSERT INTO component_interface (component_id, name, type, description) VALUES (?, ?, ?, ?)"
  );
  for (const iface of data.interfaces ?? []) {
    insertIface.run(data.id, iface.name, iface.type, iface.description ?? null);
  }

  const insertDep = db.prepare(
    "INSERT OR IGNORE INTO component_dependency (component_id, depends_on) VALUES (?, ?)"
  );
  for (const dep of data.dependencies ?? []) {
    insertDep.run(data.id, dep);
  }

  const insertReq = db.prepare(
    "INSERT OR IGNORE INTO component_requirement (component_id, requirement_id) VALUES (?, ?)"
  );
  for (const req_id of data.requirements_addressed ?? []) {
    insertReq.run(data.id, req_id);
  }

  const insertBoundary = db.prepare(
    `INSERT INTO integration_test_boundary (component_id, target_component, boundary_type, correct_behavior)
     VALUES (?, ?, ?, ?)`
  );
  for (const b of data.integration_test_boundaries ?? []) {
    insertBoundary.run(data.id, b.target_component, b.boundary_type, b.correct_behavior);
  }

  return { entity_type: "component", id: data.id, updated: !!existed };
}

function insertArchitectureOverview(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO architecture_overview (iteration_id, revision_id, description, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(
      iteration_id,
      revision_id ?? null,
      data.description,
      now
    );

  const overviewId = result.lastInsertRowid;

  const insertPrinciple = db.prepare(
    "INSERT INTO architecture_principle (overview_id, principle) VALUES (?, ?)"
  );
  for (const p of data.principles ?? []) {
    insertPrinciple.run(overviewId, p);
  }

  const insertDiagram = db.prepare(
    "INSERT INTO architecture_diagram (overview_id, name, path, description) VALUES (?, ?, ?, ?)"
  );
  for (const d of data.diagrams ?? []) {
    insertDiagram.run(overviewId, d.name, d.path, d.description ?? null);
  }

  return { entity_type: "architecture_overview", id: overviewId };
}

function insertDataEntity(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO data_entity (iteration_id, revision_id, entity_name, description, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      iteration_id,
      revision_id ?? null,
      data.entity_name,
      data.description,
      now
    );

  const entityId = result.lastInsertRowid;

  const insertAttr = db.prepare(
    "INSERT INTO data_entity_attribute (entity_id, name, type, is_required, description) VALUES (?, ?, ?, ?, ?)"
  );
  for (const a of data.attributes ?? []) {
    insertAttr.run(entityId, a.name, a.type, a.is_required ?? 0, a.description ?? null);
  }

  // Resolve and insert relationships.
  // target_entity (name string) is looked up in data_entity within the same iteration.
  const insertRel = db.prepare(
    "INSERT INTO data_entity_relationship (entity_id, target_entity_id, relationship_type, description) VALUES (?, ?, ?, ?)"
  );
  const lookupTarget = db.prepare(
    "SELECT id FROM data_entity WHERE entity_name = ? AND iteration_id = ? ORDER BY id DESC LIMIT 1"
  );
  for (const r of data.relationships ?? []) {
    const targetRow = lookupTarget.get(r.target_entity, iteration_id);
    if (!targetRow) {
      throw new Error(
        `Cannot resolve target_entity "${r.target_entity}" — no data_entity with that name exists in iteration ${iteration_id}. Insert the target entity first, then insert this entity's relationships.`
      );
    }
    insertRel.run(entityId, targetRow.id, r.relationship_type ?? null, r.description ?? null);
  }

  return { entity_type: "data_entity", id: entityId };
}

function insertTechnologyChoice(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO technology_choice (iteration_id, revision_id, category, name, purpose, rationale, version, config, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      iteration_id,
      revision_id ?? null,
      data.category,
      data.name,
      data.purpose ?? null,
      data.rationale ?? null,
      data.version ?? null,
      data.config ?? null,
      now
    );
  return { entity_type: "technology_choice", id: result.lastInsertRowid };
}

function insertTraceabilityMapping(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO traceability_mapping (iteration_id, revision_id, requirement_id, addressed_by, addressed_by_type, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      iteration_id,
      revision_id ?? null,
      data.requirement_id,
      data.addressed_by,
      data.addressed_by_type,
      data.notes ?? null,
      now
    );
  return { entity_type: "traceability_mapping", id: result.lastInsertRowid };
}

function insertArchitectureConfig(db, iteration_id, revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  const now = new Date().toISOString();
  let lastId;
  const insert = db.prepare(
    `INSERT INTO architecture_config (iteration_id, revision_id, config_type, target, category, key, value, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const entry of entries) {
    const result = insert.run(
      iteration_id,
      revision_id,
      entry.config_type,
      entry.target ?? null,
      entry.category,
      entry.key,
      entry.value,
      now
    );
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "architecture_config", id: lastId };
}

function insertApprovedDependency(db, iteration_id, revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  const now = new Date().toISOString();
  let lastId;
  const insert = db.prepare(
    `INSERT INTO approved_dependency
       (iteration_id, revision_id, package, version_constraint, purpose, justification, adr_id, license, maintenance_activity, community_adoption, transitive_deps, single_maintainer_risk, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const entry of entries) {
    const result = insert.run(
      iteration_id,
      revision_id,
      entry.package,
      entry.version_constraint ?? null,
      entry.purpose,
      entry.justification,
      entry.adr_id ?? null,
      entry.license ?? null,
      entry.maintenance_activity ?? null,
      entry.community_adoption ?? null,
      entry.transitive_deps ?? null,
      entry.single_maintainer_risk ?? 0,
      now
    );
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "approved_dependency", id: lastId };
}

function insertUserFlow(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const existed = snapshotIfExists(db, "user_flow", "user_flow", data.id, revision_id);

  db.prepare(
    `INSERT INTO user_flow (id, iteration_id, revision_id, name, goal, persona_id, entry_point, success_state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       revision_id = excluded.revision_id,
       name = excluded.name,
       goal = excluded.goal,
       persona_id = excluded.persona_id,
       entry_point = excluded.entry_point,
       success_state = excluded.success_state,
       updated_at = ?`
  ).run(
    data.id,
    iteration_id,
    revision_id ?? null,
    data.name,
    data.goal,
    data.persona_id ?? null,
    data.entry_point ?? null,
    data.success_state ?? null,
    now,
    now
  );

  if (existed) {
    // Delete steps and their branches
    const stepIds = db.prepare("SELECT id FROM user_flow_step WHERE flow_id = ?").all(data.id);
    for (const step of stepIds) {
      db.prepare("DELETE FROM user_flow_step_branch WHERE step_id = ?").run(step.id);
    }
    db.prepare("DELETE FROM user_flow_step WHERE flow_id = ?").run(data.id);
    db.prepare("DELETE FROM user_flow_error_state WHERE flow_id = ?").run(data.id);
    db.prepare("DELETE FROM user_flow_requirement WHERE flow_id = ?").run(data.id);
    db.prepare("DELETE FROM user_flow_data_dependency WHERE flow_id = ?").run(data.id);
  }

  const insertStep = db.prepare(
    `INSERT INTO user_flow_step (flow_id, step_number, action, screen, is_decision_point)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertBranch = db.prepare(
    "INSERT INTO user_flow_step_branch (step_id, condition, next_step) VALUES (?, ?, ?)"
  );
  for (const step of data.steps ?? []) {
    const stepResult = insertStep.run(
      data.id,
      step.step_number,
      step.action,
      step.screen,
      step.is_decision_point ? 1 : 0
    );
    for (const branch of step.branches ?? []) {
      insertBranch.run(stepResult.lastInsertRowid, branch.condition, branch.next_step);
    }
  }

  const insertError = db.prepare(
    "INSERT INTO user_flow_error_state (flow_id, condition, recovery) VALUES (?, ?, ?)"
  );
  for (const err of data.error_states ?? []) {
    insertError.run(data.id, err.condition, err.recovery);
  }

  const insertReq = db.prepare(
    "INSERT OR IGNORE INTO user_flow_requirement (flow_id, requirement_id) VALUES (?, ?)"
  );
  for (const req_id of data.requirements_addressed ?? []) {
    insertReq.run(data.id, req_id);
  }

  const insertDataDep = db.prepare(
    "INSERT INTO user_flow_data_dependency (flow_id, dependency) VALUES (?, ?)"
  );
  for (const dep of data.data_dependencies ?? []) {
    insertDataDep.run(data.id, dep);
  }

  return { entity_type: "user_flow", id: data.id, updated: !!existed };
}

function insertScreen(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const existed = snapshotIfExists(db, "screen", "screen", data.id, revision_id);

  db.prepare(
    `INSERT INTO screen (id, iteration_id, revision_id, name, purpose, wireframe_path, mockup_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       revision_id = excluded.revision_id,
       name = excluded.name,
       purpose = excluded.purpose,
       wireframe_path = excluded.wireframe_path,
       mockup_path = excluded.mockup_path,
       updated_at = ?`
  ).run(
    data.id,
    iteration_id,
    revision_id ?? null,
    data.name,
    data.purpose,
    data.wireframe_path ?? null,
    data.mockup_path ?? null,
    now,
    now
  );

  if (existed) {
    db.prepare("DELETE FROM screen_component WHERE screen_id = ?").run(data.id);
    db.prepare("DELETE FROM screen_state WHERE screen_id = ?").run(data.id);
    db.prepare("DELETE FROM screen_responsive_variant WHERE screen_id = ?").run(data.id);
  }

  const insertComp = db.prepare(
    "INSERT INTO screen_component (screen_id, component_name) VALUES (?, ?)"
  );
  for (const comp of data.components ?? []) {
    insertComp.run(data.id, typeof comp === "string" ? comp : comp.component_name ?? comp.name);
  }

  const insertState = db.prepare(
    "INSERT INTO screen_state (screen_id, name, description, wireframe_path) VALUES (?, ?, ?, ?)"
  );
  for (const state of data.states ?? []) {
    insertState.run(data.id, state.name, state.description ?? null, state.wireframe_path ?? null);
  }

  const insertVariant = db.prepare(
    "INSERT INTO screen_responsive_variant (screen_id, breakpoint, wireframe_path, layout_changes) VALUES (?, ?, ?, ?)"
  );
  for (const variant of data.responsive_variants ?? []) {
    insertVariant.run(
      data.id,
      variant.breakpoint,
      variant.wireframe_path ?? null,
      variant.layout_changes ?? null
    );
  }

  return { entity_type: "screen", id: data.id, updated: !!existed };
}

function insertPlanPhase(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO plan_phase (iteration_id, revision_id, phase_number, name, type, goal, complexity, review_checkpoint, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      iteration_id,
      revision_id ?? null,
      data.phase_number,
      data.name,
      data.type,
      data.goal,
      data.complexity ?? null,
      data.review_checkpoint ? 1 : 0,
      data.notes ?? null,
      now
    );
  const plan_phase_id = result.lastInsertRowid;

  const insertReq = db.prepare(
    "INSERT OR IGNORE INTO plan_phase_requirement (plan_phase_id, requirement_id) VALUES (?, ?)"
  );
  for (const req_id of data.requirements ?? []) {
    insertReq.run(plan_phase_id, req_id);
  }

  const insertComp = db.prepare(
    "INSERT OR IGNORE INTO plan_phase_component (plan_phase_id, component_id) VALUES (?, ?)"
  );
  for (const comp_id of data.components ?? []) {
    insertComp.run(plan_phase_id, comp_id);
  }

  const insertFlow = db.prepare(
    "INSERT OR IGNORE INTO plan_phase_flow (plan_phase_id, flow_id) VALUES (?, ?)"
  );
  for (const flow_id of data.flows ?? []) {
    insertFlow.run(plan_phase_id, flow_id);
  }

  const insertScreenLink = db.prepare(
    "INSERT OR IGNORE INTO plan_phase_screen (plan_phase_id, screen_id) VALUES (?, ?)"
  );
  for (const screen_id of data.screens ?? []) {
    insertScreenLink.run(plan_phase_id, screen_id);
  }

  const insertEntry = db.prepare(
    "INSERT INTO plan_phase_entry_criterion (plan_phase_id, criterion) VALUES (?, ?)"
  );
  for (const criterion of data.entry_criteria ?? []) {
    insertEntry.run(plan_phase_id, criterion);
  }

  const insertExit = db.prepare(
    "INSERT INTO plan_phase_exit_criterion (plan_phase_id, criterion) VALUES (?, ?)"
  );
  for (const criterion of data.exit_criteria ?? []) {
    insertExit.run(plan_phase_id, criterion);
  }

  const insertEndpoint = db.prepare(
    "INSERT INTO plan_phase_api_endpoint (plan_phase_id, method, path, description) VALUES (?, ?, ?, ?)"
  );
  for (const ep of data.api_endpoints ?? []) {
    insertEndpoint.run(plan_phase_id, ep.method, ep.path, ep.description ?? "");
  }

  const insertDbChange = db.prepare(
    "INSERT INTO plan_phase_db_change (plan_phase_id, migration_name, description) VALUES (?, ?, ?)"
  );
  const insertDbTable = db.prepare(
    "INSERT INTO plan_phase_db_change_table (db_change_id, table_name) VALUES (?, ?)"
  );
  for (const change of data.db_changes ?? []) {
    const changeResult = insertDbChange.run(plan_phase_id, change.migration_name, change.description ?? "");
    for (const tbl of change.tables ?? []) {
      insertDbTable.run(changeResult.lastInsertRowid, tbl);
    }
  }

  const insertDep = db.prepare(
    "INSERT OR IGNORE INTO plan_phase_dependency (plan_phase_id, depends_on_phase, reason) VALUES (?, ?, ?)"
  );
  for (const dep of data.dependencies ?? []) {
    const depPhase = typeof dep === "object" ? dep.depends_on_phase ?? dep.phase : dep;
    const reason = typeof dep === "object" ? dep.reason ?? null : null;
    insertDep.run(plan_phase_id, depPhase, reason);
  }

  const insertRisk = db.prepare(
    "INSERT INTO plan_phase_risk (plan_phase_id, risk, mitigation) VALUES (?, ?, ?)"
  );
  for (const risk of data.risks ?? []) {
    insertRisk.run(plan_phase_id, risk.risk, risk.mitigation ?? "");
  }

  const insertCheckpointFocus = db.prepare(
    "INSERT INTO plan_checkpoint_focus (plan_phase_id, focus) VALUES (?, ?)"
  );
  for (const focus of data.checkpoint_focus ?? []) {
    insertCheckpointFocus.run(plan_phase_id, focus);
  }

  const insertParallel = db.prepare(
    "INSERT OR IGNORE INTO plan_phase_parallel (plan_phase_id, can_parallel_with) VALUES (?, ?)"
  );
  for (const phase_num of data.parallel_with ?? []) {
    insertParallel.run(plan_phase_id, phase_num);
  }

  return { entity_type: "plan_phase", id: plan_phase_id };
}

function insertPlanOverview(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO plan_overview (iteration_id, revision_id, strategy, total_phases, rationale, phase_one_approach, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      iteration_id,
      revision_id ?? null,
      data.strategy,
      data.total_phases,
      data.rationale,
      data.phase_one_approach ?? null,
      now
    );
  const plan_overview_id = result.lastInsertRowid;

  const insertRisk = db.prepare(
    "INSERT INTO plan_overview_risk (plan_overview_id, risk, mitigation, phase) VALUES (?, ?, ?, ?)"
  );
  for (const risk of data.risks ?? []) {
    insertRisk.run(plan_overview_id, risk.risk, risk.mitigation ?? "", risk.phase ?? null);
  }

  const insertAssumption = db.prepare(
    "INSERT INTO plan_overview_assumption (plan_overview_id, assumption) VALUES (?, ?)"
  );
  for (const assumption of data.assumptions ?? []) {
    insertAssumption.run(plan_overview_id, assumption);
  }

  return { entity_type: "plan_overview", id: plan_overview_id };
}

function insertPlanRequirementMapping(db, iteration_id, _revision_id, data) {
  const result = db
    .prepare(
      `INSERT INTO plan_requirement_mapping (iteration_id, requirement_id, plan_phase_number, priority, notes)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      iteration_id,
      data.requirement_id,
      data.plan_phase_number,
      data.priority,
      data.notes ?? null
    );
  return { entity_type: "plan_requirement_mapping", id: result.lastInsertRowid };
}

function insertPlanExternalDependency(db, iteration_id, _revision_id, data) {
  const result = db
    .prepare(
      `INSERT INTO plan_external_dependency (iteration_id, name, description, phase, risk_level, mitigation)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      iteration_id,
      data.name,
      data.description,
      data.phase ?? null,
      data.risk_level,
      data.mitigation ?? null
    );
  return { entity_type: "plan_external_dependency", id: result.lastInsertRowid };
}

function insertPlanCriticalPath(db, iteration_id, _revision_id, data) {
  const result = db
    .prepare(
      `INSERT INTO plan_critical_path (iteration_id, phase_number, sequence_order)
       VALUES (?, ?, ?)`
    )
    .run(
      iteration_id,
      data.phase_number,
      data.sequence_order
    );
  return { entity_type: "plan_critical_path", id: result.lastInsertRowid };
}

function insertPlanMetadata(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO plan_metadata (iteration_id, revision_id, title, version, created, updated, status, requirements_version, architecture_version, ux_specification_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      iteration_id,
      revision_id ?? null,
      data.title,
      data.version,
      data.created,
      data.updated ?? null,
      data.status,
      data.requirements_version,
      data.architecture_version,
      data.ux_specification_version,
      now
    );
  return { entity_type: "plan_metadata", id: result.lastInsertRowid };
}

function insertImplementationManifest(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO implementation_manifest
         (iteration_id, revision_id, sub_phase_number, status, files_created, files_modified, lines_of_code, warnings, build_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      iteration_id,
      revision_id ?? null,
      data.sub_phase_number,
      data.status,
      data.files_created ?? 0,
      data.files_modified ?? 0,
      data.lines_of_code ?? null,
      data.warnings ?? 0,
      data.build_status ?? null,
      now
    );
  const manifest_id = result.lastInsertRowid;

  const insertFile = db.prepare(
    "INSERT INTO implementation_file (manifest_id, path, action, purpose, component_id) VALUES (?, ?, ?, ?, ?)"
  );
  const insertFileReq = db.prepare(
    "INSERT OR IGNORE INTO implementation_file_requirement (file_id, requirement_id) VALUES (?, ?)"
  );
  for (const f of data.files ?? []) {
    const fileResult = insertFile.run(
      manifest_id,
      f.path,
      f.action,
      f.purpose ?? null,
      f.component_id ?? null
    );
    for (const req_id of f.requirements ?? []) {
      insertFileReq.run(fileResult.lastInsertRowid, req_id);
    }
  }

  const insertReqStatus = db.prepare(
    "INSERT INTO implementation_requirement_status (manifest_id, requirement_id, status, notes) VALUES (?, ?, ?, ?)"
  );
  for (const rs of data.requirement_status ?? []) {
    insertReqStatus.run(manifest_id, rs.requirement_id, rs.status, rs.notes ?? null);
  }

  const insertCompStatus = db.prepare(
    "INSERT INTO implementation_component_status (manifest_id, component_id, status, notes) VALUES (?, ?, ?, ?)"
  );
  for (const cs of data.component_status ?? []) {
    insertCompStatus.run(manifest_id, cs.component_id, cs.status, cs.notes ?? null);
  }

  const insertEndpoint = db.prepare(
    "INSERT INTO implementation_api_endpoint (manifest_id, path, method, status) VALUES (?, ?, ?, ?)"
  );
  const insertEndpointReq = db.prepare(
    "INSERT OR IGNORE INTO implementation_api_endpoint_requirement (endpoint_id, requirement_id) VALUES (?, ?)"
  );
  for (const ep of data.api_endpoints ?? []) {
    const epResult = insertEndpoint.run(manifest_id, ep.path, ep.method, ep.status);
    for (const req_id of ep.requirements ?? []) {
      insertEndpointReq.run(epResult.lastInsertRowid, req_id);
    }
  }

  const insertBlocker = db.prepare(
    "INSERT INTO implementation_blocker (manifest_id, description, severity, recommendation, needs_escalation) VALUES (?, ?, ?, ?, ?)"
  );
  const insertBlockerReq = db.prepare(
    "INSERT OR IGNORE INTO implementation_blocker_requirement (blocker_id, requirement_id) VALUES (?, ?)"
  );
  for (const blocker of data.blockers ?? []) {
    const blockerResult = insertBlocker.run(
      manifest_id,
      blocker.description,
      blocker.severity,
      blocker.recommendation ?? null,
      blocker.needs_escalation ? 1 : 0
    );
    for (const req_id of blocker.requirements ?? []) {
      insertBlockerReq.run(blockerResult.lastInsertRowid, req_id);
    }
  }

  const insertDepAdded = db.prepare(
    "INSERT INTO implementation_dependency_added (manifest_id, name, version, purpose, license) VALUES (?, ?, ?, ?, ?)"
  );
  for (const dep of data.dependencies_added ?? []) {
    insertDepAdded.run(manifest_id, dep.name, dep.version, dep.purpose, dep.license ?? null);
  }

  const insertDbMigration = db.prepare(
    "INSERT INTO implementation_db_migration (manifest_id, name, description, status) VALUES (?, ?, ?, ?)"
  );
  for (const mig of data.db_migrations ?? []) {
    insertDbMigration.run(manifest_id, mig.name, mig.description ?? null, mig.status);
  }

  const insertChecklistItem = db.prepare(
    "INSERT INTO implementation_review_checklist (manifest_id, check_name, passed) VALUES (?, ?, ?)"
  );
  for (const item of data.review_checklist ?? []) {
    insertChecklistItem.run(manifest_id, item.check_name, item.passed ? 1 : 0);
  }

  const insertMetadata = db.prepare(
    "INSERT INTO implementation_manifest_metadata (manifest_id, version, created, requirements_version, architecture_version, language, commit_sha) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  for (const meta of data.metadata ?? []) {
    insertMetadata.run(
      manifest_id,
      meta.version,
      meta.created,
      meta.requirements_version,
      meta.architecture_version,
      meta.language ?? null,
      meta.commit_sha ?? null
    );
  }

  return { entity_type: "implementation_manifest", id: manifest_id };
}

function insertProjectContext(db, iteration_id, _revision_id, data) {
  // data may be a single entry or an array of entries
  const entries = Array.isArray(data) ? data : [data];
  let lastId;
  const insert = db.prepare(
    `INSERT OR REPLACE INTO project_context (iteration_id, key, value, category) VALUES (?, ?, ?, ?)`
  );
  for (const entry of entries) {
    const result = insert.run(
      iteration_id,
      entry.key,
      entry.value,
      entry.category ?? null
    );
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "project_context", id: lastId };
}

function insertSystemInput(db, iteration_id, _revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  let lastId;
  const insert = db.prepare(
    `INSERT INTO system_input (iteration_id, name, description, source, format) VALUES (?, ?, ?, ?, ?)`
  );
  for (const entry of entries) {
    const result = insert.run(
      iteration_id,
      entry.name,
      entry.description,
      entry.source ?? null,
      entry.format ?? null
    );
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "system_input", id: lastId };
}

function insertSystemOutput(db, iteration_id, _revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  let lastId;
  const insert = db.prepare(
    `INSERT INTO system_output (iteration_id, name, description, destination, format) VALUES (?, ?, ?, ?, ?)`
  );
  for (const entry of entries) {
    const result = insert.run(
      iteration_id,
      entry.name,
      entry.description,
      entry.destination ?? null,
      entry.format ?? null
    );
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "system_output", id: lastId };
}

function insertDeploymentRequirement(db, iteration_id, _revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  let lastId;
  const insert = db.prepare(
    `INSERT INTO deployment_requirement (iteration_id, target, requirement, notes) VALUES (?, ?, ?, ?)`
  );
  for (const entry of entries) {
    const result = insert.run(
      iteration_id,
      entry.target ?? null,
      entry.requirement,
      entry.notes ?? null
    );
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "deployment_requirement", id: lastId };
}

function insertOperationalRequirement(db, iteration_id, _revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  let lastId;
  const insert = db.prepare(
    `INSERT INTO operational_requirement (iteration_id, item, category, notes) VALUES (?, ?, ?, ?)`
  );
  for (const entry of entries) {
    const result = insert.run(
      iteration_id,
      entry.item,
      entry.category,
      entry.notes ?? null
    );
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "operational_requirement", id: lastId };
}

function insertTechnologyConstraint(db, iteration_id, _revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  let lastId;
  const insert = db.prepare(
    `INSERT INTO technology_constraint (iteration_id, constraint_type, value) VALUES (?, ?, ?)`
  );
  for (const entry of entries) {
    const result = insert.run(
      iteration_id,
      entry.constraint_type,
      entry.value
    );
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "technology_constraint", id: lastId };
}

function insertVcsCommit(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO vcs_commit (iteration_id, phase_id, commit_sha, message, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(
      iteration_id,
      data.phase_id ?? null,
      data.commit_sha,
      data.message ?? null,
      now
    );
  return { entity_type: "vcs_commit", id: result.lastInsertRowid };
}

function insertIntermediateAsset(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO intermediate_asset (iteration_id, phase_id, revision_id, asset_type, title, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      iteration_id,
      data.phase_id ?? null,
      revision_id ?? null,
      data.asset_type,
      data.title,
      data.content ?? null,
      now
    );
  return { entity_type: "intermediate_asset", id: result.lastInsertRowid };
}

function insertAssetDeliverable(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO asset_deliverable (iteration_id, phase_id, asset_type, file_path, description, commit_sha, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      iteration_id,
      data.phase_id ?? null,
      data.asset_type,
      data.file_path,
      data.description ?? null,
      data.commit_sha ?? null,
      now
    );
  return { entity_type: "asset_deliverable", id: result.lastInsertRowid };
}

function insertWorkflowBlocker(db, iteration_id, _revision_id, data) {
  const result = db.prepare(
    `INSERT INTO blocker (iteration_id, phase_name, description, severity, raised_by)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    iteration_id,
    data.phase_name,
    data.description,
    data.severity,
    data.raised_by
  );
  return { entity_type: "blocker", id: result.lastInsertRowid };
}

function insertProjectLesson(db, iteration_id, _revision_id, data) {
  const result = db.prepare(
    `INSERT INTO project_lesson (iteration_id, phase_name, category, lesson, recurring)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    iteration_id,
    data.phase_name,
    data.category,
    data.lesson,
    data.recurring ? 1 : 0
  );
  return { entity_type: "project_lesson", id: result.lastInsertRowid };
}

function insertSecurityAuditFinding(db, iteration_id, revision_id, data) {
  const result = db.prepare(
    `INSERT INTO security_audit_finding
       (iteration_id, revision_id, category, severity, title, description, location, recommendation, cve, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    iteration_id,
    revision_id,
    data.category,
    data.severity,
    data.title,
    data.description,
    data.location ?? null,
    data.recommendation,
    data.cve ?? null,
    data.status ?? "open"
  );
  return { entity_type: "security_audit_finding", id: result.lastInsertRowid };
}

function insertPerformanceAuditFinding(db, iteration_id, revision_id, data) {
  const result = db.prepare(
    `INSERT INTO performance_audit_finding
       (iteration_id, revision_id, category, severity, title, description, location, metric_name, baseline_value, actual_value, recommendation, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    iteration_id,
    revision_id,
    data.category,
    data.severity,
    data.title,
    data.description,
    data.location ?? null,
    data.metric_name ?? null,
    data.baseline_value ?? null,
    data.actual_value ?? null,
    data.recommendation,
    data.status ?? "open"
  );
  return { entity_type: "performance_audit_finding", id: result.lastInsertRowid };
}

function insertTestReport(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO test_report
         (iteration_id, revision_id, total_tests, passed, failed, skipped,
          coverage_line, coverage_branch, coverage_function,
          duration_seconds, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      iteration_id,
      revision_id ?? null,
      data.total_tests ?? 0,
      data.passed ?? 0,
      data.failed ?? 0,
      data.skipped ?? 0,
      data.coverage_line ?? null,
      data.coverage_branch ?? null,
      data.coverage_function ?? null,
      data.duration_seconds ?? null,
      data.status,
      now
    );
  const report_id = result.lastInsertRowid;

  // -- test_report_metadata (1:1) --
  const insertMeta = db.prepare(
    `INSERT INTO test_report_metadata
       (report_id, version, created, requirements_version, architecture_version, commit_sha)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const meta of data.metadata ?? []) {
    insertMeta.run(
      report_id,
      meta.version,
      meta.created,
      meta.requirements_version,
      meta.architecture_version,
      meta.commit_sha ?? null
    );
  }

  // -- test_requirement_coverage (1:N) --
  //    → test_acceptance_criterion_result (1:N per coverage)
  //      → test_acceptance_criterion_test_id (1:N per criterion result)
  const insertCoverage = db.prepare(
    "INSERT INTO test_requirement_coverage (report_id, requirement_id, status) VALUES (?, ?, ?)"
  );
  const insertCriterionResult = db.prepare(
    "INSERT INTO test_acceptance_criterion_result (coverage_id, criterion, status, notes) VALUES (?, ?, ?, ?)"
  );
  const insertCriterionTestId = db.prepare(
    "INSERT INTO test_acceptance_criterion_test_id (criterion_result_id, test_id) VALUES (?, ?)"
  );
  for (const cov of data.coverage ?? []) {
    const covResult = insertCoverage.run(report_id, cov.requirement_id, cov.status);
    const coverage_id = covResult.lastInsertRowid;
    for (const cr of cov.criteria ?? []) {
      const crResult = insertCriterionResult.run(
        coverage_id,
        cr.criterion,
        cr.status,
        cr.notes ?? null
      );
      for (const tid of cr.test_ids ?? []) {
        insertCriterionTestId.run(crResult.lastInsertRowid, tid);
      }
    }
  }

  // -- test_suite (1:N) --
  //    → test_case (1:N per suite)
  //      → test_case_requirement (M:N per case)
  const insertSuite = db.prepare(
    "INSERT INTO test_suite (report_id, name, type) VALUES (?, ?, ?)"
  );
  const insertCase = db.prepare(
    `INSERT INTO test_case
       (suite_id, test_id, name, description, status, duration_ms,
        error_message, stack_trace, retry_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const insertCaseReq = db.prepare(
    "INSERT OR IGNORE INTO test_case_requirement (test_case_id, requirement_id) VALUES (?, ?)"
  );
  for (const suite of data.suites ?? []) {
    const suiteResult = insertSuite.run(report_id, suite.name, suite.type);
    const suite_id = suiteResult.lastInsertRowid;
    for (const tc of suite.cases ?? []) {
      const caseResult = insertCase.run(
        suite_id,
        tc.test_id,
        tc.name,
        tc.description ?? null,
        tc.status,
        tc.duration_ms ?? null,
        tc.error_message ?? null,
        tc.stack_trace ?? null,
        tc.retry_count ?? null
      );
      for (const req_id of tc.requirements ?? []) {
        insertCaseReq.run(caseResult.lastInsertRowid, req_id);
      }
    }
  }

  // -- test_security_finding (1:N) --
  const insertSecFinding = db.prepare(
    `INSERT INTO test_security_finding
       (report_id, category, tool, severity, description, location,
        recommendation, package, advisory)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const sf of data.security_findings ?? []) {
    insertSecFinding.run(
      report_id,
      sf.category,
      sf.tool ?? null,
      sf.severity ?? null,
      sf.description ?? null,
      sf.location ?? null,
      sf.recommendation ?? null,
      sf.package ?? null,
      sf.advisory ?? null
    );
  }

  // -- test_performance_benchmark (1:N) --
  const insertBenchmark = db.prepare(
    `INSERT INTO test_performance_benchmark
       (report_id, name, metric, value, unit, threshold, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const pb of data.performance_benchmarks ?? []) {
    insertBenchmark.run(
      report_id,
      pb.name,
      pb.metric,
      pb.value,
      pb.unit,
      pb.threshold ?? null,
      pb.status ?? null
    );
  }

  // -- test_blocker (1:N) --
  //    → test_blocker_requirement (M:N per blocker)
  const insertBlocker = db.prepare(
    "INSERT INTO test_blocker (report_id, description, severity, recommendation) VALUES (?, ?, ?, ?)"
  );
  const insertBlockerReq = db.prepare(
    "INSERT OR IGNORE INTO test_blocker_requirement (blocker_id, requirement_id) VALUES (?, ?)"
  );
  for (const blocker of data.blockers ?? []) {
    const blockerResult = insertBlocker.run(
      report_id,
      blocker.description,
      blocker.severity,
      blocker.recommendation ?? null
    );
    for (const req_id of blocker.requirements ?? []) {
      insertBlockerReq.run(blockerResult.lastInsertRowid, req_id);
    }
  }

  // -- test_recommendation (1:N) --
  const insertRecommendation = db.prepare(
    "INSERT INTO test_recommendation (report_id, category, description, priority) VALUES (?, ?, ?, ?)"
  );
  for (const rec of data.recommendations ?? []) {
    insertRecommendation.run(report_id, rec.category, rec.description, rec.priority);
  }

  return { entity_type: "test_report", id: report_id };
}

function insertDocumentationManifest(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO documentation_manifest
         (iteration_id, revision_id, status, documents_created, total_pages,
          accessibility_compliant, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      iteration_id,
      revision_id ?? null,
      data.status,
      data.documents_created ?? 0,
      data.total_pages ?? null,
      data.accessibility_compliant ?? 0,
      now
    );
  const manifest_id = result.lastInsertRowid;

  // -- documentation_manifest_metadata (1:1) --
  const insertMeta = db.prepare(
    `INSERT INTO documentation_manifest_metadata
       (manifest_id, version, created, requirements_version,
        architecture_version, implementation_version, format)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const meta of data.metadata ?? []) {
    insertMeta.run(
      manifest_id,
      meta.version,
      meta.created,
      meta.requirements_version,
      meta.architecture_version ?? null,
      meta.implementation_version ?? null,
      meta.format ?? null
    );
  }

  // -- documentation_section (1:N) --
  const insertSection = db.prepare(
    `INSERT INTO documentation_section
       (manifest_id, category, key, value, path)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const sec of data.sections ?? []) {
    insertSection.run(
      manifest_id,
      sec.category,
      sec.key,
      sec.value,
      sec.path ?? null
    );
  }

  // -- documentation_feature (1:N) --
  //    → documentation_feature_requirement (M:N per feature)
  const insertFeature = db.prepare(
    `INSERT INTO documentation_feature
       (manifest_id, name, path, includes_examples, includes_screenshots)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertFeatureReq = db.prepare(
    "INSERT OR IGNORE INTO documentation_feature_requirement (feature_id, requirement_id) VALUES (?, ?)"
  );
  for (const feat of data.features ?? []) {
    const featResult = insertFeature.run(
      manifest_id,
      feat.name,
      feat.path,
      feat.includes_examples ? 1 : 0,
      feat.includes_screenshots ? 1 : 0
    );
    for (const req_id of feat.requirements ?? []) {
      insertFeatureReq.run(featResult.lastInsertRowid, req_id);
    }
  }

  // -- documentation_requirement_coverage (1:N) --
  //    → documentation_requirement_path (1:N per coverage)
  const insertCoverage = db.prepare(
    `INSERT INTO documentation_requirement_coverage
       (manifest_id, requirement_id, documented, user_facing, notes)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertCoveragePath = db.prepare(
    "INSERT INTO documentation_requirement_path (coverage_id, path) VALUES (?, ?)"
  );
  for (const cov of data.coverage ?? []) {
    const covResult = insertCoverage.run(
      manifest_id,
      cov.requirement_id,
      cov.documented ? 1 : 0,
      cov.user_facing ? 1 : 0,
      cov.notes ?? null
    );
    const coverage_id = covResult.lastInsertRowid;
    for (const p of cov.paths ?? []) {
      insertCoveragePath.run(coverage_id, p);
    }
  }

  // -- documentation_asset (1:N) --
  const insertAsset = db.prepare(
    `INSERT INTO documentation_asset
       (manifest_id, path, type, description, alt_text)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const asset of data.assets ?? []) {
    insertAsset.run(
      manifest_id,
      asset.path,
      asset.type,
      asset.description ?? null,
      asset.alt_text ?? null
    );
  }

  // -- documentation_verification (1:N) --
  const insertVerification = db.prepare(
    "INSERT INTO documentation_verification (manifest_id, check_name, passed) VALUES (?, ?, ?)"
  );
  for (const v of data.verification ?? []) {
    insertVerification.run(manifest_id, v.check_name, v.passed ? 1 : 0);
  }

  return { entity_type: "documentation_manifest", id: manifest_id };
}

function insertDeploymentManifest(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO deployment_manifest
         (iteration_id, revision_id, status, created_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(iteration_id, revision_id ?? null, data.status, now);
  const manifest_id = result.lastInsertRowid;

  // -- deployment_manifest_metadata (1:1) --
  const insertMeta = db.prepare(
    `INSERT INTO deployment_manifest_metadata
       (manifest_id, version, created, requirements_version,
        architecture_version, implementation_version, test_report_version)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const meta of data.metadata ?? []) {
    insertMeta.run(
      manifest_id,
      meta.version,
      meta.created,
      meta.requirements_version,
      meta.architecture_version,
      meta.implementation_version,
      meta.test_report_version ?? null
    );
  }

  // -- deployment_target (1:N) --
  const insertTarget = db.prepare(
    "INSERT INTO deployment_target (manifest_id, target) VALUES (?, ?)"
  );
  for (const t of data.targets ?? []) {
    insertTarget.run(manifest_id, t.target ?? t);
  }

  // -- deployment_manifest_blocker (1:N) --
  const insertBlocker = db.prepare(
    "INSERT INTO deployment_manifest_blocker (manifest_id, blocker) VALUES (?, ?)"
  );
  for (const b of data.blockers ?? []) {
    insertBlocker.run(manifest_id, b.blocker ?? b);
  }

  // -- deployment_pipeline (1:N) --
  //    → deployment_pipeline_config_file (1:N per pipeline)
  //    → deployment_pipeline_stage (1:N per pipeline)
  //      → deployment_stage_trigger (1:N per stage)
  //      → deployment_stage_step (1:N per stage)
  //      → deployment_stage_quality_gate (1:N per stage)
  const insertPipeline = db.prepare(
    "INSERT INTO deployment_pipeline (manifest_id, platform) VALUES (?, ?)"
  );
  const insertPipelineConfigFile = db.prepare(
    "INSERT INTO deployment_pipeline_config_file (pipeline_id, file_path) VALUES (?, ?)"
  );
  const insertPipelineStage = db.prepare(
    "INSERT INTO deployment_pipeline_stage (pipeline_id, name, purpose) VALUES (?, ?, ?)"
  );
  const insertStageTrigger = db.prepare(
    "INSERT INTO deployment_stage_trigger (stage_id, trigger_text) VALUES (?, ?)"
  );
  const insertStageStep = db.prepare(
    "INSERT INTO deployment_stage_step (stage_id, step) VALUES (?, ?)"
  );
  const insertStageQualityGate = db.prepare(
    `INSERT INTO deployment_stage_quality_gate
       (stage_id, name, condition, failure_action)
     VALUES (?, ?, ?, ?)`
  );
  for (const pipeline of data.pipelines ?? []) {
    const pipeResult = insertPipeline.run(manifest_id, pipeline.platform);
    const pipeline_id = pipeResult.lastInsertRowid;
    for (const cf of pipeline.config_files ?? []) {
      insertPipelineConfigFile.run(pipeline_id, cf.file_path ?? cf);
    }
    for (const stage of pipeline.stages ?? []) {
      const stageResult = insertPipelineStage.run(
        pipeline_id,
        stage.name,
        stage.purpose
      );
      const stage_id = stageResult.lastInsertRowid;
      for (const tr of stage.triggers ?? []) {
        insertStageTrigger.run(stage_id, tr.trigger_text ?? tr);
      }
      for (const st of stage.steps ?? []) {
        insertStageStep.run(stage_id, st.step ?? st);
      }
      for (const qg of stage.quality_gates ?? []) {
        insertStageQualityGate.run(stage_id, qg.name, qg.condition, qg.failure_action);
      }
    }
  }

  // -- deployment_quality_gates (1:N) --
  const insertQualityGates = db.prepare(
    "INSERT INTO deployment_quality_gates (manifest_id, category, key, value) VALUES (?, ?, ?, ?)"
  );
  for (const qg of data.quality_gates ?? []) {
    insertQualityGates.run(manifest_id, qg.category, qg.key, qg.value);
  }

  // -- deployment_environment (1:N) --
  //    → deployment_env_infra (1:N per environment)
  //    → deployment_env_var (1:N per environment)
  const insertEnvironment = db.prepare(
    `INSERT INTO deployment_environment
       (manifest_id, name, deployment_method, url, rollback_procedure)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertEnvInfra = db.prepare(
    "INSERT INTO deployment_env_infra (environment_id, provider, resource) VALUES (?, ?, ?)"
  );
  const insertEnvVar = db.prepare(
    `INSERT INTO deployment_env_var
       (environment_id, name, source, description)
     VALUES (?, ?, ?, ?)`
  );
  for (const env of data.environments ?? []) {
    const envResult = insertEnvironment.run(
      manifest_id,
      env.name,
      env.deployment_method,
      env.url ?? null,
      env.rollback_procedure ?? null
    );
    const environment_id = envResult.lastInsertRowid;
    for (const infra of env.infra ?? []) {
      insertEnvInfra.run(environment_id, infra.provider ?? null, infra.resource);
    }
    for (const v of env.vars ?? []) {
      insertEnvVar.run(environment_id, v.name, v.source, v.description ?? null);
    }
  }

  // -- deployment_artifact (1:N) --
  //    → deployment_artifact_platform (1:N per artifact)
  const insertArtifact = db.prepare(
    `INSERT INTO deployment_artifact
       (manifest_id, name, type, registry, versioning)
     VALUES (?, ?, ?, ?, ?)`
  );
  const insertArtifactPlatform = db.prepare(
    "INSERT INTO deployment_artifact_platform (artifact_id, platform) VALUES (?, ?)"
  );
  for (const art of data.artifacts ?? []) {
    const artResult = insertArtifact.run(
      manifest_id,
      art.name,
      art.type,
      art.registry ?? null,
      art.versioning ?? null
    );
    for (const plat of art.platforms ?? []) {
      insertArtifactPlatform.run(artResult.lastInsertRowid, plat.platform ?? plat);
    }
  }

  // -- deployment_signing (1:N) --
  const insertSigning = db.prepare(
    "INSERT INTO deployment_signing (manifest_id, enabled, method) VALUES (?, ?, ?)"
  );
  for (const s of data.signing ?? []) {
    insertSigning.run(manifest_id, s.enabled ? 1 : 0, s.method ?? null);
  }

  // -- deployment_local_executable (1:N) --
  //    → deployment_local_platform (1:N per executable)
  //    → deployment_local_channel (1:N per executable)
  const insertLocalExec = db.prepare(
    `INSERT INTO deployment_local_executable
       (manifest_id, installation_method, update_mechanism)
     VALUES (?, ?, ?)`
  );
  const insertLocalPlatform = db.prepare(
    "INSERT INTO deployment_local_platform (local_exec_id, platform) VALUES (?, ?)"
  );
  const insertLocalChannel = db.prepare(
    "INSERT INTO deployment_local_channel (local_exec_id, channel) VALUES (?, ?)"
  );
  for (const le of data.local_executables ?? []) {
    const leResult = insertLocalExec.run(
      manifest_id,
      le.installation_method ?? null,
      le.update_mechanism ?? null
    );
    const local_exec_id = leResult.lastInsertRowid;
    for (const p of le.platforms ?? []) {
      insertLocalPlatform.run(local_exec_id, p.platform ?? p);
    }
    for (const ch of le.channels ?? []) {
      insertLocalChannel.run(local_exec_id, ch.channel ?? ch);
    }
  }

  // -- deployment_secret (1:N) --
  const insertSecret = db.prepare(
    `INSERT INTO deployment_secret
       (manifest_id, provider, name, purpose, rotation_policy)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const sec of data.secrets ?? []) {
    insertSecret.run(
      manifest_id,
      sec.provider ?? null,
      sec.name,
      sec.purpose,
      sec.rotation_policy ?? null
    );
  }

  // -- deployment_health_check (1:N) --
  const insertHealthCheck = db.prepare(
    "INSERT INTO deployment_health_check (manifest_id, name, endpoint, interval) VALUES (?, ?, ?, ?)"
  );
  for (const hc of data.health_checks ?? []) {
    insertHealthCheck.run(manifest_id, hc.name, hc.endpoint ?? null, hc.interval ?? null);
  }

  // -- deployment_alerting (1:N) --
  const insertAlerting = db.prepare(
    "INSERT INTO deployment_alerting (manifest_id, provider, channel) VALUES (?, ?, ?)"
  );
  for (const al of data.alerting ?? []) {
    insertAlerting.run(manifest_id, al.provider ?? null, al.channel);
  }

  // -- deployment_runbook (1:N) --
  //    → deployment_runbook_step (1:N per runbook)
  const insertRunbook = db.prepare(
    "INSERT INTO deployment_runbook (manifest_id, name, scenario) VALUES (?, ?, ?)"
  );
  const insertRunbookStep = db.prepare(
    "INSERT INTO deployment_runbook_step (runbook_id, step, is_rollback) VALUES (?, ?, ?)"
  );
  for (const rb of data.runbooks ?? []) {
    const rbResult = insertRunbook.run(manifest_id, rb.name, rb.scenario);
    const runbook_id = rbResult.lastInsertRowid;
    for (const s of rb.steps ?? []) {
      insertRunbookStep.run(runbook_id, s.step, s.is_rollback ? 1 : 0);
    }
  }

  // -- deployment_review_checklist (1:N) --
  const insertChecklist = db.prepare(
    "INSERT INTO deployment_review_checklist (manifest_id, check_name, passed) VALUES (?, ?, ?)"
  );
  for (const item of data.review_checklist ?? []) {
    insertChecklist.run(manifest_id, item.check_name, item.passed ? 1 : 0);
  }

  return { entity_type: "deployment_manifest", id: manifest_id };
}

function insertDesignSystem(db, iteration_id, revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  const now = new Date().toISOString();
  let lastId;
  const insert = db.prepare(
    `INSERT INTO design_system (iteration_id, revision_id, category, key, value, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const entry of entries) {
    const result = insert.run(
      iteration_id,
      revision_id,
      entry.category,
      entry.key,
      entry.value,
      now
    );
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "design_system", id: lastId };
}

function insertAccessibilityConfig(db, iteration_id, revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  const now = new Date().toISOString();
  let lastId;
  const insert = db.prepare(
    `INSERT INTO accessibility_config (iteration_id, revision_id, category, key, value, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const entry of entries) {
    const result = insert.run(
      iteration_id,
      revision_id,
      entry.category,
      entry.key,
      entry.value,
      now
    );
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "accessibility_config", id: lastId };
}

function insertResponsiveConfig(db, iteration_id, revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  const now = new Date().toISOString();
  let lastId;
  const insert = db.prepare(
    `INSERT INTO responsive_config (iteration_id, revision_id, category, key, value, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const entry of entries) {
    const result = insert.run(
      iteration_id,
      revision_id,
      entry.category,
      entry.key,
      entry.value,
      now
    );
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "responsive_config", id: lastId };
}

function insertFeedbackPattern(db, iteration_id, revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  const now = new Date().toISOString();
  let lastId;
  const insert = db.prepare(
    `INSERT INTO feedback_pattern (iteration_id, revision_id, category, key, value, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const entry of entries) {
    const result = insert.run(
      iteration_id,
      revision_id,
      entry.category,
      entry.key,
      entry.value,
      now
    );
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "feedback_pattern", id: lastId };
}

function insertInfoArchitecture(db, iteration_id, revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  const now = new Date().toISOString();
  let lastId;
  const insert = db.prepare(
    `INSERT INTO info_architecture (iteration_id, revision_id, category, key, value, parent_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  for (const entry of entries) {
    const result = insert.run(
      iteration_id,
      revision_id,
      entry.category,
      entry.key,
      entry.value,
      entry.parent_id ?? null,
      now
    );
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "info_architecture", id: lastId };
}

function insertPersonaAddressed(db, iteration_id, revision_id, data) {
  const result = db.prepare(
    `INSERT INTO persona_addressed (iteration_id, revision_id, persona_id, goal, how_addressed)
     VALUES (?, ?, ?, ?, ?)`
  ).run(
    iteration_id,
    revision_id,
    data.persona_id,
    data.goal,
    data.how_addressed
  );
  const persona_addressed_id = result.lastInsertRowid;

  const insertFlow = db.prepare(
    "INSERT INTO persona_addressed_flow (persona_addressed_id, flow_id) VALUES (?, ?)"
  );
  for (const flow_id of data.flows ?? []) {
    insertFlow.run(persona_addressed_id, flow_id);
  }

  return { entity_type: "persona_addressed", id: persona_addressed_id };
}

function insertUxAsset(db, iteration_id, revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  const now = new Date().toISOString();
  let lastId;
  const insert = db.prepare(
    `INSERT INTO ux_asset (iteration_id, revision_id, name, path, type, screen_id, description, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const entry of entries) {
    const result = insert.run(
      iteration_id,
      revision_id,
      entry.name,
      entry.path,
      entry.type,
      entry.screen_id ?? null,
      entry.description ?? null,
      now
    );
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "ux_asset", id: lastId };
}

function insertUxRequirementMapping(db, iteration_id, revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  let lastId;
  const insert = db.prepare(
    `INSERT INTO ux_requirement_mapping (iteration_id, revision_id, requirement_id, addressed_by, notes)
     VALUES (?, ?, ?, ?, ?)`
  );
  for (const entry of entries) {
    const result = insert.run(
      iteration_id,
      revision_id,
      entry.requirement_id,
      entry.addressed_by,
      entry.notes ?? null
    );
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "ux_requirement_mapping", id: lastId };
}

// ---------------------------------------------------------------------------

function changelogInsert(args) {
  const db = getDb();
  const { entity_type, iteration_id, revision_id, data } = args;

  const handlers = {
    persona: insertPersona,
    requirement: insertRequirement,
    adr: insertAdr,
    component: insertComponent,
    technology_choice: insertTechnologyChoice,
    architecture_overview: insertArchitectureOverview,
    data_entity: insertDataEntity,
    traceability_mapping: insertTraceabilityMapping,
    architecture_config: insertArchitectureConfig,
    approved_dependency: insertApprovedDependency,
    user_flow: insertUserFlow,
    screen: insertScreen,
    design_system: insertDesignSystem,
    accessibility_config: insertAccessibilityConfig,
    responsive_config: insertResponsiveConfig,
    feedback_pattern: insertFeedbackPattern,
    info_architecture: insertInfoArchitecture,
    persona_addressed: insertPersonaAddressed,
    ux_asset: insertUxAsset,
    ux_requirement_mapping: insertUxRequirementMapping,
    plan_phase: insertPlanPhase,
    plan_overview: insertPlanOverview,
    plan_requirement_mapping: insertPlanRequirementMapping,
    plan_external_dependency: insertPlanExternalDependency,
    plan_critical_path: insertPlanCriticalPath,
    plan_metadata: insertPlanMetadata,
    implementation_manifest: insertImplementationManifest,
    project_context: insertProjectContext,
    system_input: insertSystemInput,
    system_output: insertSystemOutput,
    deployment_requirement: insertDeploymentRequirement,
    operational_requirement: insertOperationalRequirement,
    technology_constraint: insertTechnologyConstraint,
    vcs_commit: insertVcsCommit,
    intermediate_asset: insertIntermediateAsset,
    asset_deliverable: insertAssetDeliverable,
    blocker: insertWorkflowBlocker,
    project_lesson: insertProjectLesson,
    security_audit_finding: insertSecurityAuditFinding,
    performance_audit_finding: insertPerformanceAuditFinding,
    test_report: insertTestReport,
    documentation_manifest: insertDocumentationManifest,
    deployment_manifest: insertDeploymentManifest,
  };

  const handler = handlers[entity_type];
  if (!handler) {
    throw new Error(`Unsupported entity_type: ${entity_type}`);
  }

  const run = db.transaction(() => handler(db, iteration_id, revision_id, data));
  return run();
}

function commitLink(args) {
  const db = getDb();
  const { iteration_id, phase_id, commit_sha, message } = args;
  const now = new Date().toISOString();

  const result = db
    .prepare(
      `INSERT INTO vcs_commit (iteration_id, phase_id, commit_sha, message, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(iteration_id, phase_id ?? null, commit_sha, message ?? null, now);

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

// ---------------------------------------------------------------------------
// Tool definitions (MCP inputSchema)
// ---------------------------------------------------------------------------

export const WRITE_TOOLS = [
  {
    name: "iteration_create",
    description:
      "Creates a new iteration. If the project doesn't exist, creates it. Creates all 9 phase records and sets requirements to in_progress. Returns the new iteration_id (auto-incremented).",
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
    name: "plan_phase_transition",
    description: "Transitions an implementation plan sub-phase's status (pending → test_writing → implementing → completed). Used during the implementation phase to track progress through each sub-phase.",
    inputSchema: {
      type: "object",
      properties: {
        plan_phase_id: { type: "integer", description: "The plan_phase row ID" },
        status: { type: "string", enum: ["pending", "test_writing", "implementing", "completed"] },
      },
      required: ["plan_phase_id", "status"],
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
          enum: [
            "persona",
            "requirement",
            "adr",
            "component",
            "technology_choice",
            "architecture_overview",
            "data_entity",
            "architecture_config",
            "approved_dependency",
            "traceability_mapping",
            "user_flow",
            "screen",
            "design_system",
            "accessibility_config",
            "responsive_config",
            "feedback_pattern",
            "info_architecture",
            "persona_addressed",
            "ux_asset",
            "ux_requirement_mapping",
            "plan_phase",
            "plan_overview",
            "plan_requirement_mapping",
            "plan_external_dependency",
            "plan_critical_path",
            "plan_metadata",
            "implementation_manifest",
            "test_report",
            "documentation_manifest",
            "deployment_manifest",
            "vcs_commit",
            "intermediate_asset",
            "asset_deliverable",
            "project_context",
            "system_input",
            "system_output",
            "deployment_requirement",
            "operational_requirement",
            "technology_constraint",
            "blocker",
            "project_lesson",
            "security_audit_finding",
            "performance_audit_finding",
          ],
        },
        iteration_id: { type: "integer" },
        revision_id: { type: "integer" },
        data: { type: "object", description: "Entity-specific fields" },
      },
      required: ["entity_type", "iteration_id", "data"],
    },
  },
  {
    name: "commit_link",
    description: "Links a VCS commit to an iteration and optionally a phase.",
    inputSchema: {
      type: "object",
      properties: {
        iteration_id: { type: "integer" },
        phase_id: { type: "integer" },
        commit_sha: { type: "string" },
        message: { type: "string" },
      },
      required: ["iteration_id", "commit_sha"],
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
    case "plan_phase_transition":
      return planPhaseTransition(args);
    case "revision_create":
      return revisionCreate(args);
    case "revision_update":
      return revisionUpdate(args);
    case "changelog_insert":
      return changelogInsert(args);
    case "commit_link":
      return commitLink(args);
    case "project_update":
      return projectUpdate(args);
    case "blocker_resolve":
      return blockerResolve(args);
    default:
      throw new Error(`Unknown write tool: ${name}`);
  }
}
