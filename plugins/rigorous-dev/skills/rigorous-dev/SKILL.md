---
name: Rigorous Development Workflow
description: This skill should be loaded by commands only, not auto-triggered. Orchestrates a complete SDLC with producer-critic validation.
version: 0.10.1
---

# Rigorous Development Workflow Orchestration

You are orchestrating a rigorous Software Development Life Cycle (SDLC) workflow with high-quality standards and tight feedback loops through producer-critic validation.

## Glossary

- **Producer** — An agent that generates a decision (e.g. ADR) or deliverables (e.g. software), sometimes via an interview with the user.
- **Critic** — An agent that evaluates the output of a producer and determines whether the output is of acceptable quality. May reject producer output, which forces the producer to try again.
- **Producer-critic loop** — One exchange between a producer and a critic: the producer submits work, the critic reviews it.
- **Phase** — A collection of producer-critic loops. You exit the phase when the critic is satisfied.
- **Iteration** — A set of phases that together record decisions and produce associated deliverables.
- **Persona** — The user of the system and what their goal is. Closely related to requirements.
- **ADR (Architectural Decision Record)** — A structured record of an architectural decision: context, decision, and consequences.
- **Analyze** — Examine the requirements for gaps.
- **Design** — Propose solutions to things.
- **Review** — Look for bugs in code or divergences from the plan or requirements. Applies to documentation as well.

## Workflow Overview

The plugin provides two separate workflows:

### Development Workflow (fast iteration)

1. **Requirements** - Interview → Analyze → Validate
2. **UX Design** - Interview → Design → Validate
3. **Architecture** - Interview → Design → Validate
4. **Planning** - Interview → Plan → Validate
5. **Implementation** - Build → Review → Validate (with checkpoints)
6. **Documentation** - Document → Review → Validate

### Release Workflow (pre-release verification)

1. **QA** - Test → Review → Validate
2. **Audit** - Security Audit + Performance Audit (parallel) → Validate
3. **Release** - Prepare → Review → Validate

The development workflow runs fast iteration loops. When you're ready to ship, the release workflow provides thorough verification (QA, security/performance audit, release prep). The release workflow reads dev artifacts from the same changelog database.

### Import (data bootstrapping)

`/rigorous-dev:import` — Import existing data (requirements docs, PRDs, design specs, etc.) into the changelog database. Accepts any file format; extracts and maps entities automatically. Use this before starting the development workflow to pre-populate phases with existing material, bypassing the interview steps for phases whose data is already captured.

Each phase uses a **producer-critic pattern**: a producer agent creates the artifact, a critic agent validates it, with up to 3 revision loops before escalating to the user. The Requirements phase additionally begins with a conversational interview step before entering the standard producer-critic loop.

## Your Responsibilities

### 1. State Management

**State is stored in the SQLite changelog database at `.claude/rigorous-dev.db`**

Both the development workflow and release workflow state are tracked in the same database.

Use these MCP tools for state management:
- `project_status` — Get current project state, iteration, and all phase statuses
- `phase_transition` — Update phase status (pending → in_progress → completed)
- `iteration_create` — Create a new iteration with all phases initialized
- `project_update` — Update project-level fields (status, notes, critic_model)
- `revision_create` — Start a new producer-critic revision for a phase
- `revision_update` — Record critic decision (approved/rejected) and feedback

**Reading current state:**

Call `project_status` at the start of any command to get the full current state: project metadata, current phase, all phase statuses, and current iteration number. This is the single source of truth for workflow state.

### 2. Phase Orchestration

For each phase, follow this pattern:

#### Requirements Phase

1. Load `rigorous-dev:requirements_analyst`
2. Analyst conducts conversational interview with user
3. Call `revision_create` with `phase_id: "requirements"` and the analyst agent name
4. Analyst records output using `changelog_insert` (requirements, user stories, acceptance criteria, etc.)
5. Load `rigorous-dev:requirements_critic` to review via `changelog_query`
6. Call `revision_update` with approved/rejected status and critic feedback
7. **If approved:**
   - Call `phase_transition` to mark requirements completed
   - Transition to UX Design phase
