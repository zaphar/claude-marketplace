---
description: Start a new iteration from a closed workflow
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
  - mcp__plugin_rigor_rigor-db__project_status
  - mcp__plugin_rigor_rigor-db__iteration_create
  - mcp__plugin_rigor_rigor-db__iteration_summary
---

# New Iteration — Rigorous Development Workflow

Start a new workflow iteration after closing the previous one. Commits current artifacts to VCS for history, then deletes versioned artifacts so they start fresh. Persistent design artifacts remain in place.

## What This Command Does

1. Validates workflow exists and is closed
2. Shows previous iteration summary
3. Asks user for confirmation
4. Commits current artifacts to VCS for history
5. Resets state for the new iteration via `iteration_create`
6. Begins Requirements phase with context from prior iteration

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

- If `status != "closed"`, display error:

```
ERROR: The current project is still active.
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
Start a new iteration? This will commit current artifacts to VCS and create a fresh iteration in the DB.
```

Options:
- Yes, start new iteration
- Cancel

If user cancels:
```
Operation cancelled. Workflow remains closed.
Use /rigor:new-iteration when ready to start a new iteration.
```

### 5. Commit Artifacts to VCS

Before creating the new iteration, commit all current artifacts to VCS so the full state is preserved in history. Detect which VCS is in use and commit accordingly:

```bash
# Detect VCS and commit
if [ -d .jj ]; then
  # Jujutsu — just describe the current change with a message
  jj commit -m "rigor: archive iteration <iteration_id> artifacts for <project_name>"
elif [ -d .git ]; then
  # Git — stage the artifacts directory and commit
  git add "<artifacts_dir>/"
  git commit -m "rigor: archive iteration <iteration_id> artifacts for <project_name>"
fi
```

> **Note:** The archival commit is recorded in VCS history but not in the `vcs_commit` table,
> since `vcs_commit` tracks work-item-scoped implementation commits (each linked to a specific
> `work_item_id` and `revision_id`). Archival commits are infrastructure, not deliverables.

### 6. Create New Iteration in DB

Call `iteration_create` with the incremented iteration number to create all new phase rows in the DB:

```
iteration_create({
  starting_phase: "requirements",
  notes: "New iteration started. Prior iteration artifacts preserved in VCS history."
})
```

The DB retains all records from previous iterations — nothing is deleted.

### 7. Load Rigorous Dev Skill and Begin Requirements Phase

Load the workflow skill and start the Requirements phase, informing the agent about the prior iteration:

```
Workflow iteration <new_iteration_id> started!

Project: <project_name>
Prior iteration artifacts preserved in VCS history.
Persistent artifacts remain in place: ux_design/, architecture/ (if they exist)

Starting Requirements Phase...
Loading Requirements Analyst agent.
```

Provide the Requirements Analyst with context:
- Prior iteration artifacts are available in VCS history (use VCS log/diff to review if needed)
- Persistent artifacts (UX design, architecture) remain in the current directory as starting points
- The analyst should reference prior requirements but conduct a fresh interview to capture changes

Then invoke `rigor:requirements_analyst` via the Task tool to begin the conversational interview.

## Important Notes

- VCS history preserves all artifacts from previous iterations — nothing is lost
- Persistent artifacts (ux_design, architecture) stay in place and are re-evaluated by their respective phases
- The DB retains all previous iteration data; `iteration_create` adds new rows for the new iteration without removing old ones
