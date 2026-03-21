# Plan 2: Refactor `/rigor:ask` — Investigation Brief Workflow

> **Dependency:** This plan assumes Plan 1 (Artifacts Directory Consolidation) is complete. Specifically, it assumes:
> - `project.artifacts_directory` exists in the DB and is returned by `project_status`
> - The canonical directory structure `<artifacts_directory>/process/briefs/` exists
> - All agents read `artifacts_directory` from `project_status`

## Problem Statement

The current `/rigor:ask` skill (`skills/ask/SKILL.md`) tries to do three things:

1. **Phase 1:** Interactive Q&A loop with `project_analyst` (works well)
2. **Phase 2:** Action Mapping — synthesize conversation into actions, classify by phase, confirm with user (fails in practice)
3. **Phase 3:** Phase Execution — run scoped producer-critic loops for each affected phase (fails in practice)

Phases 2 and 3 fail because:
- By the time "ship it" fires, the LLM's context is bloated with conversational Q&A content
- The LLM has been operating in "helpful analyst" mode and must suddenly become a precise state machine
- The action mapping logic (dynamic phase selection, entity-type classification) is too many decisions at once
- The skill duplicates the workflow skill's phase execution logic, creating a parallel code path that's hard to maintain

## Solution

Redesign the ask skill to have a **clean separation of concerns**:

1. **Q&A loop** — unchanged, project_analyst investigates questions
2. **"Ship it"** — write an investigation brief file to disk, create a new iteration linked to it, tell user to `resume`
3. **Execution** — handled entirely by the existing workflow skill via `/rigor:resume`

The **investigation brief** is the interface contract between the ask skill and the workflow skill. It's a markdown file that the `requirements_analyst` reads instead of conducting an interactive interview.

### Architecture

```
/rigor:ask
  └─ Q&A loop (project_analyst dispatched for substantial questions)
  └─ User says "ship it"
  └─ Ask skill writes investigation brief to disk
  └─ Ask skill shows brief summary, asks user to confirm
  └─ Ask skill calls iteration_create(brief_path: "<path>")
  └─ Ask skill calls checkpoint()
  └─ "Iteration <N> created. Run /rigor:resume to begin."

/rigor:resume
  └─ project_status() → gets active iteration with brief_path
  └─ Loads workflow skill
  └─ Workflow skill sees requirements phase in_progress
  └─ Invokes requirements_analyst
  └─ requirements_analyst detects brief_path → reads file instead of interviewing
  └─ Normal workflow from there (all phases, user can skip-to as needed)
```

---

## Implementation Steps

### Step 1: Schema Migration — Add `brief_path` to `iteration`

**File to create:** `plugins/rigor/mcp-server/migrations/007_iteration_brief_path.sql`

> **Migration numbering:** Plan 1 creates migration `006`. This is `007`. If Plan 1 used a different number, adjust accordingly.

```sql
ALTER TABLE iteration ADD COLUMN brief_path TEXT;
```

The column is nullable — most iterations won't have a brief (they use the interactive interview path).

**File to update:** `plugins/rigor/mcp-server/schema.sql`

Add the column to the `iteration` CREATE TABLE statement:

```sql
CREATE TABLE IF NOT EXISTS iteration (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  notes TEXT NOT NULL DEFAULT '',
  brief_path TEXT                -- ← ADD THIS
);
```

Update the `-- Purpose:` / `-- Context:` comment block for the `iteration` table to mention that `brief_path` stores the path (relative to project root) of an investigation brief that seeds this iteration's requirements phase. When present, the `requirements_analyst` reads this file instead of conducting an interactive interview. NULL means the iteration uses the standard interview flow.

### Step 2: Update `iteration_create` in write-tools.js

**File:** `plugins/rigor/mcp-server/write-tools.js`

Find the `iteration_create` tool definition. Add `brief_path` as an optional parameter:

```javascript
properties: {
  project_name: { type: "string", description: "Project name (used if project must be created)" },
  critic_model: { type: "string", description: "Critic model name (default: sonnet)" },
  artifacts_directory: { type: "string", description: "Root directory for SDLC file artifacts (default: docs/sdlc). Only used on project creation." },
  brief_path: { type: "string", description: "Path to investigation brief file (relative to project root). When set, requirements_analyst reads this file instead of conducting an interactive interview." },
},
```

In the handler function, find where the iteration row is INSERTed. Add `brief_path` to the INSERT:

```sql
INSERT INTO iteration (status, brief_path) VALUES ('active', @brief_path)
```

If `args.brief_path` is not provided, insert NULL.

**Also update the return value** to include `brief_path` in the response so the caller can confirm it was stored.

