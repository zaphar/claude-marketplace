---
name: Rigorous Development Workflow
description: This skill should be loaded by commands only, not auto-triggered. Orchestrates a complete SDLC with producer-critic validation.
version: 0.12.0
---

# Rigorous Development Workflow Orchestration

You are orchestrating a rigorous Software Development Life Cycle (SDLC) workflow with high-quality standards and tight feedback loops through producer-critic validation.

## Glossary

- **Producer** — An agent that generates a decision (e.g. ADR) or deliverables (e.g. software), sometimes via an interview with the user.
- **Critic** — An agent that evaluates the output of a producer and determines whether the output is of acceptable quality. May reject producer output, which forces the producer to try again.
- **Producer-critic loop** — One exchange between a producer and a critic: the producer submits work, the critic reviews it.
- **Revision** — A single producer-critic loop attempt within a phase, tracked in the DB via `revision_create`/`revision_update`. The revision count determines escalation (≥ 3 → escalate to user).
- **Phase** — A collection of producer-critic loops. You exit the phase when the critic is satisfied.
- **Iteration** — A set of phases that together record decisions and produce associated deliverables.
- **Persona** — The user of the system and what their goal is. Closely related to requirements.
- **ADR (Architectural Decision Record)** — A structured record of an architectural decision: context, decision, and consequences.
- **Analyze** — Examine the requirements for gaps.
- **Design** — Propose solutions to things.
- **Review** — Look for bugs in code or divergences from the plan or requirements. Applies to documentation as well.
- **Convention** — A user-customizable rule or guideline stored in `<artifacts_directory>/process/conventions/`. Convention files are markdown with optional YAML frontmatter. The orchestrator is the single writer of convention files; agents read them but never edit them directly.

## Workflow Overview

The plugin provides two separate workflows:

### Development Workflow (fast iteration)

1. **Requirements** - Interview → Analyze → Validate
2. **UX Design** - Interview → Design → Validate
3. **Architecture** - Interview → Design → Validate
4. **Planning** - Interview → Plan → Validate
5. **Implementation** - Build → Review → Validate (with checkpoints)
6. **Documentation** - Document → Review → Validate

### Release Workflow (pre-release verification)

1. **QA** - Test → Review → Validate
2. **Audit** - Security Audit + Performance Audit (parallel) → Validate
3. **Code Review** - Holistic codebase review (optional, skippable) → Validate

The development workflow runs fast iteration loops. When you're ready to ship, the release workflow provides thorough verification (QA, security/performance audit, and optional code review). The release workflow reads dev artifacts from the same changelog database.

### Import (data bootstrapping)

`/rigor:import` — Import existing data (requirements docs, PRDs, design specs, etc.) into the changelog database. Accepts any file format; extracts and maps entities automatically. Use this before starting the development workflow to pre-populate phases with existing material, bypassing the interview steps for phases whose data is already captured.

### Q&A / Investigation

**For ad-hoc investigation and targeted updates:** Use `/rigor:ask` to open a Q&A session. This loads the separate Q&A skill (`skills/ask/SKILL.md`) which can investigate the project and feed findings into scoped producer-critic loops. See the Q&A skill documentation for details.

Each phase uses a **producer-critic pattern**: a producer agent creates the artifact, a critic agent validates it, with up to 3 revision loops before escalating to the user. The Requirements phase additionally begins with a conversational interview step before entering the standard producer-critic loop.

## Your Responsibilities

### 1. State Management

**State is stored in the SQLite changelog database at `.claude/rigor.db`**

Both the development workflow and release workflow state are tracked in the same database.

Use these MCP tools for state management:
- `project_status` — Get current project state, iteration, and all phase statuses
- `phase_transition` — Update phase status (pending → in_progress → completed)
- `iteration_create` — Create a new iteration with all phases initialized
- `project_update` — Update project-level fields (notes, critic_model)
- `iteration_close` — Close an active iteration (sets status to closed, records closed_at)
- `revision_create` — Start a new producer-critic revision for a phase
- `revision_update` — Record critic decision (approved/rejected) and feedback

**Reading current state:**

Call `project_status` at the start of any command to get the full current state: project metadata, current phase, all phase statuses, and current iteration number. This is the single source of truth for workflow state.

### 2. Phase Orchestration

For each phase, follow this pattern:

#### Requirements Phase

**Brief detection:** Before invoking the requirements analyst, check if the current iteration has a `brief_path` (available from the `current_iteration` object in the `project_status` response). If `brief_path` is present, this iteration was created from a Q&A investigation and the analyst should read the brief instead of interviewing the user.

**Brief append re-entry:** When resuming a workflow where the requirements phase is already `completed`, check whether the brief has been updated since requirements were finalized. This handles the case where `/rigor:ask` appended new investigation sections to an existing brief on an active iteration (each appended section has a dated header: `## Investigation: YYYY-MM-DD — <slug>`).

Detection logic (run when deciding which phase to work on next):

1. Call `project_status()` to get current state
2. Check: Is `current_iteration.brief_path` set AND is the requirements phase `completed`?
3. If both are true, compare the brief file's last-modified time against the requirements phase `completed_at` timestamp:
   ```bash
   stat -c %Y <brief_path> 2>/dev/null || stat -f %m <brief_path>  # Unix epoch of last modification (Linux || macOS)
   ```
   Parse `completed_at` to a Unix epoch and compare. If the file was modified **after** requirements completed, re-entry is needed. If not, the brief was already fully processed — skip to the next phase as normal. (Note: git operations can update mtime without content changes — this is harmless since the incremental analyst will find no new sections and report that no new requirements are needed.)

Re-entry procedure (only when the file modification check confirms new content):

1. Using the `completed_at` timestamp from the detection check above, call `phase_transition(iteration_id, phase_name: "requirements", status: "in_progress")` to re-open the phase
3. Invoke the requirements analyst with an **incremental prompt**:
   ```
   Task(
     agent_type: "rigor:requirements_analyst",
     name: "incremental-requirements",
     description: "Incremental requirements from appended brief",
     prompt: "Execute tools one at a time using the structured tool interface.
   Never write out tool calls as XML text — use the structured tool interface directly.

   This is an INCREMENTAL requirements pass. The brief has new investigation
   sections appended after the requirements phase was previously completed.

   brief_path: <brief_path>
   artifacts_directory: <artifacts_directory>
   iteration_id: <iteration_id>
   project_name: <project_name>
   requirements_completed_at: <completed_at timestamp from requirements phase>

   IMPORTANT: This is not a full requirements pass. The brief contains multiple
   investigation sections separated by '---' horizontal rules, each with a header
   like '## Investigation: YYYY-MM-DD — <slug>'.

   Only process sections dated AFTER <requirements_completed_at>.
   Query existing requirements via changelog_query to understand what's already
   been specified. Produce only NEW requirements for findings not yet covered.
   Do NOT duplicate existing requirements.
   Respect scope boundaries from all sections."
   )
   ```
4. After the incremental analyst completes, follow the normal critic flow: call `revision_create`, invoke `rigor:requirements_critic`, call `revision_update`, and handle approval/rejection with the standard escalation rules (max 3 revisions, then escalate to user)
5. On approval, call `phase_transition` to mark requirements `completed` again and call `checkpoint` with message "requirements: incremental pass completed (brief re-entry)"

**Important:** This re-entry check must happen BEFORE the orchestrator skips the requirements phase as already-completed. If re-entry is not needed (brief unmodified), proceed to the next incomplete phase as normal.

1. Invoke `rigor:requirements_analyst` via the Task tool
   - **If `brief_path` is present:** Include it in the producer prompt:
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
   - **If `brief_path` is NOT present:** Invoke the requirements_analyst with the standard interview prompt (existing behavior, no change).
