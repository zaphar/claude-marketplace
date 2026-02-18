---
description: Resume an existing rigorous development workflow
allowed-tools:
  - Read
  - Write
  - Bash
---

# Resume Rigorous Development Workflow

Resume an existing rigorous development workflow from saved state.

## What This Command Does

1. Checks if a workflow exists (error if it doesn't)
2. Loads workflow state from `.claude/rigorous-dev-state.yaml`
3. Displays current status
4. Loads the rigorous-dev skill with context
5. Continues from the current phase

## Implementation Steps

### 1. Check for Workflow State

Check if `.claude/rigorous-dev-state.yaml` exists:

```bash
if [ ! -f .claude/rigorous-dev-state.yaml ]; then
  echo "ERROR: No workflow found in this project."
  echo "Use /rigorous-dev:start to initialize a new workflow."
  exit 1
fi
```

### 2. Check Workflow Status

After loading the state, check if the workflow is closed:

- If `status` field is missing, treat as `"active"` (backward compatibility)
- If `status == "closed"`, display error:

```
ERROR: This workflow is closed (iteration <iteration_number>).
A closed workflow cannot be resumed.
Use /rigorous-dev:new-iteration to start a new iteration.
```

### 3. Load Workflow State

Read and parse `.claude/rigorous-dev-state.yaml` to extract:
- Project name
- Current phase
- Phase status
- Artifacts directory
- Iteration counts
- Notes

### 4. Display Status Summary

Show a concise summary of the workflow state:

```
✓ Workflow loaded successfully!

Project: <project_name>
Current Phase: <current_phase> (<phase_status>)
Artifacts: <artifacts_directory>

Completed Phases:
<list of completed phases with timestamps>

Resuming <current_phase> phase...
```

### 5. Load Rigorous Dev Skill

Load the rigorous-dev skill with the current state context so it knows where to continue.

### 6. Continue Current Phase

Based on the current phase and its status, load the appropriate agent:

**If phase status is "in_progress":**
- Load the producer agent for that phase (continue work)

**Phase-to-Agent Mapping:**
- `requirements` → `rigorous-dev:requirements_analyst`
- `ux_design` → `rigorous-dev:ux_designer`
- `architecture` → `rigorous-dev:backend_architect`
- `planning` → `rigorous-dev:implementation_planner`
- `implementation` → `rigorous-dev:senior_developer`
- `documentation` → `rigorous-dev:documentation_master`

**If phase status is "completed":**
- Should not happen; workflow should have advanced to next phase
- Display error and suggest running `/rigorous-dev:status` to check state

### 7. Context Handoff

When loading the agent, provide context about:
- What artifacts already exist
- Current iteration count
- Any notes from previous work
- Feedback from critics (if in revision loop)

## Success Message

Clearly indicate that the workflow has resumed and which agent is now active.