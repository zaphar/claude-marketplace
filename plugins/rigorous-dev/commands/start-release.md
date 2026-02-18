---
description: Start the release workflow (QA, audit, release)
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

# Start Release Workflow

Start the release workflow to run pre-release verification: QA testing, security/performance auditing, and release preparation.

## What This Command Does

1. Validates a dev workflow exists and implementation is completed
2. Checks no active release workflow already exists
3. Creates `.claude/rigorous-dev-release-state.yaml`
4. Loads the rigorous-dev skill and begins the QA phase

## Implementation Steps

### 1. Check for Dev Workflow State

Check if `.claude/rigorous-dev-state.yaml` exists:

```bash
if [ ! -f .claude/rigorous-dev-state.yaml ]; then
  echo "ERROR: No development workflow found in this project."
  echo "Use /rigorous-dev:start to initialize a development workflow first."
  exit 1
fi
```

### 2. Validate Dev Workflow

Read `.claude/rigorous-dev-state.yaml` and check:

- Implementation phase must have status "completed"
- If implementation is not completed:

```
ERROR: Implementation phase is not completed.
The release workflow requires a completed implementation.
Current implementation status: <status>

Complete the development workflow before starting a release.
Use /rigorous-dev:resume to continue the development workflow.
```

### 3. Check for Existing Release Workflow

Check if `.claude/rigorous-dev-release-state.yaml` already exists:

```bash
if [ -f .claude/rigorous-dev-release-state.yaml ]; then
  echo "ERROR: A release workflow already exists."
  echo "Use /rigorous-dev:resume-release to continue the existing release workflow."
  exit 1
fi
```

### 4. Create Release State File

Read the dev workflow state to get `workflow_id`, `project_name`, and `artifacts_directory`.

Create `.claude/rigorous-dev-release-state.yaml`:

```yaml
workflow_id: "<from_dev_state>"
project_name: "<from_dev_state>"
created_at: "<current_timestamp_ISO8601>"
updated_at: "<current_timestamp_ISO8601>"
status: "active"
artifacts_directory: "<from_dev_state>"
phase_status:
  qa:
    status: "in_progress"
    started_at: "<current_timestamp_ISO8601>"
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
  audit:
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

### 5. Load Rigorous Dev Skill

Load the rigorous-dev skill (`skills/rigorous-dev/SKILL.md`) for orchestration context.

### 6. Start QA Phase

Inform the user that the release workflow has started and load the QA engineer agent:

```
Release Workflow Started!

Project: <project_name>
Artifacts: <artifacts_directory>

Starting QA Phase...
Loading QA Engineer agent.
```

Then load and execute `rigorous-dev:qa_engineer` to begin testing.

## Success Message

Display a clear confirmation that the release workflow has been initialized and the QA phase has begun.
