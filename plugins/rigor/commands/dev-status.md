---
description: Display current workflow status and progress
allowed-tools:
  - Read
  - Bash
---

# Show Workflow Status

Display the current status and progress of the rigorous development workflow.

## What This Command Does

1. Checks if a workflow exists
2. Loads and displays comprehensive workflow status
3. Shows generated artifacts from the changelog

## Implementation Steps

### 1. Check for Project State

Call `project_status` to check whether a project exists in the DB:

```
project_status()
```

If it returns no project record, display:

```
No active project found.

Use /rigor:start to initialize a new workflow.
```

Exit without error.

### 2. Load and Parse State

Call `iteration_summary` to get full phase-level details for the current iteration alongside the `project_status` result.

### 3. Display Formatted Status

Present the status in a clear, visual format:

```
📋 Rigorous Dev Workflow Status

Project: <project_name>
Iteration: <iteration_id>
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

<status_indicator> Documentation
   [same format as above]

<if release phases exist in project_status>
Release Workflow:
<status_indicator> QA
   [same format as above]

<status_indicator> Audit
   [same format as above]
</if>

<if notes>
Workflow Notes:
<notes>
</if>

Generated Artifacts:
<use changelog_query to count entities per type and list artifact entries>

<if status is "closed">
This workflow is closed. To start a new iteration:
  /rigor:new-iteration
</if>
```

**Status Indicators:**
- ✅ = completed
- 🔄 = in_progress
- ⏸️  = pending
- ⏭️  = skipped (if status is "skipped")

### 4. List Generated Artifacts

Call `changelog_query` to retrieve artifact entries recorded in the DB and list them by type.

### 5. Display Last Updated

The `updated_at` timestamp comes from the `project_status` response; no separate write is needed.

## Output Format Example

```
📋 Rigorous Dev Workflow Status

Project: My Project
Iteration: 1
Status: active
Artifacts: .claude/rigor-artifacts
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
- Use it before `/rigor:resume` to see where you left off