---
description: Start the release workflow (QA, audit)
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
  - mcp__plugin_rigor_rigor-db__project_status
  - mcp__plugin_rigor_rigor-db__phase_transition
---

# Start Release Workflow

Start the release workflow to run pre-release verification: QA testing and security/performance auditing.

## What This Command Does

1. Validates a dev workflow exists and implementation is completed
2. Checks no active release workflow already exists
3. Activates the QA phase in the database
4. Loads the workflow skill and begins the QA phase

## Implementation Steps

> **Always include `project_root` in every tool call**, set to the absolute path of the current project's root directory (the directory where Claude Code is running).

### 1. Check for Dev Workflow State

Call `project_status` to check whether a dev workflow exists:

```
project_status()
```

If no project record exists, stop with error:

```
ERROR: No project found.
Use /rigor:start to initialize a development workflow first.
```

### 2. Validate Dev Workflow

Check the `project_status` response to verify the implementation phase has status "completed".

- Implementation phase must have status "completed"
- If implementation is not completed:

```
ERROR: Implementation phase is not completed.
The release workflow requires a completed implementation.
Current implementation status: <status>

Complete the development workflow before starting a release.
Use /rigor:resume to continue the development workflow.
```

### 3. Check for Existing Release Workflow

Check the `project_status` response for release phases (qa, audit). If any release phase has status "in_progress", a release workflow is already active:

```
ERROR: A release workflow already exists.
Use /rigor:resume-release to continue the existing release workflow.
```

### 4. Create Release State

Call `phase_transition` to start the QA phase:

```
phase_transition({ phase: "qa", status: "in_progress" })
```

The release phases (qa, audit) already exist in the DB — they were created by `iteration_create`. No separate state file is needed.

### 5. Load Rigorous Dev Skill

Invoke the `Skill` tool with `skill: "rigor:workflow"` to load the workflow skill for orchestration context.
Do not use any other parameter name (e.g. `name`) — the required parameter is `skill`.

### 6. Start QA Phase

Inform the user that the release workflow has started and invoke the QA engineer agent via the Task tool:

```
Release Workflow Started!

Project: <project_name>
Artifacts: <artifacts_directory>

Starting QA Phase...
Invoking QA Engineer agent...
```

Then invoke `rigor:qa_engineer` via the Task tool to begin testing.

## Success Message

Display a clear confirmation that the release workflow has been initialized and the QA phase has begun.