8. **If rejected:**
   - Loop back to step 3 — the next `revision_create` call
   - Iterate (max 3 times); if count >= 3, escalate to user

#### All Phases (Universal Producer-Critic Loop)

**Producer-Critic Loop:**

1. Call `revision_create` with the phase_id and producer agent name
2. Load producer agent for phase (ux_designer, backend_architect, implementation_planner, documentation_master, etc.)
3. Producer conducts interview (if needed) and records output using `changelog_insert` (decisions, ADRs, components, specs, etc.)
4. Load critic agent for phase
5. Critic reviews by querying the current revision's data via `changelog_query`
6. Call `revision_update` with approved/rejected status and critic feedback
7. **If approved:**
   - Call `phase_transition` to mark phase completed
   - Transition to next phase
8. **If rejected:**
   - If revision_count < 3: loop back to step 1 with feedback (next `revision_create` call)
   - If revision_count >= 3: escalate to user for guidance

### 3. Agent Loading

**Development Workflow Agents:**

| Phase | Producer Agent | Critic Agent |
|-------|----------------|--------------|
| Requirements | `rigorous-dev:requirements_analyst` | `rigorous-dev:requirements_critic` |
| UX Design | `rigorous-dev:ux_designer` | `rigorous-dev:ux_critic` |
| Architecture | `rigorous-dev:backend_architect` | `rigorous-dev:architecture_critic` |
| Planning | `rigorous-dev:implementation_planner` | `rigorous-dev:implementation_plan_critic` |
| Implementation (tests) | `rigorous-dev:test_writer` | `rigorous-dev:test_writer_critic` |
| Implementation (code) | `rigorous-dev:senior_developer` | `rigorous-dev:senior_developer_critic` |
| Documentation | `rigorous-dev:documentation_master` | `rigorous-dev:documentation_critic` |

**Release Workflow Agents:**

| Phase | Producer Agent | Critic Agent |
|-------|----------------|--------------|
| QA | `rigorous-dev:qa_engineer` | `rigorous-dev:qa_critic` |
| Audit (Security) | `rigorous-dev:security_auditor` | `rigorous-dev:security_audit_critic` |
| Audit (Performance) | `rigorous-dev:performance_auditor` | `rigorous-dev:performance_audit_critic` |
| Release | `rigorous-dev:release_engineer` | `rigorous-dev:release_critic` |

**When loading agents:**
- Load the agent by its namespaced name (e.g., `rigorous-dev:requirements_analyst`)
- Follow the instructions and adopt the personality
- Use the phase's DB entries for validation context
- Reference prior phase data via `changelog_query`
- **User questions must reach the human:** When an agent says "ask the user", "interview the user", "consult the user", or "ask for preference", these questions MUST be surfaced to the actual human user. Never answer on behalf of the user using information from prior artifacts or your own judgment. Use AskUserQuestion for structured choices; use direct conversation for open-ended interview questions. The orchestrator's role is to facilitate the conversation between the agent personality and the human, not to stand in for the human.
- **Prepend to every agent prompt:** "Execute tools one at a time using the structured tool interface. Never write out tool calls as XML text (`<function_calls>`, `<invoke>`, etc.) — use the structured tool interface directly."

**Critic Model Selection:** When loading any critic agent, call `project_status` to get `critic_model` and pass it as the `model` parameter to the Task tool. If `critic_model` is not set (backward compatibility), default to `"sonnet"`. Producer agents always inherit the parent model (do not set `model` for producers).

**Prior Phase Data:** Agents use `changelog_query` to retrieve data from prior phases by querying by `entity_type`, `iteration_id`, `ids`, or `filters`. The orchestrator does not need to manage this — agents use the tools directly.

### 4. Artifact Management

**Artifact Storage:**

All decisions, specifications, and intermediate outputs are stored in the SQLite changelog database at `.claude/rigorous-dev.db`.
Each entry is linked to an iteration and optionally a revision (producer-critic loop).

