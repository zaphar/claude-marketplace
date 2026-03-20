---
name: Project Q&A
description: Orchestrator-level Q&A session with action mapping to phase producer-critic loops. Loaded by /rigor:ask command only, not auto-triggered.
version: 0.1.0
---

# Project Q&A Orchestration

You are orchestrating an interactive Q&A session that lets users investigate their project and optionally turn findings into targeted phase updates via producer-critic loops.

This skill operates independently of the main workflow skill. It can be invoked at any time regardless of which phase the main workflow is in. It re-opens phases as needed via `phase_transition`.

## Glossary

- **Trivial question** — Answerable with a single `project_status()` call or a `changelog_query` returning ≤ 3 entities.
- **Substantial question** — Requires reading source files, cross-referencing multiple entity types, or querying large result sets.
- **Action** — A concrete proposed change to a specific phase's entities (e.g., "Add input validation requirement", "Update ADR-003").
- **Action mapping** — The process of classifying proposed actions into their target phases.
- **Scoped producer-critic loop** — A standard producer-critic loop whose prompt and evaluation are restricted to only the specified actions, not the full phase scope.

## Workflow Overview

The Q&A skill has three phases, executed sequentially:

```
Phase 1: Conversation Loop  →  Phase 2: Action Mapping  →  Phase 3: Phase Execution
          (interactive)            (synthesis)                 (producer-critic loops)
```

The user may exit after Phase 1 (no actions needed) or after Phase 2 (decides not to act). Phase 3 only runs if the user confirms actions.

## Phase 1: Conversation Loop

The orchestrator drives this directly — it is a conversational loop, NOT a producer-critic loop.

### 1.1 Entry

1. Receive minimal context from the `/rigor:ask` command:
   - Project name
   - Current iteration ID
   - Active phase (and its status)
   - Artifacts directory
2. Greet the user briefly:
   ```
   🔍 Q&A session active. Ask me anything about the project or codebase.
   ```

### 1.2 Question Loop

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
- **"done"** / **"that's all"** / **"thanks"** — exit the skill entirely (no actions)
- **"turn this into actions"** / **"let's make changes"** / **"fix this"** — transition to Phase 2

## Phase 2: Action Mapping

When the user signals they want to act on findings, the orchestrator synthesizes the conversation into concrete proposed actions.

### 2.1 Synthesize Actions

Review the accumulated Q&A conversation (questions + summarized answers) and extract concrete, actionable changes. Present as a table:

```
📋 Proposed Actions

| # | Phase          | Entity Types              | Action                                |
|---|----------------|---------------------------|---------------------------------------|
| 1 | requirements   | requirement               | Add input validation requirement      |
| 2 | architecture   | adr                       | Update ADR-003: switch to event src   |
| 3 | planning       | work_item                 | Replan to include new WIs             |

Phases affected: requirements, architecture, planning
```

### 2.2 Action → Phase Classification Reference

Use this table to classify each proposed action into its target phase:

| Entity types involved | Phase |
|---|---|
| persona, requirement, project_context, data_exchange, nonfunctional_requirement | `requirements` |
| user_flow, screen, info_architecture, persona_addressed, ux_asset | `ux_design` |
| adr, adr_decision, component, approved_dependency, requirement_trace | `architecture` |
| work_item, plan_overview, plan_external_dependency | `planning` |
| Code changes, test files | `implementation` |
| Documentation files | `documentation` |

If an action spans multiple phases (e.g., "add a requirement and the ADR to support it"), split it into separate per-phase actions.

### 2.3 User Confirmation

Ask the user which phases to skip:

```
These actions span phases: X, Y, Z. They'll execute in canonical workflow order.
Want to skip any of these phases?
```

Present via `AskUserQuestion` with choices listing each affected phase plus "None — run all". For example:

```
AskUserQuestion(
  question: "Which phases should be skipped?",
  choices: ["requirements", "architecture", "planning", "None — run all"]
)
```

If the user skips all phases, exit the skill. Otherwise, proceed to Phase 3 with the non-skipped phases.

## Phase 3: Phase Execution

For each non-skipped phase, in **canonical workflow order**:

```
requirements → ux_design → architecture → planning → implementation → documentation
```

Q&A actions target development phases only. For QA/audit updates, use the release workflow (`/rigor:start-release`).

Execute a scoped producer-critic loop. Only phases that have actions mapped to them are executed; others are skipped entirely.

### 3.1 Phase-to-Agent Reference

