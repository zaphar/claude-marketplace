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
4. Updates workflow in DB: marks as closed
5. Displays confirmation with next-step hint

## Implementation Steps

### 1. Check for Workflow State

Call `workflow_status` to check whether a workflow exists in the DB:

```
workflow_status()
```

If it returns no workflow record, stop with an error:

```
ERROR: No workflow found in this project.
Use /rigorous-dev:start to initialize a new workflow.
```

### 2. Load and Validate State

Inspect the `workflow_status` response:

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
Iteration: <iteration_number>
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

### 5. Update Workflow in DB

Call `workflow_update` to mark the workflow as closed:

```
workflow_update({
  status: "closed",
  closed_at: "<current_timestamp_ISO8601>",
  notes: "<closing_notes_if_provided>"
})
```

No YAML state file snapshot is needed — the DB is the record of state.

### 6. Display Confirmation

```
Workflow iteration <iteration_number> closed.

Project: <project_name>
Closed at: <closed_at>

To start a new iteration:
  /rigorous-dev:new-iteration

To check status:
  /rigorous-dev:status
```

## Important Notes

- Closing a workflow does not delete any artifacts or DB records
- A closed workflow cannot be resumed; use `/rigorous-dev:new-iteration` to continue work
- The release phases (qa, audit, release) are part of the same iteration in the DB and are not affected by closing the dev workflow
