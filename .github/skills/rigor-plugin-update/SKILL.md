---
name: rigor-plugin-update
description: >
  Manage changes to the rigorous-dev plugin at plugins/rigorous-dev/.
  Use when the user wants to modify, audit, or ask questions about the rigorous-dev plugin —
  its agents, commands, skills, MCP server, or orchestration workflow.
  Triggers on: update plugin, modify agent, plugin audit, plugin consistency, rigorous-dev changes.
---

# Rigor Plugin Update

You are orchestrating changes to the rigorous-dev plugin located at `plugins/rigorous-dev/`. This skill manages three modes of interaction: making changes, auditing the plugin, and answering questions about it.

**Before any mode:** Read `plugins/rigorous-dev/README.md` to understand the plugin's purpose, workflows, agents, and design conventions. This context is essential for complexity assessment, change proposals, and audit interpretation.

## Terminology

These terms have precise meanings throughout this document. Each word has exactly one meaning.

| Term | Definition | Example |
|------|-----------|---------|
| **Mode** | One of 4 interaction types: Update, Deep Audit, Schema Audit, Q&A. Determined at session start from the user's request. | "Mode Detection selected Schema Audit Mode" |
| **Finding** | A raw result from an agent (critic FAIL item, auditor recommendation, Q&A-discovered problem). Findings become issues once numbered in the Findings Index. | "The critic produced 12 findings" |
| **Issue** | A numbered entry in the Findings Index, identified by a monotonically increasing `#`. The stable identifier used throughout the review and implementation lifecycle. Created from findings during Step A. | "Issue #5: missing UNIQUE constraint on data_entity" |
| **Findings Index** | The numbered table of issues at the top of every audit report. Columns: `#`, `Group`/`Category`, `Severity`, `Approved`, `Finding`. The authoritative list of all issues. | "The Findings Index has 40 issues across 4 agent groups" |
| **Phase** | A dependency-ordered set of work-units in the implementation plan. Phase 1 has no dependencies; Phase 2 depends on Phase 1 completions. Never used to mean the plugin's own domain phases. | "Phase 1 has 15 issues with no dependencies" |
| **Implementation plan** | The phased execution plan produced during Step D of the workflow. Groups approved issues into dependency-ordered phases, each containing one or more work-units. Persisted as the "Implementation Phasing" section in audit reports. | "The implementation plan has 3 phases and 12 work-units" |
| **Work-unit** | The smallest executable chunk of implementation. A work-unit covers 1+ issues and goes through one loop cycle. | "WU-03: remove 9 CHECK constraints (Issues #12, #22, #23)" |
| **Loop cycle** | One complete pass through the Producer-Critic Loop: 1+ sequential producer calls → 1 critic review → commit. In the 1:1 pattern, the cycle has 1 producer call. In the N:1 pattern, it has N sequential producer calls. Either way, the cycle ends with one critic verdict and one commit. | "This work-unit took one loop cycle with 3 producer calls (N:1)" |
| **Step** | A procedural instruction within a mode or the shared workflow. Modes use numbered steps (Step 1, 2, 3); the shared workflow uses lettered steps (Step A, B, C, D, E). Never used to mean an implementation unit — that is a work-unit. | "Step 2: Complexity Assessment" |
| **Workflow** | The Findings Review & Implementation Workflow defined in this document. Never used to mean the plugin's own orchestration workflows. | "Enter the workflow at Step B" |
| **Report** | A persisted audit output document in `.scratch/`. Created by Schema Audit (consolidated report) and Deep Audit (critic report). Q&A and Update modes do not create reports. | "The consolidated report is at .scratch/rigor-schema-auditor/..." |
| **Producer** | The `rigor_plugin_producer` agent. Makes changes to plugin files. Never modifies files outside the plugin. | "Launch the producer with the change request" |
| **Critic** | The `rigor_plugin_critic` agent. Validates changes (or audits the plugin in Deep Audit mode). Read-only — never modifies files. | "The critic approved the change on revision 1" |
| **Auditor** | The `rigor_schema_auditor` agent. Analyzes the database schema across 20 categories. Read-only — never modifies files. | "Launch 4 auditor agents in parallel" |
| **Verdict** | The critic's output after reviewing a change: `approved` or `needs_revision`. | "The critic's verdict was needs_revision" |
| **Revision** | One pass through Loop 2 of the Producer-Critic Loop (producer makes changes → critic reviews). Maximum 3 revisions before escalation. | "The change was approved on revision 2" |
| **Escalation** | When the critic has not approved after 3 revisions, the loop stops and the user is asked to intervene. | "Escalation required after 3 revisions" |
| **Change request** | The user-provided description of what to change, confirmed in Update Mode Step 1. Passed as the prompt to the producer. | "Change request: rename backend_architect to system_architect" |
| **Complexity** | The classification of a change request: Simple, Moderate, or Complex. Determines the producer model. | "Complexity Assessment: Moderate" |
| **Agent group** | One of 4 parallel schema auditor partitions (Group A–D), each covering a subset of the 20 audit categories. | "Agent Group A covers categories 1-4 (Simplification)" |
| **Decisions ledger** | A persistent file at `.scratch/<auditor-name>/audit-decisions.md` that records approve/reject/skip decisions across audit runs. Enables deduplication on future audits. | "Check the decisions ledger for prior rulings" |
| **Consolidated report** | The merged output from all agent groups in a Schema Audit, written to `.scratch/rigor-schema-auditor/<date>/`. Contains the Findings Index and all group details. | "Create the consolidated report from all 4 group reports" |
| **Orchestrator** | The skill itself — you, the AI running this SKILL.md. Coordinates agents, manages the workflow, and reports to the user. | "The orchestrator creates the consolidated report" |
| **Deduplication** | Matching new findings against the decisions ledger to avoid re-reviewing previously decided issues. | "Deduplication found 5 prior decisions" |

