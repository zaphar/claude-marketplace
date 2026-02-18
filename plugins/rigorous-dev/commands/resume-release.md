---
description: Resume an existing release workflow
allowed-tools:
  - Read
  - Write
  - Bash
---

# Resume Release Workflow

Resume an existing release workflow from saved state.

## What This Command Does

1. Checks if a release workflow exists (error if it doesn't)
2. Loads release workflow state from `.claude/rigorous-dev-release-state.yaml`
3. Displays current release status
4. Loads the rigorous-dev skill with context
5. Continues from the current release phase

## Implementation Steps

### 1. Check for Release Workflow State

Check if `.claude/rigorous-dev-release-state.yaml` exists:

```bash
if [ ! -f .claude/rigorous-dev-release-state.yaml ]; then
  echo "ERROR: No release workflow found in this project."
  echo "Use /rigorous-dev:start-release to initialize a release workflow."
  exit 1
fi
```

### 2. Check Release Workflow Status

After loading the state, check if the release workflow is completed:

- If `status == "completed"`, display:

```
This release workflow is already completed.
To start a new release workflow, delete .claude/rigorous-dev-release-state.yaml and run /rigorous-dev:start-release.
```

### 3. Load Release Workflow State

Read and parse `.claude/rigorous-dev-release-state.yaml` to extract:
- Project name
- Current phase (first in_progress or first pending phase)
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
<status_indicator> Release: <status>

Resuming <current_phase> phase...
```

### 5. Load Rigorous Dev Skill

Load the rigorous-dev skill with the current release state context.

### 6. Continue Current Phase

Based on the current phase and its status, load the appropriate agent:

**Phase-to-Agent Mapping:**
- `qa` → `agents/qa_engineer.md`
- `audit` → `agents/security_auditor.md` + `agents/performance_auditor.md` (parallel)
- `release` → `agents/release_engineer.md`

**If phase status is "in_progress":**
- Load the producer agent for that phase (continue work)

**If phase status is "completed":**
- Should not happen; workflow should have advanced to next phase
- Display error and suggest running `/rigorous-dev:release-status` to check state

### 7. Context Handoff

When loading the agent, provide context about:
- What dev workflow artifacts exist (from `.claude/rigorous-dev-state.yaml`)
- What release artifacts already exist
- Current iteration count
- Any notes from previous work
- Feedback from critics (if in revision loop)

## Success Message

Clearly indicate that the release workflow has resumed and which agent is now active.