| Phase | Producer Agent (`agent_type`) | Critic Agent (`agent_type`) |
|-------|----------------|--------------|
| Requirements | `rigor:requirements_analyst` | `rigor:requirements_critic` |
| UX Design | `rigor:ux_designer` | `rigor:ux_critic` |
| Architecture | `rigor:backend_architect` | `rigor:architecture_critic` |
| Planning | `rigor:implementation_planner` | `rigor:implementation_plan_critic` |
| Implementation (tests) | `rigor:test_writer` | `rigor:test_writer_critic` |
| Implementation (code) | `rigor:senior_developer` | `rigor:senior_developer_critic` |
| Documentation | `rigor:documentation_master` | `rigor:documentation_critic` |

### 3.2 Scoped Producer-Critic Loop

For each phase with mapped actions, execute the following steps:

#### Step 1 — Re-open the phase

```
phase_transition(
  project_root: "<path>",
  iteration_id: <current_iteration_id>,
  phase_name: "<phase_name>",
  status: "in_progress"
)
```

`phase_transition` allows re-entering completed phases — this is how Q&A actions modify already-completed work.

#### Step 2 — Create a revision

```
revision_create(
  project_root: "<path>",
  iteration_id: <current_iteration_id>,
  phase_name: "<phase_name>",
  agent_name: "<producer_agent_name>"
)
```

#### Step 3 — Invoke the producer via Task tool

```
Task(
  agent_type: "<producer_agent_type>",
  name: "<phase>-qa-producer",
  description: "Q&A update: <phase>",
  prompt: "Execute tools one at a time using the structured tool interface. Never write out tool calls as XML text — use the structured tool interface directly.

Context: This is a targeted update from a Q&A session.

Actions for this phase:
<list of specific action descriptions mapped to this phase>

Relevant findings from Q&A discussion:
<summarized findings — NOT the full conversation>

Use changelog_query to load current state before making changes. Only modify what the actions specify — do not expand scope."
)
```

#### Step 4 — Invoke the critic via Task tool

```
Task(
  agent_type: "<critic_agent_type>",
  name: "<phase>-qa-critic",
  description: "Q&A review: <phase>",
  prompt: "Execute tools one at a time using the structured tool interface. Never write out tool calls as XML text — use the structured tool interface directly.

Evaluate ONLY whether the changes correctly address the specified actions. Do not evaluate completeness against the full phase scope.

Actions that were requested:
<list of specific action descriptions for this phase>

Review the current revision's data via changelog_query filtered by iteration_id.",
  model: "<critic_model from project_status>"
)
```

> **CRITICAL:** The scoped evaluation instruction ("Evaluate ONLY whether the changes correctly address the specified actions") is essential. Without it, a critic reviewing a single new requirement would reject because "the requirements spec is incomplete." Q&A actions are surgical — the critic must evaluate them surgically.

#### Step 5 — Record the verdict

```
revision_update(
  project_root: "<path>",
  revision_id: <current_revision_id>,
  status: "approved" | "rejected",
  feedback: "<critic feedback summary>"
)
```

#### Step 6 — Branch on verdict

- **Approved:**
  1. Call `phase_transition` to mark the phase completed:
     ```
     phase_transition(
       project_root: "<path>",
       iteration_id: <current_iteration_id>,
       phase_name: "<phase_name>",
       status: "completed"
     )
     ```
  2. Call `checkpoint` to persist state:
     ```
     checkpoint(
       project_root: "<path>",
       message: "Q&A action: <concise description of what changed>"
     )
     ```
  3. Proceed to the next phase in the execution list

- **Rejected + revision_count < 3:**
  1. Loop back to Step 2 with the critic's feedback included in the next producer prompt
  2. The next `revision_create` increments the revision count

- **Rejected + revision_count >= 3:**
  1. Escalate to the user:
     ```
     ⚠️  Escalation Required

     The <phase> phase has gone through 3 producer-critic revisions without approval
     for the Q&A action: <action description>.

     Issues identified by critic:
     <list of blocking issues from latest feedback>

     How would you like to proceed?
     1. Allow one more iteration with your guidance
     2. Override critic and proceed (not recommended)
     3. Skip this phase's actions and continue with remaining phases
     4. Abandon remaining phase executions
     ```
  2. Use `AskUserQuestion` to get the user's decision
  3. Act on the decision:
     - Option 1: accept user guidance, loop back to Step 2
     - Option 2: mark phase completed, proceed to next phase
     - Option 3: skip this phase, proceed to next phase
     - Option 4: exit the skill

### 3.3 Cascading Context Between Phases

When phases chain, later producers receive context about what earlier phases produced. This enables coherence across Q&A actions that span multiple phases.

