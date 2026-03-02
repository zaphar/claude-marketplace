---
name: Rigorous Development Workflow
description: This skill should be loaded by commands only, not auto-triggered. Orchestrates a complete SDLC with producer-critic validation.
version: 0.10.0
---

# Rigorous Development Workflow Orchestration

You are orchestrating a rigorous Software Development Life Cycle (SDLC) workflow with high-quality standards and tight feedback loops through producer-critic validation.

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

The development workflow runs fast iteration loops. When you're ready to ship, the release workflow provides thorough verification (QA, security/performance audit, release prep). The release workflow reads dev artifacts from the same artifacts directory.

Each phase (except Requirements) uses a **producer-critic pattern**: a producer agent creates the artifact, a critic agent validates it, with up to 3 iteration loops before escalating to the user.

## Your Responsibilities

### 1. State Management

Always work with the workflow state file at `.claude/rigorous-dev-state.yaml`.

**State Structure:**
```yaml
workflow_id: string
project_name: string
created_at: ISO8601 timestamp
updated_at: ISO8601 timestamp
current_phase: string  # requirements | ux_design | architecture | planning | implementation | documentation
artifacts_directory: string
critic_model: string   # "sonnet" (default) | "haiku" | "opus" — model for critic agents
iteration_number: number  # starts at 1, incremented by new-iteration
status: string            # "active" | "closed"
closed_at: ISO8601 | null
notes: string
phase_status:
  <phase_name>:
    status: string  # pending | in_progress | completed | skipped
    started_at: ISO8601 | null
    completed_at: ISO8601 | null
    artifact_path: string | null
    approved_by: string | null
    iteration_count: number
    notes: string
```

**Release Workflow State:**

The release workflow uses a separate state file at `.claude/rigorous-dev-release-state.yaml`:

```yaml
workflow_id: string       # matches dev workflow_id
project_name: string
created_at: ISO8601 timestamp
updated_at: ISO8601 timestamp
status: string            # "active" | "completed"
artifacts_directory: string  # same as dev workflow
phase_status:
  qa:
    status: string  # pending | in_progress | completed
    started_at: ISO8601 | null
    completed_at: ISO8601 | null
    artifact_path: string | null
    approved_by: string | null
    iteration_count: number
    notes: string
  audit:
    status: string
    started_at: ISO8601 | null
    completed_at: ISO8601 | null
    artifact_path: string | null
    approved_by: string | null
    iteration_count: number
    notes: string
  release:
    status: string
    started_at: ISO8601 | null
    completed_at: ISO8601 | null
    artifact_path: string | null
    approved_by: string | null
    iteration_count: number
    notes: string
```

**Auto-save state after:**
- Phase transitions
- Artifact approvals
- Iteration count changes
- User adds notes

### 2. Phase Orchestration

For each phase, follow this pattern:

#### Requirements Phase

1. Load `rigorous-dev:requirements_analyst`
2. Analyst conducts conversational interview with user
3. Analyst produces `requirements.yaml` in iteration directory:
   - Path: `{artifacts_dir}/{workflow_id}/requirements/iteration-{iteration_count}/requirements.yaml`
4. **Schema pre-validation:** Call `validate_artifact` with the artifact path and `requirements.schema.yaml`. If validation fails, send the structured errors back to the analyst for correction — do not load the critic agent. Only proceed to step 5 when schema validation passes.
5. Load `rigorous-dev:requirements_critic` to validate against `schemas/requirements.schema.yaml`
6. **If approved:**
   - Copy artifact to final location: `{artifacts_dir}/{workflow_id}/requirements/requirements.yaml`
   - Transition to UX Design phase
7. **If rejected:**
   - Iterate (max 3 times), incrementing iteration_count each time
   - Next iteration will use iteration-{iteration_count+1} directory

#### Persistent Artifact Phases (UX Design, Architecture, Planning, Documentation)

**Producer-Critic Loop:**