2. Analyst conducts conversational interview with user (or reads brief if brief_path was provided)
3. Call `revision_create` with `iteration_id: <current_iteration_id>`, `phase_name: "requirements"`, and the analyst agent name
4. Analyst records output using `changelog_insert` (requirements, user stories, acceptance criteria, etc.)
5. Invoke `rigor:requirements_critic` via the Task tool to review via `changelog_query`
6. Call `revision_update` with approved/rejected status and critic feedback
7. **If approved:**
   - Call `phase_transition` to mark requirements completed
   - Call `checkpoint` with message "requirements: phase completed and approved"
   - Transition to UX Design phase
8. **If rejected:**
   - Loop back to step 3 — the next `revision_create` call
   - Iterate (max 3 times); if count >= 3, escalate to user

#### Planning Phase

Before **every** planning revision, the orchestrator must handle phase artifacts appropriately based on plan version. First, read `artifacts_directory` from the `project_status` response (it is a field on the `project` object) and `iteration_id` from `current_iteration.id`. Planning file artifacts are iteration-scoped — each iteration gets its own directory under `<artifacts_directory>/process/planning/iteration-<iteration_id>/`.

**Initial plan (plan_version = 1) — clean slate:**

```bash
# Compute planning root for this iteration
PLAN_ROOT="<artifacts_directory>/process/planning/iteration-<iteration_id>"
rm -rf "${PLAN_ROOT}"
mkdir -p "${PLAN_ROOT}/phases"
```

Same as before — no prior artifacts exist.

**Replan (plan_version > 1) — selective cleanup:**

Do NOT delete `${PLAN_ROOT}/phases/` (where `PLAN_ROOT` is `<artifacts_directory>/process/planning/iteration-<iteration_id>`). Instead, handle files selectively:

1. **Completed WI files** — Never touched. The planner receives completed WI names as read-only context and must not overwrite or modify these files.
2. **Superseded WI files** — Planner prepends a `> ⚠️ SUPERSEDED by plan version N` header to the existing file. File stays on disk for history.
3. **New WI files** — Created with new names (decomposed/restructured WIs naturally have different names).
4. **Phase index files** — Regenerated to list only active WIs. This is the only overwrite — index files, not WI files.

Before invoking the planner for a replan, determine the new plan_version:

```
changelog_query(entity_type="plan_overview", iteration_id=<id>)
→ new_plan_version = max(existing plan_versions) + 1
```

- This cleanup runs **before** invoking `rigor:implementation_planner`.
- Only `${PLAN_ROOT}/phases/` is affected — the iteration's `index.md` and `replan-log.md` are not deleted.
- Git history preserves old content, so selective handling loses nothing.
- After cleanup, the rest of the universal producer-critic loop applies normally.

Example: If artifacts_directory is "docs/sdlc" and iteration_id is 4, the planning root is:

  docs/sdlc/process/planning/iteration-4/

Files go under:
  docs/sdlc/process/planning/iteration-4/index.md
  docs/sdlc/process/planning/iteration-4/replan-log.md
  docs/sdlc/process/planning/iteration-4/phases/phase-1/index.md
  docs/sdlc/process/planning/iteration-4/phases/phase-1/WI-001.md

NOT: docs/sdlc/process/planning/phases/phase-1/WI-001.md       ← missing iteration scope
NOT: docs/sdlc/process/planning/iteration-4/WI-001.md           ← missing phases/ directory

#### All Phases (Universal Producer-Critic Loop)

**Producer-Critic Loop:**

1. Call `revision_create` with `iteration_id: <current_iteration_id>`, `phase_name: <current_phase_name>`, and the producer agent name
2. Invoke the producer agent for the phase via the Task tool (ux_designer, backend_architect, implementation_planner, documentation_master, etc.)
3. Producer conducts interview (if needed) and records output using `changelog_insert` (decisions, ADRs, components, specs, etc.)
4. Invoke the critic agent for the phase via the Task tool
5. Critic reviews by querying the current revision's data via `changelog_query`
6. **Parse convention suggestions** from the critic's output — see §15.4 for details. Collect any `CONVENTION_SUGGESTION:` blocks but do not act on them yet.
7. Call `revision_update` with approved/rejected status and critic feedback
8. **If approved:**
   - Call `phase_transition` to mark phase completed
   - Call `checkpoint` with message "<phase_name>: phase completed and approved"
   - **Surface pending convention suggestions** to the user if any were collected during this phase (see §15.4)
   - Transition to next phase
9. **If rejected:**
   - If revision_count < 3: loop back to step 1 with feedback (next `revision_create` call)
   - If revision_count >= 3: escalate to user for guidance

### 3. Agent Invocation

> **IMPORTANT:** Agents are **not** skills. Agents live in `agents/*.agent.md` and must be invoked via the **Task tool** (sub-agent invocation). Do **not** use the Skill mechanism (`Skill()`) to load agents — that only resolves entries in `skills/` directories and will fail with "Unknown skill" errors. Every instruction in this document that says to "load" an agent means: **invoke it via the Task tool** using its namespaced `agent_type` (e.g., `agent_type: "rigor:implementation_planner"`).

**Development Workflow Agents:**

| Phase | Producer Agent (`agent_type`) | Critic Agent (`agent_type`) |
|-------|----------------|--------------|
| Requirements | `rigor:requirements_analyst` | `rigor:requirements_critic` |
| UX Design | `rigor:ux_designer` | `rigor:ux_critic` |
| Architecture | `rigor:backend_architect` | `rigor:architecture_critic` |
| Planning | `rigor:implementation_planner` | `rigor:implementation_plan_critic` |
| Implementation (tests) | `rigor:test_writer` | `rigor:test_writer_critic` |
| Implementation (code) | `rigor:senior_developer` | `rigor:senior_developer_critic` |
| Documentation | `rigor:documentation_master` | `rigor:documentation_critic` |

**Release Workflow Agents:**

| Phase | Producer Agent (`agent_type`) | Critic Agent (`agent_type`) |
|-------|----------------|--------------|
| QA | `rigor:qa_engineer` | `rigor:qa_critic` |
| Audit (Security) | `rigor:security_auditor` | `rigor:security_audit_critic` |
| Audit (Performance) | `rigor:performance_auditor` | `rigor:performance_audit_critic` |
| Code Review (Design) | `rigor:codebase_design_critic` | — |
| Code Review (Go idiom) | `rigor:codebase_idiom_critic_go` | — |
| Code Review (Cross-cutting) | `rigor:codebase_cross_cutting_critic` | — |
| Code Review (Revalidation) | `rigor:code_review_revalidator` | — |

> **Note:** Auditor agents (`security_auditor`, `performance_auditor`) are **read-only producers** — they do not have Edit/Write file tools. Instead of writing files, they submit their findings exclusively via MCP tools (`changelog_insert` with entity types `security_audit_finding` and `performance_audit_finding`). Their tool lists intentionally include only Read, Grep, Glob, and Bash for code analysis.
>
> **Note:** Code review agents (`codebase_design_critic`, `codebase_idiom_critic_go`, `codebase_cross_cutting_critic`) are also **read-only producers** — they evaluate code partitions and submit findings via `changelog_insert(entity_type: "code_review_finding")`. They are dispatched per partition during the code review phase. Their tool lists intentionally include only Read, Grep, Glob, and Bash for code analysis. The cross-cutting critic additionally uses `traceability_query` for requirement ↔ code cross-referencing.
>
> **Note:** The revalidation agent (`code_review_revalidator`) is a **read-only revalidation agent** — unlike the three code review critics above which use `changelog_insert` to create new findings, the revalidator uses `changelog_update` to resolve stale findings after the developer has addressed them. It does not use `changelog_insert`. Its tool list intentionally includes only Read, Grep, Glob, and Bash for code analysis.

**When invoking agents via the Task tool, always provide these parameters:**