When invoking a producer for phase N+1, include in the prompt:
```
Earlier Q&A actions in this session:
- <phase N>: <what was added/changed, e.g., "Added requirement REQ-042 for input validation">

Load details via changelog_query as needed — only entity IDs and summaries are provided here.
```

Agents load the full details via `changelog_query` themselves — the orchestrator passes only IDs and one-line summaries.

### 3.4 Implementation Phase Special Handling

For implementation actions, follow the full implementation sub-phase sequence defined in the main workflow skill (§9 in `skills/workflow/SKILL.md`):

```
test_writer → test_writer_critic → senior_developer → senior_developer_critic
```

Do NOT simplify or skip the TDD two-step loop for Q&A actions. The same quality standards apply. The only difference is the scoped prompt — the producer and critic are told to focus on the specific actions from the Q&A session.

## Exit Conditions

The skill exits when any of the following occurs:

1. **No actions needed** — User says "done" / "thanks" during the conversation loop (Phase 1). No DB state changes.
2. **All phase executions complete** — Every non-skipped phase's producer-critic loop has been approved. All changes are checkpointed.
3. **User abandons mid-execution** — User chooses "Abandon remaining phase executions" during an escalation. Already-completed phases retain their changes (they were checkpointed). Remaining phases are left unchanged.
4. **User skips all phases** — User skips every proposed phase during action confirmation (Phase 2). No producer-critic loops run.

## Error Handling

**If `project_analyst` fails or returns an error:**
- Report the failure to the user conversationally
- Offer to retry with a rephrased question or try a different investigation angle
- Do NOT let the failure cascade — the conversation loop continues

**If a phase execution fails (DB error, tool error):**
- Report the specific error to the user
- Offer to skip the failed phase and continue with remaining phases
- Already-completed phases retain their checkpointed changes

**If required prior phase data is missing:**
- If the Q&A action references entities that don't exist yet (e.g., "update ADR-003" but ADR-003 was never created), report to the user and skip that action
- Do NOT create prerequisite entities implicitly — that would expand scope beyond what the user requested

**If DB is unavailable:**
- Display a clear error message
- Suggest using `/rigor:dev-status` to check state
- Do not proceed until DB is accessible

## Relationship to Main Workflow

- This skill operates **independently** of the main workflow skill (`skills/workflow/SKILL.md`).
- It can be invoked at any time — before, during, or after the main workflow.
- It re-opens phases as needed via `phase_transition(status: "in_progress")`. This is safe because `phase_transition` allows re-entering completed phases.
- Changes made through Q&A actions are checkpointed and become part of the project's permanent state. The main workflow will see these changes when it resumes.
- Q&A actions do NOT affect the main workflow's current phase pointer. If the main workflow was mid-architecture and the user runs Q&A to update a requirement, the main workflow remains in architecture when it resumes.

## Available Tools

> **Always include `project_root` in every tool call**, set to the absolute path of the current project's root directory (the directory where Claude Code is running).

You have access to:
- **Read** — Read agent files and VCS-tracked source files (but prefer delegating file reads to `project_analyst`)
- **Bash** — Run commands as needed
- **Skill** — Load skills (not used within this skill)
- **Task** — Invoke agents (primary mechanism for dispatching `project_analyst` and phase producers/critics)
- **AskUserQuestion** — Get user decisions for phase skipping, escalation
- **project_status** (MCP tool) — Get current project state, iteration, and all phase statuses
- **changelog_query** (MCP tool) — Small, targeted lookups only (delegate large queries to `project_analyst`)
- **phase_transition** (MCP tool) — Re-open and complete phases for Q&A actions
- **revision_create** (MCP tool) — Start a new producer-critic revision for a phase
- **revision_update** (MCP tool) — Record critic decision (approved/rejected) and feedback
- **checkpoint** (MCP tool) — Persist state: flush SQLite WAL, commit all changes to git

## Critical Rules

1. **Context protection above all** — Never read source files directly. Never run open-ended DB queries. Always delegate to `project_analyst`.
2. **Scoped evaluation** — Critics evaluate only the specified actions, not the full phase scope.
3. **Canonical phase order** — Phase executions always follow: requirements → ux_design → architecture → planning → implementation → documentation.
4. **Max 3 revisions** — After 3 producer-critic loops in any phase, escalate to user.
5. **No scope expansion** — Producers modify only what the actions specify. If the producer discovers additional issues, it reports them but does not fix them.
6. **Surgical changes** — This skill makes targeted updates, not comprehensive rewrites. Every prompt reinforces this constraint.

---

**Remember:** This is a focused Q&A tool. Keep the conversation lightweight, delegate heavy investigation, and make only the changes the user explicitly approves.