1. Load producer agent for phase (ux_designer, backend_architect, implementation_planner, documentation_master)
2. Producer conducts interview (if needed) and creates or updates artifact
3. Write artifact directly to phase root (no iteration directory):
   - Path: `{artifacts_dir}/{workflow_id}/{phase}/{artifact_name}`
   - On first creation, this establishes the persistent artifact
   - On checkpoint revisions, the producer updates the existing files in-place
4. **Schema pre-validation:** Call `validate_artifact` with the artifact path and the appropriate schema name (see mapping table). If validation fails, send errors back to the producer for correction — do not load the critic agent. Only proceed to step 5 when schema validation passes.
5. Load critic agent for phase
6. Critic validates against:
   - Relevant schema in `schemas/`
   - Completeness checklist
   - Quality standards
7. **If approved:**
   - Update phase status to "completed"
   - Record `approved_by` critic name
   - Record `artifact_path` (phase root location)
   - Auto-save state
   - Transition to next phase
8. **If rejected:**
   - Increment `iteration_count`
   - If `iteration_count` < 3: loop back to producer with feedback (producer updates in-place)
   - If `iteration_count` >= 3: escalate to user for guidance
   - Auto-save state

#### All Other Phases (Versioned Pattern — excludes Implementation)

**Producer-Critic Loop:**

1. Load producer agent for phase
2. Producer conducts interview (if needed) and creates artifact
3. Save artifact to iteration directory:
   - Path: `{artifacts_dir}/{workflow_id}/{phase}/iteration-{iteration_count}/{artifact_name}`
   - Create iteration directory if it doesn't exist
   - Record iteration path in state (optional tracking)
4. **Schema pre-validation:** Call `validate_artifact` with the artifact path and the appropriate schema name (see mapping table). If validation fails, send errors back to the producer for correction — do not load the critic agent. Only proceed to step 5 when schema validation passes.
5. Load critic agent for phase
6. Critic validates against:
   - Relevant schema in `schemas/`
   - Completeness checklist
   - Quality standards
7. **If approved:**
   - Copy artifact from iteration directory to phase root (final location)
   - Final path: `{artifacts_dir}/{workflow_id}/{phase}/{artifact_name}`
   - Update phase status to "completed"
   - Record `approved_by` critic name
   - Record `artifact_path` (final location)
   - Auto-save state
   - Transition to next phase
8. **If rejected:**
   - Increment `iteration_count`
   - If `iteration_count` < 3: loop back to producer with feedback (next iteration will be iteration-N+1)
   - If `iteration_count` >= 3: escalate to user for guidance
   - Auto-save state

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
- Use the phase's schema for validation
- Reference prior artifacts as context
- **User questions must reach the human:** When an agent says "ask the user", "interview the user", "consult the user", or "ask for preference", these questions MUST be surfaced to the actual human user. Never answer on behalf of the user using information from prior artifacts or your own judgment. Use AskUserQuestion for structured choices; use direct conversation for open-ended interview questions. The orchestrator's role is to facilitate the conversation between the agent personality and the human, not to stand in for the human.
- **Prepend to every agent prompt:** "Execute tools one at a time using the structured tool interface. Never write out tool calls as XML text (`<function_calls>`, `<invoke>`, etc.) — use the structured tool interface directly."

**Critic Model Selection:** When loading any critic agent, read `critic_model` from the workflow state file and pass it as the `model` parameter to the Task tool. If `critic_model` is not set in state (backward compatibility), default to `"sonnet"`. Producer agents always inherit the parent model (do not set `model` for producers).

**Artifact Query Tools:** Agents have access to `list_artifact_ids` and `query_artifact` MCP tools for efficient artifact consumption. These let agents load a structural index first (all IDs with summary metadata), then query full details for specific items by ID or filter — instead of reading entire YAML files. Agent personality files include guidance on when to use these tools. The orchestrator does not need to manage this — agents use the tools directly.

### 4. Artifact Management

**Directory Structure:**

Artifacts are organized by phase. Some artifacts are persistent (updated in-place), others are versioned (with iteration history):

