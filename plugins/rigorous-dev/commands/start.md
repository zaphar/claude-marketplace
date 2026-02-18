---
description: Initialize a new rigorous development workflow
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

# Start Rigorous Development Workflow

Initialize a new rigorous development workflow for this project.

## What This Command Does

1. Checks if a workflow already exists (error if it does)
2. Prompts user for project configuration
3. Creates artifacts directory
4. Initializes workflow state file
5. Begins with the Requirements phase

## Implementation Steps

### 1. Check for Existing Workflow

First, check if `.claude/rigorous-dev-state.yaml` already exists:

```bash
if [ -f .claude/rigorous-dev-state.yaml ]; then
  echo "ERROR: A workflow already exists in this project."
  echo "Use /rigorous-dev:resume to continue the existing workflow."
  echo "Use /rigorous-dev:close to close it, then /rigorous-dev:new-iteration to start fresh."
  exit 1
fi
```

### 2. Gather Configuration

Use AskUserQuestion to prompt for:

- **Project name**: Default to current directory name if not provided
- **Artifacts directory**: Default to `.claude/rigorous-dev-artifacts`

If user wants artifacts version-controlled, suggest a non-.claude path like `./docs/sdlc-artifacts`.

### 3. Create Artifacts Directory

Create the configured artifacts directory:

```bash
mkdir -p "<artifacts_directory>"
```

### 4. Initialize State File

Create `.claude/rigorous-dev-state.yaml` with this structure:

```yaml
workflow_id: "rigorous-dev-workflow"
project_name: "<user_provided_or_inferred>"
created_at: "<current_timestamp_ISO8601>"
updated_at: "<current_timestamp_ISO8601>"
current_phase: "requirements"
artifacts_directory: "<user_configured_path>"
iteration_number: 1
status: "active"
closed_at: null
notes: ""
phase_status:
  requirements:
    status: "in_progress"
    started_at: "<current_timestamp_ISO8601>"
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
  ux_design:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
  architecture:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
  planning:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
  implementation:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    current_phase_number: null
    notes: ""
  documentation:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
```

### 5. Load Rigorous Dev Skill

After state file is created, load the rigorous-dev skill to begin the workflow:

```
Load skills/rigorous-dev/SKILL.md and begin with Requirements phase.
```

### 6. Start Requirements Phase

Inform the user that the workflow has started and load the requirements_analyst agent:

```
✓ Workflow initialized successfully!

Project: <project_name>
Artifacts: <artifacts_directory>

Starting Requirements Phase...
Loading Requirements Analyst agent.
```

Then load and execute `agents/requirements_analyst.md` to begin the conversational interview.

## Success Message

Display a clear confirmation that the workflow has been initialized and the requirements phase has begun.