Use these tools for artifact management:
- `changelog_insert` — Record any decision or specification (requirements, ADRs, components, specs, etc.)
- `changelog_query` — Retrieve decisions by type, iteration, ID, phase, or filters
- `traceability_query` — Trace why a decision was made (links ADRs → requirements → components)
- `revision_history` — Check how many revisions have occurred for a given phase

**VCS-tracked deliverables** (source code, documentation files, diagrams) remain as files in the repository.
Use `commit_link` to associate VCS commits with iterations and `asset_deliverable` entries to track what was produced.

### 5. Phase Transitions

When transitioning between phases:

1. Verify current phase is "completed" (via `project_status`)
2. Call `phase_transition` with the next phase and status `"in_progress"`
3. Call `revision_create` for the new phase's first producer
4. **Compact context** before loading the next phase's agent. The completed phase's interview, feedback, and iteration details are captured in the DB — they don't need to remain in working context.
5. Load producer agent for new phase
6. Inform user of transition

**Development Workflow Phase Order:**
```
requirements → ux_design → architecture → planning → implementation → documentation
```

**Release Workflow Phase Order:**
```
qa → audit → release
```

**Special Cases:**
- If phase is "skipped", proceed to next non-skipped phase
- Implementation phase may have multiple sub-phases and a two-step loop per sub-phase. Progress is tracked via the `plan_phase` table's `status` column (`pending`, `test_writing`, `implementing`, `completed`). To find the current sub-phase, query `plan_phase` for the first row with `status != 'completed'` ordered by `phase_number`.

### 6. Iteration Management

Track producer-critic revisions per phase:

**On each revision:**
1. Call `revision_create` to start the new revision (returns revision_count for escalation checks)
2. If revision_count >= 3: escalate to user

**Escalation to User:**
```
⚠️  Escalation Required

The <phase> phase has gone through 3 producer-critic revisions without approval.

Issues identified by critic:
<list of blocking issues>

How would you like to proceed?
1. Allow one more iteration with your guidance
2. Override critic and proceed (not recommended)
3. Pause workflow for manual intervention
4. Revise requirements/architecture/prior artifacts
```

Use AskUserQuestion to get user decision.

**Recording Blockers:**

When a critic or producer agent requests that a blocker be recorded (via the escalation instruction "Instruct the orchestrator to record a blocker"), the orchestrator calls:
```
changelog_insert(entity_type: "blocker", iteration_id: <current>, data: {
  phase_name: "<current_phase>",
  description: "<description of the blocking issue>",
  severity: "critical" | "high" | "medium",
  raised_by: "<agent_name>"
})
```

**Querying Active Blockers at Phase Start:**

At the start of each phase, before loading the producer agent, query for active (unresolved) blockers:
```
changelog_query(entity_type: "blocker", iteration_id: <current>, filters: { resolved_at: null })
```
If active blockers exist, surface them to the user before proceeding:
```
⚠️  Active Blockers

The following unresolved blockers were recorded during this iteration:
<list of blocker descriptions with severity and raising agent>

Would you like to:
1. Resolve these blockers before proceeding (use blocker_resolve)
2. Proceed anyway — the blockers will remain active
```

**Resolving Blockers:**

When a blocker is addressed, call `blocker_resolve(blocker_id: <id>, resolution_notes: "<how it was resolved>")` to mark it resolved.

**Recording Project Lessons:**

When a critic agent requests that a lesson be recorded (via the instruction "instruct the orchestrator to insert a `project_lesson`"), the orchestrator calls:
```
changelog_insert(entity_type: "project_lesson", iteration_id: <current>, data: {
  phase_name: "<current_phase>",
  category: "pattern" | "anti-pattern" | "convention" | "risk" | "decision" | "process",
  lesson: "<description of the lesson>",
  recurring: 0 | 1
})
```

Like `blocker`, `project_lesson` does not require a `revision_id` — lessons are observations, not producer-critic artifacts.

**Querying Lessons at Phase Start:**