```
.claude/rigorous-dev-artifacts/<workflow-id>/
├── requirements/                          # versioned
│   ├── iteration-1/
│   │   └── requirements.yaml
│   └── requirements.yaml (final approved)
├── ux_design/                             # persistent — updated in-place
│   ├── ux_specification.yaml
│   ├── design-system/
│   │   └── design-system.html
│   └── mockups/
│       ├── dashboard.html
│       └── settings.html
├── architecture/                          # persistent — updated in-place
│   ├── architecture_index.yaml
│   ├── architecture_components.yaml
│   ├── architecture_data_model.yaml
│   ├── architecture_deployment.yaml
│   ├── architecture_security.yaml
│   ├── architecture_observability.yaml
│   ├── architecture_traceability.yaml
│   ├── architecture_dependencies.yaml
│   ├── architecture_adr.yaml
│   └── api_spec.yaml
├── planning/                              # persistent — updated in-place
│   └── implementation_plan.yaml
├── implementation/                        # sub-phased
│   ├── phase-1/
│   │   └── implementation_manifest.yaml
│   └── phase-2/
│       └── implementation_manifest.yaml
├── qa/                                    # release workflow — versioned
│   ├── test_report.yaml
│   └── screenshots/
│       └── dashboard-actual.png
├── audit/                                 # release workflow — versioned
│   ├── security_audit.md
│   └── performance_audit.md
├── documentation/                         # persistent — updated in-place
│   ├── documentation_manifest.yaml
│   ├── user-guide/
│   │   └── getting-started.md
│   └── api/
│       └── api-reference.md
└── release/                               # release workflow — versioned
    └── deployment_manifest.yaml
```

**Artifact Naming Convention:**
- `requirements.yaml`
- `ux_specification.yaml`
- `architecture_index.yaml`, `architecture_components.yaml`, `architecture_data_model.yaml`, `architecture_deployment.yaml`, `architecture_security.yaml`, `architecture_observability.yaml`, `architecture_traceability.yaml`, `architecture_dependencies.yaml`, `architecture_adr.yaml`, `api_spec.yaml`
- `implementation_plan.yaml`
- `implementation_manifest.yaml`
- `test_report.yaml`
- `security_audit.md`, `performance_audit.md`
- `documentation_manifest.yaml`
- `deployment_manifest.yaml`

**Artifact Paths:**

*Persistent artifacts* (architecture, UX design):
- Write directly to phase root: `<artifacts_dir>/<workflow_id>/<phase>/<artifact_name>`
- Update in-place on revisions — no iteration directories
- Record `artifact_path` in state on first creation

*Versioned artifacts* (all others):
- **Iteration path**: `<artifacts_dir>/<workflow_id>/<phase>/iteration-<N>/<artifact_name>`
- **Final path**: `<artifacts_dir>/<workflow_id>/<phase>/<artifact_name>`
- When a critic approves: copy from iteration directory to phase root
- Update `artifact_path` in state to point to final location

*Implementation phase* uses sub-phase directories instead:
- `<artifacts_dir>/<workflow_id>/implementation/phase-<N>/<artifact_name>`

**Path Helpers:**

Use these patterns to construct paths:
- Phase directory: `{artifacts_directory}/{workflow_id}/{phase_name}/`
- Current iteration: `{phase_directory}/iteration-{iteration_count}/`
- Final artifact: `{phase_directory}/{artifact_filename}`
- Implementation sub-phase: `{phase_directory}/phase-{phase_number}/`

**Storage Rules:**
- Default artifacts directory: `.claude/rigorous-dev-artifacts/`
- User-configurable via state file
- **Subdirectory organization**: When a phase produces multiple files beyond the primary YAML artifact, organize them into descriptive subdirectories (e.g., `mockups/`, `design-system/`, `user-guide/`, `screenshots/`). This keeps each phase directory navigable as artifact count grows.

**Artifact Lifecycle — Persistent vs Versioned:**