**When referring to plugin domain concepts**, always use the compound form:
- **plugin-phase** — the rigorous-dev plugin's own phases (ux_design, implementation, etc.)
- **plugin-workflow** — the rigorous-dev plugin's own orchestration workflows

## Mode Detection

Determine which mode to use based on the user's request:

- **Update Mode** — The user asks to make a specific change: add an agent, modify a plugin-workflow, fix a bug, update a command, change the schema, etc.
- **Deep Audit Mode** — The user asks to audit, review, or analyze the plugin's current state without specifying a particular change. Keywords: "audit", "review the plugin", "check consistency", "analyze the plugin", "run a health check".
- **Schema Audit Mode** — The user asks to audit, simplify, or analyze the database schema specifically. Keywords: "schema audit", "simplify schema", "consolidate tables", "reduce table count", "FK audit", "CHECK constraint audit", "data model audit", "table consolidation", "schema correctness".
- **Q&A Audit Mode** — The user asks a question about the plugin, wants to understand something, or is exploring. Keywords: "what agents reference X?", "how does Y work?", "is Z up to date?", "show me inconsistencies".

If the mode is ambiguous, ask the user which mode they want.

---

## Mode 1: Update Mode

Triggered when the user requests a specific change to the plugin.

### Step 1: Understand the Request

Before assessing complexity or launching agents, make sure you fully understand what the user wants. Read the user's request and evaluate whether it is clear and actionable:

**If the request is clear and specific** (e.g., "rename the `backend_architect` agent to `system_architect`", "add a `deploy_config` entity type to the architecture domain"):
- Summarize your understanding back to the user in 1-2 sentences
- Proceed to Step 2

**If the request is ambiguous or underspecified** (e.g., "improve the implementation plugin-phase", "add better error handling"):
- Identify what's missing: scope, affected files, expected behavior, edge cases
- Use ask_user to ask **one focused question at a time** until the request is actionable
- Do not ask the user to re-explain what they already said — build on their input

**If the request could have unintended consequences** (e.g., "remove the ux_design plugin-phase", "change the revision escalation threshold"):
- Explain the downstream impact: what files would change, what cross-references would break, what behavior would shift
- Confirm the user wants to proceed with full awareness of the impact

Once the request is understood, confirm with the user:
```
📝 Change Request Summary

What: [1-2 sentence description of the change]
Scope: [which files/areas of the plugin are affected]
Impact: [any cross-reference updates, downstream effects, or breaking changes]

Proceed?
```

Use ask_user to confirm before moving to Step 2.

### Step 2: Complexity Assessment

Analyze the change request and classify its complexity:

| Complexity | Criteria | Producer Model |
|-----------|----------|----------------|
| **Simple** | Single-file edit, typo fix, minor wording change, frontmatter update | `claude-sonnet-4.6` |
| **Moderate** | Multi-file consistency updates, README updates, command changes | `claude-opus-4.6` |
| **Complex** | New agent pair, plugin-workflow restructuring, schema changes, MCP server modifications, new plugin-phases, SKILL.md rewrite | `claude-opus-4.6` |

**Default to Opus.** Only use Sonnet for changes that are obviously simple — a single-file edit with no cross-reference impact. Any change that touches multiple files or could affect consistency gets Opus. Correctness always takes priority over cost; a subtle cross-reference bug that slips past a weaker model costs far more to fix than the token difference.

Report the classification to the user:
```
📊 Complexity Assessment: [Simple | Moderate | Complex]
Reason: [brief explanation]
Producer model: [claude-sonnet-4.6 | claude-opus-4.6]
Critic model: claude-opus-4.6 (always)
```

### Step 3: Execute Change

Run the **Producer-Critic Loop** (see standalone section below) with the confirmed change request.

### Step 4: Final Report

```
✅ Plugin Update Complete

Change: [description]
Complexity: [Simple | Moderate | Complex]
Revisions: [N]
Files modified: [count]
Commit: [hash]

Modified files:
- [file path]: [brief description of change]

Critic verdict: approved
Critic results file: [path reported by critic, e.g. .scratch/rigor-plugin-critic/2026-03-06/141530_critic-review.md]
```

---

## Mode 2: Deep Audit Mode

Triggered when the user asks for a full audit or analysis of the plugin's current state.

### Step 1: Launch Critic

Run the `rigor_plugin_critic` agent (always `claude-opus-4.6`) in deep audit mode. Prompt:

```
Perform a deep audit of the rigorous-dev plugin at plugins/rigorous-dev/.

Run your complete review checklist — correctness, internal consistency, and developer ergonomics — against the full plugin codebase. This is a standalone audit, not a change review.

For each checklist category, report every item as PASS or FAIL with specific details.
Produce a comprehensive audit report in your standard verdict format with mode: deep_audit.
```