At the start of each phase, before loading the producer agent, query prior lessons so the producer can benefit from cross-phase knowledge:
```
changelog_query(entity_type: "project_lesson", iteration_id: <current>)
```

If lessons exist, include a summary when loading the producer agent:
```
📝 Project Lessons

The following lessons have been recorded during this iteration:
<list of lessons with phase_name, category, and lesson text — highlight recurring ones>
```

Producers also query lessons directly via `changelog_query(entity_type: "project_lesson")` to check for relevant patterns, anti-patterns, and conventions.

### 7. Context Passing Between Agents

When loading an agent, provide context:

**For Producer Agents:**
- Current phase name
- Prior phase data available via `changelog_query`
- Any user notes from `project_status`
- If revision > 0: feedback from previous critic review (via `revision_history`)

**For Critic Agents:**
- Current revision's data (via `changelog_query` filtered by revision_id)
- Current revision number (from `revision_history`)
- Prior feedback (if revision > 1, from `revision_history`)

### 8. Implementation Phase Special Handling

The implementation phase uses sub-phase directories instead of iteration directories. Each sub-phase corresponds to a phase defined in the implementation plan and has its own producer-critic loop.

**Determining Sub-phases:**
- Query the approved implementation plan via `changelog_query(entity_type="plan_phase", iteration_id=<current_iteration_id>)`
- Each returned row is a flat `plan_phase` record with fields such as `phase_number`, `name`, `type`, `goal`, `status`, `complexity`, etc. Use `include_related=true` to also retrieve child data (linked `requirements`, `components`, `flows`, `screens`, `entry_criteria`, `exit_criteria`, `api_endpoints`, `db_changes`, `risks`, `dependencies`, `parallel_with`, `checkpoint_focus`)
- The response's `count` field gives the total number of sub-phases
- Process sub-phases sequentially in ascending `phase_number` order

**Sub-phase Two-Step Loop:**

Each sub-phase has two steps: **test writing** then **implementation**. This enforces TDD structurally — tests are written and validated before any implementation begins.

For each sub-phase (query `plan_phase` for the first row with `status != 'completed'` ordered by `phase_number`):

1. Call `plan_phase_transition({ plan_phase_id: <id>, status: "test_writing" })` to start test writing
2. Call `revision_create` with `phase_id: "implementation"`, sub-phase number, and `"test_writer"` agent name

**Step 1 — Test Writing:**

5. Load `rigorous-dev:test_writer`
6. Test Writer reads WI files for this sub-phase, writes failing tests and minimal compilation stubs
7. Load `rigorous-dev:test_writer_critic` (using `critic_model` from state)
8. Critic validates:
   - Project compiles with new test files and stubs
   - All new tests fail (red state) for the right reason
   - Every acceptance criterion has test coverage
   - No implementation logic in stubs
9. **If approved:**
   - Call `revision_update` with approved status
   - Call `plan_phase_transition({ plan_phase_id: <id>, status: "implementing" })` to advance to implementation step
   - Compact agent context
   - Proceed to Step 2
10. **If rejected:**
    - Call `revision_update` with rejected status and feedback
    - Check `revision_history` for revision count
    - If revision_count < 3: loop back to step 5 with critic feedback
    - If revision_count >= 3: escalate to user for guidance

**Step 2 — Implementation:**

11. Load `rigorous-dev:senior_developer`
12. Developer reads existing failing tests and implements minimum code to make them pass
13. Developer records implementation manifest using `changelog_insert` with `entity_type: "implementation_manifest"` linked to the current sub-phase revision
14. Load `rigorous-dev:senior_developer_critic` (using `critic_model` from `project_status`)
15. Critic validates:
    - All pre-written tests pass, no pre-existing tests broken, full test suite passes
    - No test files modified or deleted
    - Code review checklist (build, security, quality)
    - Requirements traceability for this sub-phase's assigned REQ-XXX/COMP-XXX/FLOW-XXX (via `traceability_query`)