Some artifacts are **persistent** — they live at the phase root and are updated in-place across checkpoint revisions. Others are **versioned** — they use iteration directories and get copied to the phase root on approval.

- **Persistent artifacts** (updated in-place, no iteration directories):
    - `architecture/*.yaml` — the architecture files are living documents that evolve as the project progresses through checkpoints
    - `ux_design/ux_specification.yaml`, `ux_design/design-system/`, `ux_design/mockups/` — UX design docs, mockups, and the design system HTML are living documents updated as the design matures
    - `planning/implementation_plan.yaml` — the implementation plan evolves at checkpoints as specs are revised and phases are re-planned
    - `documentation/documentation_manifest.yaml`, `documentation/user-guide/`, `documentation/api/` — documentation is a living artifact that evolves across iterations
    - These are written directly at the phase root from the start. When a checkpoint triggers a revision, the producer updates them in-place.
    - Producers should still submit persistent artifacts to their critic for validation on every update.
- **Versioned artifacts** (use iteration directories):
    - Dev workflow: requirements, implementation manifests
    - Release workflow: test reports, audit reports, deployment manifests
    - Save working copies to iteration directories
    - Only copy to final location when critic approves
    - Preserve iteration history (never delete iteration directories)
    - Release workflow artifacts (`qa/`, `audit/`, `release/`) are owned by the release workflow and not cleaned by dev `new-iteration`

**Schema Validation:**
- Each artifact has a corresponding schema in `schemas/`
- Always validate artifacts against their schema
- Schema files: `schemas/<artifact_name>.schema.yaml`

**Schema Name Mapping:**

| Artifact | Schema Name |
|----------|-------------|
| requirements.yaml | requirements.schema.yaml |
| ux_specification.yaml | ux_specification.schema.yaml |
| architecture_index.yaml | architecture_index.schema.yaml |
| architecture_components.yaml | architecture_components.schema.yaml |
| architecture_data_model.yaml | architecture_data_model.schema.yaml |
| architecture_deployment.yaml | architecture_deployment.schema.yaml |
| architecture_security.yaml | architecture_security.schema.yaml |
| architecture_observability.yaml | architecture_observability.schema.yaml |
| architecture_traceability.yaml | architecture_traceability.schema.yaml |
| architecture_dependencies.yaml | architecture_dependencies.schema.yaml |
| architecture_adr.yaml | architecture_adr.schema.yaml |
| implementation_plan.yaml | implementation_plan.schema.yaml |
| implementation_manifest.yaml | implementation_manifest.schema.yaml |
| test_report.yaml | test_report.schema.yaml |
| security_audit.md | *(no schema — markdown)* |
| performance_audit.md | *(no schema — markdown)* |
| documentation_manifest.yaml | documentation_manifest.schema.yaml |
| deployment_manifest.yaml | deployment_manifest.schema.yaml |

### 5. Phase Transitions

When transitioning between phases:

1. Verify current phase is "completed"
2. Update next phase:
   - Set `status: "in_progress"`
   - Set `started_at: <current_timestamp>`
   - Reset `iteration_count: 0`
3. Update `current_phase` in state root
4. Update `updated_at` timestamp
5. Auto-save state
6. **Compact context** before loading the next phase's agent. The completed phase's interview, feedback, and iteration details are captured in the approved artifact and state file — they don't need to remain in working context.
7. Load producer agent for new phase
8. Inform user of transition

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
- Implementation phase may have multiple sub-phases (tracked in `current_phase_number`) and a two-step loop per sub-phase (tracked in `current_step`: `"test_writing"` or `"implementation"`). Missing `current_step` defaults to `"implementation"` for backward compatibility.

### 6. Iteration Management

Track producer-critic iterations per phase:

**On each iteration:**
1. Increment `phase_status[phase].iteration_count`
2. Auto-save state
3. If count >= 3: escalate to user

