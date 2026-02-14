---
name: Rigorous Development Workflow
description: This skill should be loaded by commands only, not auto-triggered. Orchestrates a complete SDLC with producer-critic validation.
version: 0.1.0
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
7. **Documentation** - Document → Review → Validate
8. **Release** - Prepare → Review → Validate

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
current_phase: string  # requirements | ux_design | architecture | planning | implementation | qa | documentation | release
artifacts_directory: string
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

#### All Other Phases (Standard Pattern)

**Producer-Critic Loop:**

1. Load producer agent for phase (ux_designer, backend_architect, etc.)
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
| Documentation | `agents/documentation_master.md` | `agents/documentation_critic.md` |
| Release | `agents/release_engineer.md` | `agents/release_critic.md` |

**When loading agents:**
- Read the agent personality file
- Follow the instructions and adopt the personality
- Use the phase's schema for validation
- Reference prior artifacts as context

### 4. Artifact Management

**Directory Structure:**

Artifacts are organized by phase with iteration history:

```
.claude/rigorous-dev-artifacts/<workflow-id>/
├── requirements/
│   ├── iteration-1/
│   │   └── requirements.yaml
│   └── requirements.yaml (final approved)
├── ux_design/
│   ├── iteration-1/
│   │   ├── ux_specification.yaml
│   │   ├── design-system/
│   │   │   └── design-system.html
│   │   └── mockups/
│   │       ├── dashboard.html
│   │       └── settings.html
│   ├── ux_specification.yaml (final)
│   ├── design-system/
│   │   └── design-system.html
│   └── mockups/
│       ├── dashboard.html
│       └── settings.html
├── architecture/
│   └── backend_architecture.yaml (final)
├── planning/
│   └── implementation_plan.yaml
├── implementation/
│   ├── phase-1/
│   │   └── implementation_manifest.yaml
│   └── phase-2/
│       └── implementation_manifest.yaml
├── qa/
│   ├── test_report.yaml
│   └── screenshots/
│       └── dashboard-actual.png
├── documentation/
│   ├── documentation_manifest.yaml
│   ├── user-guide/
│   │   └── getting-started.md
│   └── api/
│       └── api-reference.md
└── release/
    └── deployment_manifest.yaml
```

**Artifact Naming Convention:**
- `requirements.yaml`
- `ux_specification.yaml`
- `backend_architecture.yaml`
- `implementation_plan.yaml`
- `implementation_manifest.yaml`
- `test_report.yaml`
- `documentation_manifest.yaml`
- `deployment_manifest.yaml`

**Artifact Paths:**

When working on an artifact:
- **Iteration path**: `<artifacts_dir>/<workflow_id>/<phase>/iteration-<N>/<artifact_name>`
- **Final path**: `<artifacts_dir>/<workflow_id>/<phase>/<artifact_name>`

When a critic approves an artifact:
- Copy from iteration directory to phase root (final location)
- Update `artifact_path` in state to point to final location

Implementation phase uses sub-phase directories instead:
- `<artifacts_dir>/<workflow_id>/implementation/phase-<N>/<artifact_name>`

**Path Helpers:**

Use these patterns to construct paths:
- Phase directory: `{artifacts_directory}/{workflow_id}/{phase_name}/`
- Current iteration: `{phase_directory}/iteration-{iteration_count}/`
- Final artifact: `{phase_directory}/{artifact_filename}`
- Implementation sub-phase: `{phase_directory}/phase-{phase_number}/`

**Storage Rules:**
- Always save working artifacts to iteration directories
- Only copy to final location when critic approves
- Preserve iteration history (never delete iteration directories)
- Default artifacts directory: `.claude/rigorous-dev-artifacts/`
- User-configurable via state file
- **Subdirectory organization**: When a phase produces multiple files beyond the primary YAML artifact, organize them into descriptive subdirectories (e.g., `mockups/`, `design-system/`, `user-guide/`, `screenshots/`). This keeps each phase directory navigable as artifact count grows.

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
requirements → ux_design → architecture → planning → implementation → qa → documentation → release
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

The implementation phase is unique:

**Checkpoints:**
- Implementation plan defines checkpoints (usually after Phase 1)
- At each checkpoint: pause and review with user
- User can provide feedback or adjustments
- Update `implementation_manifest.yaml` with checkpoint status

**Sub-phases:**
- Track `current_phase_number` (1, 2, 3, etc.)
- Each sub-phase is a chunk of work stored in its own directory:
  - Path: `{artifacts_dir}/{workflow_id}/implementation/phase-{phase_number}/implementation_manifest.yaml`
- Senior Developer implements, Senior Developer Critic reviews
- Each sub-phase directory preserves the manifest for that phase of work
- Only after all sub-phases complete does phase transition to QA

**Note:** Implementation uses sub-phase directories instead of iteration directories because phases are sequential chunks of planned work, not revision iterations.

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
