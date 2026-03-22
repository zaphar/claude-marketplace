---
description: Resume an existing release workflow
allowed-tools:
  - Read
  - Write
  - Bash
  - Skill
  - Task
  - mcp__plugin_rigor_rigor-db__project_status
  - mcp__plugin_rigor_rigor-db__changelog_query
---

# Resume Release Workflow

Resume an existing release workflow from saved state.

## What This Command Does

1. Checks if a release workflow exists (error if it doesn't)
2. Loads release workflow state from the database
3. Displays current release status
4. Loads the workflow skill with context
5. Continues from the current release phase

## Implementation Steps

> **Always include `project_root` in every tool call**, set to the absolute path of the current project's root directory (the directory where Claude Code is running).

### 1. Check for Release Workflow State

Call `project_status` to check whether release phases exist and have any activity:

```
project_status()
```

Check if release phases (qa, audit, code_review) exist. If none have been started (all pending), show error suggesting /rigor:start-release:

```
ERROR: No release workflow found in this project.
Use /rigor:start-release to initialize a release workflow.
```

### 2. Check Release Workflow Status

Check the `project_status` response for release phase statuses.

- If all release phases have status "completed", display:

```
This release workflow is already completed.
To start a new release workflow, run /rigor:start-release.
```

### 3. Load Release Workflow State

Use the `project_status` response data to extract:
- Project name
- Current phase (first in_progress or first pending release phase)
- Phase statuses
- Artifacts directory

### 4. Display Status Summary

Show a concise summary of the release workflow state:

```
Release Workflow Loaded

Project: <project_name>
Current Phase: <current_phase> (<phase_status>)
Artifacts: <artifacts_directory>

Phase Status:
<status_indicator> QA: <status>
<status_indicator> Audit: <status>
<status_indicator> Code Review: <status> (optional)

Resuming <current_phase> phase...
```

### 5. Load Rigorous Dev Skill

Invoke the `Skill` tool with `skill: "rigor:workflow"` to load the workflow skill with the current release state context.
Do not use any other parameter name (e.g. `name`) — the required parameter is `skill`.

### 6. Continue Current Phase

Based on the current phase and its status, invoke the appropriate agent via the Task tool:

**Phase-to-Agent Mapping:**
- `qa` → `rigor:qa_engineer`
- `audit` → `rigor:security_auditor` + `rigor:performance_auditor` (parallel)
- `code_review` → Load `skills/code-review/SKILL.md` and follow its orchestration instructions

**If phase status is "in_progress":**
- Invoke the producer agent for that phase via the Task tool (continue work)

**If phase status is "completed":**
- Should not happen; workflow should have advanced to next phase
- Display error and suggest running `/rigor:release-status` to check state

### 7. Context Handoff

When invoking the agent, provide context about:
- What dev workflow artifacts exist (from `project_status` and `changelog_query` responses)
- What release artifacts already exist
- Current iteration count
- Any notes from previous work
- Feedback from critics (if in revision loop)

## Success Message

Clearly indicate that the release workflow has resumed and which agent is now active.