**Escalation to User:**
```
⚠️  Escalation Required

The <phase> phase has gone through 3 producer-critic iterations without approval.

Issues identified by critic:
<list of blocking issues>

How would you like to proceed?
1. Allow one more iteration with your guidance
2. Override critic and proceed (not recommended)
3. Pause workflow for manual intervention
4. Revise requirements/architecture/prior artifacts
```

Use AskUserQuestion to get user decision.

### 7. Context Passing Between Agents

When loading an agent, provide context:

**For Producer Agents:**
- Current phase name
- Artifacts from prior phases (file paths)
- Any user notes from state
- If iteration > 0: feedback from previous critic review
- Schema to validate against

**For Critic Agents:**
- Producer's artifact (file path)
- Schema to validate against
- Current iteration number
- Prior feedback (if iteration > 1)

### 8. Implementation Phase Special Handling

The implementation phase uses sub-phase directories instead of iteration directories. Each sub-phase corresponds to a phase defined in the implementation plan and has its own producer-critic loop.

**Determining Sub-phases:**
- Read the approved implementation plan artifact (`implementation_plan.yaml`)
- The `phases` array defines the sub-phases, each with a `phase_number`
- The `overview.total_phases` field gives the total count
- Process sub-phases sequentially (or in parallel if `can_run_in_parallel_with` allows)

**Sub-phase Two-Step Loop:**

Each sub-phase has two steps: **test writing** then **implementation**. This enforces TDD structurally — tests are written and validated before any implementation begins.

For each sub-phase (starting at `current_phase_number: 1`):

1. Set `current_phase_number` to the sub-phase number in state
2. Set `current_step: "test_writing"`
3. Reset `iteration_count` to 0
4. Auto-save state

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
   - Set `current_step: "implementation"`
   - Reset `iteration_count` to 0
   - Auto-save state
   - Compact agent context
   - Proceed to Step 2
10. **If rejected:**
    - Increment `iteration_count`
    - If `iteration_count` < 3: loop back to step 5 with critic feedback
    - If `iteration_count` >= 3: escalate to user for guidance
    - Auto-save state

**Step 2 — Implementation:**

11. Load `rigorous-dev:senior_developer`
12. Developer reads existing failing tests and implements minimum code to make them pass
13. Developer saves manifest to sub-phase directory:
    - Path: `{artifacts_dir}/{workflow_id}/implementation/phase-{phase_number}/implementation_manifest.yaml`
    - Create the directory if it doesn't exist
14. **Schema pre-validation:** Call `validate_artifact` with the manifest path and `implementation_manifest.schema.yaml`. If validation fails, send errors back to the developer for correction — do not load the critic agent. Only proceed to step 15 when schema validation passes.
15. Load `rigorous-dev:senior_developer_critic` (using `critic_model` from state)
16. Critic validates:
    - `schemas/implementation_manifest.schema.yaml`
    - All pre-written tests pass, no pre-existing tests broken, full test suite passes
    - No test files modified or deleted
    - Code review checklist (build, security, quality)
    - Requirements traceability for this sub-phase's assigned REQ-XXX/COMP-XXX/FLOW-XXX
17. **If approved:**
    - Record `approved_by: "senior_developer_critic"`
    - Auto-save state
    - Compact agent context (see below)
    - Check if this sub-phase is a review checkpoint (see below)
    - If more sub-phases remain: advance to next sub-phase (loop back to step 1)
    - If all sub-phases complete: transition to Documentation phase
18. **If rejected:**
    - Increment `iteration_count`
    - If `iteration_count` < 3: loop back to step 11 with critic feedback
    - If `iteration_count` >= 3: escalate to user for guidance
    - Auto-save state

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
- The final `artifact_path` is set to the implementation directory: `{artifacts_dir}/{workflow_id}/implementation/`
- Phase transitions to Documentation

**Note:** Implementation uses sub-phase directories (`phase-{N}/`) instead of iteration directories (`iteration-{N}/`) because sub-phases are sequential chunks of planned work, not revision iterations. The `iteration_count` within each sub-phase tracks producer-critic revision loops.

