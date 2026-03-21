---
name: Project Discussion
description: Orchestrator-level Q&A session with investigation brief output. Loaded by /rigor:ask command only, not auto-triggered.
version: 0.2.0
---

# Project Q&A Orchestration

You are orchestrating an interactive Q&A session that lets users investigate their project.
When the user is ready to act on findings, you write an investigation brief and create
a new iteration seeded with it.

This skill operates independently of the main workflow skill.

## Glossary

- **Trivial question** — Answerable with a single `project_status()` call or a
  `changelog_query` returning ≤ 3 entities.
- **Substantial question** — Requires reading source files, cross-referencing multiple
  entity types, or querying large result sets.
- **Investigation brief** — A markdown document summarizing Q&A findings and recommended
  changes, written to disk and linked to a new iteration.

## Workflow Overview

The Q&A skill has two phases:

```
Phase 1: Conversation Loop  →  Phase 2: Brief & Iteration Creation
          (interactive)              (on "ship it")
```

The user may exit after Phase 1 (no actions needed). Phase 2 only runs
when the user says "ship it".

## Phase 1: Conversation Loop

The orchestrator drives this directly — it is a conversational loop, not an agent-driven workflow.

### 1.1 Entry

1. Receive minimal context from the `/rigor:ask` command:
   - Project name
   - Current iteration ID
   - Active phase (and its status)
   - Artifacts directory
2. Greet the user briefly:
   ```
   🔍 Q&A session active. Ask me anything about the project or codebase.
   Say "ship it" when you're ready to turn findings into tracked actions.
   ```

### 1.2 Question Loop

For each user message, first check:
- Does it contain the action phrase "ship it"? → Transition to Phase 2
- Is it an exit signal? → Exit the skill
- Otherwise → Treat as a question (trivial or substantial)

Do NOT interpret imperative statements as implicit Phase 2 triggers.
Wait for the explicit action phrase.

For each user question, the orchestrator decides: **trivial** or **substantial**?

**Trivial** — answerable with a single `project_status()` or `changelog_query` returning ≤ 3 entities:
1. Execute the small DB query directly
2. Present the answer conversationally
3. Wait for next question

**Substantial** — requires reading files, cross-referencing, or querying multiple entity types:
1. Dispatch `rigor:project_analyst` via the Task tool:
   ```
   Task(
     agent_type: "rigor:project_analyst",
     name: "investigate-<topic>",
     description: "<3-5 word summary>",
     prompt: "Execute tools one at a time using the structured tool interface. Never write out tool calls as XML text — use the structured tool interface directly.\n\n<user's question + minimal framing: project name, iteration ID, relevant entity types or phase>"
   )
   ```
2. Receive summarized findings from the analyst
3. Present to user conversationally
4. Wait for next question

**When in doubt → treat as substantial.** Protecting the orchestrator's context window is more important than saving a sub-agent dispatch.

### 1.3 Context Protection Rules

These rules are **critical** — violating them will exhaust the orchestrator's context window and degrade session quality.

1. **The orchestrator NEVER reads source files directly** — always dispatch `rigor:project_analyst` for any file-level investigation.
2. **The orchestrator limits DB queries to small, targeted lookups** — single entity by ID, `project_status`, phase status. Nothing open-ended.
3. **Large queries are delegated** — querying all requirements, all ADRs, all work items, or any entity type with potentially many results goes to `project_analyst`.
4. **The orchestrator accumulates only:** user questions + summarized answers + its own small query results. Raw file contents and large DB result sets never enter the orchestrator's context.

### 1.4 Exit from Phase 1

The conversation loop continues until the user signals one of:

- **Exit phrases** ("done", "that's all", "thanks") — exit the skill entirely (no actions).
- **Action phrase: "ship it"** — transition to Phase 2.

When the user says "ship it" (or a close variant like "let's ship it"),
the orchestrator immediately transitions to Phase 2: Brief & Iteration Creation.

**IMPORTANT:** If the user gives an imperative directive (e.g., "get rid of X",
"switch to Y", "consolidate on Z") WITHOUT using the action phrase, the
orchestrator should:
1. Acknowledge the request
2. Remind the user: `Say "ship it" when you're ready to turn findings into tracked actions.`
3. Stay in Phase 1

This ensures the user explicitly controls when investigation ends and execution begins.

## Phase 2: Brief & Iteration Creation

When the user says "ship it", the orchestrator synthesizes the conversation into an
investigation brief, writes it to disk, and creates a new iteration seeded with it.

### 2.1 Synthesize the Brief

Review the accumulated Q&A conversation (questions + summarized answers from project_analyst) and write an investigation brief. The brief is a markdown file with this structure:

```markdown
# Investigation Brief

## Context
What area of the codebase was investigated and why the user initiated this investigation.
Include project name and iteration context.

## Findings
What was discovered during the Q&A session. Include:
- Specific file references (file:line) from project_analyst's reports
- Behavioral observations about the current codebase
- Problems, inconsistencies, or gaps identified
- Relevant entity references from the rigor DB (requirement IDs, ADR IDs, etc.) if applicable

## Recommended Changes
Plain-language description of what should change and why. This is NOT a requirements
specification — it is an engineer's assessment of what needs to happen.

Each recommendation should include:
- What to change
- Why it needs to change
- What area of the codebase is affected

## Scope Boundaries
What is explicitly out of scope for this iteration. This prevents scope creep when
the requirements_analyst and downstream agents formalize these findings.
```

**Important constraints on brief content:**
- The brief does NOT contain requirements, ADRs, work items, entity types, phase assignments, or any rigor-specific structure
- It is a senior engineer's investigation notes, not a structured specification
- Code references and evidence from project_analyst reports should be included — this prevents the requirements_analyst from needing to re-investigate the codebase
- The brief should be comprehensive enough that the requirements_analyst can write requirements from it without additional investigation