### Step 3: Update `project_status` in read-tools.js

**File:** `plugins/rigor/mcp-server/read-tools.js`

The `projectStatus` function queries `SELECT * FROM iteration WHERE status = 'active'`. Since the column now exists, `SELECT *` will include `brief_path` automatically.

**Verify:** Confirm the function doesn't filter columns. If it explicitly lists columns in the SELECT, add `brief_path`.

Also check `iteration_summary` — if it returns iteration data, ensure `brief_path` is included.

### Step 4: Rewrite the Ask Skill

**File:** `plugins/rigor/skills/ask/SKILL.md`

This is the largest change. **Delete Phase 2 (Action Mapping) and Phase 3 (Phase Execution) entirely.** Replace them with a brief-writing flow.

The new skill structure:

```markdown
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
```

#### Phase 1: Conversation Loop

**Keep this section almost identical to the current Phase 1.** The Q&A loop, trivial vs substantial routing, context protection rules, project_analyst dispatch — all of this stays as-is. The only changes:

1. Remove the reference to "Phase 2: Action Mapping" and "Phase 3: Phase Execution" from the exit conditions
2. Update exit signals:
   - **Exit phrases** ("done", "that's all", "thanks") → exit the skill, no changes
   - **"Ship it"** → transition to Phase 2 (Brief & Iteration Creation)

3. Keep the rule that imperative statements ("get rid of X") do NOT trigger Phase 2 — the user must say "ship it" explicitly.

4. **Keep all context protection rules intact** — the orchestrator never reads source files, delegates large queries to project_analyst, etc.

#### Phase 2: Brief & Iteration Creation (NEW — replaces old Phase 2 and Phase 3)

When the user says "ship it", execute the following steps:

##### Step 2.1: Synthesize the Brief

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

##### Step 2.2: Determine File Path

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

##### Step 2.3: Show Summary and Confirm

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

##### Step 2.4: Create Iteration

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

**Note:** For existing projects (iteration 2+), `project_name` and `critic_model` are already set on the project row. The `iteration_create` handler should use the existing values — passing them here is for the case where no project exists yet (first iteration from Q&A, which is an edge case but should work).

##### Step 2.5: Checkpoint and Exit

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

#### No Ad-Hoc Planning Rule

