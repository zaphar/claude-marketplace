# Planning Redesign: Codebase-Aware Planner + Plan Versioning

## Status: Phase 1 COMPLETE ✅

All 15 todos from Phase 1 are done. See commits: b193d2b, 2fd78b6, 1cdf660, 59e74c9.

---

## Phase 2: Targeted Auto-Replan

### Problem

A growing codebase means WI sizing estimates from planning time become stale. As completed WIs accumulate code, later WIs face a larger codebase than anticipated. Currently the senior dev detects this and raises a blocker requiring human intervention — wasting a full agent invocation and blocking on human response.

### Solution

Allow the senior developer to trigger a **targeted auto-replan** — decomposing only the specific WI it was handed, not the entire plan. The orchestrator handles this automatically without human intervention, with a circuit breaker (max 3 auto-replans per iteration).

### Design

**Senior dev signal:** Instead of raising a blocker and stopping, the senior dev returns a structured `REPLAN_NEEDED` signal with its codebase analysis. This analysis is valuable — the senior dev already explored the codebase and knows why the WI is too large.

**Orchestrator detection (§9):** After invoking the senior dev, the orchestrator inspects the result. If it contains a `REPLAN_NEEDED` signal:
1. Check auto-replan counter (tracked in project notes or iteration metadata)
2. If count >= 3: escalate to human (circuit breaker)
3. If count < 3: invoke targeted replan flow

