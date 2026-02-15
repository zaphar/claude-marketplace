---
description: Start a new iteration from a closed workflow
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

# New Iteration — Rigorous Development Workflow

Start a new workflow iteration after closing the previous one. Archives prior artifacts and resets phases while preserving persistent design artifacts as starting points.

## What This Command Does

1. Validates workflow exists and is closed
2. Shows previous iteration summary
3. Asks user for confirmation
4. Archives current artifacts directory
5. Creates fresh artifacts directory with persistent artifacts carried forward
6. Resets state for the new iteration
7. Begins Requirements phase with context from prior iteration

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

### 2. Load and Validate State

Read `.claude/rigorous-dev-state.yaml` and check:

- If `status` field is missing, treat as `"active"` (backward compatibility)
- If `status != "closed"`, display error:

```
ERROR: The current workflow is still active.
Use /rigorous-dev:close to close the current iteration before starting a new one.
```

### 3. Display Previous Iteration Summary

Show a summary of the iteration being archived:

```
Previous Iteration Summary

Project: <project_name>
Iteration: <iteration_number>
Closed at: <closed_at>

Phase Results:
<for each phase: name, status, artifact_path if present>

This iteration's artifacts will be archived to:
  <artifacts_dir>/<workflow_id>-iteration-<iteration_number>/
```

### 4. Ask for Confirmation

Use AskUserQuestion to confirm:

```
Start a new iteration? This will archive the current artifacts and reset all phases.
```

Options:
- Yes, start new iteration
- Cancel

If user cancels:
```
Operation cancelled. Workflow remains closed.
Use /rigorous-dev:resume is not available for closed workflows.
Use /rigorous-dev:new-iteration when ready to start a new iteration.
```

### 5. Archive Current Artifacts

Rename the current workflow artifacts directory to include the iteration number:

```bash
mv "<artifacts_dir>/<workflow_id>" "<artifacts_dir>/<workflow_id>-iteration-<iteration_number>"
```

This preserves all artifacts from the completed iteration.

### 6. Create Fresh Artifacts Directory and Copy Persistent Artifacts

Create a new empty artifacts directory for the new iteration:

```bash
mkdir -p "<artifacts_dir>/<workflow_id>"
```

Copy persistent artifacts forward from the archive. These are living documents that carry forward as starting points for re-evaluation in the new iteration:

```bash
# Copy UX design artifacts (if they exist)
if [ -d "<artifacts_dir>/<workflow_id>-iteration-<N>/ux_design" ]; then
  cp -r "<artifacts_dir>/<workflow_id>-iteration-<N>/ux_design" "<artifacts_dir>/<workflow_id>/ux_design"
fi

# Copy architecture artifacts (if they exist)
if [ -d "<artifacts_dir>/<workflow_id>-iteration-<N>/architecture" ]; then
  cp -r "<artifacts_dir>/<workflow_id>-iteration-<N>/architecture" "<artifacts_dir>/<workflow_id>/architecture"
fi
```

### 7. Rewrite State File

Update `.claude/rigorous-dev-state.yaml` with:

- Increment `iteration_number` (old value + 1)
- Set `status: "active"`
- Set `closed_at: null`
- Set `current_phase: "requirements"`
- Update `updated_at: "<current_timestamp_ISO8601>"`
- Append archive path info to `notes` field: `"New iteration started. Prior iteration archived at: <archive_path>"`
- Reset all phase statuses to initial state:

```yaml
phase_status:
  requirements:
    status: "in_progress"
    started_at: "<current_timestamp_ISO8601>"
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
  ux_design:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
  architecture:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
  planning:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
  implementation:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    current_phase_number: null
    notes: ""
  qa:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
  documentation:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
  release:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
```

### 8. Load Rigorous Dev Skill and Begin Requirements Phase

Load the rigorous-dev skill and start the Requirements phase, informing the agent about the prior iteration:

```
Workflow iteration <new_iteration_number> started!

Project: <project_name>
Previous iteration archived at: <archive_path>
Persistent artifacts carried forward: ux_design/, architecture/ (if they existed)

Starting Requirements Phase...
Loading Requirements Analyst agent.
```

Provide the Requirements Analyst with context:
- Path to archived prior iteration artifacts: `<artifacts_dir>/<workflow_id>-iteration-<prev_N>/`
- Note that persistent artifacts (UX design, architecture) have been copied into the new iteration directory as starting points
- The analyst should reference prior requirements but conduct a fresh interview to capture changes

Then load and execute `agents/requirements_analyst.md` to begin the conversational interview.

## Important Notes

- The archive directory preserves all artifacts from the previous iteration
- Persistent artifacts (ux_design, architecture) are copied forward as starting points, not as final approved artifacts — they will be re-evaluated by their respective phases
- The state snapshot from `/rigorous-dev:close` remains in the archive for reference
- Versioned artifacts (requirements, planning, implementation, etc.) start completely fresh
