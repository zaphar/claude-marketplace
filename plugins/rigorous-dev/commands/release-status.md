---
description: Display release workflow status
allowed-tools:
  - Read
  - Bash
---

# Show Release Workflow Status

Display the current status and progress of the release workflow.

## What This Command Does

1. Checks if a release workflow exists
2. Loads and displays release workflow status
3. Shows which dev artifacts are being used as inputs

## Implementation Steps

### 1. Check for Release Workflow State

Call `workflow_status` to check whether release phases exist:

```
workflow_status()
```

If no workflow exists or release phases haven't been started, display:

```
No release workflow found.

Use /rigorous-dev:start-release to initialize a release workflow.
```

Exit without error.

### 2. Load and Parse State

Use the `workflow_status` response and call `iteration_summary` to get full phase-level details. Extract all fields from the release phases (qa, audit, release).

### 3. Display Formatted Status

Present the status in a clear, visual format:

```
Release Workflow Status

Project: <project_name>
Workflow ID: <workflow_id>
Status: <active|completed>
Artifacts: <artifacts_directory>
Created: <created_at>
Last Updated: <updated_at>

Release Progress:
<status_indicator> QA
   Status: <status>
   <if completed>Completed: <completed_at></if>
   <if in_progress>Iteration: <iteration_count>/3</if>
   <if artifact_path>Artifact: <artifact_path></if>
   <if approved_by>Approved by: <approved_by></if>

<status_indicator> Audit
   Status: <status>
   [same format as above]

<status_indicator> Release
   Status: <status>
   [same format as above]

Dev Artifact Inputs:
  Requirements: <artifact_path or "not available">
  Architecture: <artifact_path or "not available">
  Implementation: <artifact_path or "not available">
  Documentation: <artifact_path or "not available">
```

**Status Indicators:**
- Completed = completed
- In Progress = in_progress
- Pending = pending

### 4. List Release Artifacts

Call `changelog_query` to retrieve release-phase artifact entries from the DB.

## Output Format Example

```
Release Workflow Status

Project: My Project
Workflow ID: rigorous-dev-workflow
Status: active
Artifacts: .claude/rigorous-dev-artifacts
Created: 2026-02-15T10:00:00Z
Last Updated: 2026-02-15T14:30:00Z

Release Progress:
QA
   Status: completed
   Completed: 2026-02-15T12:00:00Z
   Artifact: qa/test_report.yaml
   Approved by: qa_critic

Audit
   Status: in_progress
   Iteration: 1/3

Release
   Status: pending

Dev Artifact Inputs:
  Requirements: requirements/requirements.yaml
  Architecture: architecture/
  Implementation: implementation/
  Documentation: documentation/

Release Artifacts:
- qa/test_report.yaml
```
