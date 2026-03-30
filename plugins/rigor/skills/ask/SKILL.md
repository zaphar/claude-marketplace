---
name: Project Discussion
description: Orchestrator-level Q&A session with investigation brief output. Loaded by /rigor:ask command only, not auto-triggered.
version: 0.3.0
---

# Project Q&A Orchestration

You are orchestrating an interactive Q&A session that lets users investigate their project.
When the user is ready to act on findings, you write an investigation brief and either
create a new iteration or attach the findings to the current active iteration.

This skill operates independently of the main workflow skill.

## Glossary

- **Trivial question** — Answerable with a single `project_status()` call or a
  `changelog_query` returning ≤ 3 entities.
- **Substantial question** — Requires reading source files, cross-referencing multiple
  entity types, or querying large result sets.
- **Investigation brief** — A markdown document summarizing Q&A findings and recommended
  changes, written to disk and linked to an iteration (new or existing).

## Workflow Overview

The Q&A skill has two phases:

```
Phase 1: Conversation Loop  →  Phase 2: Brief & Iteration Attachment
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
the orchestrator immediately transitions to Phase 2: Brief & Iteration Attachment.

**IMPORTANT:** If the user gives an imperative directive (e.g., "get rid of X",
"switch to Y", "consolidate on Z") WITHOUT using the action phrase, the
orchestrator should:
1. Acknowledge the request
2. Remind the user: `Say "ship it" when you're ready to turn findings into tracked actions.`
3. Stay in Phase 1

This ensures the user explicitly controls when investigation ends and execution begins.

## Phase 2: Brief & Iteration Attachment

When the user says "ship it", the orchestrator synthesizes the conversation into an
investigation brief and attaches it to an iteration — creating a new iteration only
if none is active.

**Three scenarios** (determined by `project_status()` at the start of this phase):

| Scenario | Active iteration? | `brief_path` | Action |
|----------|-------------------|--------------|--------|
| A — New iteration | No | N/A | Create brief file → `iteration_create` |
| B — Attach brief | Yes | NULL | Create brief file → `iteration_update` |
| C — Append to brief | Yes | Already set | Append to existing brief file (no DB mutation) |

### 2.1 Synthesize the Brief

Review the accumulated Q&A conversation (questions + summarized answers from project_analyst) and write an investigation brief.

**For Scenario A or B** (creating a new brief file), use this structure:

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

**For Scenario C** (appending to an existing brief file), use this structure:

```markdown
---

## Investigation: YYYY-MM-DD — <slug>

### Context
What area of the codebase was investigated and why the user initiated this investigation.
Include project name and iteration context.

### Findings
What was discovered during the Q&A session. Include:
- Specific file references (file:line) from project_analyst's reports
- Behavioral observations about the current codebase
- Problems, inconsistencies, or gaps identified
- Relevant entity references from the rigor DB (requirement IDs, ADR IDs, etc.) if applicable

### Recommended Changes
Plain-language description of what should change and why. This is NOT a requirements
specification — it is an engineer's assessment of what needs to happen.

Each recommendation should include:
- What to change
- Why it needs to change
- What area of the codebase is affected

### Scope Boundaries
What is explicitly out of scope for this iteration. This prevents scope creep when
the requirements_analyst and downstream agents formalize these findings.
```

Note: When appending, the section uses `##` as its top-level heading (since `#` is the document title), and subsections use `###`. The `---` horizontal rule separates investigations visually. The `YYYY-MM-DD` date and `<slug>` identify this investigation session.

**Important constraints on brief content (all scenarios):**
- The brief does NOT contain requirements, ADRs, work items, entity types, phase assignments, or any rigor-specific structure
- It is a senior engineer's investigation notes, not a structured specification
- Code references and evidence from project_analyst reports should be included — this prevents the requirements_analyst from needing to re-investigate the codebase
- The brief should be comprehensive enough that the requirements_analyst can write requirements from it without additional investigation

### 2.2 Determine File Path and Write Brief

Read `artifacts_directory` from the project context (obtained via `project_status` at the start of the session).

**Scenario A or B** — creating a new brief file:

Choose a `<slug>` (kebab-case) — since the brief file may accumulate multiple investigation sections over time (via Scenario C appending), use a **generic name** rather than encoding the first investigation's topic. Use `investigation-brief` as the slug, or `iteration-<N>-brief` where N is the iteration ID.

Then compute the canonical path by running these bash commands **exactly** (substitute only the two variable values on the first two lines):

