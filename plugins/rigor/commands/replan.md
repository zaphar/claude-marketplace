---
description: Trigger a replanning flow to decompose or restructure work items mid-implementation. Optionally specify WI names to target.
allowed-tools:
  - Read
  - Write
  - Bash
  - Skill
  - Task
  - mcp__plugin_rigor_rigor-db__project_status
  - mcp__plugin_rigor_rigor-db__changelog_query
  - mcp__plugin_rigor_rigor-db__iteration_summary
---

# Replan — Decompose or Restructure Work Items

Trigger a replanning flow mid-implementation. Replaces oversized or problematic work items with smaller, better-scoped ones while preserving all completed work.

## What This Command Does

1. Checks for an active project
2. Verifies the workflow is at or past the planning phase
3. Queries current work items and partitions them into completed vs actionable
4. Displays replan context for the user
5. Loads the workflow skill and hands off to the replan flow (SKILL.md §11)

## Implementation Steps

> **Always include `project_root` in every tool call**, set to the absolute path of the current project's root directory (the directory where Claude Code is running).

### 1. Check for Active Project

Call `project_status` to check whether a project exists in the DB:

```
project_status()
```

If it returns no project record, stop with an error:

```
ERROR: No project found.
Use /rigor:start to initialize a new workflow.
```

If `status == "closed"`, stop with an error:

```
ERROR: This workflow is closed (iteration <iteration_id>).
A closed workflow cannot be replanned.
Use /rigor:new-iteration to start a new iteration.
```

### 2. Verify Implementation Phase

Inspect `current_phase` from the `project_status` response.

If the current phase is before `planning` (i.e., `requirements`, `ux_design`, or `architecture`), stop with an error:

```
ERROR: Cannot replan — no implementation plan exists yet.
Current phase: <current_phase>
Complete the planning phase first, or use /rigor:resume to continue the current phase.
```

The replan command is valid when:
- `current_phase` is `planning` and its status is `completed`, OR
- `current_phase` is `implementation` (any status)

### 3. Query Current Work Items

Call `changelog_query` to retrieve all active (non-superseded) work items for the current iteration:

```
changelog_query(entity_type="work_item", iteration_id=<id>, filters={superseded: false})
```

Partition the results into two sets:
- **Completed** — rows where `status == "completed"` (these are preserved and immutable)
- **Actionable** — all other rows (status is `pending`, `test_writing`, or `implementing`)

### 4. Query Current Plan Version

Call `changelog_query` to get the current plan overview:

```
changelog_query(entity_type="plan_overview", iteration_id=<id>)
```

Extract the current `plan_version` (the maximum `plan_version` value across results).

### 5. Display Replan Context

Show the user what will happen:

```
📋 Replan Context

Current plan version: v<plan_version>
Completed WIs (preserved):  <count>
Actionable WIs (eligible):  <count>

Actionable work items:
  - <wi_name> (status: <status>)
  - <wi_name> (status: <status>)
  ...
```

If there are no actionable WIs (all are completed), stop with a message:

```
All work items are already completed — nothing to replan.
Use /rigor:close to close the iteration, or /rigor:new-iteration to start fresh.
```

### 6. Accept Optional Target Parameters

The user may have specified which WI names to target for decomposition in their message. For example:

```
/rigor:replan auth-login and auth-signup are too large
```

If specific WI names are mentioned, only those WIs are targeted for decomposition. If no specific WIs are mentioned, all actionable WIs are eligible.

### 7. Load Workflow Skill

Invoke the `Skill` tool with `skill: "rigor:workflow"` to load the workflow skill.
Do not use any other parameter name (e.g. `name`) — the required parameter is `skill`.

### 8. Context Handoff

When handing off to the replan flow (SKILL.md §11), provide:

- **Reason for replanning** — extracted from the user's message (e.g., "WIs are too large", "requirements changed", "blocker encountered")
- **Target WIs** — the specific WI names to decompose (if specified), or "all actionable" if not specified
- **Current plan version** — from the `plan_overview` query (step 4)
- **Completed WI names** — listed as read-only context (these must not be modified or superseded)
- **Iteration context** — from `iteration_summary` if additional context is needed

The workflow skill's §11 handles the rest: re-opening the planning phase, invoking the planner in replan mode, running the critic, superseding old WIs, and resuming implementation.

## Important Notes

- Completed work items are **never** superseded — the DB enforces this constraint
- Each replan increments the plan version (v1 → v2 → v3, etc.)
- The replan log at `planning/replan-log.md` records what changed and why
- Use `/rigor:dev-status` after replanning to verify the new state
