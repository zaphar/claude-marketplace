---
description: Run holistic code review across the full codebase
allowed-tools:
  - Read
  - Bash
  - Skill
  - Task
  - AskUserQuestion
  - mcp__plugin_rigor_rigor-db__project_status
  - mcp__plugin_rigor_rigor-db__iteration_create
  - mcp__plugin_rigor_rigor-db__phase_transition
  - mcp__plugin_rigor_rigor-db__changelog_query
  - mcp__plugin_rigor_rigor-db__checkpoint
---

# Run Holistic Code Review

Run a holistic code review across the full codebase, standalone or as part of the release workflow.

## What This Command Does

1. Validates a project exists; creates a new iteration if none is open
2. Checks current code_review phase state (handles pending/skipped, in_progress, completed)
3. Gathers security/performance audit findings as context (if any exist)
4. Activates the code_review phase and dispatches the Code Review Orchestration skill
5. Marks the phase complete after the skill returns

## Implementation Steps

> **Always include `project_root` in every tool call**, set to the absolute path of the current project's root directory (the directory where Claude Code is running).

### Step 1: Check Project State

Call `project_status` to check whether a project exists:

```
project_status()
```

If no project exists, show error:

```
ERROR: No project found.
Use /rigor:start to initialize a project before running code review.
```

### Step 2: Ensure an Open Iteration Exists

Check the `project_status` response for an open iteration (status `"open"`).

**If no open iteration exists**, inform the user and create one:

```
No open iteration found. Creating a new iteration for this code review...
```

Then call `iteration_create` to open a new iteration. Use a description like `"Holistic code review"`.

After creating the iteration, proceed with the new `iteration_id`.

**If an open iteration already exists**, use its `iteration_id` and proceed.

### Step 3: Check Code Review Phase Status

Extract the `code_review` phase status from the `project_status` response:

- **`in_progress`**: Already running — inform the user and resume. Load the skill directly in Step 6, skipping the `phase_transition` call in Step 5.
- **`completed`**: Already done this iteration — use `AskUserQuestion` to ask if they want to re-run. If yes, proceed (the skill will handle finding any existing run). If no, exit.
- **`pending`** or **`skipped`**: Ready to start — continue to Step 4.

### Step 4: Gather Audit Context

Query for prior audit findings from the current iteration:

```
changelog_query(entity_type: "security_audit_finding", iteration_id: <iteration_id>)
changelog_query(entity_type: "performance_audit_finding", iteration_id: <iteration_id>)
```

If findings exist, build a concise `audit_context` summary:
- Counts by severity (critical, high, medium, low)
- Brief descriptions of critical/high findings only

This avoids code review agents re-reporting known security/performance issues.

If no findings exist, `audit_context` is omitted.

### Step 5: Activate Code Review Phase

Call `phase_transition` to mark the phase as active:

```
phase_transition(iteration_id: <id>, phase_name: "code_review", status: "in_progress")
```

Skip this step if the phase was already `in_progress` in Step 3.

Show the user:

```
Starting Holistic Code Review

Project: <project_name>
Artifacts: <artifacts_directory>

Dispatching code review skill...
```

### Step 6: Dispatch Code Review Skill

Invoke the `Skill` tool with `skill: "rigor:code-review"`.

Pass this context when invoking the skill:

- `iteration_id`: current iteration ID (from project_status)
- `revision_id`: latest revision ID (from project_status, may be null if no dev revisions exist)
- `artifacts_directory`: from project_status
- `language_hint`: auto-detect from project root (check for `go.mod`, `package.json`, `Cargo.toml`, `pyproject.toml`, etc.) or leave empty for language-agnostic mode
- `audit_context`: summary from Step 4 (omit if empty)

The skill creates its own `code_review_run` record — do NOT pre-create one.

### Step 7: Complete the Phase

After the skill returns, mark the phase as completed:

```
phase_transition(iteration_id: <id>, phase_name: "code_review", status: "completed")
checkpoint(message: "code_review: phase completed")
```

Show completion:

```
Code Review Complete

Findings have been recorded and reviewed.
Use /rigor:release-status to see the full release workflow state.
```