```bash
# 1. Set inputs — substitute these three values only
PROCESS_DIR="<process_directory>"       # from project_status, e.g. ".sdlc"
SLUG="<slug>"                           # e.g. "investigation-brief" or "iteration-3-brief"

# 2. Compute date components (UTC) — do NOT modify these lines
DATE_PATH=$(date -u '+%Y/%m/%d')        # e.g. "2026/03/24"
EPOCH=$(date +%s)                       # Unix seconds (10 digits), e.g. "1774310400"

# 3. Assemble canonical path — do NOT deviate from this structure
BRIEF_DIR="${PROCESS_DIR}/briefs/${DATE_PATH}"
BRIEF_PATH="${BRIEF_DIR}/${EPOCH}-${SLUG}.md"

# 4. Create directory and write brief
mkdir -p "${BRIEF_DIR}"
```

Then write the brief content to `${BRIEF_PATH}` using the Write tool or `cat`:

```bash
cat > "${BRIEF_PATH}" << 'BRIEF_EOF'
<brief content here>
BRIEF_EOF
```

**Worked example.** If `process_directory` is `.sdlc`, today is 2026-03-24 UTC, epoch is `1774310400`, and slug is `investigation-brief`, the path MUST be:

```
.sdlc/briefs/2026/03/24/1774310400-investigation-brief.md
```

These are all **wrong** — do NOT produce paths like these:

```
docs/sdlc/briefs/investigation-brief.md                          ← missing process_directory and date hierarchy
.sdlc/briefs/2026-03-24/1774310400-investigation-brief.md  ← dashes instead of directory separators in date
.sdlc/briefs/investigation-brief.md                  ← missing date hierarchy entirely
.sdlc/briefs/2026/03/24/1774310400000-investigation-brief.md ← milliseconds (13 digits) instead of seconds (10 digits)
```

**Path rules (mandatory):**
- The path MUST be rooted at `<process_directory>/briefs/`
- The date MUST be split into three directory levels: `YYYY/MM/DD` (not `YYYY-MM-DD` as a single directory name)
- Month and day MUST be zero-padded: `03` not `3`
- Epoch MUST be Unix seconds (10 digits), not milliseconds (13 digits)
- The `brief_path` stored in the DB is relative to the project root — no leading `/`, no absolute path

**Scenario C** — appending to an existing brief file:

Use the `brief_path` returned by `project_status()`. The file already exists at that path (relative to the project root). Append the content synthesized in step 2.1 (which starts with `---`) to the end of the existing file.

### 2.3 Show Summary and Confirm

Present the brief summary to the user. The confirmation message varies by scenario:

**Scenario A** (new iteration):

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

**Scenario B** (attach brief to existing iteration):

```
📋 Investigation Brief

File: <brief_path>

Summary:
- <1-2 sentence summary of findings>
- <number> recommended changes identified
- Scope: <brief scope description>

This will attach the brief to iteration <N>.
The requirements analyst will formalize these findings into requirements,
then the standard workflow will proceed through architecture, planning,
and implementation.

Ready to attach? You can also edit the brief file first
if you want to adjust anything.
```

**Scenario C** (append to existing brief):

```
📋 Investigation Findings Appended

File: <brief_path>

Summary:
- <1-2 sentence summary of new findings>
- <number> recommended changes identified
- Scope: <brief scope description>

This will append findings to the existing brief for iteration <N>.
The requirements analyst will read all investigation sections when
formalizing requirements.

Ready to proceed? You can also edit the brief file first
if you want to adjust anything.
```

Wait for the user to respond. If they want to edit the brief, wait for them to signal they're done. If they want to cancel, exit the skill.

### 2.4 Create or Attach Iteration

Once confirmed, execute the appropriate DB mutation based on the scenario determined at the start of Phase 2:

**Scenario A** — no active iteration → create one:

```
iteration_create(
  project_root: "<path>",
  brief_path: "<relative path to brief file from project root>",
  project_name: "<existing project name>",
  critic_model: "<existing critic model>"
)
```

**Note:** For existing projects (iteration 2+), `project_name` and `critic_model` are already set on the project row. The `iteration_create` handler uses the existing values — passing them here is for the case where no project exists yet.

**Scenario B** — active iteration with NULL `brief_path` → attach:

```
iteration_update(
  project_root: "<path>",
  iteration_id: <N>,
  brief_path: "<relative path to brief file from project root>"
)
```

**Scenario C** — active iteration with `brief_path` already set → no DB call needed:

The file was already appended to on disk in step 2.2. The existing `brief_path` on the iteration still points to the correct file. No database mutation is required.

### 2.5 Checkpoint and Exit

