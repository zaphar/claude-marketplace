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
  const { workflow_id, iteration_number, project_name, critic_model } = args;
  const now = new Date().toISOString();

  const run = db.transaction(() => {
    // Ensure workflow exists
    const existing = db
      .prepare("SELECT id FROM workflow WHERE id = ?")
      .get(workflow_id);

    if (!existing) {
      db.prepare(
        `INSERT INTO workflow (id, project_name, created_at, updated_at, status, critic_model, notes)
         VALUES (?, ?, ?, ?, 'active', ?, '')`
      ).run(workflow_id, project_name || workflow_id, now, now, critic_model || "sonnet");
    }

    // Create iteration
    const iterResult = db
      .prepare(
        `INSERT INTO iteration (workflow_id, iteration_number, status, started_at, notes)
         VALUES (?, ?, 'active', ?, '')`
      )
      .run(workflow_id, iteration_number, now);

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

    return { iteration_id, workflow_id, iteration_number };
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
    current_sub_phase,
    current_step,
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
  if (current_sub_phase !== undefined) {
    sets.push("current_sub_phase = @current_sub_phase");
    params.current_sub_phase = current_sub_phase;
  }
  if (current_step !== undefined) {
    sets.push("current_step = @current_step");
    params.current_step = current_step;
  }

  db.prepare(
    `UPDATE phase SET ${sets.join(", ")} WHERE iteration_id = @iteration_id AND name = @phase_name`
  ).run(params);

  const row = db
    .prepare("SELECT id, name, status FROM phase WHERE iteration_id = ? AND name = ?")
    .get(iteration_id, phase_name);

  return { phase_id: row.id, name: row.name, status: row.status };
}

function revisionCreate(args) {
  const db = getDb();
  const { phase_id, producer_agent } = args;
  const now = new Date().toISOString();

  const maxRow = db
    .prepare("SELECT MAX(revision_number) AS max_rev FROM revision WHERE phase_id = ?")
    .get(phase_id);
  const revision_number = (maxRow.max_rev ?? 0) + 1;

  const result = db
    .prepare(
      `INSERT INTO revision (phase_id, revision_number, producer_agent, created_at, status)
       VALUES (?, ?, ?, ?, 'draft')`
    )
    .run(phase_id, revision_number, producer_agent, now);

  return { revision_id: result.lastInsertRowid, revision_number, phase_id };
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

function insertPersona(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO persona (id, iteration_id, revision_id, name, description, technical_level, frequency_of_use, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.id,
    iteration_id,
    revision_id ?? null,
    data.name,
    data.description,
    data.technical_level ?? null,
    data.frequency_of_use ?? null,
    now
  );

  const insertGoal = db.prepare(
    "INSERT INTO persona_goal (persona_id, goal) VALUES (?, ?)"
  );
  for (const goal of data.goals ?? []) {
    insertGoal.run(data.id, goal);
  }

  return { entity_type: "persona", id: data.id };
}

function insertRequirement(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO requirement (id, iteration_id, revision_id, description, rationale, priority, category, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.id,
    iteration_id,
    revision_id ?? null,
    data.description,
    data.rationale ?? null,
    data.priority,
    data.category,
    now
  );

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

  return { entity_type: "requirement", id: data.id };
}

function insertAdr(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO adr (id, iteration_id, revision_id, title, status, date, context, decision, rationale, superseded_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    now
  );

  const insertAlt = db.prepare(
    "INSERT INTO adr_alternative (adr_id, option_text) VALUES (?, ?)"
  );
  const insertPro = db.prepare(
    "INSERT INTO adr_alternative_pro (alternative_id, pro) VALUES (?, ?)"
  );
  const insertCon = db.prepare(
    "INSERT INTO adr_alternative_con (alternative_id, con) VALUES (?, ?)"
  );
  for (const alt of data.alternatives_considered ?? []) {
    const altResult = insertAlt.run(data.id, alt.option_text ?? alt.option ?? alt);
    for (const pro of alt.pros ?? []) {
      insertPro.run(altResult.lastInsertRowid, pro);
    }
    for (const con of alt.cons ?? []) {
      insertCon.run(altResult.lastInsertRowid, con);
    }
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

  return { entity_type: "adr", id: data.id };
}

function insertComponent(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO component (id, iteration_id, revision_id, name, purpose, type, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.id,
    iteration_id,
    revision_id ?? null,
    data.name,
    data.purpose,
    data.type,
    now
  );

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

  return { entity_type: "component", id: data.id };
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

function insertUserFlow(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO user_flow (id, iteration_id, revision_id, name, goal, persona_id, entry_point, success_state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.id,
    iteration_id,
    revision_id ?? null,
    data.name,
    data.goal,
    data.persona_id ?? null,
    data.entry_point ?? null,
    data.success_state ?? null,
    now
  );

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

  return { entity_type: "user_flow", id: data.id };
}

function insertScreen(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO screen (id, iteration_id, revision_id, name, purpose, wireframe_path, mockup_path, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    data.id,
    iteration_id,
    revision_id ?? null,
    data.name,
    data.purpose,
    data.wireframe_path ?? null,
    data.mockup_path ?? null,
    now
  );

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

  return { entity_type: "screen", id: data.id };
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

  return { entity_type: "implementation_manifest", id: manifest_id };
}

function insertIterationMetadata(db, iteration_id, _revision_id, data) {
  // data may be a single entry or an array of entries
  const entries = Array.isArray(data) ? data : [data];
  let lastId;
  const insert = db.prepare(
    `INSERT OR REPLACE INTO iteration_metadata (iteration_id, key, value, category) VALUES (?, ?, ?, ?)`
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
  return { entity_type: "iteration_metadata", id: lastId };
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
    traceability_mapping: insertTraceabilityMapping,
    user_flow: insertUserFlow,
    screen: insertScreen,
    plan_phase: insertPlanPhase,
    plan_overview: insertPlanOverview,
    plan_requirement_mapping: insertPlanRequirementMapping,
    implementation_manifest: insertImplementationManifest,
    iteration_metadata: insertIterationMetadata,
    vcs_commit: insertVcsCommit,
    intermediate_asset: insertIntermediateAsset,
    asset_deliverable: insertAssetDeliverable,
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

function workflowUpdate(args) {
  const db = getDb();
  const { workflow_id, status, closed_at, notes, critic_model } = args;
  const now = new Date().toISOString();

  const sets = ["updated_at = @now"];
  const params = { workflow_id, now };

  if (status !== undefined) { sets.push("status = @status"); params.status = status; }
  if (closed_at !== undefined) { sets.push("closed_at = @closed_at"); params.closed_at = closed_at; }
  if (notes !== undefined) { sets.push("notes = @notes"); params.notes = notes; }
  if (critic_model !== undefined) { sets.push("critic_model = @critic_model"); params.critic_model = critic_model; }

  db.prepare(
    `UPDATE workflow SET ${sets.join(", ")} WHERE id = @workflow_id`
  ).run(params);

  const row = db.prepare("SELECT id, status FROM workflow WHERE id = ?").get(workflow_id);
  return { workflow_id: row.id, status: row.status };
}

// ---------------------------------------------------------------------------
// Tool definitions (MCP inputSchema)
// ---------------------------------------------------------------------------

export const WRITE_TOOLS = [
  {
    name: "iteration_create",
    description:
      "Creates a new iteration within a workflow. If the workflow doesn't exist, creates it. Creates all 9 phase records and sets requirements to in_progress.",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: { type: "string", description: "Workflow identifier (TEXT primary key)" },
        iteration_number: { type: "integer", description: "Iteration number within the workflow" },
        project_name: { type: "string", description: "Project name (used if workflow must be created)" },
        critic_model: { type: "string", description: "Critic model name (default: sonnet)" },
      },
      required: ["workflow_id", "iteration_number"],
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
        current_sub_phase: { type: "integer" },
        current_step: { type: "string", enum: ["test_writing", "implementation"] },
      },
      required: ["iteration_id", "phase_name", "status"],
    },
  },
  {
    name: "revision_create",
    description:
      "Starts a new producer-critic revision within a phase. Auto-increments revision_number.",
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
            "security_config",
            "deployment_config",
            "observability_config",
            "approved_dependency",
            "traceability_mapping",
            "user_flow",
            "screen",
            "design_system",
            "accessibility_config",
            "plan_phase",
            "plan_overview",
            "plan_requirement_mapping",
            "implementation_manifest",
            "test_report",
            "documentation_manifest",
            "deployment_manifest",
            "vcs_commit",
            "intermediate_asset",
            "asset_deliverable",
            "iteration_metadata",
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
    name: "workflow_update",
    description: "Updates workflow-level fields (status, notes, critic_model, closed_at).",
    inputSchema: {
      type: "object",
      properties: {
        workflow_id: { type: "string" },
        status: { type: "string", enum: ["active", "closed"] },
        closed_at: { type: "string" },
        notes: { type: "string" },
        critic_model: { type: "string" },
      },
      required: ["workflow_id"],
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
    case "revision_create":
      return revisionCreate(args);
    case "revision_update":
      return revisionUpdate(args);
    case "changelog_insert":
      return changelogInsert(args);
    case "commit_link":
      return commitLink(args);
    case "workflow_update":
      return workflowUpdate(args);
    default:
      throw new Error(`Unknown write tool: ${name}`);
  }
}
