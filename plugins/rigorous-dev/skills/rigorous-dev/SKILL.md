---
name: Rigorous Development Workflow
description: This skill should be loaded by commands only, not auto-triggered. Orchestrates a complete SDLC with producer-critic validation.
version: 0.5.0
---

# Rigorous Development Workflow Orchestration

You are orchestrating a rigorous Software Development Life Cycle (SDLC) workflow with high-quality standards and tight feedback loops through producer-critic validation.

## Workflow Overview

The workflow follows these phases in order:

1. **Requirements** - Interview → Analyze → Validate
2. **UX Design** - Interview → Design → Validate
3. **Architecture** - Interview → Design → Validate
4. **Planning** - Interview → Plan → Validate
5. **Implementation** - Build → Review → Validate (with checkpoints)
6. **QA** - Test → Review → Validate
7. **Audit** - Security Audit + Performance Audit (parallel) → Validate
8. **Documentation** - Document → Review → Validate
9. **Release** - Prepare → Review → Validate

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
current_phase: string  # requirements | ux_design | architecture | planning | implementation | qa | audit | documentation | release
artifacts_directory: string
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

**Auto-save state after:**
- Phase transitions
- Artifact approvals
- Iteration count changes
- User adds notes

### 2. Phase Orchestration

For each phase, follow this pattern:

#### Requirements Phase

1. Load `agents/requirements_analyst.md`
2. Analyst conducts conversational interview with user
3. Analyst produces `requirements.yaml` in iteration directory:
   - Path: `{artifacts_dir}/{workflow_id}/requirements/iteration-{iteration_count}/requirements.yaml`
4. Load `agents/requirements_critic.md` to validate against `schemas/requirements.schema.yaml`
5. **If approved:**
   - Copy artifact to final location: `{artifacts_dir}/{workflow_id}/requirements/requirements.yaml`
   - Transition to UX Design phase
6. **If rejected:**
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
4. Load critic agent for phase
5. Critic validates against:
   - Relevant schema in `schemas/`
   - Completeness checklist
   - Quality standards
6. **If approved:**
   - Update phase status to "completed"
   - Record `approved_by` critic name
   - Record `artifact_path` (phase root location)
   - Auto-save state
   - Transition to next phase
7. **If rejected:**
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
4. Load critic agent for phase
5. Critic validates against:
   - Relevant schema in `schemas/`
   - Completeness checklist
   - Quality standards
6. **If approved:**
   - Copy artifact from iteration directory to phase root (final location)
   - Final path: `{artifacts_dir}/{workflow_id}/{phase}/{artifact_name}`
   - Update phase status to "completed"
   - Record `approved_by` critic name
   - Record `artifact_path` (final location)
   - Auto-save state
   - Transition to next phase
7. **If rejected:**
   - Increment `iteration_count`
   - If `iteration_count` < 3: loop back to producer with feedback (next iteration will be iteration-N+1)
   - If `iteration_count` >= 3: escalate to user for guidance
   - Auto-save state

### 3. Agent Loading

**Agent-to-File Mapping:**

| Phase | Producer Agent | Critic Agent |
|-------|----------------|--------------|
| Requirements | `agents/requirements_analyst.md` | `agents/requirements_critic.md` |
| UX Design | `agents/ux_designer.md` | `agents/ux_critic.md` |
| Architecture | `agents/backend_architect.md` | `agents/architecture_critic.md` |
| Planning | `agents/implementation_planner.md` | `agents/implementation_plan_critic.md` |
| Implementation | `agents/senior_developer.md` | `agents/senior_developer_critic.md` |
| QA | `agents/qa_engineer.md` | `agents/qa_critic.md` |
| Audit (Security) | `agents/security_auditor.md` | `agents/security_audit_critic.md` |
| Audit (Performance) | `agents/performance_auditor.md` | `agents/performance_audit_critic.md` |
| Documentation | `agents/documentation_master.md` | `agents/documentation_critic.md` |
| Release | `agents/release_engineer.md` | `agents/release_critic.md` |