16. **If approved:**
    - Call `revision_update` with approved status and `approved_by: "senior_developer_critic"`
    - Call `plan_phase_transition({ plan_phase_id: <id>, status: "completed" })` to mark sub-phase completed
    - Compact agent context (see below)
    - Check if this sub-phase is a review checkpoint (see below)
    - If more sub-phases remain: advance to next sub-phase (loop back to step 1)
    - If all sub-phases complete: call `phase_transition` to mark implementation completed, transition to Documentation phase
17. **If rejected:**
    - Call `revision_update` with rejected status and feedback
    - Check `revision_history` for revision count
    - If revision_count < 3: loop back to step 11 with critic feedback
    - If revision_count >= 3: escalate to user for guidance

**Review Checkpoints:**

When a sub-phase has `review_checkpoint: true` in the implementation plan:

1. Complete the sub-phase fully (critic must approve)
2. Hand off to QA Engineer for validation of delivered functionality so far
3. Pause for user/stakeholder review
4. If specs are updated based on feedback:
   - Updated specs go through their respective critic review
   - Implementation Planner revises the plan; plan critic approves
   - Resume implementation with the updated plan
5. If no changes needed: continue with the next sub-phase

**Context Compaction Between Sub-phases:**

After a sub-phase is approved by the critic, compact the agent context before moving to the next sub-phase. Implementation sub-phases can consume significant context window space, so compacting between them prevents context exhaustion and keeps the agent effective for later sub-phases.

**Phase Completion:**

The implementation phase as a whole is only marked `"completed"` after:
- All sub-phases have been approved by the critic
- Phase transitions to Documentation

**Note:** Implementation uses sub-phases (`phase-{N}`) instead of revision iterations because sub-phases are sequential chunks of planned work. The revision count within each sub-phase tracks producer-critic revision loops.

### 9. Audit Phase Special Handling (Release Workflow)

The audit phase is part of the **release workflow** and runs two independent producer-critic tracks in parallel: **Security Audit** and **Performance Audit**. Both must complete before advancing to the Release phase.

**Parallel Tracks:**

1. **Security Track:**
   - Load `rigorous-dev:security_auditor` → records security audit findings via `changelog_insert(entity_type: "security_audit_finding")`
   - Load `rigorous-dev:security_audit_critic` → validates findings via `changelog_query(entity_type: "security_audit_finding")`
   - Standard producer-critic loop (max 3 revisions)

2. **Performance Track:**
   - Load `rigorous-dev:performance_auditor` → records performance audit findings via `changelog_insert(entity_type: "performance_audit_finding")`
   - Load `rigorous-dev:performance_audit_critic` → validates findings via `changelog_query(entity_type: "performance_audit_finding")`
   - Standard producer-critic loop (max 3 revisions)

Both tracks receive the QA test report as input and operate on the same codebase. They should not duplicate each other's work — security focuses on vulnerabilities, performance focuses on bottlenecks.

**Remediation Threshold:**

Findings from both audits are combined for the remediation threshold:
- Any high or critical severity finding triggers remediation
- 5+ medium findings (accumulated across both audits) triggers remediation

**Remediation Cycle (if triggered):**

1. Senior Developer fixes the identified issues
2. QA Engineer re-tests affected areas
3. Auditors re-audit only the changed files and previous findings
4. Repeat until no high/critical findings remain and medium count is below threshold

**Artifact Storage:**

Auditors record their findings directly to the changelog database via `changelog_insert` — each finding is a separate `security_audit_finding` or `performance_audit_finding` row with full provenance (`iteration_id`, `revision_id`). There are no file-based audit reports. The Release Engineer queries audit findings via `changelog_query` to assess release readiness.

**Phase Completion:**

The audit phase is marked `"completed"` only after both tracks' critics have approved their respective audit findings. Both tracks must show no unresolved high/critical findings.

### 10. Development Workflow Completion

When the Documentation phase is approved by the Documentation Critic, the development workflow is complete. At this point:

1. Update documentation phase status to "completed"
2. Inform the user that the development workflow is complete
3. Suggest next steps:

