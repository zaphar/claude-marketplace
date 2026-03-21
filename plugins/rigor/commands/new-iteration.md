---
description: Start a new iteration from a closed workflow
allowed-tools:
  - Read
  - Write
  - Bash
  - Skill
  - Task
  - AskUserQuestion
  - mcp__plugin_rigor_rigor-db__project_status
  - mcp__plugin_rigor_rigor-db__iteration_create
  - mcp__plugin_rigor_rigor-db__iteration_summary
---

# New Iteration — Rigorous Development Workflow

Start a new workflow iteration after closing the previous one. Resets state for a fresh iteration while persistent design artifacts remain in place.

## What This Command Does

1. Validates workflow exists and has no active iteration
2. Shows previous iteration summary
3. Asks user for confirmation
4. Resets state for the new iteration via `iteration_create`
5. Begins Requirements phase with context from prior iteration

## Implementation Steps

> **Always include `project_root` in every tool call**, set to the absolute path of the current project's root directory (the directory where Claude Code is running).

### 1. Check for Project State

Call `project_status` to check whether a project exists in the DB:

```
project_status()
```

If it returns no project record, stop with an error:

```
ERROR: No project found.
Use /rigor:start to initialize a new workflow.
```

### 2. Load and Validate State

Inspect the `project_status` response:

- If `current_iteration` is not null and its status is `"active"`, display error:

```
ERROR: The current iteration is still active.
Use /rigor:close to close the current iteration before starting a new one.
```

### 3. Display Previous Iteration Summary

Show a summary of the iteration being closed out:

```
Previous Iteration Summary

Project: <project_name>
Iteration: <iteration_id>
Closed at: <closed_at>

Phase Results:
<for each phase: name, status, artifact_path if present>

Persistent artifacts (ux_design/, architecture/) will remain in place.
```

### 4. Ask for Confirmation

Use AskUserQuestion to confirm:

```
Start a new iteration? This will create a fresh iteration in the DB.
```

Options:
- Yes, start new iteration
- Cancel

If user cancels:
```
Operation cancelled. No new iteration created.
Use /rigor:new-iteration when ready to start a new iteration.
```

### 5. Create New Iteration in DB

Call `iteration_create` with the incremented iteration number to create all new phase rows in the DB:

```
iteration_create({
  starting_phase: "requirements",
  notes: "New iteration started."
})
```

The DB retains all records from previous iterations — nothing is deleted.

### 6. Load Rigorous Dev Skill and Begin Requirements Phase

Invoke the `Skill` tool with `skill: "rigor:workflow"` to load the workflow skill and start the Requirements phase, informing the agent about the prior iteration.
Do not use any other parameter name (e.g. `name`) — the required parameter is `skill`.

```
Workflow iteration <new_iteration_id> started!

Project: <project_name>
Persistent artifacts remain in place: ux_design/, architecture/ (if they exist)

Starting Requirements Phase...
Invoking Requirements Analyst agent...
```

Provide the Requirements Analyst with context:
- Persistent artifacts (UX design, architecture) remain in the current directory as starting points
- The analyst should reference prior requirements but conduct a fresh interview to capture changes

Then invoke `rigor:requirements_analyst` via the Task tool to begin the conversational interview.

## Important Notes

- Persistent artifacts (ux_design, architecture) stay in place and are re-evaluated by their respective phases
- The DB retains all previous iteration data; `iteration_create` adds new rows for the new iteration without removing old ones