### Step 2: Build Findings Index

After the critic completes, read its report and build a **Findings Index** from all FAIL items:

1. **Deduplication**: Check for a prior decisions ledger at `.scratch/rigor-plugin-critic/audit-decisions.md`. Match each FAIL item against prior decisions using category + affected files (structural fingerprint) or summary (fuzzy text match). Pre-fill the `Approved` column for matches and mark with `(prior)`.
2. Each FAIL item gets a monotonically increasing `#` (starting at 1)
3. Add the Findings Index table to the critic's existing `.scratch/` report (this is an addition to the report the critic already creates — not a new file)
4. Present the report to the user with the Findings Index highlighted at the top

The Findings Index follows the format defined in the **Findings Review & Implementation Workflow** section:

```
| # | Category | Severity | Approved | Finding |
|---|----------|----------|----------|---------|
| 1 | Correctness | blocking | | [FAIL item one-line summary] |
| 2 | Consistency | recommended | ✅ (prior) | [FAIL item one-line summary] |
```

### Step 3: Enter Findings Review & Implementation Workflow

Enter the **Findings Review & Implementation Workflow** starting at **Step B: Interactive Review** (the Findings Index was already built in Step 2).

The shared workflow handles: interactive approve/reject/skip review → dependency analysis → implementation plan (appended to the critic's report only if 3+ fixes are approved) → execution with progress reporting. After review, the decisions ledger at `.scratch/rigor-plugin-critic/audit-decisions.md` is created or updated.

If the user chooses to fix issues, each fix goes through the full **Producer-Critic Loop**. The complexity assessment should account for the scope of fixes needed.

---

## Mode 3: Schema Audit Mode

Triggered when the user asks to audit, simplify, or analyze the database schema specifically.

### Step 1: Scope the Audit

Determine audit scope based on the user's request:

- **Full audit** — Run all 20 audit categories across 4 parallel agent groups. Use when the user says "audit the schema", "full schema audit", or doesn't specify categories.
- **Focused audit** — Run specific category groups. Use when the user asks about a specific concern (e.g., "find tables to consolidate" → Group A, "check FK enforcement" → Group A, "find correctness bugs" → Group B).

If scope is ambiguous, ask the user:

```
The schema auditor has 20 audit categories across 4 agent groups. Would you like me to run all of them, or focus on specific areas?
```

Offer choices via ask_user:
- **Full audit (all 20 categories)** — Comprehensive analysis across 4 parallel agents
- **Simplification only (Group A: categories 1-4)** — Table consolidation, child collapse, FK enforcement, CHECK constraints
- **Correctness only (Group B: categories 5, 12-14)** — Structural bugs, nullability, transactions, circular FKs
- **Waste & Consistency (Group C: categories 6-9)** — Redundant tables, orphans, naming, column redundancy
- **Performance & Hygiene (Group D: categories 10-11, 15-20)** — Indexes, timestamps, polymorphic refs, scope leakage, deletion patterns, type precision, doc drift, unused enums
- **Let me specify** — User picks individual categories

### Step 2: Launch Schema Auditor Agents in Parallel

The 20 audit categories are split across 4 agent groups that run in parallel. Each agent group uses the `rigor_schema_auditor` agent (always `claude-opus-4.6`) with a scoped prompt.

**Agent Group Assignments:**

| Group | Name | Categories | Focus |
|-------|------|-----------|-------|
| A | Simplification | 1, 2, 3, 4 | Table consolidation, child collapse, FK enforcement, CHECK constraints |
| B | Correctness | 5, 12, 13, 14 | Structural bugs, nullability mismatches, transaction safety, circular FKs |
| C | Waste & Consistency | 6, 7, 8, 9 | Redundant tables, orphaned tables, naming consistency, column redundancy |
| D | Performance & Hygiene | 10, 11, 15, 16, 17, 18, 19, 20 | Indexes, timestamps, polymorphic refs, scope leakage, deletion patterns, type precision, doc drift, unused enums |

**For a full audit**, launch all 4 agents in parallel using `mode: "background"` and `model: "claude-opus-4.6"` (mandatory — never use a weaker model for schema audits):

```
Agent A prompt:
Perform a schema audit of the rigorous-dev plugin. Focus ONLY on these categories:
- Category 1: Table Consolidation
- Category 2: Child Table Collapse
- Category 3: Foreign Key Enforcement
- Category 4: CHECK Constraint Audit
Produce your findings in the standard audit report format. Persist results to .scratch/rigor-schema-auditor/<date>/<HHMMSS>_group-a-simplification.md

Agent B prompt:
Perform a schema audit of the rigorous-dev plugin. Focus ONLY on these categories:
- Category 5: Schema Correctness
- Category 12: Nullable vs Required Alignment
- Category 13: Transaction Safety
- Category 14: Circular FK Dependencies
Produce your findings in the standard audit report format. Persist results to .scratch/rigor-schema-auditor/<date>/<HHMMSS>_group-b-correctness.md

Agent C prompt:
Perform a schema audit of the rigorous-dev plugin. Focus ONLY on these categories:
- Category 6: Redundant Tables
- Category 7: Orphaned Tables
- Category 8: Naming Consistency
- Category 9: Column Redundancy
Produce your findings in the standard audit report format. Persist results to .scratch/rigor-schema-auditor/<date>/<HHMMSS>_group-c-waste-consistency.md

Agent D prompt:
Perform a schema audit of the rigorous-dev plugin. Focus ONLY on these categories:
- Category 10: Index Coverage
- Category 11: Timestamp Consistency
- Category 15: Polymorphic References
- Category 16: Scope Leakage
- Category 17: Soft Delete vs Hard Delete
- Category 18: Data Type Precision
- Category 19: Documentation-Schema Drift
- Category 20: Unused Enum Values
Produce your findings in the standard audit report format. Persist results to .scratch/rigor-schema-auditor/<date>/<HHMMSS>_group-d-performance-hygiene.md
```

**For a focused audit**, launch only the relevant agent group(s).

### Step 3: Wait for All Agents and Consolidate

Wait for all launched agents to complete using `read_agent` with `wait: true`.

**⚠️ Do NOT delete the individual group reports.** They are preserved as the raw audit fragments.

Once ALL agents have completed, **you (the skill orchestrator) create the consolidated report** by:

1. Reading each agent group's persisted report from `.scratch/rigor-schema-auditor/<date>/`
2. Merging all findings into a single prioritized list ordered by impact (most tables/code eliminated, most critical bugs first)
3. Writing the consolidated report to `.scratch/rigor-schema-auditor/<date>/<HHMMSS>_consolidated-audit.md`

The consolidated report format — use the **Canonical Persisted Report Structure** from the Findings Review & Implementation Workflow section:

```markdown
# Schema Audit — Consolidated Report

**Date:** [date]
**Schema Tables:** [count]
**Groups Run:** [A, B, C, D]
**Total Findings:** [count across all groups]

---

## Findings Index

| # | Group | Severity | Approved | Finding |
|---|-------|----------|----------|---------|
| 1 | [A/B/C/D] | [critical/medium/low] | | [one-line summary — include impact, e.g. "22 child tables can collapse to JSON columns"] |
| 2 | ... | ... | | ... |

---

## Group A: Simplification (Categories 1-4)
[paste or summarize findings from group A report]

## Group B: Correctness (Categories 5, 12-14)
[paste or summarize findings from group B report]

## Group C: Waste & Consistency (Categories 6-9)
[paste or summarize findings from group C report]

## Group D: Performance & Hygiene (Categories 10-11, 15-20)
[paste or summarize findings from group D report]

---
**Individual reports preserved at:**
- .scratch/rigor-schema-auditor/<date>/<HHMMSS>_group-a-simplification.md
- .scratch/rigor-schema-auditor/<date>/<HHMMSS>_group-b-correctness.md
- .scratch/rigor-schema-auditor/<date>/<HHMMSS>_group-c-waste-consistency.md
- .scratch/rigor-schema-auditor/<date>/<HHMMSS>_group-d-performance-hygiene.md
```

Note: The `Approved` column starts blank. The `Implementation Phasing` section is NOT included in the initial report — it is appended later during the shared workflow (Step D).

### Step 4: Enter Findings Review & Implementation Workflow

After creating the consolidated report, enter the **Findings Review & Implementation Workflow** starting at **Step A** (the Findings Index is already built in Step 3 above — proceed to **Step B: Interactive Review**).

The shared workflow handles: interactive approve/reject/skip review → dependency analysis → implementation plan (appended to the consolidated report) → execution with progress reporting.

If the user chooses to fix issues, each fix goes through the full **Producer-Critic Loop**. The schema auditor identifies findings; the producer-critic loop implements fixes.

---

## Mode 4: Q&A Audit Mode

Triggered when the user asks questions about the plugin or is exploring potential changes.

### Conversational Investigation

Answer the user's question by reading and analyzing the relevant plugin files. This is a conversational loop — continue answering follow-ups until the user is done or until changes are identified.

**Discovery Commands:** When answering questions, discover the current plugin state dynamically rather than assuming. Use these commands as needed:

| What | How |
|------|-----|
| Agent files | `ls plugins/rigorous-dev/agents/*.agent.md` |
| Command files | `ls plugins/rigorous-dev/commands/*.md` |
| MCP tool names | `grep -o 'name: "[a-z_]*"' plugins/rigorous-dev/mcp-server/write-tools.js plugins/rigorous-dev/mcp-server/read-tools.js` |
| Entity types | `grep -A 30 'const ENTITY_TABLE' plugins/rigorous-dev/mcp-server/read-tools.js` |
| Plugin-phases | `grep -A 15 'const PHASES' plugins/rigorous-dev/mcp-server/write-tools.js` |
| DB tables | `grep '^CREATE TABLE' plugins/rigorous-dev/mcp-server/schema.sql` |
| Table docs | `ls plugins/rigorous-dev/skills/rigorous-dev/references/tables/` |
| SKILL.md agent tables | `grep -A 20 'Producer Agent.*Critic Agent' plugins/rigorous-dev/skills/rigorous-dev/SKILL.md` |
| TEXT-PK entity tables | `grep -A 5 'TEXT_PK_TYPES' plugins/rigorous-dev/mcp-server/read-tools.js` |
| Full schema for a table | `grep -A 30 'CREATE TABLE <table_name>' plugins/rigorous-dev/mcp-server/schema.sql` |
| Table relationships | `grep 'REFERENCES' plugins/rigorous-dev/mcp-server/schema.sql` |
| MCP tool parameters | Read the relevant tool handler in `write-tools.js` or `read-tools.js` |
| Table documentation | Read `plugins/rigorous-dev/skills/rigorous-dev/references/tables/<domain>.md` |

**Key reference files for data model questions:**
- `plugins/rigorous-dev/mcp-server/schema.sql` — **Source of truth.** Full DDL with all tables, columns, constraints, and foreign keys. When in doubt, this file wins.
- `plugins/rigorous-dev/skills/rigorous-dev/references/schemas-overview.md` — Human-readable data model overview. Summarizes every domain, lists all tables with their producer agent and purpose, and links to detailed per-domain docs. **Start here** for data model questions, then drill into schema.sql for specifics.
- `plugins/rigorous-dev/skills/rigorous-dev/references/tables/` — Per-domain detailed table documentation (core.md, requirements.md, architecture.md, ux-design.md, planning.md, implementation.md, documentation.md, qa-test.md, deployment.md, cross-cutting.md, data-model.md)
- `plugins/rigorous-dev/mcp-server/write-tools.js` — Write tool handlers (shows what parameters each tool accepts and what it does)
- `plugins/rigorous-dev/mcp-server/read-tools.js` — Read tool handlers (shows query logic, entity type mappings, TEXT-PK types)
- `plugins/rigorous-dev/mcp-server/db.js` — Database initialization (WAL mode, foreign keys)

**Capabilities:**
- Trace cross-references: "What agents reference tool X?" → grep agent files for the tool name
- Check consistency: "Are there orphaned agents?" → diff `agents/` directory listing against SKILL.md tables
- Impact analysis: "What would I need to change to add a new plugin-phase?" → trace all files that would need updates
- Explain structure: "How does the implementation plugin-phase work?" → read SKILL.md section 8 and relevant agents
- Spot-check: "Is the README agent listing up to date?" → compare agents/ filenames with README content
- Data model questions: "What columns does the requirement table have?" → grep schema.sql for the CREATE TABLE
- Tool behavior: "What does changelog_insert do?" → read the handler in write-tools.js
- Entity relationships: "How do iterations relate to plugin-phases?" → read core.md and grep schema.sql for REFERENCES

### Change Detection

While answering questions, track whether the investigation reveals issues that would benefit from changes:

- **No changes needed** — The answer is purely informational. Continue Q&A.
- **Single change identified** — Present the change to the user and offer to enter Update Mode (Step 1) directly:

```
📋 Proposed Change

Based on this investigation, the following change would improve the plugin:

1. [Change description + rationale + affected files]

Complexity: [Simple | Moderate | Complex]

Would you like me to implement this change?
```

- **Multiple changes identified (2+)** — Present them as a numbered Findings Index inline (no persisted document) and offer to enter the shared workflow:

```
📋 Proposed Changes

Based on this investigation, the following changes would improve the plugin:

| # | Category | Severity | Finding |
|---|----------|----------|---------|
| 1 | [cat]    | [sev]    | [one-line summary + affected files] |
| 2 | [cat]    | [sev]    | [one-line summary + affected files] |

Would you like to review these interactively?
```

If the user agrees, enter the **Findings Review & Implementation Workflow** at **Step B: Interactive Review** (the numbered table above serves as the Findings Index). The implementation plan is only generated when 3+ changes are approved; for 1-2 changes, skip it and go straight to execution.

### User Decision

Use ask_user to offer choices:
- **Yes, review interactively** → Enter the Findings Review & Implementation Workflow (Step B)
- **Yes, implement all** → Enter Update Mode (Step 1) with all proposed changes
- **No, continue Q&A** → Continue answering questions
- **Modify the proposal** → Let the user adjust, then re-evaluate

After changes are applied (or declined), return to Q&A mode. The conversation continues until the user is done.

---

## Producer-Critic Loop

This is the shared execution mechanism used by all modes when making changes. Every change — whether from Update Mode, audit fix, or Q&A-discovered issue — goes through this loop.

**Decompose work into the smallest logical chunks possible.** Each producer call should handle one atomic, coherent change — the smallest unit of work that leaves the codebase in a consistent state. This keeps changes reviewable, revertable, and reduces agent failure risk.

When executing work from the Findings Review & Implementation Workflow, break issues down at the planning stage (Step D: Implementation Phasing), not at the producer level. If an issue is large, decompose it into multiple work-units in the implementation plan — each work-unit is then a small, focused unit.

There are **two kinds of iteration** in this loop. They are orthogonal:

### Loop 1: Producer Batching (how many producers before a critic)

This controls how many producer calls run before the critic reviews:

- **1:1** (default) — 1 producer → 1 critic → commit. Use for standalone changes.
- **N:1** (batching) — N sequential producers → 1 critic → commit. Use when multiple small chunks are parts of one logical change or a work-unit covers closely related issues. The critic reviews the aggregate result. Never run producers in parallel — sequential only to avoid rate limiting.

Use your judgment on which pattern fits. The goal is always: smallest producer tasks, fewest wasted critic calls.

### Loop 2: Revision (what happens when the critic rejects)

After the producer(s) complete and the critic reviews, the critic either approves or requests revisions. This is the feedback loop:

**Revision 1 (initial):**

1. Launch the `rigor_plugin_producer` agent (using the assessed model) with the change request as the prompt. Include:
   - The specific change to make
   - Any context about why the change is needed

2. After the producer (or all N producers in a batch) completes, launch the `rigor_plugin_critic` agent (always `claude-opus-4.6`) with:
   - The producer's summary of changes
   - The list of modified files
   - The revision number (starting at 1)

3. Evaluate the critic's verdict:
   - **`approved`** → commit and proceed
   - **`needs_revision`** → enter revision 2

**Revisions 2-3 (if needed):**

Feed the critic's blocking issues back to the producer agent as the change request:
```
Fix the following issues identified by the critic in revision [N]:

[critic's blocking issues and recommended changes]

Original change request: [original request]
```

After the producer fixes, run the critic again. Repeat up to 3 total revisions.

**Escalation (revision > 3):**

If the critic has not approved after 3 revisions, stop the loop and escalate to the user:
```
⚠️ Escalation Required

The plugin update has gone through 3 producer-critic revisions without approval.

Remaining issues from critic:
[list of blocking issues still present]

How would you like to proceed?
1. Provide guidance on the remaining issues and retry
2. Override the reviewer and accept current changes
3. Abandon the change
```

Use the ask_user tool to get the user's decision.

### Commit

After the critic approves, **immediately commit the changes to git** before moving to the next work-unit. Every approved change must be committed before any subsequent work begins.

**Commit frequently and minimally** — commit as fine-grained as possible, at minimum after each issue completes but preferably after each coherent sub-change. Each commit should be independently understandable and revertable.

```bash
git add -A && git commit -m "<concise description>

<details of what changed>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Findings Review & Implementation Workflow

This shared workflow is used by any mode that produces multiple findings (Schema Audit, Deep Audit, Q&A when 2+ changes surface). It covers the full lifecycle from findings presentation through implementation.

**Document scope varies by mode:**
- **Update Mode** — NO persisted report. The workflow applies when a change request is decomposed into multiple work-units. Phasing and progress are tracked in-conversation. Single changes go straight through the Producer-Critic Loop without this workflow.
- **Schema Audit Mode** — always creates a persisted consolidated report in `.scratch/`. The findings index, decisions, and implementation plan are all recorded in that document.
- **Deep Audit Mode** — the critic already creates a persisted report in `.scratch/`. The orchestrator adds a findings index table to that existing report. The implementation plan is only appended if the user approves 3+ fixes.
- **Q&A Mode** — NO persisted document. Findings are presented inline in the conversation. The conversation itself is the record.

### Canonical Persisted Report Structure

When a mode produces a persisted report, it must follow this structure:

```markdown
# [Audit Type] — Consolidated Report

**Date:** [date]
**[Domain-specific metadata]:** [e.g., Schema Tables: 112, Files Analyzed: 47]
**[Scope metadata]:** [e.g., Groups Run: A, B, C, D]
**Total Findings:** [count]

---

## Findings Index

| # | Group | Severity | Approved | Finding |
|---|-------|----------|----------|---------|
| 1 | [grp] | critical |          | [one-line summary] |
| 2 | [grp] | medium   |          | [one-line summary] |

---

## [Group/Category Detail Sections]
[Detailed findings per group/category — full analysis, affected files, rationale]

---

## Implementation Phasing
[Appended after interactive review + dependency analysis — NOT in initial report]

### Phase 1 — No dependencies
| Issue | Summary |
|-------|---------|
| 1     | [desc]  |

### Phase 2 — Depends on Phase 1
| Issue | Depends on | Summary |
|-------|------------|---------|
| 5     | 1          | [desc]  |

---

**Individual reports preserved at:**
- [paths to raw audit fragments, if applicable]
```

Key format rules:
- **Findings Index is the first content section** — always at the top after header metadata
- The `#` column uses monotonically increasing integers — stable identifiers for referring to issues (e.g., "issue 5")
- The `Approved` column starts blank and gets filled with ✅/❌/⏭️ during interactive review
- Findings are ordered by impact (most critical / highest elimination first)
- Group detail sections preserve the full analysis from each auditor/critic agent
- **Implementation Phasing is appended later** — it is NOT part of the initial report; it gets added after Step D below
- Each phase table includes the original `#` issue numbers for traceability

### Step A: Build Findings Index

- Collect all findings from agent reports (or investigation results)
- **Deduplication**: Before building the index, check for a prior decisions ledger at `.scratch/<auditor-name>/audit-decisions.md`. If it exists, match each finding against prior decisions using `category` + `tables` (structural fingerprint) or `summary` (fuzzy text match). Findings that match a prior decision should be pre-filled with that decision in the `Approved` column and marked with `(prior)` so the user can see they were already decided. The user can override any prior decision during interactive review.
- Assign monotonically increasing `#` starting at 1
- Build the findings table with columns: `#`, `Group`/`Category`, `Severity`, `Finding` (one-line summary), `Approved` (blank, or pre-filled from prior decisions)
- Order by impact: critical bugs first, then high-elimination changes, then medium, then low
- For persisted modes: write the full report (header + Findings Index + group details) to the report file
- For Q&A mode: present the numbered table inline in conversation

### Step B: Interactive Review

- Present each issue one at a time to the user
- For issues with a prior decision: show the prior decision and ask if the user wants to keep it or change it
- For new issues: show context (category, severity, affected tables/files, what it means, why it matters)
- Use `ask_user` with choices: `"Approve"`, `"Reject"`, `"Skip"`, `"Expand (tell me more)"`
- On "Expand": provide deeper analysis (show the actual schema/code, explain tradeoffs), then re-ask for decision
- Record decision in the Approved column: ✅ (approved), ❌ (rejected), ⏭️ (skipped)
- For persisted modes: update the report file with decisions after each batch or at the end
- Report running tally after each decision: `"X approved, Y rejected, Z skipped, W remaining"`

**After interactive review completes**, update the decisions ledger:
- Create or update `.scratch/<auditor-name>/audit-decisions.md`
- Each decision gets a ledger entry with: date, category, tables, summary, decision, action/reason
- The ledger is the persistent record across audit runs — it enables deduplication on future audits
- Format per entry:
  ```markdown
  ### D[N]
  - **Date:** [date]
  - **Category:** [N] ([name])
  - **Tables:** [affected tables]
  - **Summary:** [one-line finding]
  - **Decision:** approved | rejected | skipped
  - **Action:** [what was done] | **Reason:** [why rejected/skipped]
  ```

### Step C: Dependency Analysis

- After review, analyze dependencies between **approved** issues only
- Identify ordering constraints (e.g., "rename column before adding UNIQUE on it", "merge tables before adding indexes", "collapse child tables before adding CASCADE FKs")
- For persisted modes: record dependencies in the report
- Present dependency summary to user: which issues block which, and why

### Step D: Implementation Phasing

- Generate the implementation plan from approved issues + dependency graph:
  - **Phase 1**: No dependencies (can execute in any order)
  - **Phase 2**: Depends on Phase 1 items
  - **Phase N**: Depends on prior phases
- Each phase has work-units; each work-unit covers 1+ issues
- Each work-unit shows original issue `#` numbers for traceability
- For persisted modes: append "Implementation Phasing" section to the report
- For Q&A mode: present the implementation plan in-conversation (only if 3+ approved changes warrant it; for 1-2 changes, skip directly to execution)
- Present implementation plan to user for confirmation before starting implementation

### Step E: Implementation Execution

Execute work-units in phase order using the **Producer-Critic Loop** (see standalone section above).

- Each work-unit decomposes into the smallest logical producer tasks possible
- Use 1:1 (single producer → critic) for standalone changes; use N:1 (N sequential producers → 1 critic) when multiple small tasks are parts of one logical change
- Track and report progress at the start of each work-unit:
  ```
  📊 Progress: X/Y issues done | Z in progress | W remaining
  Current: WU-N — [description] (Issues #A, #B)
  ```
- For persisted modes: update the report as issues complete (mark steps done)
- **Commit frequently and minimally** — commit as fine-grained as possible, at minimum after each issue completes but preferably after each coherent sub-change. Each commit should be independently understandable and revertable.

---

## Agent Reference

| Agent | Role | Default Model | Purpose |
|-------|------|---------------|---------|
| `rigor_plugin_producer` | Producer | Adaptive (sonnet or opus) | Makes changes to plugin files |
| `rigor_plugin_critic` | Critic | Always `claude-opus-4.6` | Validates changes for correctness, consistency, ergonomics |
| `rigor_schema_auditor` | Auditor | Always `claude-opus-4.6` | Schema simplification, correctness, and consistency analysis (20 audit categories) |

All agents have deep embedded knowledge of the rigorous-dev plugin's file structure, cross-reference map, and conventions. They are purpose-built for this plugin — not generic tools.

## Critical Rules

1. **Critic always uses Opus** — Catching subtle cross-reference bugs across 20+ files requires the strongest reasoning model.
2. **Schema auditor always uses Opus** — Analyzing 141+ tables across schema, handlers, and documentation requires deep reasoning. All 4 audit groups must use `model: "claude-opus-4.6"` — no exceptions.
3. **Producer defaults to Opus** — Only use Sonnet for obviously simple, single-file changes with no cross-reference impact. Correctness over cost, always.
4. **Max 3 iterations** — After 3 producer-critic loops, escalate to the user. Never loop silently.
5. **Critic and auditor are read-only** — They never modify files. They only read and report.
6. **Changes always go through the loop** — Even in Q&A mode, proposed changes enter the full producer-critic loop. No direct edits bypass critique.
7. **Deep audits are standalone** — In Deep Audit and Schema Audit modes, auditors run against the current state, not a diff. No producer is involved unless the user asks to fix issues.
8. **Audit findings go through the Findings Review & Implementation Workflow** — All audit modes (Schema Audit, Deep Audit) and Q&A (when 2+ changes surface) use the shared Findings Review & Implementation Workflow. Findings get numbered as issues, then go through interactive review, dependency analysis, and an implementation plan. The schema/deep auditor produces findings; the producer-critic loop implements fixes.
9. **Decompose into smallest logical chunks** — Each producer call should handle the smallest atomic change that leaves the codebase consistent. Decompose large issues into multiple work-units at the planning stage. Use 1:1 (producer → critic → commit) for standalone changes; use N:1 (N sequential producers → 1 critic) when multiple small chunks form one logical change. Never run producers in parallel — sequential only to avoid rate limiting.
10. **Commit frequently and minimally** — Commit as fine-grained as possible. Prefer one commit per coherent sub-change (e.g., schema change, handler change, doc change as separate commits). Each commit should be independently understandable and revertable. At minimum, commit after each issue completes. Never batch multiple unrelated issues into one commit. Fine-grained commits make tracking changes and reverting much easier.
11. **Report progress during multi-work-unit implementation** — At the start of each work-unit, report done/in-progress/remaining counts and the current work-unit with issue numbers. This keeps the user oriented during long implementation runs.
12. **All audit outputs use the Findings Index format** — Every audit mode must produce a Findings Index table with monotonically increasing `#` column, `Approved` column, and consistent column structure. The `#` is the stable identifier for referring to issues across the review and implementation lifecycle.
13. **Schema documentation divergence is a blocking issue** — `schema.sql` is always the source of truth for the database. If `schemas-overview.md` or any file in `references/tables/` describes tables, columns, or constraints that don't match `schema.sql`, that is a **blocking issue** that must be surfaced to the user immediately. This applies in all modes — Schema Audit, Deep Audit, Q&A, and Update.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Agent group** | One of 4 parallel schema auditor partitions (Group A–D), each covering a subset of the 20 audit categories. |
| **Auditor** | The `rigor_schema_auditor` agent. Analyzes the database schema across 20 categories. Read-only — never modifies files. |
| **Change request** | The user-provided description of what to change, confirmed in Update Mode Step 1. Passed as the prompt to the producer. |
| **Complexity** | The classification of a change request: Simple, Moderate, or Complex. Determines the producer model. |
| **Consolidated report** | The merged output from all agent groups in a Schema Audit, written to `.scratch/rigor-schema-auditor/<date>/`. Contains the Findings Index and all group details. |
| **Critic** | The `rigor_plugin_critic` agent. Validates changes (or audits the plugin in Deep Audit mode). Read-only — never modifies files. |
| **Decisions ledger** | A persistent file at `.scratch/<auditor-name>/audit-decisions.md` that records approve/reject/skip decisions across audit runs. Enables deduplication on future audits. |
| **Deduplication** | Matching new findings against the decisions ledger to avoid re-reviewing previously decided issues. |
| **Escalation** | When the critic has not approved after 3 revisions, the loop stops and the user is asked to intervene. |
| **Finding** | A raw result from an agent (critic FAIL item, auditor recommendation, Q&A-discovered problem). Findings become issues once numbered in the Findings Index. |
| **Findings Index** | The numbered table of issues at the top of every audit report. Columns: `#`, `Group`/`Category`, `Severity`, `Approved`, `Finding`. The authoritative list of all issues. |
| **Implementation plan** | The phased execution plan produced during Step D of the workflow. Groups approved issues into dependency-ordered phases, each containing one or more work-units. Persisted as the "Implementation Phasing" section in audit reports. |
| **Issue** | A numbered entry in the Findings Index, identified by a monotonically increasing `#`. The stable identifier used throughout the review and implementation lifecycle. Created from findings during Step A. |
| **Loop cycle** | One complete pass through the Producer-Critic Loop: 1+ sequential producer calls → 1 critic review → commit. In the 1:1 pattern, the cycle has 1 producer call. In the N:1 pattern, it has N sequential producer calls. Either way, the cycle ends with one critic verdict and one commit. |
| **Mode** | One of 4 interaction types: Update, Deep Audit, Schema Audit, Q&A. Determined at session start from the user's request. |
| **Orchestrator** | The skill itself — you, the AI running this SKILL.md. Coordinates agents, manages the workflow, and reports to the user. |
| **Phase** | A dependency-ordered set of work-units in the implementation plan. Phase 1 has no dependencies; Phase 2 depends on Phase 1 completions. Never refers to the plugin's own domain phases — those are **plugin-phases**. |
| **Plugin-phase** | A phase in the rigorous-dev plugin's own domain (e.g., ux_design, implementation, qa_test). Distinct from **phase**. |
| **Plugin-workflow** | An orchestration workflow in the rigorous-dev plugin itself. Distinct from **workflow**. |
| **Producer** | The `rigor_plugin_producer` agent. Makes changes to plugin files. Never modifies files outside the plugin. |
| **Report** | A persisted audit output document in `.scratch/`. Created by Schema Audit (consolidated report) and Deep Audit (critic report). Q&A and Update modes do not create reports. |
| **Revision** | One pass through Loop 2 of the Producer-Critic Loop (producer makes changes → critic reviews). Maximum 3 revisions before escalation. |
| **Step** | A procedural instruction within a mode or the shared workflow. Modes use numbered steps (Step 1, 2, 3); the shared workflow uses lettered steps (Step A, B, C, D, E). Never refers to an implementation unit — that is a **work-unit**. |
| **Verdict** | The critic's output after reviewing a change: `approved` or `needs_revision`. |
| **Work-unit** | The smallest executable chunk of implementation. A work-unit covers 1+ issues and goes through one loop cycle. |
| **Workflow** | The Findings Review & Implementation Workflow defined in this document. Never refers to the plugin's own orchestration workflows — those are **plugin-workflows**. |
