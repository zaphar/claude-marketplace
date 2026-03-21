---
description: Skip to a specific workflow phase (advanced use only)
argument-hint: <phase>
allowed-tools:
  - Read
  - Write
  - Bash
  - Skill
  - Task
  - AskUserQuestion
  - mcp__plugin_rigor_rigor-db__project_status
  - mcp__plugin_rigor_rigor-db__phase_transition
  - mcp__plugin_rigor_rigor-db__changelog_query
---

# Skip to Workflow Phase

Skip directly to a specific phase in the workflow. **Use with caution** - skipping phases bypasses validation and may cause issues.

## What This Command Does

1. Validates that a workflow exists
2. Validates the target phase name
3. Displays a warning about skipped phases
4. Requires explicit user confirmation
5. Updates state and loads the target phase

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

### 2. Validate Arguments

Check that a phase argument was provided and is valid:

**Valid phases (development workflow only):**
- `requirements`
- `ux-design` (maps to `ux_design` in DB)
- `architecture`
- `planning`
- `implementation`
- `documentation`

If invalid or missing:
```
ERROR: Invalid or missing phase argument.

Usage: /rigor:skip-to <phase>

Valid phases (development workflow):
- requirements
- ux-design
- architecture
- planning
- implementation
- documentation

Note: QA and audit phases are part of the release workflow.
Use /rigor:start-release to begin the release workflow.
```

### 3. Load Current State and Check Workflow Status

Use the `project_status` response to get:
- Current phase
- Phase status

If `current_iteration` is null or the iteration's status is not `"active"`, display error:

```
ERROR: No active iteration found.
Use /rigor:new-iteration to start a new iteration.
```

### 4. Check if Already at Target

If `current_phase` == target phase:
```
You are already at the <target_phase> phase.
Use /rigor:resume to continue.
```
Exit without changes.

### 5. Calculate Skipped Phases

Determine which phases will be skipped based on the standard workflow order:
1. requirements
2. ux_design
3. architecture
4. planning
5. implementation
6. documentation

List all phases between current and target that will be marked as "skipped".

### 6. Display Warning and Request Confirmation

Use AskUserQuestion to display warning and get confirmation:

```
⚠️  WARNING: Skipping Phases

You are about to skip from <current_phase> to <target_phase>.

This will skip the following phases:
<list of skipped phases>

⚠️  Consequences:
- Missing artifacts may cause downstream phases to fail
- Validation and quality checks will be bypassed
- Requirements may not be properly documented

This operation should only be used when:
- You have existing artifacts from previous work
- You are prototyping or experimenting
- You understand the risks

Do you want to continue?
```

Options:
- Yes, skip to <target_phase>
- No, cancel

### 7. Update State if Confirmed

If user confirms, call `phase_transition` for each phase that needs to change:

1. For each phase to be skipped (between current and target), call:
   ```
   phase_transition({ phase: "<phase_name>", status: "skipped" })
   ```
2. For the target phase, call:
   ```
   phase_transition({ phase: "<target_phase>", status: "in_progress" })
   ```

### 8. Load Rigorous Dev Skill

Invoke the `Skill` tool with `skill: "rigor:workflow"` to load the workflow skill for orchestration context before invoking the target phase agent.
Do not use any other parameter name (e.g. `name`) — the required parameter is `skill`.

### 9. Invoke Target Phase Agent via the Task Tool

Invoke the appropriate agent for the target phase via the Task tool:

- `requirements` → `rigor:requirements_analyst`
- `ux_design` → `rigor:ux_designer`
- `architecture` → `rigor:backend_architect`
- `planning` → `rigor:implementation_planner`
- `implementation` → Query `work_item` for first row with `status != 'completed'` ordered by `phase_number`:
  - If that row's `status` is `"test_writing"` or `"pending"` → `rigor:test_writer`
  - If that row's `status` is `"implementing"` → `rigor:senior_developer`
- `documentation` → `rigor:documentation_master`

### 10. Inform User

Display confirmation message:

```
✓ Skipped to <target_phase> phase.

⚠️  Reminder: Ensure you have necessary artifacts from previous phases.

Invoking <agent_name> agent...
```

### 11. Handle Cancellation

If user cancels:
```
Operation cancelled. Workflow state unchanged.
Use /rigor:resume to continue from <current_phase>.
```

## Important Notes

- This command is for advanced users only
- Skipping phases can lead to incomplete or inconsistent artifacts
- Use `/rigor:dev-status` after skipping to verify state
- Consider using this only for experimentation or when resuming partial work

## Example Usage

```
/rigor:skip-to implementation
```

This would skip from the current phase directly to implementation, marking all intermediate phases as "skipped".