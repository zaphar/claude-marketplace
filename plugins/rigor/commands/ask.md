---
description: Ask a question about the project using full codebase and rigor DB context
allowed-tools:
  - Read
  - Bash
  - Task
  - mcp__plugin_rigor_rigor-db__project_status
  - mcp__plugin_rigor_rigor-db__changelog_query
  - mcp__plugin_rigor_rigor-db__phase_transition
  - mcp__plugin_rigor_rigor-db__revision_create
  - mcp__plugin_rigor_rigor-db__revision_update
  - mcp__plugin_rigor_rigor-db__checkpoint
---

# Ask a Question About the Project

Dispatch a read-only analyst to answer a question about the project, cross-referencing
the codebase and the rigor database (requirements, ADRs, components, work items, etc.).

## What This Command Does

1. Verifies a project exists
2. Passes minimal project context to the already-loaded Q&A skill so it can orchestrate the answer

## Implementation Steps

> **Always include `project_root` in every tool call**, set to the absolute path of the current project's root directory (the directory where Claude Code is running).

### 1. Check for Existing Project

Call `project_status` to check whether a project exists in the DB:

```
project_status()
```

If it returns no project record, stop with an error:

```
ERROR: No project found. Run /rigor:start first.
```

### 2. Extract Minimal Context

From the `project_status` response, extract:

- **Project name**
- **Current iteration ID**
- **Active phase** (and its status)
- **Artifacts directory**

These are the only values you pass forward — do not query additional data.

### 3. Begin Q&A Session

The Q&A skill is already loaded by the platform. Do NOT call `skill("rigor:ask")` or any other skill invocation — it will fail because the skill is already active.

Present the extracted context and greet the user:

```
Project: <project_name>
Iteration: <iteration_id>
Active Phase: <phase_name> (<phase_status>)
Artifacts: <artifacts_directory>

🔍 Q&A session active. Ask me anything about the project or codebase.
Say "ship it" when you're ready to turn findings into tracked actions.
```

Then wait for the user's next conversational message. Do NOT use `AskUserQuestion` to prompt for a question — the user will type naturally.