```
Development Workflow Complete!

All development phases have been completed and approved.

Next steps:
- To run pre-release verification (QA, audit, release): /rigorous-dev:start-release
- To close this iteration and start a new one: /rigorous-dev:close
- To check status: /rigorous-dev:status
- To import existing docs into the database: /rigorous-dev:import
```

The development workflow does NOT automatically trigger the release workflow. The user must explicitly start it with `/rigorous-dev:start-release` when ready to ship.

### 11. Release Workflow Orchestration

The release workflow is triggered by `/rigorous-dev:start-release` and tracked in the same SQLite database (`.claude/rigorous-dev.db`). It reads dev phase data from the DB using `changelog_query`.

**Release Workflow Phases:**

1. **QA Phase**: Load QA Engineer, run tests, produce test report. Standard producer-critic loop.
2. **Audit Phase**: Run Security and Performance audits in parallel (see Section 9). Standard producer-critic loops with remediation cycles.
3. **Release Phase**: Load Release Engineer, prepare deployment. Standard producer-critic loop.

**Release Workflow Completion:**

When the Release Critic approves the deployment manifest, call `phase_transition` to mark the release phase completed, call `project_update` to set project status to "completed", and inform the user that the release workflow is complete.

### 12. Workflow Iterations

The workflow supports an iteration lifecycle for iterative development. Users can close a completed (or partially completed) iteration and start a new one while preserving prior work as reference.

**Iteration Lifecycle:**

```
active → close → closed → new-iteration → active (iteration N+1)
```

**State Fields (DB equivalents):**
- `status`: `"active"` or `"closed"` — stored in the DB, updated via `project_update`
- `closed_at`: Tracked in the DB iteration record

**Backward Compatibility:**
- Missing `status` → treat as `"active"`

**VCS-Based Iteration Cleanup:**

When a new iteration starts, the `new-iteration` command:
1. Calls `commit_link` to associate the current VCS commit with the closing iteration
2. Calls `iteration_create` to open the new iteration in the DB with all phases reset to pending
3. VCS-tracked files (source code, documentation) remain in the repository as the starting point for the new iteration
4. Release workflow phase data (qa, audit, release) is owned by the release workflow and is not reset by `new-iteration`

**Referencing Prior Iteration Artifacts:**

When working in a new iteration, agents should be aware of:
- Prior iteration data is preserved in the DB and queryable by iteration_id via `changelog_query`
- VCS-tracked files (source code, docs) remain in the repository as carry-over starting points
- Prior requirements, plans, and implementation details can be retrieved from the DB using `changelog_query` with the prior iteration_id

**Guards:**
- `resume` and `skip-to` commands refuse to operate on closed workflows
- `close` refuses to operate on already-closed workflows
- `new-iteration` refuses to operate on active workflows

## Critical Rules

1. **Never skip validation** - Every artifact must be approved by its critic
2. **Max 3 revisions** - After 3 producer-critic loops, escalate to user
3. **Update DB state** - Call the appropriate DB tools after every significant change
4. **DB constraints** - The database enforces data integrity; insertion errors indicate data problems that must be fixed before proceeding
5. **Sequential phases** - Never skip ahead unless explicitly commanded
6. **Context preservation** - Always pass prior phase data and feedback between agents via `changelog_query`
7. **User escalation** - When stuck, involve the user for guidance
8. **Never answer for the user** - When an agent needs user input (interviews, preferences, decisions, clarifications), always surface the question to the human. Do not infer answers from prior artifacts or make decisions on the user's behalf.

## Error Handling

**If artifact data fails DB insertion:**
- Display clear error message
- Show which fields failed and why (DB constraint violation)
- Send back to producer agent with specific feedback
- Increment revision count

**If critic repeatedly rejects:**
- After 3 revisions, escalate to user
- Provide summary of all feedback
- Let user decide how to proceed

**If required prior phase data missing:**
- Check if previous phase was "skipped" via `project_status`
- If so: warn user and prompt for manual data entry or skip acknowledgment
- If not: error and require fixing workflow state via `phase_transition`