```
checkpoint(
  project_root: "<path>",
  message: "Q&A investigation brief: <slug>"
)
```

Present the completion message appropriate to the scenario:

**Scenario A:**

```
✅ Iteration <N> created, seeded with investigation brief.

Brief: <brief_path>

Run /rigor:resume to begin the workflow. The requirements analyst will
read the brief and formalize findings into requirements. From there,
the standard workflow proceeds through all phases.

You can use /rigor:skip-to to jump to a specific phase if some phases
aren't needed.
```

**Scenario B:**

```
✅ Investigation brief attached to iteration <N>.

Brief: <brief_path>

Run /rigor:resume to begin the workflow. The requirements analyst will
read the brief and formalize findings into requirements. From there,
the standard workflow proceeds through all phases.

You can use /rigor:skip-to to jump to a specific phase if some phases
aren't needed.
```

**Scenario C:**

```
✅ Findings appended to investigation brief for iteration <N>.

Brief: <brief_path>

Run /rigor:resume to continue the workflow. The requirements analyst will
read all investigation sections when formalizing requirements.
```

Exit the skill.

## Exit Conditions

The skill exits when any of the following occurs:

1. **No actions needed** — User says "done" / "thanks" during the conversation loop (Phase 1). No DB state changes.
2. **Brief created and iteration started** — Phase 2 completes successfully (Scenario A). Brief is on disk, iteration is created, state is checkpointed.
3. **Brief attached or appended** — Phase 2 completes successfully (Scenario B or C). Brief is on disk and linked to the existing iteration, state is checkpointed.
4. **User cancels during confirmation** — User declines after seeing the brief summary. Brief file remains on disk but no iteration is created or modified.

## Error Handling

- **project_analyst failure** — Report the failure to the user conversationally. Offer to retry with a rephrased question. Do NOT let the failure cascade.
- **Brief write failure** — Report the error, suggest the user check disk permissions.
- **iteration_create failure** — Report the error. This should only be called in Scenario A (no active iteration).
- **iteration_update failure** — The iteration's `brief_path` is already set. Append to the existing brief file instead (Scenario C). This should not happen if the orchestrator follows the flow correctly — it means `project_status` was not checked before choosing the scenario.
- **DB unavailable** — Display a clear error message. Suggest using `/rigor:dev-status` to check state.

## Relationship to Main Workflow

- This skill operates **independently** of the main workflow skill (`skills/workflow/SKILL.md`).
- It can be invoked at any time — before, during, or after the main workflow.
- It does NOT modify phase state, create revisions, or run agent workflows — those are the workflow skill's responsibility.
- The only DB mutations are `iteration_create`, `iteration_update` (to attach a brief to an existing iteration), and `checkpoint`.

## Available Tools

> **Always include `project_root` in every tool call**, set to the absolute path of the current project's root directory.

You have access to:
- **Read** — Read agent files and VCS-tracked source files (but prefer delegating file reads to `project_analyst`)
- **Bash** — Run commands (mkdir, write files)
- **Task** — Invoke agents (project_analyst for investigation)
- **AskUserQuestion** — Get user confirmation for iteration creation
- **project_status** (MCP tool) — Get current project state
- **changelog_query** (MCP tool) — Small, targeted lookups only
- **iteration_create** (MCP tool) — Create iteration with brief_path (Phase 2, Scenario A only)
- **iteration_update** (MCP tool) — Set brief_path on an existing active iteration (Phase 2, Scenario B only — when brief_path is NULL; pass `force: true` to correct an incorrect path)
- **checkpoint** (MCP tool) — Persist state after iteration creation (Phase 2 only)

## Critical Rules

1. **Context protection above all** — Never read source files directly. Always delegate to project_analyst.
2. **"Ship it" is the explicit gate** — Imperative statements do not trigger Phase 2.
3. **No scope expansion** — The brief documents what the user discussed, nothing more.
4. **No ad-hoc planning** — NEVER create plan.md files, session SQL todos, or local task lists for changes that should flow through the rigor workflow. If the user requests changes, guide them to say "ship it" to trigger Phase 2. All project changes go through the brief → iteration → workflow pipeline. The rigor DB is the sole system of record for project planning and tracking.
5. **Brief is prose, not structure** — No requirements, ADRs, work items, or rigor entity types in the brief.
6. **"Ship it" attaches to the current iteration when possible** — Only creates a new iteration if none is active. When an active iteration exists, the brief is attached or appended to it.

---

**Remember:** This is a focused Q&A tool. Keep the conversation lightweight, delegate heavy investigation, and hand off to the workflow skill for execution.