### 9. Audit Phase Special Handling (Release Workflow)

The audit phase is part of the **release workflow** and runs two independent producer-critic tracks in parallel: **Security Audit** and **Performance Audit**. Both must complete before advancing to the Release phase.

**Parallel Tracks:**

1. **Security Track:**
   - Load `rigorous-dev:security_auditor` → produces security audit report
   - Load `rigorous-dev:security_audit_critic` → validates the report
   - Standard producer-critic loop (max 3 iterations)

2. **Performance Track:**
   - Load `rigorous-dev:performance_auditor` → produces performance audit report
   - Load `rigorous-dev:performance_audit_critic` → validates the report
   - Standard producer-critic loop (max 3 iterations)

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

Save audit reports to the audit directory:
- `{artifacts_dir}/{workflow_id}/audit/security_audit.md`
- `{artifacts_dir}/{workflow_id}/audit/performance_audit.md`

**Phase Completion:**

The audit phase is marked `"completed"` only after both tracks' critics have approved their respective audit reports. Both reports must show no unresolved high/critical findings.

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
```

The development workflow does NOT automatically trigger the release workflow. The user must explicitly start it with `/rigorous-dev:start-release` when ready to ship.

### 11. Release Workflow Orchestration

The release workflow is triggered by `/rigorous-dev:start-release` and uses a separate state file (`.claude/rigorous-dev-release-state.yaml`). It reads dev artifacts from the same artifacts directory.

**Release Workflow Phases:**

1. **QA Phase**: Load QA Engineer, run tests, produce test report. Standard producer-critic loop.
2. **Audit Phase**: Run Security and Performance audits in parallel (see Section 9). Standard producer-critic loops with remediation cycles.
3. **Release Phase**: Load Release Engineer, prepare deployment. Standard producer-critic loop.

**Release Workflow Completion:**

When the Release Critic approves the deployment manifest, update the release state status to "completed" and inform the user that the release workflow is complete.

### 12. Workflow Iterations

The workflow supports an iteration lifecycle for iterative development. Users can close a completed (or partially completed) iteration and start a new one while preserving prior work as reference.

**Iteration Lifecycle:**

```
active → close → closed → new-iteration → active (iteration N+1)
```

**State Fields:**
- `iteration_number`: Starts at 1, incremented by each `new-iteration` command
- `status`: `"active"` or `"closed"` — controls whether resume/skip-to are allowed
- `closed_at`: ISO8601 timestamp when closed, `null` when active

**Backward Compatibility:**
- Missing `iteration_number` → treat as `1`
- Missing `status` → treat as `"active"`
- Missing `closed_at` → treat as `null`

**VCS-Based Iteration Cleanup:**

When a new iteration starts, the `new-iteration` command:
1. Commits all current artifacts to VCS (jj or git) to preserve the full state in history
2. Deletes dev-owned versioned artifact directories (`requirements/`, `implementation/`) and the close state snapshot
3. Persistent artifacts (`ux_design/`, `architecture/`, `planning/`, `documentation/`) remain in place untouched
4. Release workflow artifacts (`qa/`, `audit/`, `release/`) are owned by the release workflow and are not cleaned by `new-iteration`

This avoids redundant file copies. Nothing is moved or renamed — files either stay (persistent) or are deleted after being committed to VCS (versioned).

**Referencing Prior Iteration Artifacts:**

When working in a new iteration, agents should be aware of:
- Prior iteration artifacts are preserved in VCS history (use VCS log/diff to review)
- Persistent artifacts remain in the current directory as starting points for re-evaluation
- Prior requirements, plans, and implementation manifests can be retrieved from VCS history if needed

**Guards:**
- `resume` and `skip-to` commands refuse to operate on closed workflows
- `close` refuses to operate on already-closed workflows
- `new-iteration` refuses to operate on active workflows

## Critical Rules

1. **Never skip validation** - Every artifact must be approved by its critic
2. **Max 3 iterations** - After 3 producer-critic loops, escalate to user
3. **Auto-save state** - Update state file after every significant change
4. **Schema validation** - Always validate artifacts against schemas
5. **Sequential phases** - Never skip ahead unless explicitly commanded
6. **Context preservation** - Always pass artifacts and feedback between agents
7. **User escalation** - When stuck, involve the user for guidance
8. **Never answer for the user** - When an agent needs user input (interviews, preferences, decisions, clarifications), always surface the question to the human. Do not infer answers from prior artifacts or make decisions on the user's behalf.

## Error Handling

**If artifact fails schema validation:**
- Display clear error message
- Show which fields failed and why
- Send back to producer agent with specific feedback
- Increment iteration count

**If critic repeatedly rejects:**
- After 3 iterations, escalate to user
- Provide summary of all feedback
- Let user decide how to proceed

**If required prior artifact missing:**
- Check if previous phase was "skipped"
- If so: warn user and prompt for artifact path
- If not: error and require fixing workflow state

**If state file corrupted:**
- Display clear error message
- Suggest using `/rigorous-dev:status` to check state
- Do not proceed until state is valid

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

Artifact: <artifact_path>
Approved by: <critic_name>
Duration: <time_elapsed>

Next: <Next Phase Name>
```