**Targeted replan flow (§11 variant):** Unlike a full replan (all actionable WIs), a targeted replan:
- Supersedes only the one specific WI
- Planner decomposes only that WI into smaller sub-WIs
- All other WIs (completed AND other pending/active) remain untouched
- Still increments plan_version (it's a plan evolution)
- Critic validates only the decomposition (original WI's requirements covered by new WIs)

**Planner targeted mode:** The planner receives:
- The specific WI to decompose (with full context)
- The senior dev's codebase analysis (why it's too large, key dependencies found)
- Completed WI list (read-only context for codebase understanding)
- Instruction: decompose ONLY this WI, don't touch anything else

**Critic targeted validation:** Simpler than full replan validation:
- New WIs cover all requirements from the decomposed WI
- No other WIs were modified or superseded
- New WI sizing is grounded in codebase analysis
- Plan_version is correct

**Circuit breaker:**
- Orchestrator tracks auto-replan count per iteration
- After 3 auto-replans, escalate to human with full history
- Human can then: approve another auto-replan, do a full manual replan, or adjust the plan directly

### Implementation Todos

1. **senior-dev-replan-signal** — Update senior_developer.agent.md: replace blocker-based escalation with structured REPLAN_NEEDED signal containing codebase analysis
2. **orchestrator-auto-replan-detection** — Update SKILL.md §9: after senior dev invocation, detect REPLAN_NEEDED signal, check circuit breaker, branch to targeted replan
3. **orchestrator-targeted-replan** — Update SKILL.md §11: add targeted replan variant (single-WI scope, only that WI superseded)
4. **planner-targeted-mode** — Update implementation_planner.agent.md: add targeted decomposition mode (receives one WI + senior dev analysis, decomposes only that WI)
5. **critic-targeted-validation** — Update implementation_plan_critic.agent.md: add targeted replan validation (scoped to single WI decomposition)
6. **tests** — Add tests for any new MCP tool behavior (if applicable)
7. **docs-update** — Update README.md, AGENTS.md, SKILL.md §11 trigger list

### Dependencies

- 1 (senior dev signal) and 4 (planner targeted mode) are independent — can be parallel
- 2 (orchestrator detection) depends on 1 (needs to know the signal format)
- 3 (orchestrator targeted replan) depends on 2 (detection triggers it)
- 5 (critic validation) depends on 4 (needs to know what planner produces)
- 6 (tests) depends on whether MCP tool changes are needed
- 7 (docs) depends on all others

### Decisions

1. **Counter storage: orchestrator memory.** The auto-replan counter is a transient variable the orchestrator tracks during the session. No DB column or persistence needed — resetting on resume is correct behavior (context has changed).

2. **Circuit breaker: per-iteration with user reset.** 3 auto-replans per iteration, then escalate. If the user wants to continue after escalation, they can explicitly reset the counter (e.g., acknowledging the situation and telling the orchestrator to proceed). This prevents runaway cascades while keeping human override available.

3. **REPLAN signal: DB blocker with auto-resolve.** Senior dev inserts a `blocker` via `changelog_insert(entity_type: "blocker")` with its codebase analysis. After successful replan, orchestrator calls `blocker_resolve()` on it. This provides a full audit trail of what triggered each replan — the blocker description preserves the senior dev's technical findings.

## Three Requirements

1. **Codebase-aware planner** — The planner must explore the actual codebase when sizing WIs
2. **Replan any number of times** — Users can trigger replans at any point; completed work is preserved
3. **Plan version tracking** — Track what was implemented, what was superseded, and why

## Design

### Core Concept: Work Item Supersession

Instead of deleting/replacing WIs, we **supersede** them. Superseded WIs remain in the DB with full history (commits, manifests, etc.) but are excluded from the active plan. Lineage between old and new WIs is tracked through shared requirement coverage (`work_item_requirement`) and `plan_version` grouping — no explicit parent pointer needed.

Active plan = all WIs where `superseded_at IS NULL`
History = all WIs, ordered by plan_version + superseded_at

### Schema Changes (Migration 005)

**work_item — add 2 columns:**

```sql
ALTER TABLE work_item ADD COLUMN plan_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE work_item ADD COLUMN superseded_at TEXT;           -- NULL = active

CREATE INDEX idx_work_item_plan_version ON work_item(iteration_id, plan_version);
```

- `plan_version` — which planning pass created this WI (1 = initial, 2 = first replan, etc.)
- `superseded_at` — timestamp when this WI was retired by a replan (NULL = still active)
- Decomposition lineage is tracked through shared requirements (`work_item_requirement`) and `plan_version` grouping — no parent pointer needed

**plan_overview — table recreation to allow multiple versions:**

```sql
-- Rename-create-copy-drop pattern (same as migration 002)
ALTER TABLE plan_overview RENAME TO _old_plan_overview;

CREATE TABLE IF NOT EXISTS plan_overview (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  plan_version INTEGER NOT NULL DEFAULT 1,
  strategy TEXT NOT NULL,
  rationale TEXT NOT NULL,
  phase_one_approach TEXT,
  assumptions JSON NOT NULL DEFAULT '[]',
  risks JSON,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, plan_version)  -- was UNIQUE(iteration_id)
);

INSERT INTO plan_overview (id, iteration_id, plan_version, strategy, rationale, phase_one_approach, assumptions, risks, created_at)
  SELECT id, iteration_id, 1, strategy, rationale, phase_one_approach, assumptions, risks, created_at
  FROM _old_plan_overview;

DROP TABLE _old_plan_overview;
```

**Migration path for existing data:**
- All existing work_items get `plan_version = 1`, `superseded_at = NULL` (via DEFAULT values on ALTER TABLE ADD COLUMN)
- All existing plan_overview rows get `plan_version = 1` (via INSERT ... SELECT with literal 1)
- No data loss, no behavioral change for projects that never replan

### Tool Changes

**write-tools.js:**

1. **`work_item_transition`** — Add `"superseded"` to allowed statuses. When transitioning to superseded, auto-set `superseded_at = now()`.

2. **`changelog_insert` for work_item** — Accept optional `plan_version` in the data payload. Defaults to 1 if omitted (backward compat).

3. **`changelog_insert` for plan_overview** — Accept optional `plan_version` in data payload. Defaults to 1.

**read-tools.js:**

5. **`changelog_query` for work_item** — Add filters:
   - `plan_version` — filter by specific version
   - `superseded` — boolean filter: `true` = superseded only, `false` = active only, `null` = all (default `null` for backward compat)
   - `status_not` — exclude WIs with this status (e.g., `"completed"` to get only actionable WIs)

6. **`changelog_query` for plan_overview** — Add `plan_version` filter.

7. **`traceability_query`** — No structural change needed. Existing join through `work_item_requirement` already traces requirements to WIs. Active vs superseded WIs can be distinguished by `superseded_at`.

### Orchestrator Changes (SKILL.md)

**Planning phase cleanup — selective, not destructive:**

Replace:
```bash
rm -rf planning/phases/
mkdir -p planning/phases/
```

With version-aware cleanup:
- **Initial plan (version 1):** Same as today — clean slate, `rm -rf planning/phases/`
- **Replan (version 2+):** No directory-level deletion. File-level operations only:
  1. **Completed WI files** — Never touched. Planner receives completed WI names as read-only context and must not overwrite or modify these files.
  2. **Superseded WI files** — Planner prepends a `> ⚠️ SUPERSEDED by plan version N` header to the existing file. File stays on disk for history.
  3. **New WI files** — Created with new names (decomposed/restructured WIs naturally have different names, so no collision with existing files).
  4. **Phase index files** — Regenerated to list only active WIs. This is the only overwrite — index files, not WI files.

**New: Replan trigger flow:**

Add a replan section to SKILL.md that can be triggered:
- By user request at any time
- By escalation when senior_developer can't complete a WI
- At review checkpoints when specs change

The flow:
1. Orchestrator queries current WI state: `changelog_query(entity_type="work_item", filters={superseded: false})`
2. Partitions WIs into: `completed` (untouchable — never replanned), `in_progress` (needs decision), `pending` (eligible for replan)
3. Orchestrator calls `revision_create` for the planning phase (re-opens it)
4. Invokes implementation_planner with:
   - Completed WIs (read-only context — what's already done, not subject to replan)
   - Pending/in-progress WIs that need decomposition
   - The reason for replan
   - Current plan_version + 1
5. Planner explores codebase, creates new WIs with the new plan_version
6. Planner creates new plan_overview (version N+1) explaining what changed and why
7. Orchestrator invokes implementation_plan_critic
8. Critic validates:
   - Completed WIs not touched
   - All requirements from superseded WIs covered by new WIs (no orphaned requirements)
   - New WIs properly sized (codebase-aware assessment)
9. On approval: orchestrator calls `work_item_transition(status="superseded")` on old WIs
10. Implementation resumes with new active WIs

**Implementation phase — filter active WIs only:**

Change the WI query from:
```
changelog_query(entity_type="work_item", iteration_id=<id>)
```
to:
```
changelog_query(entity_type="work_item", iteration_id=<id>, filters={superseded: false, status_not: "completed"})
```

This excludes both superseded and completed WIs at the query level, returning only WIs the orchestrator needs to act on (pending, test_writing, implementing). Keeps the context window lean, especially after multiple replans where completed + superseded WIs accumulate.

### Agent Changes

**implementation_planner.agent.md — Two changes:**

1. **Codebase awareness (new section):**
   Before sizing WIs, the planner must explore the actual codebase:
   - Use Glob to discover files that would need modification for each WI
   - Use Grep to assess coupling and dependency density
   - Count touch points (files to create + files to modify)
   - Assess existing test coverage that might need updating
   - Use the sizing heuristic with real data: ~3 files created, ~5 files modified max per WI
   - For `onboard` workflows and later iterations: examine existing code complexity, not just specs

2. **Replan capability (new section):**
   When invoked for a replan (plan_version > 1):
   - Receive completed WIs as read-only context
   - Receive the WI(s) flagged for decomposition
   - Explore the codebase to understand why the original sizing was wrong
   - Create new WIs for the current plan_version
   - Ensure requirement coverage: every requirement from superseded WIs must appear in at least one new or existing active WI
   - Do NOT modify completed WI files on disk — only create new files for new WIs
   - Update phase index files to reflect the new WI structure

**implementation_plan_critic.agent.md — Two changes:**

1. **Codebase-aware sizing validation:**
   - Add checklist item: "Planner has assessed actual codebase complexity for WI sizing"
   - Escalate (not just flag) XL WIs: reject if any WI has complexity > L without documented justification

2. **Replan validation:**
   - Completed WIs are never superseded or modified — replan only touches pending/in-progress WIs
   - All requirements from superseded WIs are covered by new or existing active WIs
   - New WIs have correct plan_version
   - plan_version is consistent across all new WIs

**senior_developer.agent.md — Early detection guidance:**

Add section on recognizing oversized WIs early:
- If codebase exploration exceeds ~20% of context window before writing any code, the WI is likely too large
- Signal via blocker: `changelog_insert(entity_type: "blocker", data: { description: "WI too large for single session — recommend decomposition", severity: "major" })`
- Stop exploring and report findings so they can inform the replan

### Filesystem Changes

**Versioned planning directory structure:**

```
planning/
├── index.md                          (current plan overview — updated on replan)
├── phases/
│   ├── phase-1/
│   │   ├── index.md                  (updated on replan to reflect new WIs)
│   │   ├── wi-setup-database.md      (completed — preserved)
│   │   ├── wi-api-endpoints.md       (superseded — left on disk, marked in header)
│   │   ├── wi-api-core.md            (new — created in replan v2)
│   │   └── wi-api-auth.md            (new — created in replan v2)
│   └── phase-2/
│       └── ...
└── replan-log.md                     (append-only log of replan events with rationale)
```

- Superseded WI files get a `> ⚠️ SUPERSEDED` header added (not deleted)
- New WI files are created alongside them
- Phase index files are regenerated to reflect active WIs only
- replan-log.md tracks the history: version, date, reason, what was superseded, what was created

## Implementation Todos

1. **migration-005** — Schema changes (work_item columns + plan_overview recreation + index)
2. **write-tools-update** — Update work_item_transition, changelog_insert for new fields
3. **read-tools-update** — Update changelog_query filters for work_item and plan_overview
4. **planner-codebase-awareness** — Update implementation_planner.agent.md with codebase exploration instructions
5. **planner-replan-capability** — Update implementation_planner.agent.md with replan flow
6. **critic-replan-validation** — Update implementation_plan_critic.agent.md with replan checks
7. **senior-dev-early-detection** — Update senior_developer.agent.md with oversized WI detection
8. **orchestrator-replan-flow** — Update SKILL.md with replan trigger and flow
9. **orchestrator-selective-cleanup** — Update SKILL.md planning cleanup to be version-aware
10. **orchestrator-active-wi-filter** — Update SKILL.md implementation phase to filter active WIs
11. **replan-command** — Create commands/replan.md with /rigor:replan command (accepts optional WI names to target for decomposition, invokes the workflow skill's replan flow). Completed WIs are always excluded — only pending/in-progress WIs are eligible for replanning.
12. **tests** — Update MCP server tests for new schema, tools, and query behavior
13. **readme-update** — Update README.md to document replan capability and new command
14. **schema-sql-reference** — Update schema.sql reference file to match migration 005
15. **agents-md-update** — Update AGENTS.md if any new invariants are introduced

## Dependencies

- 1 (migration) blocks 2, 3, 14
- 2, 3 (tool changes) block 8, 9, 10 (orchestrator changes)
- 4, 5 (planner changes) can proceed in parallel with tool changes
- 6 (critic changes) depends on 5 (planner changes define what critic validates)
- 7 (senior dev changes) is independent
- 8 (orchestrator replan flow) blocks 11 (replan command)
- 12 (tests) depends on 1, 2, 3
- 13, 15 (docs) depend on all others

## Migration Path for Existing Projects

**Zero-disruption upgrade:**

1. Migration 005 runs automatically on next MCP server startup (migrate.js handles this)
2. All existing work_items get safe defaults: plan_version=1, superseded_at=NULL
3. All existing plan_overview rows get plan_version=1
4. Existing projects that never replan: zero behavioral change — all queries default to active WIs, which is what they return today
5. The `superseded: false` default filter means existing orchestrator logic works unchanged until SKILL.md is updated
6. New SKILL.md replan flow only activates when explicitly triggered — existing flows are unaffected

**Risk:** The plan_overview table recreation (rename-create-copy-drop) briefly locks the table. This is the same pattern used in migration 002 and is atomic within a transaction.
