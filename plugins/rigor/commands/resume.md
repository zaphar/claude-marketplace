---
description: Resume an existing rigorous development workflow
allowed-tools:
  - Read
  - Write
  - Bash
  - Skill
  - Task
  - mcp__plugin_rigor_rigor-db__project_status
  - mcp__plugin_rigor_rigor-db__iteration_summary
  - mcp__plugin_rigor_rigor-db__checkpoint, rigor-db/checkpoint
---

# Resume Rigorous Development Workflow

Resume an existing rigorous development workflow from saved state.

## What This Command Does

1. Checks if a workflow exists (error if it doesn't)
2. Loads workflow state from the database
3. Displays current status
4. Loads the workflow skill with context
5. Continues from the current phase

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

### 2. Check Workflow Status

Inspect the `project_status` response:

- If `current_iteration` is null or the iteration's status is not `"active"`, display error:

```
ERROR: No active iteration found.
Use /rigor:new-iteration to start a new iteration.
```

### 3. Load Workflow State

Use the data returned by `project_status` to extract:
- Project name
- Current phase
- Phase status
- Artifacts directory
- Iteration counts
- Notes

### 4. Display Status Summary

Show a concise summary of the workflow state:

```
✓ Workflow loaded successfully!

Project: <project_name>
Current Phase: <current_phase> (<phase_status>)
Artifacts: <artifacts_directory>

Completed Phases:
<list of completed phases with timestamps>

Resuming <current_phase> phase...
```

### 5. Check Layout Upgrade

Before loading the workflow skill, check if the project uses the old unified artifact layout:

```bash
test -d "<artifacts_directory>/deliverables" && echo "OLD_DELIVERABLES"
test -d "<artifacts_directory>/process" && echo "OLD_PROCESS"
test -d "<artifacts_directory>/process/conventions" && echo "OLD_CONVENTIONS"
```

If **any** of these detect the old layout, warn the user and recommend running the upgrade:

```
⚠ This project uses the old artifact layout (deliverables/ and process/ subdirectories
under artifacts_directory). The plugin now uses a split layout with separate
artifacts_directory and process_directory.

Run /rigor:organize-artifacts to upgrade your layout. This will:
  - Move deliverables up one level (drop deliverables/ prefix)
  - Move conventions from process/ to artifacts root
  - Let you choose where ephemeral workflow files live

You can continue without upgrading, but agents may not find existing files.
```

Ask the user whether to continue or run organize-artifacts first. If they choose to upgrade, stop and let them run `/rigor:organize-artifacts`. If they choose to continue, proceed with the warning noted.

### 5b. Check Convention Migration

Check if the conventions directory exists at the current expected location (see SKILL.md §15.3):

```bash
test -d "<artifacts_directory>/conventions" && echo "EXISTS" || echo "MISSING"
```

If missing, prompt the user to set up conventions. This handles projects that predate the conventions system. See §15.3 for the full migration procedure.

### 6. Load Rigorous Dev Skill

Invoke the `Skill` tool with `skill: "rigor:workflow"` to load the workflow skill.
Do not use any other parameter name (e.g. `name`) — the required parameter is `skill`.

### 7. Continue Current Phase

Based on the current phase and its status, invoke the appropriate agent via the Task tool:

**If phase status is "in_progress":**
- Invoke the producer agent for that phase via the Task tool (continue work)
- Refer to the phase-to-agent mapping in SKILL.md §3 (Agent Invocation)

**If phase status is "completed":**
- Should not happen; workflow should have advanced to next phase
- Display error and suggest running `/rigor:dev-status` to check state

### 8. Context Handoff

When invoking the agent, provide context from the `project_status` response about:
- What artifacts already exist
- Current iteration count
- Any notes from previous work
- Feedback from critics (if in revision loop)

## Success Message

Clearly indicate that the workflow has resumed and which agent is now active.