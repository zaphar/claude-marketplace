---
description: Display current workflow status and progress
allowed-tools:
  - Read
  - Write
  - Bash
---

# Show Workflow Status

Display the current status and progress of the rigorous development workflow.

## What This Command Does

1. Checks if a workflow exists
2. Loads and displays comprehensive workflow status
3. Auto-saves the state (updates timestamp)

## Implementation Steps

### 1. Check for Workflow State

Check if `.claude/rigorous-dev-state.yaml` exists:

```bash
if [ ! -f .claude/rigorous-dev-state.yaml ]; then
  echo "No active workflow found."
  echo ""
  echo "Use /rigorous-dev:start to initialize a new workflow."
  exit 0
fi
```

### 2. Load and Parse State

Read `.claude/rigorous-dev-state.yaml` and extract all fields.

### 3. Display Formatted Status

Present the status in a clear, visual format:

```
📋 Rigorous Dev Workflow Status

Project: <project_name>
Workflow ID: <workflow_id>
Iteration: <iteration_number> (default 1 if missing)
Status: <active|closed>
<if closed>Closed at: <closed_at></if>
Artifacts: <artifacts_directory>
Created: <created_at>
Last Updated: <updated_at>

Progress:
<status_indicator> Requirements
   Status: <status>
   <if completed>Completed: <completed_at></if>
   <if in_progress>Iteration: <iteration_count>/3</if>
   <if artifact_path>Artifact: <artifact_path></if>
   <if approved_by>Approved by: <approved_by></if>
   <if notes>Notes: <notes></if>

<status_indicator> UX Design
   [same format as above]

<status_indicator> Architecture
   [same format as above]

<status_indicator> Planning
   [same format as above]

<status_indicator> Implementation
   [same format as above]
   <if in_progress and current_phase_number>Current Phase: <current_phase_number></if>

<status_indicator> Documentation
   [same format as above]

<if .claude/rigorous-dev-release-state.yaml exists>
Release Workflow:
<status_indicator> QA
   [same format as above]

<status_indicator> Audit
   [same format as above]

<status_indicator> Release
   [same format as above]
</if>

<if notes>
Workflow Notes:
<notes>
</if>

Generated Artifacts:
<list all artifact files that exist in artifacts_directory>

<if status is "closed">
This workflow is closed. To start a new iteration:
  /rigorous-dev:new-iteration
</if>
```

**Status Indicators:**
- ✅ = completed
- 🔄 = in_progress
- ⏸️  = pending
- ⏭️  = skipped (if status is "skipped")

### 4. List Generated Artifacts

Scan the artifacts directory and list all files found:

```bash
ls -1 "<artifacts_directory>" 2>/dev/null
```

Display each artifact with its filename.

### 5. Auto-Save State

Update the `updated_at` timestamp in the state file:

```yaml
updated_at: "<current_timestamp_ISO8601>"
```

Write the updated state back to `.claude/rigorous-dev-state.yaml`.

## Output Format Example

```
📋 Rigorous Dev Workflow Status

Project: My Project
Workflow ID: rigorous-dev-workflow
Iteration: 1
Status: active
Artifacts: .claude/rigorous-dev-artifacts
Created: 2026-02-12T19:00:00Z
Last Updated: 2026-02-12T21:30:00Z

Progress:
✅ Requirements
   Status: completed
   Completed: 2026-02-12T20:45:00Z
   Artifact: requirements.yaml
   Approved by: requirements_critic

✅ UX Design
   Status: completed
   Completed: 2026-02-12T21:15:00Z
   Artifact: ux_specification.yaml
   Approved by: ux_critic

🔄 Architecture
   Status: in_progress
   Iteration: 2/3
   Started: 2026-02-12T21:20:00Z

⏸️  Planning
   Status: pending

⏸️  Implementation
   Status: pending

⏸️  Documentation
   Status: pending

Generated Artifacts:
- requirements.yaml
- ux_specification.yaml

Last updated: 2026-02-12 21:30:00
```

## Usage Tips

- Run this command anytime to check progress
- Use it before `/rigorous-dev:resume` to see where you left off
- The state auto-saves after each phase, but this command refreshes the timestamp