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

    // Create all 9 phase records
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
    .prepare("SELECT id, name, status FROM phase WHERE iteration_id = @iteration_id AND name = @phase_name")
    .get({ iteration_id, phase_name });
  if (!row) throw new Error(`Phase "${phase_name}" not found in iteration ${iteration_id}`);

  return { phase_id: row.id, name: row.name, status: row.status };
}

function planPhaseTransition(args) {
  const db = getDb();
  const { plan_phase_id, status } = args;

  const row = db.prepare("SELECT id, phase_number, name, status FROM plan_phase WHERE id = @plan_phase_id").get({ plan_phase_id });
  if (!row) throw new Error(`Plan phase ${plan_phase_id} not found`);

  db.prepare(
    "UPDATE plan_phase SET status = @status WHERE id = @plan_phase_id"
  ).run({ status, plan_phase_id });

  return { plan_phase_id: row.id, phase_number: row.phase_number, name: row.name, status };
}

function revisionCreate(args) {
  const db = getDb();
  const { phase_id, producer_agent } = args;
  const now = new Date().toISOString();

  const run = db.transaction(() => {
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
function snapshotIfExists(db, table, entityType, entityId, newRevisionId) {
  const existing = db.prepare(`SELECT * FROM ${table} WHERE id = @id`).get({ id: entityId });
  if (existing) {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO entity_snapshot (entity_type, source_id, revision_id, snapshot, created_at)
       VALUES (@entity_type, @source_id, @revision_id, @snapshot, @created_at)`
    ).run({ entity_type: entityType, source_id: entityId, revision_id: newRevisionId, snapshot: JSON.stringify(existing), created_at: now });
  }
  return existing;
}

function insertPersona(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const existed = snapshotIfExists(db, "persona", "persona", data.id, revision_id);

  db.prepare(
    `INSERT INTO persona (id, revision_id, name, description, technical_level, frequency_of_use, goals, created_at)
     VALUES (@id, @revision_id, @name, @description, @technical_level, @frequency_of_use, @goals, @created_at)
     ON CONFLICT(id) DO UPDATE SET
       revision_id = excluded.revision_id,
       name = excluded.name,
       description = excluded.description,
       technical_level = excluded.technical_level,
       frequency_of_use = excluded.frequency_of_use,
       goals = excluded.goals,
       updated_at = @updated_at`
  ).run({
    id: data.id,
    revision_id,
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
  const existed = snapshotIfExists(db, "requirement", "requirement", data.id, revision_id);

  db.prepare(
    `INSERT INTO requirement (id, revision_id, description, rationale, priority, category, acceptance_criteria, created_at)
     VALUES (@id, @revision_id, @description, @rationale, @priority, @category, @acceptance_criteria, @created_at)
     ON CONFLICT(id) DO UPDATE SET
       revision_id = excluded.revision_id,
       description = excluded.description,
       rationale = excluded.rationale,
       priority = excluded.priority,
       category = excluded.category,
       acceptance_criteria = excluded.acceptance_criteria,
       updated_at = @updated_at`
  ).run({
    id: data.id,
    revision_id,
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
  const existed = snapshotIfExists(db, "adr", "adr", data.id, revision_id);

  db.prepare(
    `INSERT INTO adr (id, revision_id, title, status, date, context, decision, rationale, superseded_by, consequences, research_sources, created_at)
     VALUES (@id, @revision_id, @title, @status, @date, @context, @decision, @rationale, @superseded_by, @consequences, @research_sources, @created_at)
     ON CONFLICT(id) DO UPDATE SET
       revision_id = excluded.revision_id,
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
    revision_id,
    title: data.title,
    status: data.status ?? "proposed",
    date: data.date ?? null,
    context: data.context ?? null,
    decision: data.decision,
    rationale: data.rationale,
    superseded_by: data.superseded_by ?? null,
    consequences: JSON.stringify(data.consequences ?? []),
    research_sources: JSON.stringify(data.research_sources ?? []),
    created_at: now,
    updated_at: now
  });

  if (existed) {
    // Delete child rows
    db.prepare("DELETE FROM adr_alternative WHERE adr_id = @adr_id").run({ adr_id: data.id });
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

function insertComponent(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const existed = snapshotIfExists(db, "component", "component", data.id, revision_id);

  db.prepare(
    `INSERT INTO component (id, revision_id, name, purpose, component_type, created_at)
     VALUES (@id, @revision_id, @name, @purpose, @component_type, @created_at)
     ON CONFLICT(id) DO UPDATE SET
       revision_id = excluded.revision_id,
       name = excluded.name,
       purpose = excluded.purpose,
       component_type = excluded.component_type,
       updated_at = @updated_at`
  ).run({
    id: data.id,
    revision_id,
    name: data.name,
    purpose: data.purpose,
    component_type: data.type,
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
    insertIface.run({ component_id: data.id, name: iface.name, interface_type: iface.type, description: iface.description ?? null });
  }

  const insertDep = db.prepare(
    "INSERT OR IGNORE INTO component_dependency (component_id, depends_on) VALUES (@component_id, @depends_on)"
  );
  for (const dep of data.dependencies ?? []) {
    insertDep.run({ component_id: data.id, depends_on: dep });
  }

  const insertReq = db.prepare(
    "INSERT OR IGNORE INTO requirement_trace (revision_id, requirement_id, addressed_by, addressed_by_type) VALUES (@revision_id, @requirement_id, @addressed_by, 'component')"
  );
  for (const req_id of data.requirements_addressed ?? []) {
    insertReq.run({ revision_id, requirement_id: req_id, addressed_by: data.id });
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

function insertArchitectureOverview(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO architecture_overview (revision_id, description, principles, created_at)
       VALUES (@revision_id, @description, @principles, @created_at)`
    )
    .run({
      revision_id,
      description: data.description,
      principles: JSON.stringify(data.principles ?? []),
      created_at: now
    });

  const overviewId = result.lastInsertRowid;

  const insertDiagram = db.prepare(
    "INSERT INTO architecture_diagram (overview_id, name, path, description) VALUES (@overview_id, @name, @path, @description)"
  );
  for (const d of data.diagrams ?? []) {
    insertDiagram.run({ overview_id: overviewId, name: d.name, path: d.path, description: d.description ?? null });
  }

  return { entity_type: "architecture_overview", id: overviewId };
}

function insertDataEntity(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO data_entity (revision_id, name, description, created_at)
       VALUES (@revision_id, @name, @description, @created_at)`
    )
    .run({
      revision_id,
      name: data.name,
      description: data.description,
      created_at: now
    });

  const entityId = result.lastInsertRowid;

  const insertAttr = db.prepare(
    "INSERT INTO data_entity_attribute (entity_id, name, data_type, is_required, description) VALUES (@entity_id, @name, @data_type, @is_required, @description)"
  );
  for (const a of data.attributes ?? []) {
    insertAttr.run({ entity_id: entityId, name: a.name, data_type: a.data_type, is_required: a.is_required ?? 0, description: a.description ?? null });
  }

  // Resolve and insert relationships.
  // target_entity (name string) is looked up in data_entity within the same iteration.
  const insertRel = db.prepare(
    "INSERT INTO data_entity_relationship (entity_id, target_entity_id, cardinality, description) VALUES (@entity_id, @target_entity_id, @cardinality, @description)"
  );
  const lookupTarget = db.prepare(
    `SELECT id FROM data_entity WHERE name = @target_name AND revision_id IN
       (SELECT revision_id FROM entity_context WHERE iteration_id = @iteration_id)
     ORDER BY id DESC LIMIT 1`
  );
  for (const r of data.relationships ?? []) {
    const targetRow = lookupTarget.get({ target_name: r.target_entity, iteration_id });
    if (!targetRow) {
      throw new Error(
        `Cannot resolve target_entity "${r.target_entity}" — no data_entity with that name exists in iteration ${iteration_id}. Insert the target entity first, then insert this entity's relationships.`
      );
    }
    insertRel.run({ entity_id: entityId, target_entity_id: targetRow.id, cardinality: r.cardinality ?? r.relationship_type ?? null, description: r.description ?? null });
  }

  return { entity_type: "data_entity", id: entityId };
}

function insertTechnologyChoice(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO technology_choice (revision_id, category, name, purpose, rationale, version, config, created_at)
       VALUES (@revision_id, @category, @name, @purpose, @rationale, @version, @config, @created_at)`
    )
    .run({
      revision_id,
      category: data.category,
      name: data.name,
      purpose: data.purpose ?? null,
      rationale: data.rationale ?? null,
      version: data.version ?? null,
      config: data.config ?? null,
      created_at: now
    });
  return { entity_type: "technology_choice", id: result.lastInsertRowid };
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
  const iterClause = "revision_id IN (SELECT revision_id FROM entity_context WHERE iteration_id = @iteration_id)";
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
      `INSERT INTO requirement_trace (revision_id, requirement_id, addressed_by, addressed_by_type, notes, created_at)
       VALUES (@revision_id, @requirement_id, @addressed_by, @addressed_by_type, @notes, @created_at)`
    )
    .run({
      revision_id,
      requirement_id: data.requirement_id,
      addressed_by: data.addressed_by,
      addressed_by_type: data.addressed_by_type,
      notes: data.notes ?? null,
      created_at: now
    });
  return { entity_type: "requirement_trace", id: result.lastInsertRowid };
}

function insertArchitectureConfig(db, iteration_id, revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  const now = new Date().toISOString();
  let lastId;
  const insert = db.prepare(
    `INSERT INTO architecture_config (revision_id, config_type, target, category, key, value, created_at)
     VALUES (@revision_id, @config_type, @target, @category, @key, @value, @created_at)`
  );
  for (const entry of entries) {
    const result = insert.run({
      revision_id,
      config_type: entry.config_type,
      target: entry.target ?? null,
      category: entry.category,
      key: entry.key,
      value: entry.value,
      created_at: now
    });
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
       (revision_id, package, version_constraint, purpose, justification, adr_id, license, maintenance_activity, community_adoption, transitive_deps, single_maintainer_risk, created_at)
     VALUES (@revision_id, @package, @version_constraint, @purpose, @justification, @adr_id, @license, @maintenance_activity, @community_adoption, @transitive_deps, @single_maintainer_risk, @created_at)`
  );
  for (const entry of entries) {
    const result = insert.run({
      revision_id,
      package: entry.package,
      version_constraint: entry.version_constraint ?? null,
      purpose: entry.purpose,
      justification: entry.justification,
      adr_id: entry.adr_id ?? null,
      license: entry.license ?? null,
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
  const existed = snapshotIfExists(db, "user_flow", "user_flow", data.id, revision_id);

  db.prepare(
    `INSERT INTO user_flow (id, revision_id, name, goal, persona_id, entry_point, success_state, data_dependencies, created_at)
     VALUES (@id, @revision_id, @name, @goal, @persona_id, @entry_point, @success_state, @data_dependencies, @created_at)
     ON CONFLICT(id) DO UPDATE SET
       revision_id = excluded.revision_id,
       name = excluded.name,
       goal = excluded.goal,
       persona_id = excluded.persona_id,
       entry_point = excluded.entry_point,
       success_state = excluded.success_state,
       data_dependencies = excluded.data_dependencies,
       updated_at = @updated_at`
  ).run({
    id: data.id,
    revision_id,
    name: data.name,
    goal: data.goal,
    persona_id: data.persona_id ?? null,
    entry_point: data.entry_point ?? null,
    success_state: data.success_state ?? null,
    data_dependencies: JSON.stringify(data.data_dependencies ?? []),
    created_at: now,
    updated_at: now
  });

  if (existed) {
    // Delete steps and their branches
    const stepIds = db.prepare("SELECT id FROM user_flow_step WHERE flow_id = @flow_id").all({ flow_id: data.id });
    for (const step of stepIds) {
      db.prepare("DELETE FROM user_flow_step_branch WHERE step_id = @step_id").run({ step_id: step.id });
    }
    db.prepare("DELETE FROM user_flow_step WHERE flow_id = @flow_id").run({ flow_id: data.id });
    db.prepare("DELETE FROM user_flow_error_state WHERE flow_id = @flow_id").run({ flow_id: data.id });
    db.prepare("DELETE FROM requirement_trace WHERE addressed_by = @addressed_by AND addressed_by_type = 'flow'").run({ addressed_by: data.id });
  }

  const insertStep = db.prepare(
    `INSERT INTO user_flow_step (flow_id, step_number, action, surface, is_decision_point)
     VALUES (@flow_id, @step_number, @action, @surface, @is_decision_point)`
  );
  const insertBranch = db.prepare(
    "INSERT INTO user_flow_step_branch (step_id, condition, next_step) VALUES (@step_id, @condition, @next_step)"
  );
  for (const step of data.steps ?? []) {
    const stepResult = insertStep.run({
      flow_id: data.id,
      step_number: step.step_number,
      action: step.action,
      surface: step.surface ?? null,
      is_decision_point: step.is_decision_point ? 1 : 0
    });
    for (const branch of step.branches ?? []) {
      insertBranch.run({ step_id: stepResult.lastInsertRowid, condition: branch.condition, next_step: branch.next_step });
    }
  }

  const insertError = db.prepare(
    "INSERT INTO user_flow_error_state (flow_id, condition, recovery) VALUES (@flow_id, @condition, @recovery)"
  );
  for (const err of data.error_states ?? []) {
    insertError.run({ flow_id: data.id, condition: err.condition, recovery: err.recovery });
  }

  const insertReq = db.prepare(
    "INSERT OR IGNORE INTO requirement_trace (revision_id, requirement_id, addressed_by, addressed_by_type) VALUES (@revision_id, @requirement_id, @addressed_by, 'flow')"
  );
  for (const req_id of data.requirements_addressed ?? []) {
    insertReq.run({ revision_id, requirement_id: req_id, addressed_by: data.id });
  }

  return { entity_type: "user_flow", id: data.id, updated: !!existed };
}

function insertScreen(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const existed = snapshotIfExists(db, "screen", "screen", data.id, revision_id);

  db.prepare(
    `INSERT INTO screen (id, revision_id, name, purpose, wireframe_path, mockup_path, components, created_at)
     VALUES (@id, @revision_id, @name, @purpose, @wireframe_path, @mockup_path, @components, @created_at)
     ON CONFLICT(id) DO UPDATE SET
       revision_id = excluded.revision_id,
       name = excluded.name,
       purpose = excluded.purpose,
       wireframe_path = excluded.wireframe_path,
       mockup_path = excluded.mockup_path,
       components = excluded.components,
       updated_at = @updated_at`
  ).run({
    id: data.id,
    revision_id,
    name: data.name,
    purpose: data.purpose,
    wireframe_path: data.wireframe_path ?? null,
    mockup_path: data.mockup_path ?? null,
    components: JSON.stringify((data.components ?? []).map(comp => typeof comp === "string" ? comp : comp.component_name ?? comp.name)),
    created_at: now,
    updated_at: now
  });

  if (existed) {
    db.prepare("DELETE FROM screen_state WHERE screen_id = @screen_id").run({ screen_id: data.id });
    db.prepare("DELETE FROM screen_responsive_variant WHERE screen_id = @screen_id").run({ screen_id: data.id });
  }

  const insertState = db.prepare(
    "INSERT INTO screen_state (screen_id, name, description, wireframe_path) VALUES (@screen_id, @name, @description, @wireframe_path)"
  );
  for (const state of data.states ?? []) {
    insertState.run({ screen_id: data.id, name: state.name, description: state.description ?? null, wireframe_path: state.wireframe_path ?? null });
  }

  const insertVariant = db.prepare(
    "INSERT INTO screen_responsive_variant (screen_id, breakpoint, wireframe_path, layout_changes) VALUES (@screen_id, @breakpoint, @wireframe_path, @layout_changes)"
  );
  for (const variant of data.responsive_variants ?? []) {
    insertVariant.run({
      screen_id: data.id,
      breakpoint: variant.breakpoint,
      wireframe_path: variant.wireframe_path ?? null,
      layout_changes: variant.layout_changes ?? null
    });
  }

  return { entity_type: "screen", id: data.id, updated: !!existed };
}

function insertPlanPhase(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO plan_phase (revision_id, phase_number, name, phase_type, goal, complexity, review_checkpoint, notes, entry_criteria, exit_criteria, checkpoint_focus, critical_path_sequence, created_at)
       VALUES (@revision_id, @phase_number, @name, @phase_type, @goal, @complexity, @review_checkpoint, @notes, @entry_criteria, @exit_criteria, @checkpoint_focus, @critical_path_sequence, @created_at)`
    )
    .run({
      revision_id,
      phase_number: data.phase_number,
      name: data.name,
      phase_type: data.type,
      goal: data.goal,
      complexity: data.complexity ?? null,
      review_checkpoint: data.review_checkpoint ? 1 : 0,
      notes: data.notes ?? null,
      entry_criteria: JSON.stringify(data.entry_criteria ?? []),
      exit_criteria: JSON.stringify(data.exit_criteria ?? []),
      checkpoint_focus: JSON.stringify(data.checkpoint_focus ?? []),
      critical_path_sequence: data.critical_path_sequence ?? null,
      created_at: now
    });
  const plan_phase_id = result.lastInsertRowid;

  const insertReq = db.prepare(
    "INSERT OR IGNORE INTO plan_phase_requirement (plan_phase_id, requirement_id, priority, notes) VALUES (@plan_phase_id, @requirement_id, @priority, @notes)"
  );
  for (const req of data.requirements ?? []) {
    if (typeof req === "string") {
      insertReq.run({ plan_phase_id, requirement_id: req, priority: null, notes: null });
    } else {
      insertReq.run({ plan_phase_id, requirement_id: req.requirement_id, priority: req.priority ?? null, notes: req.notes ?? null });
    }
  }

  const insertComp = db.prepare(
    "INSERT OR IGNORE INTO plan_phase_component (plan_phase_id, component_id) VALUES (@plan_phase_id, @component_id)"
  );
  for (const comp_id of data.components ?? []) {
    insertComp.run({ plan_phase_id, component_id: comp_id });
  }

  const insertFlow = db.prepare(
    "INSERT OR IGNORE INTO plan_phase_flow (plan_phase_id, flow_id) VALUES (@plan_phase_id, @flow_id)"
  );
  for (const flow_id of data.flows ?? []) {
    insertFlow.run({ plan_phase_id, flow_id });
  }

  const insertScreenLink = db.prepare(
    "INSERT OR IGNORE INTO plan_phase_screen (plan_phase_id, screen_id) VALUES (@plan_phase_id, @screen_id)"
  );
  for (const screen_id of data.screens ?? []) {
    insertScreenLink.run({ plan_phase_id, screen_id });
  }

  const insertEndpoint = db.prepare(
    "INSERT INTO plan_phase_api_endpoint (plan_phase_id, http_method, route, description) VALUES (@plan_phase_id, @http_method, @route, @description)"
  );
  for (const ep of data.api_endpoints ?? []) {
    insertEndpoint.run({ plan_phase_id, http_method: ep.http_method, route: ep.route, description: ep.description ?? null });
  }

  const insertDbChange = db.prepare(
    "INSERT INTO plan_phase_db_change (plan_phase_id, migration_name, description, tables) VALUES (@plan_phase_id, @migration_name, @description, @tables)"
  );
  for (const change of data.db_changes ?? []) {
    insertDbChange.run({ plan_phase_id, migration_name: change.migration_name, description: change.description ?? null, tables: JSON.stringify(change.tables ?? []) });
  }

  const insertDep = db.prepare(
    "INSERT OR IGNORE INTO plan_phase_relationship (plan_phase_id, related_phase_id, dependency_type, reason) VALUES (@plan_phase_id, @related_phase_id, 'dependency', @reason)"
  );
  for (const dep of data.dependencies ?? []) {
    const depPhase = typeof dep === "object" ? dep.depends_on_phase_id ?? dep.phase : dep;
    const reason = typeof dep === "object" ? dep.reason ?? null : null;
    insertDep.run({ plan_phase_id, related_phase_id: depPhase, reason });
  }

  const insertRisk = db.prepare(
    "INSERT INTO plan_phase_risk (plan_phase_id, risk, mitigation) VALUES (@plan_phase_id, @risk, @mitigation)"
  );
  for (const risk of data.risks ?? []) {
    insertRisk.run({ plan_phase_id, risk: risk.risk, mitigation: risk.mitigation ?? null });
  }

  const insertParallel = db.prepare(
    "INSERT OR IGNORE INTO plan_phase_relationship (plan_phase_id, related_phase_id, dependency_type) VALUES (@plan_phase_id, @related_phase_id, 'parallel')"
  );
  for (const parallel_id of data.parallel_with ?? []) {
    insertParallel.run({ plan_phase_id, related_phase_id: parallel_id });
  }

  return { entity_type: "plan_phase", id: plan_phase_id };
}

function insertPlanOverview(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO plan_overview (revision_id, strategy, rationale, phase_one_approach, assumptions, created_at)
       VALUES (@revision_id, @strategy, @rationale, @phase_one_approach, @assumptions, @created_at)`
    )
    .run({
      revision_id,
      strategy: data.strategy,
      rationale: data.rationale,
      phase_one_approach: data.phase_one_approach ?? null,
      assumptions: JSON.stringify(data.assumptions ?? []),
      created_at: now
    });
  const plan_overview_id = result.lastInsertRowid;

  const insertRisk = db.prepare(
    "INSERT INTO plan_overview_risk (plan_overview_id, risk, mitigation, plan_phase_id) VALUES (@plan_overview_id, @risk, @mitigation, @plan_phase_id)"
  );
  for (const risk of data.risks ?? []) {
    insertRisk.run({ plan_overview_id, risk: risk.risk, mitigation: risk.mitigation ?? null, plan_phase_id: risk.plan_phase_id ?? null });
  }

  return { entity_type: "plan_overview", id: plan_overview_id };
}

function insertPlanExternalDependency(db, iteration_id, _revision_id, data) {
  const result = db
    .prepare(
      `INSERT INTO plan_external_dependency (iteration_id, name, description, plan_phase_id, risk_level, mitigation)
       VALUES (@iteration_id, @name, @description, @plan_phase_id, @risk_level, @mitigation)`
    )
    .run({
      iteration_id,
      name: data.name,
      description: data.description,
      plan_phase_id: data.plan_phase_id ?? null,
      risk_level: data.risk_level,
      mitigation: data.mitigation ?? null
    });
  return { entity_type: "plan_external_dependency", id: result.lastInsertRowid };
}

function insertPlanMetadata(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO plan_metadata (revision_id, title, version, document_date, document_updated, status, requirements_version, architecture_version, ux_specification_version, created_at)
       VALUES (@revision_id, @title, @version, @document_date, @document_updated, @status, @requirements_version, @architecture_version, @ux_specification_version, @created_at)`
    )
    .run({
      revision_id,
      title: data.title,
      version: data.version,
      document_date: data.document_date,
      document_updated: data.document_updated ?? null,
      status: data.status,
      requirements_version: data.requirements_version,
      architecture_version: data.architecture_version,
      ux_specification_version: data.ux_specification_version,
      created_at: now
    });
  return { entity_type: "plan_metadata", id: result.lastInsertRowid };
}

function insertImplementationManifest(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const meta = Array.isArray(data.metadata) ? data.metadata[0] : data.metadata;
  const result = db
    .prepare(
      `INSERT INTO implementation_manifest
         (revision_id, plan_phase_id, status, lines_of_code, warnings, build_status,
          version, document_date, requirements_version, architecture_version, language, commit_sha,
          created_at)
       VALUES (@revision_id, @plan_phase_id, @status, @lines_of_code, @warnings, @build_status,
               @version, @document_date, @requirements_version, @architecture_version, @language, @commit_sha,
               @created_at)`
    )
    .run({
      revision_id,
      plan_phase_id: data.plan_phase_id,
      status: data.status,
      lines_of_code: data.lines_of_code ?? null,
      warnings: data.warnings ?? 0,
      build_status: data.build_status ?? null,
      version: meta?.version ?? data.version ?? null,
      document_date: meta?.document_date ?? data.document_date ?? null,
      requirements_version: meta?.requirements_version ?? data.requirements_version ?? null,
      architecture_version: meta?.architecture_version ?? data.architecture_version ?? null,
      language: meta?.language ?? data.language ?? null,
      commit_sha: meta?.commit_sha ?? data.commit_sha ?? null,
      created_at: now
    });
  const manifest_id = result.lastInsertRowid;

  const insertFile = db.prepare(
    "INSERT INTO implementation_file (manifest_id, path, file_operation, purpose, component_id) VALUES (@manifest_id, @path, @file_operation, @purpose, @component_id)"
  );
  const insertFileReq = db.prepare(
    "INSERT OR IGNORE INTO implementation_file_requirement (file_id, requirement_id) VALUES (@file_id, @requirement_id)"
  );
  for (const f of data.files ?? []) {
    const fileResult = insertFile.run({
      manifest_id,
      path: f.path,
      file_operation: f.file_operation,
      purpose: f.purpose ?? null,
      component_id: f.component_id ?? null
    });
    for (const req_id of f.requirements ?? []) {
      insertFileReq.run({ file_id: fileResult.lastInsertRowid, requirement_id: req_id });
    }
  }

  const insertReqStatus = db.prepare(
    "INSERT OR REPLACE INTO implementation_requirement_status (manifest_id, requirement_id, status, notes) VALUES (@manifest_id, @requirement_id, @status, @notes)"
  );
  for (const rs of data.requirement_status ?? []) {
    insertReqStatus.run({ manifest_id, requirement_id: rs.requirement_id, status: rs.status, notes: rs.notes ?? null });
  }

  const insertCompStatus = db.prepare(
    "INSERT OR REPLACE INTO implementation_component_status (manifest_id, component_id, status, notes) VALUES (@manifest_id, @component_id, @status, @notes)"
  );
  for (const cs of data.component_status ?? []) {
    insertCompStatus.run({ manifest_id, component_id: cs.component_id, status: cs.status, notes: cs.notes ?? null });
  }

  const insertEndpoint = db.prepare(
    "INSERT INTO implementation_api_endpoint (manifest_id, route, http_method, status) VALUES (@manifest_id, @route, @http_method, @status)"
  );
  const insertEndpointReq = db.prepare(
    "INSERT OR IGNORE INTO implementation_api_endpoint_requirement (endpoint_id, requirement_id) VALUES (@endpoint_id, @requirement_id)"
  );
  for (const ep of data.api_endpoints ?? []) {
    const epResult = insertEndpoint.run({ manifest_id, route: ep.route, http_method: ep.http_method, status: ep.status });
    for (const req_id of ep.requirements ?? []) {
      insertEndpointReq.run({ endpoint_id: epResult.lastInsertRowid, requirement_id: req_id });
    }
  }

  const insertBlocker = db.prepare(
    "INSERT INTO implementation_blocker (manifest_id, description, severity, recommendation, needs_escalation) VALUES (@manifest_id, @description, @severity, @recommendation, @needs_escalation)"
  );
  const insertBlockerReq = db.prepare(
    "INSERT OR IGNORE INTO implementation_blocker_requirement (blocker_id, requirement_id) VALUES (@blocker_id, @requirement_id)"
  );
  for (const blocker of data.blockers ?? []) {
    const blockerResult = insertBlocker.run({
      manifest_id,
      description: blocker.description,
      severity: blocker.severity,
      recommendation: blocker.recommendation ?? null,
      needs_escalation: blocker.needs_escalation ? 1 : 0
    });
    for (const req_id of blocker.requirements ?? []) {
      insertBlockerReq.run({ blocker_id: blockerResult.lastInsertRowid, requirement_id: req_id });
    }
  }

  const insertDepAdded = db.prepare(
    "INSERT INTO implementation_dependency_added (manifest_id, name, version, purpose, license) VALUES (@manifest_id, @name, @version, @purpose, @license)"
  );
  for (const dep of data.dependencies_added ?? []) {
    insertDepAdded.run({ manifest_id, name: dep.name, version: dep.version, purpose: dep.purpose, license: dep.license ?? null });
  }

  const insertDbMigration = db.prepare(
    "INSERT INTO implementation_db_migration (manifest_id, name, description, status) VALUES (@manifest_id, @name, @description, @status)"
  );
  for (const mig of data.db_migrations ?? []) {
    insertDbMigration.run({ manifest_id, name: mig.name, description: mig.description ?? null, status: mig.status });
  }

  const insertChecklistItem = db.prepare(
    "INSERT INTO implementation_review_checklist (manifest_id, check_name, passed) VALUES (@manifest_id, @check_name, @passed)"
  );
  for (const item of data.review_checklist ?? []) {
    insertChecklistItem.run({ manifest_id, check_name: item.check_name, passed: item.passed ? 1 : 0 });
  }

  return { entity_type: "implementation_manifest", id: manifest_id };
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

function insertSystemIo(db, iteration_id, _revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  let lastId;
  const insert = db.prepare(
    `INSERT INTO system_io (iteration_id, direction, name, description, source, destination, data_format) VALUES (@iteration_id, @direction, @name, @description, @source, @destination, @data_format)`
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
  return { entity_type: "system_io", id: lastId };
}

function insertDeploymentRequirement(db, iteration_id, _revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  let lastId;
  const insert = db.prepare(
    `INSERT INTO deployment_requirement (iteration_id, target, description, notes) VALUES (@iteration_id, @target, @description, @notes)`
  );
  for (const entry of entries) {
    const result = insert.run({
      iteration_id,
      target: entry.target ?? null,
      description: entry.description,
      notes: entry.notes ?? null
    });
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "deployment_requirement", id: lastId };
}

function insertOperationalRequirement(db, iteration_id, _revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  let lastId;
  const insert = db.prepare(
    `INSERT INTO operational_requirement (iteration_id, item, category, notes) VALUES (@iteration_id, @item, @category, @notes)`
  );
  for (const entry of entries) {
    const result = insert.run({
      iteration_id,
      item: entry.item,
      category: entry.category,
      notes: entry.notes ?? null
    });
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "operational_requirement", id: lastId };
}

function insertTechnologyConstraint(db, iteration_id, _revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  let lastId;
  const insert = db.prepare(
    `INSERT INTO technology_constraint (iteration_id, constraint_type, value) VALUES (@iteration_id, @constraint_type, @value)`
  );
  for (const entry of entries) {
    const result = insert.run({
      iteration_id,
      constraint_type: entry.constraint_type,
      value: entry.value
    });
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "technology_constraint", id: lastId };
}

function insertVcsCommit(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO vcs_commit (iteration_id, phase_id, commit_sha, message, created_at)
       VALUES (@iteration_id, @phase_id, @commit_sha, @message, @created_at)`
    )
    .run({
      iteration_id,
      phase_id: data.phase_id ?? null,
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
      `INSERT INTO intermediate_asset (phase_id, revision_id, asset_type, title, content, created_at)
       VALUES (@phase_id, @revision_id, @asset_type, @title, @content, @created_at)`
    )
    .run({
      phase_id: data.phase_id ?? null,
      revision_id,
      asset_type: data.asset_type,
      title: data.title,
      content: data.content ?? null,
      created_at: now
    });
  return { entity_type: "intermediate_asset", id: result.lastInsertRowid };
}

function insertAssetDeliverable(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO asset_deliverable (iteration_id, phase_id, asset_type, file_path, description, commit_sha, created_at)
       VALUES (@iteration_id, @phase_id, @asset_type, @file_path, @description, @commit_sha, @created_at)`
    )
    .run({
      iteration_id,
      phase_id: data.phase_id ?? null,
      asset_type: data.asset_type,
      file_path: data.file_path,
      description: data.description ?? null,
      commit_sha: data.commit_sha ?? null,
      created_at: now
    });
  return { entity_type: "asset_deliverable", id: result.lastInsertRowid };
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
       (revision_id, category, severity, title, description, location, recommendation, cve, status)
     VALUES (@revision_id, @category, @severity, @title, @description, @location, @recommendation, @cve, @status)`
  ).run({
    revision_id,
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
       (revision_id, category, severity, title, description, location, metric_name, baseline_value, actual_value, recommendation, status)
     VALUES (@revision_id, @category, @severity, @title, @description, @location, @metric_name, @baseline_value, @actual_value, @recommendation, @status)`
  ).run({
    revision_id,
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
         (revision_id, total_tests, passed_count, failed, skipped,
          coverage_line, coverage_branch, coverage_function,
          duration_seconds, status,
          version, document_date, requirements_version, architecture_version, commit_sha,
          created_at)
       VALUES (@revision_id, @total_tests, @passed_count, @failed, @skipped,
               @coverage_line, @coverage_branch, @coverage_function,
               @duration_seconds, @status,
               @version, @document_date, @requirements_version, @architecture_version, @commit_sha,
               @created_at)`
    )
    .run({
      revision_id,
      total_tests: data.total_tests ?? 0,
      passed_count: data.passed_count ?? 0,
      failed: data.failed ?? 0,
      skipped: data.skipped ?? 0,
      coverage_line: data.coverage_line ?? null,
      coverage_branch: data.coverage_branch ?? null,
      coverage_function: data.coverage_function ?? null,
      duration_seconds: data.duration_seconds ?? null,
      status: data.status,
      version: meta?.version ?? data.version ?? null,
      document_date: meta?.document_date ?? data.document_date ?? null,
      requirements_version: meta?.requirements_version ?? data.requirements_version ?? null,
      architecture_version: meta?.architecture_version ?? data.architecture_version ?? null,
      commit_sha: meta?.commit_sha ?? data.commit_sha ?? null,
      created_at: now
    });
  const report_id = result.lastInsertRowid;

  // -- test_requirement_coverage (1:N) --
  //    → test_acceptance_criterion_result (1:N per coverage)
  const insertCoverage = db.prepare(
    `INSERT INTO test_requirement_coverage (report_id, requirement_id, status) VALUES (@report_id, @requirement_id, @status)
     ON CONFLICT(report_id, requirement_id) DO UPDATE SET status = excluded.status`
  );
  const insertCriterionResult = db.prepare(
    "INSERT INTO test_acceptance_criterion_result (coverage_id, criterion, status, notes, test_ids) VALUES (@coverage_id, @criterion, @status, @notes, @test_ids)"
  );
  for (const cov of data.coverage ?? []) {
    const covResult = insertCoverage.run({ report_id, requirement_id: cov.requirement_id, status: cov.status });
    const coverage_id = covResult.lastInsertRowid;
    for (const cr of cov.criteria ?? []) {
      insertCriterionResult.run({
        coverage_id,
        criterion: cr.criterion,
        status: cr.status,
        notes: cr.notes ?? null,
        test_ids: JSON.stringify(cr.test_ids ?? [])
      });
    }
  }

  // -- test_suite (1:N) --
  //    → test_case (1:N per suite)
  //      → test_case_requirement (M:N per case)
  const insertSuite = db.prepare(
    "INSERT INTO test_suite (report_id, name, suite_type) VALUES (@report_id, @name, @suite_type)"
  );
  const insertCase = db.prepare(
    `INSERT INTO test_case
       (suite_id, test_id, name, description, status, duration_ms,
        error_message, stack_trace, retry_count)
     VALUES (@suite_id, @test_id, @name, @description, @status, @duration_ms,
             @error_message, @stack_trace, @retry_count)`
  );
  const insertCaseReq = db.prepare(
    "INSERT OR IGNORE INTO test_case_requirement (test_case_id, requirement_id) VALUES (@test_case_id, @requirement_id)"
  );
  for (const suite of data.suites ?? []) {
    const suiteResult = insertSuite.run({ report_id, name: suite.name, suite_type: suite.type });
    const suite_id = suiteResult.lastInsertRowid;
    for (const tc of suite.cases ?? []) {
      const caseResult = insertCase.run({
        suite_id,
        test_id: tc.test_id,
        name: tc.name,
        description: tc.description ?? null,
        status: tc.status,
        duration_ms: tc.duration_ms ?? null,
        error_message: tc.error_message ?? null,
        stack_trace: tc.stack_trace ?? null,
        retry_count: tc.retry_count ?? null
      });
      for (const req_id of tc.requirements ?? []) {
        insertCaseReq.run({ test_case_id: caseResult.lastInsertRowid, requirement_id: req_id });
      }
    }
  }

  // -- test_security_finding (1:N) --
  const insertSecFinding = db.prepare(
    `INSERT INTO test_security_finding
       (report_id, category, tool, severity, description, location,
        recommendation, package, advisory)
     VALUES (@report_id, @category, @tool, @severity, @description, @location,
             @recommendation, @package, @advisory)`
  );
  for (const sf of data.security_findings ?? []) {
    insertSecFinding.run({
      report_id,
      category: sf.category,
      tool: sf.tool ?? null,
      severity: sf.severity ?? null,
      description: sf.description,
      location: sf.location ?? null,
      recommendation: sf.recommendation,
      package: sf.package ?? null,
      advisory: sf.advisory ?? null
    });
  }

  // -- test_performance_benchmark (1:N) --
  const insertBenchmark = db.prepare(
    `INSERT INTO test_performance_benchmark
       (report_id, name, metric, measured_value, unit, threshold, status)
     VALUES (@report_id, @name, @metric, @measured_value, @unit, @threshold, @status)`
  );
  for (const pb of data.performance_benchmarks ?? []) {
    insertBenchmark.run({
      report_id,
      name: pb.name,
      metric: pb.metric,
      measured_value: pb.measured_value,
      unit: pb.unit,
      threshold: pb.threshold ?? null,
      status: pb.status ?? null
    });
  }

  // -- test_blocker (1:N) --
  //    → test_blocker_requirement (M:N per blocker)
  const insertBlocker = db.prepare(
    "INSERT INTO test_blocker (report_id, description, severity, recommendation) VALUES (@report_id, @description, @severity, @recommendation)"
  );
  const insertBlockerReq = db.prepare(
    "INSERT OR IGNORE INTO test_blocker_requirement (blocker_id, requirement_id) VALUES (@blocker_id, @requirement_id)"
  );
  for (const blocker of data.blockers ?? []) {
    const blockerResult = insertBlocker.run({
      report_id,
      description: blocker.description,
      severity: blocker.severity,
      recommendation: blocker.recommendation ?? null
    });
    for (const req_id of blocker.requirements ?? []) {
      insertBlockerReq.run({ blocker_id: blockerResult.lastInsertRowid, requirement_id: req_id });
    }
  }

  // -- test_recommendation (1:N) --
  const insertRecommendation = db.prepare(
    "INSERT INTO test_recommendation (report_id, category, description, priority) VALUES (@report_id, @category, @description, @priority)"
  );
  for (const rec of data.recommendations ?? []) {
    insertRecommendation.run({ report_id, category: rec.category, description: rec.description, priority: rec.priority });
  }

  return { entity_type: "test_report", id: report_id };
}

function insertDocumentationManifest(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const meta = Array.isArray(data.metadata) ? data.metadata[0] : data.metadata;
  const result = db
    .prepare(
      `INSERT INTO documentation_manifest
         (revision_id, status, total_pages,
          accessibility_compliant,
          version, document_date, requirements_version,
          architecture_version, implementation_version, format,
          created_at)
       VALUES (@revision_id, @status, @total_pages,
               @accessibility_compliant,
               @version, @document_date, @requirements_version,
               @architecture_version, @implementation_version, @format,
               @created_at)`
    )
    .run({
      revision_id,
      status: data.status,
      total_pages: data.total_pages ?? null,
      accessibility_compliant: data.accessibility_compliant ?? 0,
      version: meta?.version ?? data.version ?? null,
      document_date: meta?.document_date ?? data.document_date ?? null,
      requirements_version: meta?.requirements_version ?? data.requirements_version ?? null,
      architecture_version: meta?.architecture_version ?? data.architecture_version ?? null,
      implementation_version: meta?.implementation_version ?? data.implementation_version ?? null,
      format: meta?.format ?? data.format ?? null,
      created_at: now
    });
  const manifest_id = result.lastInsertRowid;

  // -- documentation_section (1:N) --
  const insertSection = db.prepare(
    `INSERT INTO documentation_section
       (manifest_id, category, key, value, path)
     VALUES (@manifest_id, @category, @key, @value, @path)`
  );
  for (const sec of data.sections ?? []) {
    insertSection.run({
      manifest_id,
      category: sec.category,
      key: sec.key,
      value: sec.value,
      path: sec.path ?? null
    });
  }

  // -- documentation_feature (1:N) --
  //    → documentation_feature_requirement (M:N per feature)
  const insertFeature = db.prepare(
    `INSERT INTO documentation_feature
       (manifest_id, name, path, includes_examples, includes_screenshots)
     VALUES (@manifest_id, @name, @path, @includes_examples, @includes_screenshots)`
  );
  const insertFeatureReq = db.prepare(
    "INSERT OR IGNORE INTO documentation_feature_requirement (feature_id, requirement_id) VALUES (@feature_id, @requirement_id)"
  );
  for (const feat of data.features ?? []) {
    const featResult = insertFeature.run({
      manifest_id,
      name: feat.name,
      path: feat.path,
      includes_examples: feat.includes_examples ? 1 : 0,
      includes_screenshots: feat.includes_screenshots ? 1 : 0
    });
    for (const req_id of feat.requirements ?? []) {
      insertFeatureReq.run({ feature_id: featResult.lastInsertRowid, requirement_id: req_id });
    }
  }

  // -- documentation_requirement_coverage (1:N) --
  const insertCoverage = db.prepare(
    `INSERT OR REPLACE INTO documentation_requirement_coverage
       (manifest_id, requirement_id, documented, user_facing, notes, paths)
     VALUES (@manifest_id, @requirement_id, @documented, @user_facing, @notes, @paths)`
  );
  for (const cov of data.coverage ?? []) {
    insertCoverage.run({
      manifest_id,
      requirement_id: cov.requirement_id,
      documented: cov.documented ? 1 : 0,
      user_facing: cov.user_facing ? 1 : 0,
      notes: cov.notes ?? null,
      paths: JSON.stringify(cov.paths ?? [])
    });
  }

  // -- documentation_asset (1:N) --
  const insertAsset = db.prepare(
    `INSERT INTO documentation_asset
       (manifest_id, path, asset_type, description, alt_text)
     VALUES (@manifest_id, @path, @asset_type, @description, @alt_text)`
  );
  for (const asset of data.assets ?? []) {
    insertAsset.run({
      manifest_id,
      path: asset.path,
      asset_type: asset.type,
      description: asset.description ?? null,
      alt_text: asset.alt_text ?? null
    });
  }

  // -- documentation_review_checklist (1:N) --
  const insertVerification = db.prepare(
    "INSERT INTO documentation_review_checklist (manifest_id, check_name, passed) VALUES (@manifest_id, @check_name, @passed)"
  );
  for (const v of data.verification ?? []) {
    insertVerification.run({ manifest_id, check_name: v.check_name, passed: v.passed ? 1 : 0 });
  }

  return { entity_type: "documentation_manifest", id: manifest_id };
}

function insertDeploymentManifest(db, iteration_id, revision_id, data) {
  const now = new Date().toISOString();
  const meta = Array.isArray(data.metadata) ? data.metadata[0] : data.metadata;
  const result = db
    .prepare(
      `INSERT INTO deployment_manifest
         (revision_id, status, targets, blockers,
          version, document_date, requirements_version,
          architecture_version, implementation_version, test_report_version,
          created_at)
       VALUES (@revision_id, @status, @targets, @blockers,
               @version, @document_date, @requirements_version,
               @architecture_version, @implementation_version, @test_report_version,
               @created_at)`
    )
    .run({
      revision_id,
      status: data.status,
      targets: JSON.stringify((data.targets ?? []).map(t => t.target ?? t)),
      blockers: JSON.stringify((data.blockers ?? []).map(b => b.blocker ?? b)),
      version: meta?.version ?? data.version ?? null,
      document_date: meta?.document_date ?? data.document_date ?? null,
      requirements_version: meta?.requirements_version ?? data.requirements_version ?? null,
      architecture_version: meta?.architecture_version ?? data.architecture_version ?? null,
      implementation_version: meta?.implementation_version ?? data.implementation_version ?? null,
      test_report_version: meta?.test_report_version ?? data.test_report_version ?? null,
      created_at: now
    });
  const manifest_id = result.lastInsertRowid;

  // -- deployment_pipeline (1:N) --
  //    → deployment_pipeline_stage (1:N per pipeline)
  //      → deployment_stage_quality_gate (1:N per stage)
  const insertPipeline = db.prepare(
    "INSERT INTO deployment_pipeline (manifest_id, platform, config_files) VALUES (@manifest_id, @platform, @config_files)"
  );
  const insertPipelineStage = db.prepare(
    "INSERT INTO deployment_pipeline_stage (pipeline_id, name, purpose, triggers, steps) VALUES (@pipeline_id, @name, @purpose, @triggers, @steps)"
  );
  const insertStageQualityGate = db.prepare(
    `INSERT INTO deployment_stage_quality_gate
       (stage_id, name, condition, failure_action)
     VALUES (@stage_id, @name, @condition, @failure_action)`
  );
  for (const pipeline of data.pipelines ?? []) {
    const pipeResult = insertPipeline.run({ manifest_id, platform: pipeline.platform, config_files: JSON.stringify((pipeline.config_files ?? []).map(cf => cf.file_path ?? cf)) });
    const pipeline_id = pipeResult.lastInsertRowid;
    for (const stage of pipeline.stages ?? []) {
      const stageResult = insertPipelineStage.run({
        pipeline_id,
        name: stage.name,
        purpose: stage.purpose,
        triggers: JSON.stringify((stage.triggers ?? []).map(tr => tr.trigger_text ?? tr)),
        steps: JSON.stringify((stage.steps ?? []).map(st => st.step ?? st))
      });
      const stage_id = stageResult.lastInsertRowid;
      for (const qg of stage.quality_gates ?? []) {
        insertStageQualityGate.run({ stage_id, name: qg.name, condition: qg.condition, failure_action: qg.failure_action });
      }
    }
  }

  // -- deployment_quality_gate (1:N) --
  const insertQualityGates = db.prepare(
    "INSERT INTO deployment_quality_gate (manifest_id, category, key, value) VALUES (@manifest_id, @category, @key, @value)"
  );
  for (const qg of data.quality_gates ?? []) {
    insertQualityGates.run({ manifest_id, category: qg.category, key: qg.key, value: qg.value });
  }

  // -- deployment_environment (1:N) --
  //    → deployment_env_infra (1:N per environment)
  //    → deployment_env_var (1:N per environment)
  const insertEnvironment = db.prepare(
    `INSERT INTO deployment_environment
       (manifest_id, name, deployment_method, url, rollback_procedure)
     VALUES (@manifest_id, @name, @deployment_method, @url, @rollback_procedure)`
  );
  const insertEnvInfra = db.prepare(
    "INSERT INTO deployment_env_infra (environment_id, provider, resource) VALUES (@environment_id, @provider, @resource)"
  );
  const insertEnvVar = db.prepare(
    `INSERT INTO deployment_env_var
       (environment_id, name, value_source, description)
     VALUES (@environment_id, @name, @value_source, @description)`
  );
  for (const env of data.environments ?? []) {
    const envResult = insertEnvironment.run({
      manifest_id,
      name: env.name,
      deployment_method: env.deployment_method,
      url: env.url ?? null,
      rollback_procedure: env.rollback_procedure ?? null
    });
    const environment_id = envResult.lastInsertRowid;
    for (const infra of env.infra ?? []) {
      insertEnvInfra.run({ environment_id, provider: infra.provider ?? null, resource: infra.resource });
    }
    for (const v of env.vars ?? []) {
      insertEnvVar.run({ environment_id, name: v.name, value_source: v.value_source, description: v.description ?? null });
    }
  }

  // -- deployment_artifact (1:N) --
  const insertArtifact = db.prepare(
    `INSERT INTO deployment_artifact
       (manifest_id, name, artifact_type, registry, versioning, platforms)
     VALUES (@manifest_id, @name, @artifact_type, @registry, @versioning, @platforms)`
  );
  for (const art of data.artifacts ?? []) {
    insertArtifact.run({
      manifest_id,
      name: art.name,
      artifact_type: art.type,
      registry: art.registry ?? null,
      versioning: art.versioning ?? null,
      platforms: JSON.stringify((art.platforms ?? []).map(plat => plat.platform ?? plat))
    });
  }

  // -- deployment_signing (1:N) --
  const insertSigning = db.prepare(
    "INSERT INTO deployment_signing (manifest_id, enabled, signing_method) VALUES (@manifest_id, @enabled, @signing_method)"
  );
  for (const s of data.signing ?? []) {
    insertSigning.run({ manifest_id, enabled: s.enabled ? 1 : 0, signing_method: s.signing_method ?? null });
  }

  // -- deployment_local_executable (1:N) --
  const insertLocalExec = db.prepare(
    `INSERT INTO deployment_local_executable
       (manifest_id, installation_method, update_mechanism, platforms, channels)
     VALUES (@manifest_id, @installation_method, @update_mechanism, @platforms, @channels)`
  );
  for (const le of data.local_executables ?? []) {
    insertLocalExec.run({
      manifest_id,
      installation_method: le.installation_method ?? null,
      update_mechanism: le.update_mechanism ?? null,
      platforms: JSON.stringify((le.platforms ?? []).map(p => p.platform ?? p)),
      channels: JSON.stringify((le.channels ?? []).map(ch => ch.channel ?? ch))
    });
  }

  // -- deployment_secret (1:N) --
  const insertSecret = db.prepare(
    `INSERT INTO deployment_secret
       (manifest_id, provider, name, purpose, rotation_policy)
     VALUES (@manifest_id, @provider, @name, @purpose, @rotation_policy)`
  );
  for (const sec of data.secrets ?? []) {
    insertSecret.run({
      manifest_id,
      provider: sec.provider ?? null,
      name: sec.name,
      purpose: sec.purpose,
      rotation_policy: sec.rotation_policy ?? null
    });
  }

  // -- deployment_health_check (1:N) --
  const insertHealthCheck = db.prepare(
    "INSERT INTO deployment_health_check (manifest_id, name, endpoint, interval) VALUES (@manifest_id, @name, @endpoint, @interval)"
  );
  for (const hc of data.health_checks ?? []) {
    insertHealthCheck.run({ manifest_id, name: hc.name, endpoint: hc.endpoint ?? null, interval: hc.interval ?? null });
  }

  // -- deployment_alerting (1:N) --
  const insertAlerting = db.prepare(
    "INSERT INTO deployment_alerting (manifest_id, provider, channel) VALUES (@manifest_id, @provider, @channel)"
  );
  for (const al of data.alerting ?? []) {
    insertAlerting.run({ manifest_id, provider: al.provider ?? null, channel: al.channel });
  }

  // -- deployment_runbook (1:N) --
  //    → deployment_runbook_step (1:N per runbook)
  const insertRunbook = db.prepare(
    "INSERT INTO deployment_runbook (manifest_id, name, scenario) VALUES (@manifest_id, @name, @scenario)"
  );
  const insertRunbookStep = db.prepare(
    "INSERT INTO deployment_runbook_step (runbook_id, step, is_rollback) VALUES (@runbook_id, @step, @is_rollback)"
  );
  for (const rb of data.runbooks ?? []) {
    const rbResult = insertRunbook.run({ manifest_id, name: rb.name, scenario: rb.scenario });
    const runbook_id = rbResult.lastInsertRowid;
    for (const s of rb.steps ?? []) {
      insertRunbookStep.run({ runbook_id, step: s.step, is_rollback: s.is_rollback ? 1 : 0 });
    }
  }

  // -- deployment_review_checklist (1:N) --
  const insertChecklist = db.prepare(
    "INSERT INTO deployment_review_checklist (manifest_id, check_name, passed) VALUES (@manifest_id, @check_name, @passed)"
  );
  for (const item of data.review_checklist ?? []) {
    insertChecklist.run({ manifest_id, check_name: item.check_name, passed: item.passed ? 1 : 0 });
  }

  return { entity_type: "deployment_manifest", id: manifest_id };
}

function insertUxConfig(db, iteration_id, revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  const now = new Date().toISOString();
  let lastId;
  const insert = db.prepare(
    `INSERT INTO ux_config (revision_id, config_type, category, key, value, created_at)
     VALUES (@revision_id, @config_type, @category, @key, @value, @created_at)`
  );
  for (const entry of entries) {
    const result = insert.run({
      revision_id,
      config_type: entry.config_type,
      category: entry.category,
      key: entry.key,
      value: entry.value,
      created_at: now
    });
    lastId = result.lastInsertRowid;
  }
  return { entity_type: "ux_config", id: lastId };
}

function insertInfoArchitecture(db, iteration_id, revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  const now = new Date().toISOString();
  let lastId;
  const insert = db.prepare(
    `INSERT INTO info_architecture (revision_id, category, key, value, parent_id, created_at)
     VALUES (@revision_id, @category, @key, @value, @parent_id, @created_at)`
  );
  for (const entry of entries) {
    const result = insert.run({
      revision_id,
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
    `INSERT INTO persona_addressed (revision_id, persona_id, goal, how_addressed)
     VALUES (@revision_id, @persona_id, @goal, @how_addressed)`
  ).run({
    revision_id,
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

function insertUxAsset(db, iteration_id, revision_id, data) {
  const entries = Array.isArray(data) ? data : [data];
  const now = new Date().toISOString();
  let lastId;
  const insert = db.prepare(
    `INSERT INTO ux_asset (revision_id, name, path, asset_type, screen_id, description, created_at)
     VALUES (@revision_id, @name, @path, @asset_type, @screen_id, @description, @created_at)`
  );
  for (const entry of entries) {
    const result = insert.run({
      revision_id,
      name: entry.name,
      path: entry.path,
      asset_type: entry.type,
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
    component: insertComponent,
    technology_choice: insertTechnologyChoice,
    architecture_overview: insertArchitectureOverview,
    data_entity: insertDataEntity,
    requirement_trace: insertRequirementTrace,
    architecture_config: insertArchitectureConfig,
    approved_dependency: insertApprovedDependency,
    user_flow: insertUserFlow,
    screen: insertScreen,
    ux_config: insertUxConfig,
    info_architecture: insertInfoArchitecture,
    persona_addressed: insertPersonaAddressed,
    ux_asset: insertUxAsset,
    plan_phase: insertPlanPhase,
    plan_overview: insertPlanOverview,
    plan_external_dependency: insertPlanExternalDependency,
    plan_metadata: insertPlanMetadata,
    implementation_manifest: insertImplementationManifest,
    project_context: insertProjectContext,
    system_io: insertSystemIo,
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

  const sql = `UPDATE ${config.table} SET ${setClauses.join(", ")} WHERE id = @entity_id`;
  const info = db.prepare(sql).run(params);

  if (info.changes === 0) {
    throw new Error(`${entity_type} with id=${entity_id} not found`);
  }

  return { entity_type, entity_id, updated_fields: Object.keys(updates) };
}

function commitLink(args) {
  const db = getDb();
  const { iteration_id, phase_id, commit_sha, message } = args;
  const now = new Date().toISOString();

  const result = db
    .prepare(
      `INSERT INTO vcs_commit (iteration_id, phase_id, commit_sha, message, created_at)
       VALUES (@iteration_id, @phase_id, @commit_sha, @message, @created_at)`
    )
    .run({ iteration_id, phase_id: phase_id ?? null, commit_sha, message: message ?? null, created_at: now });

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
    case "plan_phase_transition":
      return planPhaseTransition(args);
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