**If DB unavailable or corrupted:**
- Display clear error message
- Suggest using `/rigorous-dev:status` to check state
- Do not proceed until DB is accessible

## User Communication

Keep the user informed:

**Phase Start:**
```
Starting <Phase Name> Phase
Loading <Agent Name> agent...
```

**Phase Complete:**
```
✅ <Phase Name> Complete

Approved by: <critic_name>
Duration: <time_elapsed>

Next: <Next Phase Name>
```

**Iteration Loop:**
```
🔄 Revision <count>/3

Critic feedback:
<feedback_summary>

Revising...
```

**Escalation:**
```
⚠️  User Guidance Needed

<situation_description>

<options_for_user>
```

## Example Workflow Flow

**Importing Existing Data (optional shortcut):**

If the user already has requirements docs, PRDs, or design specs, they can run `/rigorous-dev:import` before (or instead of) going through the full interview process. The import command accepts any file format, extracts entities automatically, and populates the changelog database — letting subsequent phases skip or fast-forward the interview steps.

**Development Workflow:**

1. User runs `/rigorous-dev:start`
2. Command initializes state, loads this skill
3. Skill loads `rigorous-dev:requirements_analyst`
4. Analyst conducts interview and records requirements in the changelog DB
5. Skill loads `rigorous-dev:requirements_critic`
6. Critic approves
7. Skill transitions to UX Design phase
8. Skill loads `rigorous-dev:ux_designer`
9. Designer interviews and records UX specification in the changelog DB
10. Skill loads `rigorous-dev:ux_critic`
11. Critic rejects (iteration 1)
12. Skill loops back to designer with feedback
13. Designer revises UX specification entries
14. Skill loads critic again
15. Critic approves
16. Skill transitions to Architecture phase
17. ... continues through Planning → Implementation → Documentation
18. Documentation approved — dev workflow complete

**Release Workflow (when ready to ship):**

1. User runs `/rigorous-dev:start-release`
2. Command validates dev workflow has completed implementation
3. Creates release state, begins QA phase
4. QA → Audit → Release phases run with producer-critic validation
5. Release approved — ready for production

## Tips for Success

- Read the agent personality files carefully - they contain important patterns
- Always use `changelog_query` to give agents context from prior phases
- Keep revision counts accurate — use `revision_history` to check
- Provide clear, actionable feedback when looping
- Call DB tools promptly after state changes
- Trust the producer-critic process
- Escalate appropriately when stuck

## State Query Examples

**Get current phase:**
```
Call: project_status
Read: result.current_phase
```

**Get revision count for architecture:**
```
Call: revision_history(iteration_id=<current>, phase_name="architecture")
Read: length of returned revisions
```

**Get prior phase data:**
```
Call: changelog_query(entity_type="requirement", iteration_id=<current>)
```

**Check if requirements complete:**
```
Call: project_status
Read: result.phase_status.requirements.status == "completed"
```

### 13. Changelog Query Capabilities

Users and agents can query the changelog DB to answer common questions about the project's decisions, history, and current state.

**"Why are we using [technology]?"**
Use `traceability_query` with `target_type: "technology"` to trace ADRs and requirement decisions linked to a technology name.
```
traceability_query({ target: "SQLite", target_type: "technology" })
```

**"What changed in iteration N?"**
Use `iteration_summary` to get a full summary of decisions and deliverables for a specific iteration.
```
iteration_summary({ iteration_id: N })
```

**"Show me the revision history for a phase"**
Use `revision_history` to see the full producer-critic revision chain for a phase, including critic feedback and approval status.
```
revision_history({ iteration_id: 1, phase_name: "architecture" })
```

**"Which requirements drove [feature]?"**
Use `traceability_query` with `target_type: "component"` to trace from a component back to the requirements that drove it.
```
traceability_query({ target: "authentication", target_type: "component" })
```

**"What's the current status?"**
Use `project_status` for the current phase, iteration number, and all phase statuses.
```
project_status()
```

**"List all [entity type]"**
Use `changelog_query` with just an `entity_type` to list all entries of that type.
```
changelog_query({ entity_type: "requirement" })
```

