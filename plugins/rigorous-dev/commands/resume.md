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
2. Loads workflow state from the database
3. Displays current status
4. Loads the rigorous-dev skill with context
5. Continues from the current phase

## Implementation Steps

### 1. Check for Project State

Call `project_status` to check whether a project exists in the DB:

```
project_status()
```

If it returns no project record, stop with an error:

```
ERROR: No project found.
Use /rigorous-dev:start to initialize a new workflow.
```

### 2. Check Workflow Status

Inspect the `status` field in the `project_status` response:

- If `status == "closed"`, display error:

```
ERROR: This workflow is closed (iteration <iteration_id>).
A closed workflow cannot be resumed.
Use /rigorous-dev:new-iteration to start a new iteration.
```

### 3. Load Workflow State

Use the data returned by `project_status` to extract:
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
- `implementation` → Query `plan_phase` for first row with `status != 'completed'` ordered by `phase_number`:
  - If that row's `status` is `"test_writing"` or `"pending"` → `rigorous-dev:test_writer`
  - If that row's `status` is `"implementing"` → `rigorous-dev:senior_developer`
- `documentation` → `rigorous-dev:documentation_master`

**If phase status is "completed":**
- Should not happen; workflow should have advanced to next phase
- Display error and suggest running `/rigorous-dev:status` to check state

### 7. Context Handoff

When loading the agent, provide context from the `project_status` response about:
- What artifacts already exist
- Current iteration count
- Any notes from previous work
- Feedback from critics (if in revision loop)

## Success Message

Clearly indicate that the workflow has resumed and which agent is now active.