| Parameter | Required | Description |
|-----------|----------|-------------|
| `agent_type` | Yes | The agent's namespaced name from the tables above (e.g., `"rigor:implementation_planner"`) |
| `prompt` | Yes | The task context and instructions for the agent (see §8 Context Passing) |
| `description` | Yes | A short (3–5 word) summary of the task (e.g., `"Planning implementation phases"`, `"Reviewing architecture"`) |
| `name` | Yes | A short kebab-case name for the invocation (e.g., `"planning-producer"`, `"arch-critic"`) |
| `model` | Critics only | The `critic_model` from `project_status` (see Critic Model Selection below) |

**Example invocation (Planning phase producer):**
```
Task(
  agent_type: "rigor:implementation_planner",
  name: "planning-producer",
  description: "Creating implementation plan",
  prompt: "Execute tools one at a time using the structured tool interface. Never write out tool calls as XML text — use the structured tool interface directly.\n\nYou are working on iteration <iteration_id>, phase: planning. <context from §8>..."
)
```

**Example invocation (Planning phase critic):**
```
Task(
  agent_type: "rigor:implementation_plan_critic",
  name: "planning-critic",
  description: "Reviewing implementation plan",
  prompt: "Execute tools one at a time using the structured tool interface. Never write out tool calls as XML text — use the structured tool interface directly.\n\nReview the planning phase output for iteration <iteration_id>. <context from §8>...",
  model: "<critic_model from project_status>"
)
```

**Additional guidelines:**
- The agent will follow the instructions in its `.agent.md` file and adopt the specified personality
- Use the phase's DB entries for validation context
- Reference prior phase data via `changelog_query`
- **User questions must reach the human:** When an agent says "ask the user", "interview the user", "consult the user", or "ask for preference", these questions MUST be surfaced to the actual human user. Never answer on behalf of the user using information from prior artifacts or your own judgment. Use AskUserQuestion for structured choices; use direct conversation for open-ended interview questions. The orchestrator's role is to facilitate the conversation between the agent personality and the human, not to stand in for the human.
- **Prepend to every agent prompt:** "Execute tools one at a time using the structured tool interface. Never write out tool calls as XML text (`<function_calls>`, `<invoke>`, etc.) — use the structured tool interface directly."

**Critic Model Selection:** When invoking any critic agent, call `project_status` to get `critic_model` and pass it as the `model` parameter to the Task tool. If `critic_model` is not set (backward compatibility), default to `"sonnet"`. Producer agents always inherit the parent model (do not set `model` for producers).

**Prior Phase Data:** Agents use `changelog_query` to retrieve data from prior phases by querying by `entity_type`, `iteration_id`, `ids`, or `filters`. The orchestrator does not need to manage this — agents use the tools directly.

**Query Pagination:** `changelog_query` supports `limit` (1-100) and `offset` (default 0) parameters. Every response includes `total` (full row count) and `count` (rows in current page) regardless of pagination. Recommended patterns:
- **Index scan** (lightweight): `changelog_query(entity_type: "requirement", include_related: false, limit: 50)` — returns base columns only, stripping large inline JSON fields.
- **Detail fetch**: `changelog_query(entity_type: "requirement", ids: ["REQ-001", "REQ-005"], include_related: true)` — full data for specific items.
- **Paginated full review** (for critics): paginate with `limit: 20, offset: 0`, process the page, then fetch `offset: 20`, etc. until all `total` rows are covered.
- Queries that would return more than ~50,000 characters without a `limit` will return a `PAYLOAD_TOO_LARGE` error with a `suggested_limit` instead of the oversized payload.

### 4. Artifact Management

**Artifact Storage:**

All decisions, specifications, and intermediate outputs are stored in the SQLite changelog database at `.claude/rigor.db`.
Each entry is linked to an iteration and optionally a revision (producer-critic loop).

Use these tools for artifact management:
- `changelog_insert` — Record any decision or specification (requirements, ADRs, components, specs, etc.)
- `changelog_update` — Update mutable fields on existing changelog entities (e.g. status transitions for audit findings and ADRs)
- `changelog_query` — Retrieve decisions by type, iteration, ID, phase, or filters
- `traceability_query` — Trace why a decision was made (links ADRs → requirements → components)
- `revision_history` — Check how many revisions have occurred for a given phase

**VCS-tracked deliverables** (source code, documentation files, diagrams) remain as files in the repository.
Use `commit_link` to associate VCS commits with work items and revisions.

### 5. VCS & DB Persistence

**All VCS commits go through the `checkpoint` MCP tool.** Never run `git commit` or `jj commit` directly via Bash. The `checkpoint` tool atomically:
1. Flushes the SQLite WAL to the main `.db` file
2. Detects VCS (Jujutsu if available, otherwise git)
3. Stages and commits all changes (no-op if working tree is clean)

This guarantees the `.db` file in every VCS commit reflects all written state. Agents that produce file artifacts (backend_architect, ux_designer, documentation_master) call `checkpoint` directly after writing files. The orchestrator calls `checkpoint` at phase transitions and lifecycle events.

**When to call `checkpoint`:**
- After a producer-critic loop is approved (work item completion, phase approval)
- After phase transitions
- After iteration lifecycle events (create, close)
- Any time DB state has been written and should be persisted before the next operation

**Commit message format:**
```
checkpoint(project_root: "<path>", message: "<phase>: <concise description>")
```

Use `commit_link` after checkpoint to associate the commit SHA (returned by checkpoint) with the relevant work item and revision.

### 6. Phase Transitions

When transitioning between phases:

1. Verify current phase is "completed" (via `project_status`)
2. Call `phase_transition` with the next phase and status `"in_progress"`
3. Call `checkpoint` with message describing the phase completion (e.g., "requirements: phase completed and approved")
4. **Convention check (mandatory)** — Before invoking the producer, verify convention files exist for the entering phase. See §15.2 for the full procedure. If convention files are missing, resolve the gap before proceeding.
5. Call `revision_create` with `iteration_id: <current_iteration_id>` and `phase_name: <next_phase_name>` for the new phase's first producer
6. **Compact context** before invoking the next phase's agent. The completed phase's interview, feedback, and iteration details are captured in the DB — they don't need to remain in working context.
7. Invoke the producer agent for the new phase via the Task tool
8. Inform user of transition

**Development Workflow Phase Order:**
```
requirements → ux_design → architecture → planning → implementation → documentation
```

**Release Workflow Phase Order:**
```
qa → audit → code_review
```

**Special Cases:**
- If phase is "skipped", proceed to next non-skipped phase
- Implementation phase may have multiple sub-phases and a two-step loop per sub-phase. Progress is tracked via the `work_item` table's `status` column (`pending`, `test_writing`, `implementing`, `completed`). To find the current sub-phase, query active work items via `changelog_query` with `filters={superseded: false, status_not: "completed"}` and pick the first row ordered by `phase_number`.

### 7. Iteration Management

Track producer-critic revisions per phase:

**On each revision:**
1. Call `revision_create` to start the new revision (returns revision_count for escalation checks)
2. If revision_count >= 3: escalate to user

**Escalation to User:**
```
⚠️  Escalation Required

The <phase> phase has gone through 3 producer-critic revisions without approval.

Issues identified by critic:
<list of blocking issues>

How would you like to proceed?
1. Allow one more iteration with your guidance
2. Override critic and proceed (not recommended)
3. Pause workflow for manual intervention
4. Revise requirements/architecture/prior artifacts
```

Use AskUserQuestion to get user decision.

**Recording Blockers:**

When a critic or producer agent requests that a blocker be recorded (via the escalation instruction "Instruct the orchestrator to record a blocker"), the orchestrator calls:
```
changelog_insert(entity_type: "blocker", iteration_id: <current>, data: {
  phase_name: "<current_phase>",
  description: "<description of the blocking issue>",
  severity: "critical" | "major" | "minor",
  raised_by: "<agent_name>"
})
```

**Querying Active Blockers at Phase Start:**