Keep the existing rule (currently rule #7 in Critical Rules):

> NEVER create plan.md files, session SQL todos, or local task lists for changes that should flow through the rigor workflow. If the user requests changes, guide them to say "ship it" to trigger Phase 2. All project changes go through the brief → iteration → workflow pipeline. The rigor DB is the sole system of record for project planning and tracking.

#### Updated Available Tools

Remove the phase execution tools that are no longer needed. The ask skill's tool list becomes:

- **Read** — Read agent files and VCS-tracked source files (prefer delegating to project_analyst)
- **Bash** — Run commands (mkdir, write files)
- **Task** — Invoke agents (project_analyst for investigation)
- **AskUserQuestion** — Get user confirmation for iteration creation
- **project_status** (MCP tool) — Get current project state
- **changelog_query** (MCP tool) — Small, targeted lookups only
- **iteration_create** (MCP tool) — Create iteration with brief_path (Phase 2 only)
- **checkpoint** (MCP tool) — Persist state after iteration creation (Phase 2 only)

**Remove these tools from the skill** (they were only needed for the old Phase 3):
- `phase_transition` — not needed, the workflow skill handles this
- `revision_create` — not needed
- `revision_update` — not needed

#### Updated Error Handling

Simplify error handling to match the reduced scope:

- **project_analyst failure** — same as before (report, offer retry)
- **Brief write failure** — report the error, suggest the user check disk permissions
- **iteration_create failure** — report the error, suggest checking if an active iteration needs to be closed first
- **Active iteration exists** — explain the situation, suggest `/rigor:close` first

Remove all the phase execution error handling (DB errors during phase execution, missing prior phase data, etc.) — these are the workflow skill's responsibility now.

#### Updated Critical Rules

```
1. Context protection above all — Never read source files directly. Always delegate to project_analyst.
2. "Ship it" is the explicit gate — Imperative statements do not trigger Phase 2.
3. No scope expansion — The brief documents what the user discussed, nothing more.
4. No ad-hoc planning — Changes go through the brief → iteration → workflow pipeline.
5. Brief is prose, not structure — No requirements, ADRs, work items, or rigor entity types in the brief.
6. One iteration per "ship it" — Each brief creates exactly one new iteration.
```

### Step 5: Update the Ask Command

**File:** `plugins/rigor/commands/ask.md`

The command's `allowed-tools` list needs to match the skill's reduced tool set. Update:

```yaml
allowed-tools:
  - Read
  - Bash
  - Task
  - mcp__plugin_rigor_rigor-db__project_status
  - mcp__plugin_rigor_rigor-db__changelog_query
  - mcp__plugin_rigor_rigor-db__iteration_create
  - mcp__plugin_rigor_rigor-db__checkpoint
```

**Remove** from allowed-tools:
- `mcp__plugin_rigor_rigor-db__phase_transition`
- `mcp__plugin_rigor_rigor-db__revision_create`
- `mcp__plugin_rigor_rigor-db__revision_update`

Also add the Copilot CLI format for the new tools (per AGENTS.md invariant #1):
- `rigor-db/iteration_create`
- `rigor-db/checkpoint`

And remove the Copilot CLI format for removed tools:
- `rigor-db/phase_transition`
- `rigor-db/revision_create`
- `rigor-db/revision_update`

### Step 6: Update `requirements_analyst` Agent

**File:** `plugins/rigor/agents/requirements_analyst.agent.md`

This is the critical integration point. The requirements_analyst currently always conducts an interactive interview with the user. It needs to support a second mode: reading an investigation brief.

Add a new section near the top of the agent's instructions (after the role description, before the interview instructions):

```markdown
### Brief-Driven Mode

Before beginning the interview, check whether the orchestrator has provided a `brief_path`
in the session context. This value comes from the iteration record — if the current
iteration was created by `/rigor:ask`, it will have a brief_path pointing to an
investigation brief file.

**If `brief_path` is provided:**

1. Read the brief file at the given path
2. Extract the findings, recommended changes, and scope boundaries
3. **Skip the interactive interview entirely** — the brief replaces the interview
4. Proceed directly to writing requirements based on the brief's content
5. Use the brief's code references and evidence as your source material
6. Respect the scope boundaries — do not add requirements for things the brief
   explicitly marks as out of scope
7. You may use `changelog_query` to check for existing requirements from prior
   iterations that are relevant to the brief's findings

**If `brief_path` is NOT provided (or is NULL):**

Proceed with the standard interactive interview as described below.
```

**Do not remove or modify the existing interview instructions.** The brief-driven mode is an alternative entry path, not a replacement. The agent must support both modes.

### Step 7: Update Workflow Skill — Requirements Phase

**File:** `plugins/rigor/skills/workflow/SKILL.md`

Find the section that handles the requirements phase (where the orchestrator invokes `requirements_analyst`). This is the section that currently kicks off the interactive interview.

Add brief detection logic. When the orchestrator is about to invoke the requirements_analyst, it should:

1. Check if the current iteration has a `brief_path` (this is available from `project_status`)
2. If `brief_path` is present, include it in the producer prompt:

```
Task(
  agent_type: "rigor:requirements_analyst",
  name: "requirements-from-brief",
  description: "Requirements from investigation brief",
  prompt: "Execute tools one at a time using the structured tool interface.
  Never write out tool calls as XML text — use the structured tool interface directly.

  This iteration was created from a Q&A investigation. Read the investigation
  brief at: <brief_path>

  brief_path: <brief_path>
  artifacts_directory: <artifacts_directory>
  iteration_id: <iteration_id>
  project_name: <project_name>

  Write requirements based on the brief's findings and recommended changes.
  Do NOT conduct an interactive interview — the brief replaces the interview.
  Respect the scope boundaries defined in the brief."
)
```

3. If `brief_path` is NOT present, invoke the requirements_analyst with the standard interview prompt (existing behavior, no change).

**This is the only change to the workflow skill for Plan 2.** Everything else (phase progression, producer-critic loops, phase transitions) remains exactly as-is.

### Step 8: Update the Ask Skill's Tools in Command Frontmatter

**File:** `plugins/rigor/commands/ask.md`

Verify the allowed-tools list (from Step 5) includes both naming conventions per AGENTS.md invariant #1:

```yaml
allowed-tools:
  - Read
  - Bash
  - Task
  - mcp__plugin_rigor_rigor-db__project_status
  - rigor-db/project_status
  - mcp__plugin_rigor_rigor-db__changelog_query
  - rigor-db/changelog_query
  - mcp__plugin_rigor_rigor-db__iteration_create
  - rigor-db/iteration_create
  - mcp__plugin_rigor_rigor-db__checkpoint
  - rigor-db/checkpoint
```

### Step 9: Handle Edge Case — First-Ever Project via Ask

If a user runs `/rigor:ask` on a codebase with no existing project, the ask command currently errors with "No project found. Run /rigor:start first."

This is correct behavior — leave it as-is. The ask skill requires an existing project to investigate. The flow is:

1. `/rigor:start` → creates project and iteration 1 (standard interview flow)
2. Work through iteration 1
3. Later: `/rigor:ask` → investigate, "ship it" → creates iteration 2 with brief

If the user wants to use Q&A to bootstrap their very first iteration, they should:
1. `/rigor:start` → creates project (can immediately close iteration 1 if they prefer)
2. `/rigor:ask` → investigate, "ship it" → creates iteration 2 with brief

This is acceptable UX. Do not add project creation to the ask skill — it would reintroduce the scope bloat we're removing.

### Step 10: Handle Edge Case — Active Iteration Exists

When the user says "ship it" and there's already an active iteration, the ask skill needs to handle this gracefully. The implementation in Step 4 (Step 2.4) covers this:

- If the active iteration has no meaningful work → offer to close it
- If the active iteration has work in progress → tell user to `/rigor:close` first

The `iteration_create` tool should enforce this at the DB level too — it should error if an active iteration already exists. Check `write-tools.js` to confirm this constraint exists. If not, add it:

```javascript
// In iteration_create handler, before INSERT:
const activeIteration = db.prepare("SELECT id FROM iteration WHERE status = 'active'").get();
if (activeIteration) {
  return { error: "An active iteration already exists (ID: " + activeIteration.id + "). Close it with /rigor:close before creating a new one." };
}
```

**Verify** whether this check already exists. If it does, the ask skill just needs to handle the error response gracefully.

---

## Validation

After implementing all changes:

1. **Migration applies cleanly:** Confirm `brief_path` column is added to `iteration` table
2. **iteration_create accepts brief_path:** Create a test iteration with `brief_path` set and confirm it's stored
3. **project_status returns brief_path:** Query an iteration with a brief and confirm the field is present
4. **Ask skill no longer has phase execution:** Grep the ask skill for `phase_transition`, `revision_create`, `revision_update` — should find zero matches
5. **Ask command tools are correct:** Verify allowed-tools has both naming formats and does NOT include phase execution tools
6. **Requirements analyst brief mode:** Verify the agent file has the brief-driven mode section
7. **Workflow skill brief detection:** Verify the requirements phase section checks for `brief_path`

Grep validation:

```bash
# Ask skill should NOT reference these (they belonged to the old Phase 3)
grep -n 'phase_transition\|revision_create\|revision_update\|producer-critic' plugins/rigor/skills/ask/SKILL.md
# Should return zero matches (or only in comments explaining what was removed)

# Ask command should NOT list these tools
grep -n 'phase_transition\|revision_create\|revision_update' plugins/rigor/commands/ask.md
# Should return zero matches

# Requirements analyst should have brief_path handling
grep -n 'brief_path\|brief-driven\|investigation brief' plugins/rigor/agents/requirements_analyst.agent.md
# Should return matches in the new section

# Workflow skill should check for brief_path
grep -n 'brief_path' plugins/rigor/skills/workflow/SKILL.md
# Should return matches in the requirements phase section
```

---

## Files Changed (Summary)

| File | Change Type |
|---|---|
| `plugins/rigor/mcp-server/migrations/007_iteration_brief_path.sql` | **NEW** |
| `plugins/rigor/mcp-server/schema.sql` | Edit (add column + update comments) |
| `plugins/rigor/mcp-server/write-tools.js` | Edit (iteration_create params + handler) |
| `plugins/rigor/mcp-server/read-tools.js` | Verify (project_status returns brief_path) |
| `plugins/rigor/skills/ask/SKILL.md` | **MAJOR REWRITE** (delete Phase 2+3, add brief flow) |
| `plugins/rigor/commands/ask.md` | Edit (update allowed-tools) |
| `plugins/rigor/agents/requirements_analyst.agent.md` | Edit (add brief-driven mode) |
| `plugins/rigor/skills/workflow/SKILL.md` | Edit (brief detection in requirements phase) |

---

## What Was Removed

The following sections from the current `skills/ask/SKILL.md` are **deleted entirely**:

- **Phase 2: Action Mapping** (~40 lines) — action synthesis, entity-type-to-phase classification table, phase skip selection
- **Phase 3: Phase Execution** (~180 lines) — scoped producer-critic loops, phase-to-agent reference table, revision management, cascading context, implementation special handling, escalation logic
- **Related error handling** for phase execution failures, missing prior phase data
- **Critical rules** #2 (scoped evaluation), #3 (canonical phase order), #4 (max 3 revisions), #6 (surgical changes) — these are the workflow skill's responsibility

**Total lines removed:** ~250+ lines of complex orchestration logic
**Total lines added:** ~80 lines of brief-writing logic

The net result is a dramatically simpler skill that does one thing well: investigate and hand off.