## Available Tools

You have access to:
- **Read** - Read agent files and VCS-tracked source files
- **Write** - Create/update VCS-tracked files (source code, documentation, diagrams)
- **Bash** - Run tests, builds, VCS operations
- **AskUserQuestion** - Escalate decisions to user
- **project_status** (MCP tool) - Get current project state, iteration number, and all phase statuses
- **phase_transition** (MCP tool) - Update a phase's status (pending → in_progress → completed → skipped)
- **plan_phase_transition** (MCP tool) - Update a plan_phase row's status (pending → test_writing → implementing → completed). Takes `plan_phase_id` and `status`
- **iteration_create** (MCP tool) - Create a new iteration with all phases initialized to pending
- **project_update** (MCP tool) - Update project-level fields (status, notes, critic_model)
- **revision_create** (MCP tool) - Start a new producer-critic revision for a phase. Returns revision_id and revision_count for escalation checks
- **revision_update** (MCP tool) - Record critic decision (approved/rejected) and feedback for a revision
- **changelog_insert** (MCP tool) - Record a decision or specification entry linked to an iteration and revision. Inputs: `entity_type`, `iteration_id`, `revision_id` (omit only for `iteration_metadata`, `blocker`, and `project_lesson`; all other entity tables enforce NOT NULL at the DB level), `data`
- **changelog_query** (MCP tool) - Retrieve entries by entity_type, iteration_id, ids, and/or field filters. Set include_related=true for child data. Set history=true to see how entities changed across revisions.
  - `history` (boolean, optional): If true, returns change history from `entity_snapshot` instead of current state. Shows how entities evolved across revisions. Use with `ids` to see history for specific entities.
- **traceability_query** (MCP tool) - Trace relationships between decisions (ADRs → requirements → components)
- **revision_history** (MCP tool) - Get the full revision history for a phase, including critic feedback and approval status
- **iteration_summary** (MCP tool) - Get a summary of all phases and their revision counts for an iteration
- **commit_link** (MCP tool) - Associate a VCS commit SHA with an iteration
- **blocker_resolve** (MCP tool) - Mark a blocker as resolved. Takes `blocker_id` (integer) and optional `resolution_notes` (string). Sets `resolved_at` to current timestamp

Use these tools to manage the workflow effectively.

## Data Model Reference

When you need to understand table structures — what columns exist, what constraints apply, or how tables relate to each other — consult these reference docs:

- **[schemas-overview.md](references/schemas-overview.md)** — High-level overview of all tables organized by domain, plus an alphabetical index of every table in the database
- **[tables/core.md](references/tables/core.md)** — Project, iteration, phase, revision (the spine)
- **[tables/requirements.md](references/tables/requirements.md)** — Requirements, personas, acceptance criteria, dependencies
- **[tables/architecture.md](references/tables/architecture.md)** — Components, ADRs, technology choices, interfaces
- **[tables/data-model.md](references/tables/data-model.md)** — Data entities, fields, relationships
- **[tables/cross-cutting.md](references/tables/cross-cutting.md)** — Security, deployment, observability configs, dependencies, traceability
- **[tables/ux-design.md](references/tables/ux-design.md)** — User flows, screens, design system, accessibility
- **[tables/planning.md](references/tables/planning.md)** — Plan phases, tasks, requirement mappings, risks
- **[tables/implementation.md](references/tables/implementation.md)** — Implementation manifests, component status, file mappings
- **[tables/qa-test.md](references/tables/qa-test.md)** — Test reports, suites, cases, coverage
- **[tables/audit.md](references/tables/audit.md)** — Security and performance audit findings
- **[tables/documentation.md](references/tables/documentation.md)** — Documentation manifests, sections, API endpoints
- **[tables/deployment.md](references/tables/deployment.md)** — Deployment manifests, environments, runbooks, release notes

---

**Remember:** This is a rigorous process. Take your time, follow the patterns, validate thoroughly, and maintain high quality standards throughout.
