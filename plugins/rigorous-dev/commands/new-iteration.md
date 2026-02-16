---
description: Start a new iteration from a closed workflow
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

# New Iteration — Rigorous Development Workflow

Start a new workflow iteration after closing the previous one. Commits current artifacts to VCS for history, then deletes versioned artifacts so they start fresh. Persistent design artifacts remain in place.

## What This Command Does

1. Validates workflow exists and is closed
2. Shows previous iteration summary
3. Asks user for confirmation
4. Commits all current artifacts to VCS (preserving history)
5. Deletes versioned artifact directories (they start fresh)
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

Show a summary of the iteration being closed out:

```
Previous Iteration Summary

Project: <project_name>
Iteration: <iteration_number>
Closed at: <closed_at>

Phase Results:
<for each phase: name, status, artifact_path if present>

Versioned artifacts will be deleted (retrievable from VCS history).
Persistent artifacts (ux_design/, architecture/) will remain in place.
```

### 4. Ask for Confirmation

Use AskUserQuestion to confirm:

```
Start a new iteration? This will commit current artifacts to VCS, then delete versioned artifact directories.
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

### 5. Commit Artifacts to VCS

Before deleting anything, commit all current artifacts to VCS so the full state is preserved in history. Detect which VCS is in use and commit accordingly:

```bash
# Detect VCS and commit
if [ -d .jj ]; then
  # Jujutsu — just describe the current change with a message
  jj commit -m "rigorous-dev: archive iteration <iteration_number> artifacts for <project_name>"
elif [ -d .git ]; then
  # Git — stage the artifacts directory and commit
  git add "<artifacts_dir>/<workflow_id>/"
  git commit -m "rigorous-dev: archive iteration <iteration_number> artifacts for <project_name>"
fi
```

This ensures the complete artifact state is retrievable from VCS history even after versioned directories are deleted.

### 6. Delete Versioned Artifact Directories

Remove the directories that start fresh each iteration. Persistent artifacts (`ux_design/`, `architecture/`) remain in place untouched.

```bash
# Delete versioned artifact directories
rm -rf "<artifacts_dir>/<workflow_id>/requirements"
rm -rf "<artifacts_dir>/<workflow_id>/planning"
rm -rf "<artifacts_dir>/<workflow_id>/implementation"
rm -rf "<artifacts_dir>/<workflow_id>/qa"
rm -rf "<artifacts_dir>/<workflow_id>/documentation"
rm -rf "<artifacts_dir>/<workflow_id>/release"

# Delete the close snapshot (no longer needed)
rm -f "<artifacts_dir>/<workflow_id>/rigorous-dev-state-closed.yaml"
```

### 7. Rewrite State File

Update `.claude/rigorous-dev-state.yaml` with:

- Increment `iteration_number` (old value + 1)
- Set `status: "active"`
- Set `closed_at: null`
- Set `current_phase: "requirements"`
- Update `updated_at: "<current_timestamp_ISO8601>"`
- Set `notes` field to: `"New iteration started. Prior iteration artifacts preserved in VCS history."`
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
Prior iteration artifacts preserved in VCS history.
Persistent artifacts remain in place: ux_design/, architecture/ (if they exist)

Starting Requirements Phase...
Loading Requirements Analyst agent.
```

Provide the Requirements Analyst with context:
- Prior iteration artifacts are available in VCS history (use VCS log/diff to review if needed)
- Persistent artifacts (UX design, architecture) remain in the current directory as starting points
- The analyst should reference prior requirements but conduct a fresh interview to capture changes

Then load and execute `agents/requirements_analyst.md` to begin the conversational interview.

## Important Notes

- VCS history preserves all artifacts from previous iterations — nothing is lost
- Persistent artifacts (ux_design, architecture) stay in place and are re-evaluated by their respective phases
- Versioned artifacts (requirements, planning, implementation, etc.) start completely fresh
- The close state snapshot is cleaned up since VCS history serves the same purpose