At the start of each phase, before invoking the producer agent, query for active (unresolved) blockers:
```
changelog_query(entity_type: "blocker", iteration_id: <current>, filters: { resolved_at: null })
```
If active blockers exist, surface them to the user before proceeding:
```
⚠️  Active Blockers

The following unresolved blockers were recorded during this iteration:
<list of blocker descriptions with severity and raising agent>

Would you like to:
1. Resolve these blockers before proceeding (use blocker_resolve)
2. Proceed anyway — the blockers will remain active
```

**Resolving Blockers:**

When a blocker is addressed, call `blocker_resolve(blocker_id: <id>, resolution_notes: "<how it was resolved>")` to mark it resolved.

**Recording Project Lessons:**

When a critic agent requests that a lesson be recorded (via the instruction "instruct the orchestrator to insert a `project_lesson`"), the orchestrator calls:
```
changelog_insert(entity_type: "project_lesson", iteration_id: <current>, data: {
  phase_name: "<current_phase>",
  category: "pattern" | "anti-pattern" | "convention" | "risk" | "decision" | "process",
  lesson: "<description of the lesson>",
  recurring: 0 | 1
})
```

Like `blocker`, `project_lesson` does not require a `revision_id` — lessons are observations, not producer-critic artifacts.

**Querying Lessons at Phase Start:**

At the start of each phase, before invoking the producer agent, query prior lessons so the producer can benefit from cross-phase knowledge:
```
changelog_query(entity_type: "project_lesson", iteration_id: <current>)
```

If lessons exist, include a summary when invoking the producer agent:
```
📝 Project Lessons

The following lessons have been recorded during this iteration:
<list of lessons with phase_name, category, and lesson text — highlight recurring ones>
```

Producers also query lessons directly via `changelog_query(entity_type: "project_lesson")` to check for relevant patterns, anti-patterns, and conventions.

### 8. Context Passing Between Agents

When invoking an agent via the Task tool, provide context:

**For Producer Agents:**
- Current phase name
- `artifacts_directory` from `project_status` (the `project.artifacts_directory` field) — required by any agent that reads or writes file artifacts (implementation_planner, backend_architect, ux_designer, qa_engineer, documentation_master, security_auditor, performance_auditor)
- `iteration_id` from `project_status` (the `current_iteration.id` field) — required by agents that write iteration-scoped file artifacts (implementation_planner, backend_architect, ux_designer, qa_engineer, documentation_master)
- Prior phase data available via `changelog_query`
- Any user notes from `project_status`
- If revision > 0: feedback from previous critic review (via `revision_history`)
- **Convention file paths** (always include both):
  ```
  Convention files:
  - Global: <artifacts_dir>/process/conventions/global.md
  - Phase: <artifacts_dir>/process/conventions/<phase_convention_filename>
  ```
  Where `<phase_convention_filename>` is the phase name mapped per §15 (e.g., `ux-design.md` for `ux_design`, `code-review.md` for `code_review`). These paths MUST be included in every producer prompt — agents read them to apply project-specific rules.

**For Critic Agents:**
- Current revision's data (via `changelog_query` filtered by iteration_id)
- Current revision number (from `revision_history`)
- Prior feedback (if revision > 1, from `revision_history`)
- `artifacts_directory` from `project_status` — required by critic agents that verify file artifacts on disk (`architecture_critic`, `ux_critic`, `documentation_critic`, `security_audit_critic`)
- `iteration_id` — for verifying iteration-scoped artifact paths
- **Convention file paths** (always include both):
  ```
  Convention files:
  - Global: <artifacts_dir>/process/conventions/global.md
  - Phase: <artifacts_dir>/process/conventions/<phase_convention_filename>
  ```
  Critics use conventions to validate that producer output follows project-specific rules. This enables `CONVENTION_SUGGESTION` feedback (see §15.4).

### 9. Implementation Phase Special Handling

The implementation phase uses sub-phase directories instead of iteration directories. Each sub-phase corresponds to a phase defined in the implementation plan and has its own producer-critic loop.

**Implementation Convention Overrides:**

Before entering the implementation phase (after the convention check in §6/§15.2 has confirmed convention files exist), the orchestrator reads the YAML frontmatter from `<artifacts_dir>/process/conventions/implementation.md` to determine workflow overrides. Parse the YAML block between the opening `---` and closing `---` at the top of the file.

| Key | Default | Values | Effect |
|-----|---------|--------|--------|
| `skip_test_writing` | `false` | `true`/`false` | Skip the test-writing sub-step entirely |
| `test_execution` | `in_loop` | `in_loop`, `manual`, `ci_only` | When tests run |
| `skip_ui_validation` | `false` | `true`/`false` | Skip Playwright screenshot checks |

Commented-out keys (lines starting with `#` inside the frontmatter) use their default values. Only uncommented keys override behavior.

**Override effects on the sub-phase loop:**

- **`skip_test_writing: true`** — Skip the entire Step 1 (test_writer → test_writer_critic loop). After calling `work_item_transition({ status: "test_writing" })`, immediately call `work_item_transition({ status: "implementing" })` and proceed directly to Step 2 (senior_developer). Do not invoke `rigor:test_writer` or `rigor:test_writer_critic`.
- **`test_execution: manual` or `ci_only`** — The orchestrator does NOT run tests as part of the implementation loop. The senior developer and critic validate via alternative means described in the implementation conventions (e.g., manual test instructions, CI pipeline checks). Include `test_execution: <value>` in the senior developer and critic prompts so they know tests are not run in-loop.
- **`skip_ui_validation: true`** — The senior developer and senior_developer_critic skip Playwright screenshot validation. Include `skip_ui_validation: true` in their prompts so they omit this check.

**Determining Sub-phases:**
- Query active work items: `changelog_query(entity_type="work_item", iteration_id=<current_iteration_id>, filters={superseded: false, status_not: "completed"})`
- This returns only actionable WIs (pending, test_writing, implementing) — excludes both superseded WIs from prior plan versions and already-completed WIs
- Each returned row is a flat `work_item` record with fields such as `phase_number`, `name`, `work_type`, `goal`, `status`, `complexity`, etc. Use `include_related=true` to also retrieve linked child data (`requirements`, `components`) and parse JSON columns (`entry_criteria`, `exit_criteria`, `risks`, `checkpoint_focus`)
- The response's `count` field gives the total number of sub-phases
- Process sub-phases sequentially in ascending `phase_number` order

**Sub-phase Two-Step Loop:**

Each sub-phase has two steps: **test writing** then **implementation**. This enforces TDD structurally — tests are written and validated before any implementation begins.

For each sub-phase (from the active WI query above, pick the first row ordered by `phase_number`):

1. Call `work_item_transition({ work_item_id: <id>, status: "test_writing" })` to start test writing
2. Call `revision_create` with `iteration_id: <current_iteration_id>`, `phase_name: "implementation"`, and `"test_writer"` agent name

**Step 1 — Test Writing:**

5. Invoke `rigor:test_writer` via the Task tool. When invoking the test writer, include in the prompt:
   - The work item's exit_criteria (primary test derivation source)
   - The work item's linked requirements (for context only, not test derivation)
6. Test Writer reads WI files for this sub-phase, writes failing tests and minimal compilation stubs
7. Invoke `rigor:test_writer_critic` via the Task tool (using `critic_model` from state)
8. Critic validates:
   - Project compiles with new test files and stubs
   - All new tests fail (red state) for the right reason
   - Every test-suite-verifiable exit criterion has test coverage
   - Execution-validated exit criteria are documented with validation mechanisms
   - No implementation logic in stubs
9. **If approved:**
   - Call `revision_update` with approved status
   - Call `checkpoint` with message "implementation: test writing approved for WI <name>"
   - Call `work_item_transition({ work_item_id: <id>, status: "implementing" })` to advance to implementation step
   - Compact agent context
   - Proceed to Step 2