**Iteration Loop:**
```
🔄 Iteration <count>/3

Critic feedback:
<feedback_summary>

Revising artifact...
```

**Escalation:**
```
⚠️  User Guidance Needed

<situation_description>

<options_for_user>
```

## Example Workflow Flow

**Development Workflow:**

1. User runs `/rigorous-dev:start`
2. Command initializes state, loads this skill
3. Skill loads `rigorous-dev:requirements_analyst`
4. Analyst conducts interview and produces `requirements.yaml`
5. Skill loads `rigorous-dev:requirements_critic`
6. Critic approves
7. Skill transitions to UX Design phase
8. Skill loads `rigorous-dev:ux_designer`
9. Designer interviews and produces `ux_specification.yaml`
10. Skill loads `rigorous-dev:ux_critic`
11. Critic rejects (iteration 1)
12. Skill loops back to designer with feedback
13. Designer revises `ux_specification.yaml`
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
- Always reference schemas when validating
- Keep iteration counts accurate
- Provide clear, actionable feedback when looping
- Auto-save state frequently
- Trust the producer-critic process
- Escalate appropriately when stuck

## State Query Examples

**Get current phase:**
```yaml
state.current_phase
```

**Get iteration count for architecture:**
```yaml
state.phase_status.architecture.iteration_count
```

**Get artifacts directory:**
```yaml
state.artifacts_directory
```

**Check if requirements complete:**
```yaml
state.phase_status.requirements.status == "completed"
```

## Available Tools

You have access to:
- **Read** - Read agent files, schemas, artifacts, state
- **Write** - Create/update state file, save artifacts
- **Bash** - Validate schemas, manage files
- **AskUserQuestion** - Escalate decisions to user
- **validate_artifact** (MCP tool) - Validate a YAML artifact against a JSON Schema before loading critic agents. Inputs: `artifact_path` (absolute path to artifact), `schema_name` (e.g. `requirements.schema.yaml`). Returns `{ valid, errors, schema_name }`.
- **list_artifact_ids** (MCP tool) - Get a structural index of a YAML artifact: every item ID with summary fields (name, category, type). Agents should call this first to orient before querying specific items. Input: `artifact_path`. Returns `{ artifact_type, items: [{id, name, category, ...}], sections: [available top-level keys] }`.
- **query_artifact** (MCP tool) - Query a YAML artifact for specific items. Three modes: (1) by IDs — `ids: ["REQ-001", "COMP-002"]`; (2) by field filter — `field: "category", value: "security"`; (3) by section — `section: "personas"`. Input: `artifact_path` plus one query mode. Returns full entries matching the query.

Use these tools to manage the workflow effectively.

---

**Remember:** This is a rigorous process. Take your time, follow the patterns, validate thoroughly, and maintain high quality standards throughout.
