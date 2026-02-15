---
description: Close the current workflow iteration
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

# Close Rigorous Development Workflow

Close the current workflow iteration, marking it as completed (or partially completed) so a new iteration can be started.

## What This Command Does

1. Validates workflow exists and is active (not already closed)
2. Shows status summary
3. Asks user for confirmation + optional closing notes
4. Snapshots state file into artifacts directory
5. Updates state: marks as closed
6. Displays confirmation with next-step hint

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

Read `.claude/rigorous-dev-state.yaml` and check the workflow status:

- If `status` field is missing, treat as `"active"` (backward compatibility)
- If `status == "closed"`, display error:

```
ERROR: This workflow is already closed.
Use /rigorous-dev:new-iteration to start a new iteration.
```

### 3. Display Status Summary

Show a concise summary of the current workflow state before closing:

```
Workflow Close Summary

Project: <project_name>
Iteration: <iteration_number> (default 1 if missing)
Current Phase: <current_phase> (<phase_status>)

Completed Phases:
<list of completed phases with timestamps>

In-Progress Phases:
<list of in-progress phases>

Pending Phases:
<list of pending phases>
```

### 4. Ask for Confirmation and Closing Notes

Use AskUserQuestion to confirm:

```
Do you want to close this workflow iteration?
```

Options:
- Close iteration
- Close with notes (prompt for closing notes)
- Cancel

If user chooses "Close with notes", prompt for the notes text.

If user cancels:
```
Operation cancelled. Workflow remains active.
Use /rigorous-dev:resume to continue working.
```

### 5. Snapshot State File

Copy the current state file into the artifacts directory as a snapshot:

```bash
cp .claude/rigorous-dev-state.yaml "<artifacts_dir>/<workflow_id>/rigorous-dev-state-closed.yaml"
```

Create the directory if it doesn't exist:

```bash
mkdir -p "<artifacts_dir>/<workflow_id>"
```

### 6. Update State File

Update `.claude/rigorous-dev-state.yaml` with the following changes:

- Set `status: "closed"`
- Set `closed_at: "<current_timestamp_ISO8601>"`
- Ensure `iteration_number` is set (add as `1` if missing for backward compatibility)
- Append closing notes to `notes` field if provided
- Update `updated_at: "<current_timestamp_ISO8601>"`

### 7. Display Confirmation

```
Workflow iteration <iteration_number> closed.

Project: <project_name>
Closed at: <closed_at>
State snapshot: <artifacts_dir>/<workflow_id>/rigorous-dev-state-closed.yaml

To start a new iteration:
  /rigorous-dev:new-iteration

To check status:
  /rigorous-dev:status
```

## Important Notes

- Closing a workflow does not delete any artifacts or state
- The state snapshot preserves the full state at close time
- A closed workflow cannot be resumed; use `/rigorous-dev:new-iteration` to continue work
