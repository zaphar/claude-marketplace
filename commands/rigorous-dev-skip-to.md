---
description: Skip to a specific workflow phase (advanced use only)
argument-hint: <phase>
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
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

### 1. Check for Workflow State

Check if `.claude/rigorous-dev-state.yaml` exists:

```bash
if [ ! -f .claude/rigorous-dev-state.yaml ]; then
  echo "ERROR: No workflow found in this project."
  echo "Use /rigorous-dev:start to initialize a new workflow."
  exit 1
fi
```

### 2. Validate Arguments

Check that a phase argument was provided and is valid:

**Valid phases:**
- `requirements`
- `ux-design` (maps to `ux_design` in state)
- `architecture`
- `planning`
- `implementation`
- `qa`
- `documentation`
- `release`

If invalid or missing:
```
ERROR: Invalid or missing phase argument.

Usage: /rigorous-dev:skip-to <phase>

Valid phases:
- requirements
- ux-design
- architecture
- planning
- implementation
- qa
- documentation
- release
```

### 3. Load Current State

Read `.claude/rigorous-dev-state.yaml` to get:
- Current phase
- Phase status

### 4. Check if Already at Target

If `current_phase` == target phase:
```
You are already at the <target_phase> phase.
Use /rigorous-dev:resume to continue.
```
Exit without changes.

### 5. Calculate Skipped Phases

Determine which phases will be skipped based on the standard workflow order:
1. requirements
2. ux_design
3. architecture
4. planning
5. implementation
6. qa
7. documentation
8. release

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

If user confirms, update the state file:

1. Mark skipped phases with status "skipped"
2. Set target phase as "in_progress"
3. Update `current_phase` to target phase
4. Set `started_at` for target phase
5. Update `updated_at` timestamp

Example state update:
```yaml
current_phase: "architecture"
updated_at: "<current_timestamp>"
phase_status:
  requirements:
    status: "skipped"
  ux_design:
    status: "skipped"
  architecture:
    status: "in_progress"
    started_at: "<current_timestamp>"
    iteration_count: 0
```

### 8. Load Target Phase Agent

Load the appropriate agent for the target phase:

- `requirements` → `agents/requirements_interviewer.md`
- `ux_design` → `agents/ux_designer.md`
- `architecture` → `agents/backend_architect.md`
- `planning` → `agents/implementation_planner.md`
- `implementation` → `agents/senior_developer.md`
- `qa` → `agents/qa_engineer.md`
- `documentation` → `agents/documentation_master.md`
- `release` → `agents/release_engineer.md`

### 9. Inform User

Display confirmation message:

```
✓ Skipped to <target_phase> phase.

⚠️  Reminder: Ensure you have necessary artifacts from previous phases.

Loading <agent_name> agent...
```

### 10. Handle Cancellation

If user cancels:
```
Operation cancelled. Workflow state unchanged.
Use /rigorous-dev:resume to continue from <current_phase>.
```

## Important Notes

- This command is for advanced users only
- Skipping phases can lead to incomplete or inconsistent artifacts
- Use `/rigorous-dev:status` after skipping to verify state
- Consider using this only for experimentation or when resuming partial work

## Example Usage

```
/rigorous-dev:skip-to implementation
```

This would skip from the current phase directly to implementation, marking all intermediate phases as "skipped".