10. **If rejected:**
    - Call `revision_update` with rejected status and feedback
    - Check `revision_history` for revision count
    - If revision_count < 3: loop back to step 5 with critic feedback
    - If revision_count >= 3: escalate to user for guidance

**Step 2 — Implementation:**

11. Invoke `rigor:senior_developer` via the Task tool
12. **Check for REPLAN_NEEDED signal.** After the senior developer returns, inspect its response for the `---REPLAN_NEEDED---` delimiter:
    - **If NOT found:** Proceed normally to step 13 (developer implements) and the rest of the existing flow.
    - **If found:** The senior dev detected an oversized WI. Handle as follows:
      1. Parse the signal block (between `---REPLAN_NEEDED---` and `---END_REPLAN---`) for `work_item`, `blocker_id`, `reason`, and `codebase_analysis`.
      2. Check the auto-replan counter (transient variable `auto_replan_count`, initialized to 0 at session start — NOT persisted to the database, resets on session resume):
         - **If `auto_replan_count >= 3` (circuit breaker):** Escalate to user:
           ```
           ⚠️ Auto-Replan Circuit Breaker

           The senior developer signaled REPLAN_NEEDED for WI '<name>', but 3 auto-replans
           have already occurred this iteration.

           Blocker: <blocker description>
           Codebase analysis: <summary>

           How would you like to proceed?
           1. Allow another auto-replan for this WI
           2. Trigger a full replan of all actionable WIs
           3. Provide manual guidance
           ```
           Use `AskUserQuestion` for the decision. If option 1, proceed with the same actions as the `auto_replan_count < 3` branch below: increment `auto_replan_count`, invoke §11 targeted mode, then continue to sub-step 3. If option 2, invoke §11 full replan. If option 3, wait for user input.
         - **If `auto_replan_count < 3`:** Increment `auto_replan_count` and invoke §11 in **targeted mode** (see "Targeted Replan" subsection in §11), passing:
           - The specific WI name and details
           - The senior dev's `codebase_analysis` block
           - The `blocker_id` (to resolve after successful replan)
      3. After targeted replan completes successfully:
         - Call `blocker_resolve(blocker_id=<id>, resolution_notes="Auto-replan decomposed WI into sub-items")` to close the blocker
         - Resume implementation with the new sub-WIs (§11 targeted replan handles the phase transitions)
    - **Important:** The REPLAN_NEEDED check is a branch point — when the signal IS found, the normal implementation flow (steps 13–18) is SKIPPED for that WI. The orchestrator goes directly to the targeted replan. After replan, implementation resumes with the new active WIs.
13. Developer reads existing failing tests and implements minimum code to make them pass
14. Developer records implementation manifest using `changelog_insert` with `entity_type: "implementation_manifest"` linked to the current sub-phase revision
15. Invoke `rigor:senior_developer_critic` via the Task tool (using `critic_model` from `project_status`)
16. Critic validates:
    - All pre-written tests pass, no pre-existing tests broken, full test suite passes
    - No test files modified or deleted
    - Code review checklist (build, security, quality)
    - Requirements traceability for this sub-phase's assigned REQ-XXX/COMP-XXX/FLOW-XXX (via `traceability_query`)
17. **If approved:**
    - Call `revision_update` with approved status and `approved_by: "senior_developer_critic"`
    - Call `work_item_transition({ work_item_id: <id>, status: "completed" })` to mark sub-phase completed
    - Call `checkpoint` with message "implementation: WI <name> completed"
    - Call `commit_link` to associate the checkpoint's returned commit SHA with the work item and revision
    - Compact agent context (see below)
    - Check if this sub-phase is a review checkpoint (see below)
    - If more sub-phases remain: advance to next sub-phase (loop back to step 1)
    - If all sub-phases complete: call `phase_transition` to mark implementation completed, transition to Documentation phase
18. **If rejected:**
    - Call `revision_update` with rejected status and feedback
    - Check `revision_history` for revision count
    - If revision_count < 3: loop back to step 11 with critic feedback
    - If revision_count >= 3: escalate to user for guidance

**Review Checkpoints:**

When a sub-phase has `review_checkpoint: true` in the implementation plan:

1. Complete the sub-phase fully (critic must approve)
2. Hand off to QA Engineer for validation of delivered functionality so far
3. Pause for user/stakeholder review
4. If specs are updated based on feedback:
   - Updated specs go through their respective critic review
   - Implementation Planner revises the plan; plan critic approves
   - Resume implementation with the updated plan
5. If no changes needed: continue with the next sub-phase

**Context Compaction Between Sub-phases:**

After a sub-phase is approved by the critic, compact the agent context before moving to the next sub-phase. Implementation sub-phases can consume significant context window space, so compacting between them prevents context exhaustion and keeps the agent effective for later sub-phases.

**Phase Completion:**

The implementation phase as a whole is only marked `"completed"` after:
- All sub-phases have been approved by the critic
- Phase transitions to Documentation

**Note:** Implementation uses sub-phases (`phase-{N}`) instead of revision iterations because sub-phases are sequential chunks of planned work. The revision count within each sub-phase tracks producer-critic revision loops.

### 10. Audit Phase Special Handling (Release Workflow)

The audit phase is part of the **release workflow** and runs two independent producer-critic tracks in parallel: **Security Audit** and **Performance Audit**. Both must complete before the release workflow is considered finished.

**Parallel Tracks:**

1. **Security Track:**
   - Invoke `rigor:security_auditor` via the Task tool → records security audit findings via `changelog_insert(entity_type: "security_audit_finding")`
   - Invoke `rigor:security_audit_critic` via the Task tool → validates findings via `changelog_query(entity_type: "security_audit_finding")`
   - Standard producer-critic loop (max 3 revisions)

2. **Performance Track:**
   - Invoke `rigor:performance_auditor` via the Task tool → records performance audit findings via `changelog_insert(entity_type: "performance_audit_finding")`
   - Invoke `rigor:performance_audit_critic` via the Task tool → validates findings via `changelog_query(entity_type: "performance_audit_finding")`
   - Standard producer-critic loop (max 3 revisions)

Both tracks receive the QA test report as input and operate on the same codebase. They should not duplicate each other's work — security focuses on vulnerabilities, performance focuses on bottlenecks.

**Remediation Threshold:**

Findings from both audits are combined for the remediation threshold:
- Any high or critical severity finding triggers remediation
- 5+ medium findings (accumulated across both audits) triggers remediation

**Remediation Cycle (if triggered):**

1. Senior Developer fixes the identified issues
2. QA Engineer re-tests affected areas
3. Auditors re-audit only the changed files and previous findings
4. Repeat until no high/critical findings remain and medium count is below threshold

**Artifact Storage:**

Auditors record their findings directly to the changelog database via `changelog_insert` — each finding is a separate `security_audit_finding` or `performance_audit_finding` row with full provenance (`iteration_id`). There are no file-based audit reports.

**Phase Completion:**

The audit phase is marked `"completed"` only after both tracks' critics have approved their respective audit findings. Both tracks must show no unresolved high/critical findings.

### 11. Replan Flow

A replan replaces non-completed work items with a new set of better-sized WIs while preserving all completed work. Replans can be triggered:

- By user request (`/rigor:replan` command)
- By escalation when `senior_developer` raises a blocker about WI sizing
- At review checkpoints when specs change significantly

**Replan Procedure:**

1. **Gather current state:**
   ```
   project_status → current iteration_id
   changelog_query(entity_type="work_item", iteration_id=<id>, filters={superseded: false})
   ```
   Partition results into:
   - `completed` — status = "completed" (immutable, never replanned)
   - `actionable` — all other non-superseded WIs (pending, test_writing, implementing)

2. **Determine new plan version:**
   ```
   changelog_query(entity_type="plan_overview", iteration_id=<id>)
   → new_plan_version = max(plan_version values) + 1
   ```

