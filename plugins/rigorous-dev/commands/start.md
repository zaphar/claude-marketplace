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

1. Checks if a project already exists (error if it does)
2. Prompts user for project configuration
3. Creates artifacts directory
4. Initializes workflow state file
5. Begins with the Requirements phase

## Implementation Steps

### 1. Check for Existing Project

Call `project_status` to check whether a project already exists in the DB:

```
project_status()
```

If it returns a project record, stop with an error:

```
ERROR: A project already exists in this directory.
Use /rigorous-dev:resume to continue the existing workflow.
Use /rigorous-dev:close to close it, then /rigorous-dev:new-iteration to start fresh.
```

### 2. Gather Configuration

Use AskUserQuestion to prompt for:

- **Project name**: Default to current directory name if not provided
- **Artifacts directory**: Default to `.claude/rigorous-dev-artifacts`
- **Critic model**: What effort level should critic agents use for review?
  - **Sonnet (Recommended)** — Best balance of quality and cost
  - **Haiku** — Budget-friendly, good for small projects
  - **Opus** — Maximum rigor for mission-critical work

If user wants artifacts version-controlled, suggest a non-.claude path like `./docs/sdlc-artifacts`.

### 3. Create Artifacts Directory

Create the configured artifacts directory:

```bash
mkdir -p "<artifacts_directory>"
```

### 4. Initialize Project in DB

Call `iteration_create` to create the project, iteration 1, and all phases in the DB:

```
iteration_create({
  project_name: "<user_provided_or_inferred>",
  artifacts_directory: "<user_configured_path>",
  critic_model: "<user_selected_model>",
  starting_phase: "requirements"
})
```

This creates the project record, the first iteration, and all phase rows (requirements, ux_design, architecture, planning, implementation, documentation) with requirements set to `in_progress` and the rest `pending`. No YAML state file is written.

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

Then load and execute `rigorous-dev:requirements_analyst` to begin the conversational interview.

## Success Message

Display a clear confirmation that the workflow has been initialized and the requirements phase has begun.