**When loading agents:**
- Read the agent personality file
- Follow the instructions and adopt the personality
- Use the phase's schema for validation
- Reference prior artifacts as context

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
├── qa/                                    # versioned
│   ├── test_report.yaml
│   └── screenshots/
│       └── dashboard-actual.png
├── audit/                                 # versioned
│   ├── security_audit.md
│   └── performance_audit.md
├── documentation/                         # persistent — updated in-place
│   ├── documentation_manifest.yaml
│   ├── user-guide/
│   │   └── getting-started.md
│   └── api/
│       └── api-reference.md
└── release/                               # versioned
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
    - All other artifacts (requirements, implementation manifests, test reports, etc.)
    - Save working copies to iteration directories
    - Only copy to final location when critic approves
    - Preserve iteration history (never delete iteration directories)

**Schema Validation:**
- Each artifact has a corresponding schema in `schemas/`
- Always validate artifacts against their schema
- Schema files: `schemas/<artifact_name>.schema.yaml`

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
6. Load producer agent for new phase
7. Inform user of transition

**Phase Order (Standard):**
```
requirements → ux_design → architecture → planning → implementation → qa → audit → documentation → release
```

**Special Cases:**
- If phase is "skipped", proceed to next non-skipped phase
- Implementation phase may have multiple sub-phases (tracked in `current_phase_number`)

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

**Sub-phase Producer-Critic Loop:**

For each sub-phase (starting at `current_phase_number: 1`):

1. Set `current_phase_number` to the sub-phase number in state
2. Reset `iteration_count` to 0
3. Auto-save state
4. Load `agents/senior_developer.md`
5. Developer implements the work defined for this sub-phase in the plan
6. Developer saves manifest to sub-phase directory:
   - Path: `{artifacts_dir}/{workflow_id}/implementation/phase-{phase_number}/implementation_manifest.yaml`
   - Create the directory if it doesn't exist
7. Load `agents/senior_developer_critic.md`
8. Critic validates against:
   - `schemas/implementation_manifest.schema.yaml`
   - Code review checklist (build, tests, security, quality)
   - Requirements traceability for this sub-phase's assigned REQ-XXX/COMP-XXX/FLOW-XXX
9. **If approved:**
   - Record `approved_by: "senior_developer_critic"`
   - Auto-save state
   - Compact agent context (see below)
   - Check if this sub-phase is a review checkpoint (see below)
   - If more sub-phases remain: advance to next sub-phase (loop back to step 1)
   - If all sub-phases complete: transition to QA phase
10. **If rejected:**
    - Increment `iteration_count`
    - If `iteration_count` < 3: loop back to step 4 with critic feedback
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
- Phase transitions to QA

**Note:** Implementation uses sub-phase directories (`phase-{N}/`) instead of iteration directories (`iteration-{N}/`) because sub-phases are sequential chunks of planned work, not revision iterations. The `iteration_count` within each sub-phase tracks producer-critic revision loops.

### 9. Audit Phase Special Handling

The audit phase runs two independent producer-critic tracks in parallel: **Security Audit** and **Performance Audit**. Both must complete before advancing to the Documentation phase.

**Parallel Tracks:**

1. **Security Track:**
   - Load `agents/security_auditor.md` → produces security audit report
   - Load `agents/security_audit_critic.md` → validates the report
   - Standard producer-critic loop (max 3 iterations)

2. **Performance Track:**
   - Load `agents/performance_auditor.md` → produces performance audit report
   - Load `agents/performance_audit_critic.md` → validates the report
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

### 10. Workflow Iterations

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
2. Deletes versioned artifact directories (`requirements/`, `implementation/`, `qa/`, `audit/`, `release/`) and the close state snapshot
3. Persistent artifacts (`ux_design/`, `architecture/`, `planning/`, `documentation/`) remain in place untouched

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

1. User runs `/rigorous-dev:start`
2. Command initializes state, loads this skill
3. Skill loads `requirements_analyst.md`
4. Analyst conducts interview and produces `requirements.yaml`
5. Skill loads `requirements_critic.md`
6. Critic approves
7. Skill transitions to UX Design phase
10. Skill loads `ux_designer.md`
11. Designer interviews and produces `ux_specification.yaml`
12. Skill loads `ux_critic.md`
13. Critic rejects (iteration 1)
14. Skill loops back to designer with feedback
15. Designer revises `ux_specification.yaml`
16. Skill loads critic again
17. Critic approves
18. Skill transitions to Architecture phase
19. ... continues through all phases

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

Use these tools to manage the workflow effectively.

---

**Remember:** This is a rigorous process. Take your time, follow the patterns, validate thoroughly, and maintain high quality standards throughout.