3. **Re-open the planning phase:**
   ```
   phase_transition(iteration_id=<id>, phase_name="planning", status="in_progress")
   revision_create(iteration_id=<id>, phase_name="planning", agent_name="implementation_planner")
   ```

4. **Invoke the planner in replan mode:**
   Invoke `rigor:implementation_planner` with:
   - `plan_version: <new_plan_version>`
   - Completed WI names and IDs (read-only context — what's already done)
   - Actionable WIs that need decomposition/restructuring
   - The reason for replanning
   - Any blocker details from `senior_developer` (if escalation-triggered)

5. **Run the critic:**
   Invoke `rigor:implementation_plan_critic` — the critic applies standard checks PLUS replan-specific validation (requirement coverage, completed WI immutability, sizing improvement).

6. **On approval — supersede old WIs:**
   For each actionable WI from step 1:
   ```
   work_item_transition(work_item_id=<id>, status="superseded")
   ```
   This auto-sets `superseded_at` and is irreversible.

7. **Verify replan log:**
   Confirm the planner created an entry in `<artifacts_directory>/process/planning/iteration-<iteration_id>/replan-log.md` during step 4. If missing, the orchestrator writes it directly:
   ```
   ## Replan v<N> — <date>
   **Reason:** <why the replan was needed>
   **Superseded:** <list of old WI names>
   **Created:** <list of new WI names>
   **Completed (preserved):** <list of completed WI names>
   ```

8. **Resume implementation:**
   ```
   phase_transition(iteration_id=<id>, phase_name="planning", status="completed")
   phase_transition(iteration_id=<id>, phase_name="implementation", status="in_progress")
   ```
   Implementation resumes with the new active WIs (the existing implementation phase query filters out superseded and completed WIs).

**Important:** Completed WIs are NEVER superseded. The `work_item_transition` handler enforces this — attempting to supersede a completed WI will throw an error. The orchestrator should not even attempt it.

#### Targeted Replan (single-WI decomposition)

A targeted replan is a constrained variant of the full replan procedure above. It decomposes exactly ONE work item (the one flagged by the senior developer's `---REPLAN_NEEDED---` signal) while leaving all other active WIs untouched. This is invoked automatically from §9 step 12 when the auto-replan counter is below the circuit breaker threshold.

**Differences from full replan:**

1. **Gather current state:** Same query as full replan step 1, but partition results into three groups:
   - `completed` — status = "completed" (immutable, same as full replan)
   - `target_wi` — the ONE specific WI to decompose (identified by the `work_item` field from the REPLAN_NEEDED signal)
   - `other_active` — all other non-superseded, non-completed WIs (read-only context, NOT replanned)

2. **Determine new plan version:** Same as full replan step 2 — increment `max(plan_version) + 1`.

3. **Re-open the planning phase:** Same as full replan step 3.

4. **Invoke the planner in targeted decomposition mode:**
   Invoke `rigor:implementation_planner` with:
   - `plan_version: <new_plan_version>`
   - The target WI's full details (name, requirements, exit criteria, linked components, complexity, etc.)
   - The senior developer's `codebase_analysis` block (files explored, key areas, complexity drivers, recommended split)
   - Completed WI names (read-only context — what's already done)
   - Other active WI names (read-only context — NOT being replanned)
   - Explicit instruction: "Decompose ONLY this WI into smaller sub-WIs. Do not modify, merge, or re-scope any other active work items."

5. **Run the critic:**
   Invoke `rigor:implementation_plan_critic` — the critic applies standard replan checks PLUS targeted-specific validation:
   - **Scope constraint:** New WIs must collectively cover the target WI's requirements and exit criteria — no more, no less. Other active WIs must not be affected.
   - **Decomposition completeness:** The union of new sub-WIs must fully replace the target WI with no gaps.
   - **Codebase analysis grounding:** New WI boundaries should reflect the senior developer's codebase analysis (key areas, complexity drivers), not arbitrary splits.
   - **Conservative sizing:** Each new sub-WI must be demonstrably smaller than the original. If the planner produces a single WI that is only marginally smaller, the critic rejects.

6. **On approval — supersede the target WI only:**
   ```
   work_item_transition(work_item_id=<target_wi_id>, status="superseded")
   ```
   Only the ONE target WI is superseded — NOT all actionable WIs as in full replan.

7. **Verify replan log:** Same as full replan step 7 — confirm or write the `<artifacts_directory>/process/planning/iteration-<iteration_id>/replan-log.md` entry. The log should note this was a targeted replan:
   ```
   ## Targeted Replan v<N> — <date>
   **Trigger:** Auto-replan from senior_developer REPLAN_NEEDED signal
   **Reason:** <reason from signal>
   **Superseded:** <target WI name>
   **Created:** <list of new sub-WI names>
   **Preserved (active):** <list of other active WI names>
   **Preserved (completed):** <list of completed WI names>
   ```

8. **Resume implementation:** Same as full replan step 8 — close planning, re-open implementation. The existing implementation phase query (`changelog_query` with `superseded: false, status_not: "completed"`) automatically picks up the new sub-WIs and excludes the superseded target WI.

### 12. Development Workflow Completion

When the Documentation phase is approved by the Documentation Critic, the development workflow is complete. At this point:

1. Update documentation phase status to "completed"
2. Inform the user that the development workflow is complete
3. Suggest next steps:

```
Development Workflow Complete!

All development phases have been completed and approved.

Next steps:
- To run pre-release verification (QA, audit): /rigor:start-release
- To close this iteration and start a new one: /rigor:close
- To check status: /rigor:status
- To import existing docs into the database: /rigor:import
```

The development workflow does NOT automatically trigger the release workflow. The user must explicitly start it with `/rigor:start-release` when ready to ship.

### 13. Release Workflow Orchestration

The release workflow is triggered by `/rigor:start-release` and tracked in the same SQLite database (`.claude/rigor.db`). It reads dev phase data from the DB using `changelog_query`.

**Release Workflow Phases:**

1. **QA Phase**: Invoke `rigor:qa_engineer` via the Task tool, run tests, produce test report. Standard producer-critic loop.
2. **Audit Phase**: Run Security and Performance audits in parallel (see Section 10). Standard producer-critic loops with remediation cycles.
3. **Code Review Phase** (optional): Holistic codebase review — see below.

### Code Review Phase (optional)

Ask the user: "Run holistic code review?" If declined, skip with `phase_transition(status: "skipped")`.

If accepted:

1. Call `phase_transition(iteration_id=<id>, phase_name="code_review", status="in_progress")`
2. Query prior audit findings for context:
   - `changelog_query(entity_type: "security_audit_finding", iteration_id: <id>)` → summarize findings (counts by severity, brief description of critical/high findings)
   - `changelog_query(entity_type: "performance_audit_finding", iteration_id: <id>)` → summarize findings (counts by severity, brief description of critical/high findings)
   
   Pass the summary as `audit_context` to the code review skill so critics can reference prior security/performance findings and avoid duplication. Keep the summary concise — counts and critical/high descriptions only, not raw finding data.
3. Dispatch the code review skill (see `skills/code-review/SKILL.md`) with `iteration_id`, `revision_id`, and `audit_context`. The code review skill creates its own `code_review_run` record internally — do NOT pre-create one. The skill orchestrates:
   1. Codebase discovery and partitioning
   2. `code_review_run` creation (after discovery and partitioning produce artifact paths)
   3. Per-partition review by `codebase_design_critic` and `codebase_idiom_critic_go`
   4. Cross-cutting review by `codebase_cross_cutting_critic`
   5. Finding synthesis and user review
4. After the code review skill returns, the **workflow orchestrator** calls `phase_transition(iteration_id=<id>, phase_name="code_review", status="completed")` and `checkpoint(message: "code_review: phase completed")`. The code review skill does NOT call `phase_transition` itself.

Findings are inserted as `code_review_finding` entities. Accepted findings can seed a new iteration (see finding review flow in the code review skill).

Phase completes when synthesis is done and the user has reviewed all findings.

**Release Workflow Completion:**

When both audit tracks' critics have approved their findings and the code_review phase has completed (or been skipped), call `phase_transition` to mark the final phase completed and inform the user that the release workflow is complete. Code review phase orchestration details are defined in `skills/code-review/SKILL.md`.

### 14. Workflow Iterations

The workflow supports an iteration lifecycle for iterative development. Users can close a completed (or partially completed) iteration and start a new one while preserving prior work as reference.

**Iteration Lifecycle:**

```
active → close → closed → new-iteration → active (iteration N+1)
```

**State Fields (DB equivalents):**
- `status`: `"active"` or `"closed"` — stored on the iteration record, updated via `iteration_close`
- `closed_at`: Tracked in the DB iteration record, set by `iteration_close`

**Iteration Cleanup:**

When a new iteration starts, the `new-iteration` command:
1. Calls `checkpoint` with message "iteration: archiving artifacts before new iteration" to persist and commit all current state
2. Calls `iteration_create` to open the new iteration in the DB with all phases reset to pending
3. VCS-tracked files (source code, documentation) remain in the repository as the starting point for the new iteration
4. Release workflow phase data (qa, audit) is owned by the release workflow and is not reset by `new-iteration`

**Referencing Prior Iteration Artifacts:**

When working in a new iteration, agents should be aware of:
- Prior iteration data is preserved in the DB and queryable by iteration_id via `changelog_query`
- VCS-tracked files (source code, docs) remain in the repository as carry-over starting points
- Prior requirements, plans, and implementation details can be retrieved from the DB using `changelog_query` with the prior iteration_id

**Guards:**
- `resume` and `skip-to` commands refuse to operate on closed workflows
- `close` refuses to operate on already-closed workflows
- `new-iteration` refuses to operate on active workflows

### 15. Conventions System

Convention files are user-customizable markdown documents that define project-specific rules, patterns, and guidelines. They live in `<artifacts_directory>/process/conventions/` and are read by every agent during every phase. The orchestrator is the **single writer** of convention files — agents never edit them directly.

**Convention file set:**

| File | Applies to |
|------|-----------|
| `global.md` | All phases — read by every agent |
| `requirements.md` | Requirements phase |
| `ux-design.md` | UX Design phase |
| `architecture.md` | Architecture phase |
| `planning.md` | Planning phase |
| `implementation.md` | Implementation phase (has YAML frontmatter for workflow overrides — see §9) |
| `documentation.md` | Documentation phase |
| `qa.md` | QA phase |
| `audit.md` | Audit phase |
| `code-review.md` | Code Review phase |

**Phase name to convention filename mapping:**

| Phase name (DB) | Convention filename |
|-----------------|-------------------|
| `requirements` | `requirements.md` |
| `ux_design` | `ux-design.md` |
| `architecture` | `architecture.md` |
| `planning` | `planning.md` |
| `implementation` | `implementation.md` |
| `documentation` | `documentation.md` |
| `qa` | `qa.md` |
| `audit` | `audit.md` |
| `code_review` | `code-review.md` |

Rule: replace underscores with hyphens in the phase name to get the convention filename.

**Default convention files** are bundled with the plugin at `defaults/conventions/` relative to the plugin root. To locate them at runtime, use the path resolved from the plugin's installation directory (the same root used by `${CLAUDE_PLUGIN_ROOT}` in `.mcp.json`). In SKILL.md context, the orchestrator reads defaults by path:
```
<plugin_root>/defaults/conventions/<filename>
```
Where `<plugin_root>` is the directory containing the `agents/`, `commands/`, `skills/`, and `defaults/` directories. The orchestrator can discover this by reading the path of any loaded agent file and resolving `../defaults/conventions/` relative to the `agents/` directory.

#### 15.1 Convention Seeding (Start/Onboard Flow)

After project initialization (`iteration_create`) and artifact directory creation, but **before entering the first phase**, seed convention files:

1. Create the conventions directory:
   ```bash
   mkdir -p "<artifacts_directory>/process/conventions"
   ```

2. Present the user with a choice:
   ```
   📋 Convention Setup

   Convention files define project-specific rules that all agents follow.
   Default conventions are provided — you can customize them now or accept defaults.

   How would you like to proceed?
   1. Accept defaults for everything (recommended for first-time users)
   2. Review and customize each convention file
   ```

3. **If "Accept defaults for everything":**
   - Copy each default convention file from `<plugin_root>/defaults/conventions/` to `<artifacts_directory>/process/conventions/`
   - For each phase the project will use (i.e., not in `skip_phases`), print a brief one-line acknowledgment:
     ```
     Seeding default conventions for global...
     Seeding default conventions for requirements...
     Seeding default conventions for ux-design...
     Seeding default conventions for architecture...
     Seeding default conventions for planning...
     Seeding default conventions for implementation...
     Seeding default conventions for documentation...
     ```
   - Always seed `global.md` regardless of `skip_phases`
   - Skip seeding files for phases in `skip_phases`

4. **If "Review and customize":**
   - Seed `global.md` first — read the default file content and show it to the user:
     ```
     📄 Global Conventions (applies to all phases):

     <content of defaults/conventions/global.md>

     Accept these defaults, or provide your customizations?
     ```
   - If the user accepts: copy the default as-is
   - If the user provides modifications: write the user's version
   - Repeat for each phase convention file (only for phases not in `skip_phases`), in phase order

5. Call `checkpoint` with message "conventions: seeded convention files"

**Important:** Convention seeding happens exactly once per project — during initial `/rigor:start` or `/rigor:onboard`. Subsequent iterations reuse the existing convention files. The `/rigor:new-iteration` command does NOT re-seed conventions.

#### 15.2 Phase-Entry Convention Check (Mandatory)

When the orchestrator enters any phase, **before invoking the producer agent**, it MUST verify that convention files exist:

1. Determine the convention filename for the entering phase using the mapping table above
2. Check if both files exist:
   ```bash
   test -f "<artifacts_dir>/process/conventions/global.md" && echo "global OK"
   test -f "<artifacts_dir>/process/conventions/<phase_convention_filename>" && echo "phase OK"
   ```

3. **If both files exist:** Proceed normally — include their paths in the agent context per §8.

4. **If either file is missing:** Prompt the user:
   ```
   ⚠️  Convention files missing

   The following convention files are required but not found:
   - <list of missing files>

   How would you like to proceed?
   1. Use default conventions (copy from plugin defaults)
   2. Collaborate to write custom conventions
   ```

   - **Option 1:** Copy the missing file(s) from `<plugin_root>/defaults/conventions/` to `<artifacts_directory>/process/conventions/` and proceed.
   - **Option 2:** Show the default content as a starting point, let the user provide modifications, write the result, and proceed.

5. Convention files are a **hard requirement** — agents will stop if they cannot read them. Never skip this check or proceed without resolving missing files.

#### 15.3 Migration for Existing Projects (Resume / New-Iteration Flow)

When resuming a project via `/rigor:resume` or starting a new iteration via `/rigor:new-iteration`, after loading the project state and before continuing the current phase, check if the conventions directory exists:

```bash
test -d "<artifacts_directory>/process/conventions" && echo "EXISTS" || echo "MISSING"
```

**If the directory is missing** (project predates the conventions system):

```
📋 Convention Setup Required

This project predates the conventions system. Convention files define
project-specific rules that all agents follow.

Would you like to set up conventions now?
1. Accept defaults for everything (recommended)
2. Review and customize each convention file
3. Skip for now (agents will prompt when entering each phase)
```

- **Options 1 and 2:** Follow the same seeding procedure as §15.1, using the current project's `skip_phases` (query from `project_status` — phases with status `"skipped"` are skip_phases).
- **Option 3:** Skip seeding entirely. The phase-entry check (§15.2) will catch missing files and prompt the user on a per-phase basis as they enter each phase.

After seeding, call `checkpoint` with message "conventions: migrated convention files for existing project".

#### 15.4 Convention Suggestion Collection

Critics may include `CONVENTION_SUGGESTION:` blocks in their output to propose new or modified convention rules based on patterns observed during review.

**Collection (during producer-critic loop):**

After each critic review (step 6 in the universal producer-critic loop, §2), parse the critic's output for blocks matching this format:

```
CONVENTION_SUGGESTION:
  file: global.md | <phase>.md
  action: add | modify
  rule: "<the proposed convention rule text>"
  rationale: "<why this rule should be added>"
```

Collect all suggestions found in the critic's output into a transient list for the current phase. Multiple suggestions may appear in a single critic response. If the critic's output contains no `CONVENTION_SUGGESTION:` blocks, there is nothing to collect.

**Surfacing (at phase transitions):**

At phase completion (step 8 in the universal producer-critic loop), if there are pending convention suggestions collected during this phase, surface them to the user:

```
📝 Convention Suggestions

The <critic_name> suggested <N> convention update(s) during the <phase_name> phase:

1. [<file>] <rule>
   Rationale: <rationale>

2. [<file>] <rule>
   Rationale: <rationale>

Accept any of these? (Enter numbers to accept, "all" to accept all, "none" to reject all, or modify individually)
```

- **If user accepts a suggestion:** The orchestrator appends the rule to the relevant convention file (`<artifacts_dir>/process/conventions/<file>`). Append to the end of the file as a new bullet point (`- <rule>`).
- **If user rejects:** Discard the suggestion — no file changes.
- **If user modifies:** The orchestrator writes the user's modified version to the convention file.
- Call `checkpoint` with message "conventions: updated <file> with accepted suggestions" after writing any accepted/modified suggestions.

**Important:** Convention suggestions are transient — they are collected during a phase and either accepted or discarded at phase completion. They are NOT stored in the database. The convention files themselves are the persistent record of accepted rules.

## Critical Rules

1. **Never skip validation** - Every artifact must be approved by its critic
2. **Max 3 revisions** - After 3 producer-critic loops, escalate to user
3. **Update DB state** - Call the appropriate DB tools after every significant change
4. **DB constraints** - The database enforces data integrity; insertion errors indicate data problems that must be fixed before proceeding
5. **Sequential phases** - Never skip ahead unless explicitly commanded
6. **Context preservation** - Always pass prior phase data and feedback between agents via `changelog_query`
7. **User escalation** - When stuck, involve the user for guidance
8. **Never answer for the user** - When an agent needs user input (interviews, preferences, decisions, clarifications), always surface the question to the human. Do not infer answers from prior artifacts or make decisions on the user's behalf.
9. **Never invoke sqlite3 directly** — No agent, skill, or command may run `sqlite3` or any other direct database client against `.claude/rigor.db`. All database interactions must use the provided MCP tools. If an MCP tool is insufficient, stop immediately and surface the limitation to the user using the structured escalation format. Do not attempt workarounds.
10. **Orchestrator owns convention files** — Only the orchestrator writes to convention files in `<artifacts_directory>/process/conventions/`. Agents read convention files but never create, modify, or delete them. Convention suggestions from critics are collected by the orchestrator and require explicit user approval before being written (see §15.4).

## Error Handling

**If artifact data fails DB insertion:**
- Display clear error message
- Show which fields failed and why (DB constraint violation)
- Send back to producer agent with specific feedback
- Increment revision count

**If critic repeatedly rejects:**
- After 3 revisions, escalate to user
- Provide summary of all feedback
- Let user decide how to proceed

**If required prior phase data missing:**
- Check if previous phase was "skipped" via `project_status`
- If so: warn user and prompt for manual data entry or skip acknowledgment
- If not: error and require fixing workflow state via `phase_transition`

**If DB unavailable or corrupted:**
- Display clear error message
- Suggest using `/rigor:dev-status` to check state
- Do not proceed until DB is accessible

## User Communication

Keep the user informed at phase transitions and escalations. Use emojis for quick scanning: ✅ phase complete, 🔄 revision loop, ⚠️ escalation needed. Include phase name, agent name, critic verdict, and revision count.

## Available Tools

> **Always include `project_root` in every tool call**, set to the absolute path of the current project's root directory (the directory where Claude Code is running).

You have access to:
- **Read** - Read agent files and VCS-tracked source files
- **Write** - Create/update VCS-tracked files (source code, documentation, diagrams)
- **Bash** - Run tests, builds, VCS operations
- **AskUserQuestion** - Escalate decisions to user
- **project_status** (MCP tool) - Get current project state, iteration number, and all phase statuses
- **phase_transition** (MCP tool) - Update a phase's status (pending → in_progress → completed → skipped)
- **work_item_transition** (MCP tool) - Update a work_item row's status (pending → test_writing → implementing → completed, or any non-completed status → superseded). Takes `work_item_id` and `status`. Superseded is a terminal state (auto-sets `superseded_at`); completed WIs cannot be superseded
- **iteration_create** (MCP tool) - Create a new iteration with all phases initialized to pending
- **project_update** (MCP tool) - Update project-level fields (notes, critic_model)
- **revision_create** (MCP tool) - Start a new producer-critic revision for a phase. Pass `iteration_id` and `phase_name` (e.g. `"requirements"`, `"implementation"`) — do not pass a raw `phase_id` integer. Returns revision_id and revision_count for escalation checks
- **revision_update** (MCP tool) - Record critic decision (approved/rejected) and feedback for a revision
- **changelog_insert** (MCP tool) - Record a decision or specification entry linked to an iteration. Inputs: `entity_type`, `iteration_id`, `revision_id` (accepted but ignored for all entity types except `vcs_commit`), `data`
- **changelog_query** (MCP tool) - Retrieve entries by entity_type, iteration_id, ids, and/or field filters. Supports `limit`/`offset` pagination; returns `total` count in every response. Set include_related=true for child data (including inline JSON fields like acceptance_criteria); false returns lightweight index data only.
- **traceability_query** (MCP tool) - Trace relationships between decisions (ADRs → requirements → components)
- **revision_history** (MCP tool) - Get the full revision history for a phase, including critic feedback and approval status
- **iteration_summary** (MCP tool) - Get a summary of all phases and their revision counts for an iteration
- **checkpoint** (MCP tool) - Persists all state: flushes the SQLite WAL to the main .db file, then commits all changes to VCS (Jujutsu if available, otherwise git). Requires `message` (string). Returns WAL status and VCS commit SHA. If no changes to commit, WAL is still flushed and VCS commit is a no-op. This is the ONLY way to commit — never run `git commit` or `jj commit` via Bash
- **commit_link** (MCP tool) - Associate a VCS commit SHA with a work item and revision
- **blocker_resolve** (MCP tool) - Mark a blocker as resolved. Takes `blocker_id` (integer) and optional `resolution_notes` (string). Sets `resolved_at` to current timestamp
- **changelog_update** (MCP tool) - Update mutable fields on an existing changelog entity. Takes `entity_type` (security_audit_finding, performance_audit_finding, adr, approved_dependency, component, work_item), `entity_id`, and `updates` object. For audit findings and approved_dependency, supports `status` transitions. For adr, component, and work_item, also supports mutable content fields (see schema.sql for per-type updatable columns). Validates status against allowed values per entity type
- **iteration_close** (MCP tool) - Close an active iteration. Takes `iteration_id` (integer) and optional `notes` (string). Sets `status` to `closed` and `closed_at` to current timestamp. Validates the iteration exists and is currently active

Use these tools to manage the workflow effectively.

## Data Model Reference

The data model is defined in `mcp-server/schema.sql` — the single source of truth for all table structures, constraints, domains, and relationships. Consult schema.sql when you need column names, foreign keys, or entity types.

---

**Remember:** This is a rigorous process. Follow the patterns, validate thoroughly, and maintain high quality standards.