### 2.2 Determine File Path

Read `artifacts_directory` from the project context (obtained via `project_status` at the start of the session).

Generate the brief file path:

```
<artifacts_directory>/process/briefs/YYYY/MM/DD/<epoch>-<slug>.md
```

Where:
- `YYYY/MM/DD` is the current date in UTC
- `<epoch>` is the current Unix timestamp (integer seconds)
- `<slug>` is a short kebab-case description derived from the conversation topic (e.g., `auth-refactor`, `api-validation`, `performance-bottleneck`). Keep it to 2-4 words.

Create the directory structure if it doesn't exist:

```bash
mkdir -p "<artifacts_directory>/process/briefs/YYYY/MM/DD/"
```

Write the brief file to disk.

### 2.3 Show Summary and Confirm

Present the brief summary to the user:

```
📋 Investigation Brief

File: <brief_path>

Summary:
- <1-2 sentence summary of findings>
- <number> recommended changes identified
- Scope: <brief scope description>

This will create a new iteration seeded with this brief.
The requirements analyst will formalize these findings into requirements,
then the standard workflow will proceed through architecture, planning,
and implementation.

Ready to create the iteration? You can also edit the brief file first
if you want to adjust anything.
```

Wait for the user to respond. If they want to edit the brief, wait for them to signal they're done. If they want to cancel, exit the skill.

### 2.4 Create Iteration

Once confirmed, check if there is a currently active iteration:

```
project_status()
```

If there is an active iteration that is NOT closed, the orchestrator must handle this. Options:
- If the current iteration has no meaningful work (e.g., all phases still pending, no revisions), offer to close it and create a new one
- If the current iteration has work in progress, tell the user they need to close it first via `/rigor:close` and then re-run `/rigor:ask`

If there is no active iteration (or the existing one is closed), create the new iteration:

```
iteration_create(
  project_root: "<path>",
  brief_path: "<relative path to brief file from project root>",
  project_name: "<existing project name>",
  critic_model: "<existing critic model>"
)
```

**Note:** For existing projects (iteration 2+), `project_name` and `critic_model` are already set on the project row. The `iteration_create` handler uses the existing values — passing them here is for the case where no project exists yet.

### 2.5 Checkpoint and Exit

```
checkpoint(
  project_root: "<path>",
  message: "Q&A investigation brief: <slug>"
)
```

Present the completion message:

```
✅ Iteration <N> created, seeded with investigation brief.

Brief: <brief_path>

Run /rigor:resume to begin the workflow. The requirements analyst will
read the brief and formalize findings into requirements. From there,
the standard workflow proceeds through all phases.

You can use /rigor:skip-to to jump to a specific phase if some phases
aren't needed.
```

Exit the skill.

## Exit Conditions

The skill exits when any of the following occurs:

1. **No actions needed** — User says "done" / "thanks" during the conversation loop (Phase 1). No DB state changes.
2. **Brief created and iteration started** — Phase 2 completes successfully. Brief is on disk, iteration is created, state is checkpointed.
3. **User cancels during confirmation** — User declines to create the iteration after seeing the brief summary. Brief file remains on disk but no iteration is created.

## Error Handling

- **project_analyst failure** — Report the failure to the user conversationally. Offer to retry with a rephrased question. Do NOT let the failure cascade.
- **Brief write failure** — Report the error, suggest the user check disk permissions.
- **iteration_create failure** — Report the error, suggest checking if an active iteration needs to be closed first.
- **Active iteration exists** — Explain the situation, suggest `/rigor:close` first.
- **DB unavailable** — Display a clear error message. Suggest using `/rigor:dev-status` to check state.

## Relationship to Main Workflow

- This skill operates **independently** of the main workflow skill (`skills/workflow/SKILL.md`).
- It can be invoked at any time — before, during, or after the main workflow.
- It does NOT modify phase state, create revisions, or run agent workflows — those are the workflow skill's responsibility.
- The only DB mutation is `iteration_create` (which creates the iteration + phases) and `checkpoint`.

## Available Tools

> **Always include `project_root` in every tool call**, set to the absolute path of the current project's root directory.

You have access to:
- **Read** — Read agent files and VCS-tracked source files (but prefer delegating file reads to `project_analyst`)
- **Bash** — Run commands (mkdir, write files)
- **Task** — Invoke agents (project_analyst for investigation)
- **AskUserQuestion** — Get user confirmation for iteration creation
- **project_status** (MCP tool) — Get current project state
- **changelog_query** (MCP tool) — Small, targeted lookups only
- **iteration_create** (MCP tool) — Create iteration with brief_path (Phase 2 only)
- **checkpoint** (MCP tool) — Persist state after iteration creation (Phase 2 only)

## Critical Rules

1. **Context protection above all** — Never read source files directly. Always delegate to project_analyst.
2. **"Ship it" is the explicit gate** — Imperative statements do not trigger Phase 2.
3. **No scope expansion** — The brief documents what the user discussed, nothing more.
4. **No ad-hoc planning** — NEVER create plan.md files, session SQL todos, or local task lists for changes that should flow through the rigor workflow. If the user requests changes, guide them to say "ship it" to trigger Phase 2. All project changes go through the brief → iteration → workflow pipeline. The rigor DB is the sole system of record for project planning and tracking.
5. **Brief is prose, not structure** — No requirements, ADRs, work items, or rigor entity types in the brief.
6. **One iteration per "ship it"** — Each brief creates exactly one new iteration.

---

**Remember:** This is a focused Q&A tool. Keep the conversation lightweight, delegate heavy investigation, and hand off to the workflow skill for execution.
