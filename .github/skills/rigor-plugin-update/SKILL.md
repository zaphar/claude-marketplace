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

## Mode Detection

Determine which mode to use based on the user's request:

- **Update Mode** — The user asks to make a specific change: add an agent, modify a workflow, fix a bug, update a command, change the schema, etc.
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

**If the request is ambiguous or underspecified** (e.g., "improve the implementation phase", "add better error handling"):
- Identify what's missing: scope, affected files, expected behavior, edge cases
- Use ask_user to ask **one focused question at a time** until the request is actionable
- Do not ask the user to re-explain what they already said — build on their input

**If the request could have unintended consequences** (e.g., "remove the ux_design phase", "change the revision escalation threshold"):
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
| **Complex** | New agent pair, workflow restructuring, schema changes, MCP server modifications, new phases, SKILL.md rewrite | `claude-opus-4.6` |

**Default to Opus.** Only use Sonnet for changes that are obviously simple — a single-file edit with no cross-reference impact. Any change that touches multiple files or could affect consistency gets Opus. Correctness always takes priority over cost; a subtle cross-reference bug that slips past a weaker model costs far more to fix than the token difference.

Report the classification to the user:
```
📊 Complexity Assessment: [Simple | Moderate | Complex]
Reason: [brief explanation]
Producer model: [claude-sonnet-4.6 | claude-opus-4.6]
Critic model: claude-opus-4.6 (always)
```

### Step 3: Producer-Critic Loop

**Pre-flight: Scope Check**

Before launching the producer, assess how many files the change touches. Sub-agent reliability degrades with task size — long-running agents risk API connection drops and streaming timeouts (see `sync-agent-timeout-patch.md` for details).

| Files Touched | Action |
|---------------|--------|
| **1-3 files** | Proceed with a single producer call. |
| **4+ files** | **Split into sub-tasks.** Break the change into multiple sequential producer calls, each touching ≤3 files. Run the critic once after all sub-tasks complete. |

When splitting:
- Each sub-task gets its own producer call with a focused prompt (e.g., "Update schema.sql only" → "Update write-tools.js only")
- Sub-tasks run **sequentially**, not in parallel — parallel API calls risk rate limiting and thundering-herd retries
- Later sub-tasks must reference what earlier sub-tasks changed (include file paths and summary)
- The critic reviews the aggregate result after all sub-tasks finish

**Iteration 1:**

1. Launch the `rigor_plugin_producer` agent (using the assessed model) with the confirmed change request as the prompt. Include:
   - The specific change to make (from Step 1 summary)
   - Any context about why the change is needed
   - If this is a re-run: the critic's feedback from the previous iteration

2. After the producer completes, launch the `rigor_plugin_critic` agent (always `claude-opus-4.6`) with:
   - The producer's summary of changes
   - The list of modified files
   - The revision number (starting at 1)

3. Evaluate the critic's verdict:
   - **`approved`** → proceed to Step 4
   - **`needs_revision`** → proceed to next iteration

**Iterations 2-3 (if needed):**

Feed the critic's blocking issues back to the producer agent as the change request:
```
Fix the following issues identified by the critic in revision [N]:

[critic's blocking issues and recommended changes]

Original change request: [original request]
```

**Escalation (iteration > 3):**

If the critic has not approved after 3 iterations, stop the loop and escalate to the user:
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

### Step 4: Commit

After the critic approves (or the orchestrator fixes blocking issues and is satisfied), **immediately commit the changes to git** before moving to the next work unit. Every approved change must be committed before any subsequent work begins.

```bash
git add -A && git commit -m "<WU-ID>: <concise description>

<details of what changed>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

Never batch multiple work units into a single commit. Each WU gets its own commit so changes can be reviewed and reverted independently.

### Step 5: Final Report

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

### Step 2: Present Report

Display the critic's full audit report to the user.

### Step 3: User Decision

After presenting the report, ask the user how to proceed:

```
The audit found [X] issues ([Y] blocking, [Z] recommended, [W] suggestions).

How would you like to proceed?
```

Offer choices via ask_user:
- **Fix all issues** — Enter Update Mode with all findings as the change request
- **Fix specific issues** — Let the user select which findings to address
- **No action** — Report is informational only

If the user chooses to fix issues, enter Update Mode (Step 1) with the selected findings as the change request. The complexity assessment should account for the scope of fixes needed.

---

## Mode 3: Schema Audit Mode

Triggered when the user asks to audit, simplify, or analyze the database schema specifically.

### Step 1: Scope the Audit

Determine audit scope based on the user's request:

- **Full audit** — Run all 20 audit categories across 4 parallel agent groups. Use when the user says "audit the schema", "full schema audit", or doesn't specify categories.
- **Focused audit** — Run specific category groups. Use when the user asks about a specific concern (e.g., "find tables to consolidate" → Group A, "check FK enforcement" → Group A, "find correctness bugs" → Group B).

If scope is ambiguous, ask the user:

```
The schema auditor has 20 audit categories across 4 groups. Would you like me to run all of them, or focus on specific areas?
```

Offer choices via ask_user:
- **Full audit (all 20 categories)** — Comprehensive analysis across 4 parallel agents
- **Simplification only (Group A: categories 1-4)** — Table consolidation, child collapse, FK enforcement, CHECK constraints
- **Correctness only (Group B: categories 5, 12-14)** — Structural bugs, nullability, transactions, circular FKs
- **Waste & Consistency (Group C: categories 6-9)** — Redundant tables, orphans, naming, column redundancy
- **Performance & Hygiene (Group D: categories 10-11, 15-20)** — Indexes, timestamps, polymorphic refs, scope leakage, deletion patterns, type precision, doc drift, unused enums
- **Let me specify** — User picks individual categories

### Step 2: Launch Schema Auditor Agents in Parallel

The 20 audit categories are split across 4 agent groups that run in parallel. Each group uses the `rigor_schema_auditor` agent (always `claude-opus-4.6`) with a scoped prompt.

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

**For a focused audit**, launch only the relevant group(s).

### Step 3: Wait for All Agents and Consolidate

Wait for all launched agents to complete using `read_agent` with `wait: true`.

**⚠️ Do NOT delete the individual group reports.** They are preserved as the raw audit fragments.

Once ALL agents have completed, **you (the skill orchestrator) create the consolidated report** by:

1. Reading each group's persisted report from `.scratch/rigor-schema-auditor/<date>/`
2. Merging all findings into a single prioritized list ordered by impact (most tables/code eliminated, most critical bugs first)
3. Writing the consolidated report to `.scratch/rigor-schema-auditor/<date>/<HHMMSS>_consolidated-audit.md`

The consolidated report format:

```markdown
# Schema Audit — Consolidated Report

**Date:** [date]
**Schema Tables:** [count]
**Groups Run:** [A, B, C, D]
**Total Findings:** [count across all groups]

## Prioritized Recommendations

| Priority | Category | Group | Finding | Severity | Impact | Effort |
|----------|----------|-------|---------|----------|--------|--------|
| 1 | [cat] | [A/B/C/D] | [finding] | [critical/medium/low] | [tables eliminated / bugs fixed] | [files affected] |
| 2 | ... | ... | ... | ... | ... | ... |

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

### Step 4: Present Consolidated Report

Display the consolidated report to the user, highlighting the top prioritized recommendations.

### Step 5: User Decision

After presenting the report, ask the user how to proceed:

```
The schema audit found [X] findings across [Y] categories.

Top recommendations by impact:
1. [finding] — [impact]
2. [finding] — [impact]
3. [finding] — [impact]

How would you like to proceed?
```

Offer choices via ask_user:
- **Fix all findings** — Enter Update Mode with all findings as the change request (use producer-critic loop)
- **Fix specific findings** — Let the user select which findings to address
- **Work through findings interactively** — Enter Q&A Mode to discuss each finding before deciding
- **No action** — Report is informational only

If the user chooses to fix findings, enter Update Mode (Step 1) with the selected findings as the change request. Each finding goes through the full producer-critic loop.

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
| Workflow phases | `grep -A 15 'const PHASES' plugins/rigorous-dev/mcp-server/write-tools.js` |
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

**⚠️ Schema Documentation Divergence:** `schema.sql` is always the source of truth for the database. If `schemas-overview.md` or any file in `references/tables/` describes tables, columns, or constraints that don't match `schema.sql`, that is a **blocking issue** that must be surfaced to the user immediately. This applies in all modes — Q&A, Deep Audit, and Update.

**Capabilities:**
- Trace cross-references: "What agents reference tool X?" → grep agent files for the tool name
- Check consistency: "Are there orphaned agents?" → diff `agents/` directory listing against SKILL.md tables
- Impact analysis: "What would I need to change to add a new phase?" → trace all files that would need updates
- Explain structure: "How does the implementation phase work?" → read SKILL.md section 8 and relevant agents
- Spot-check: "Is the README agent listing up to date?" → compare agents/ filenames with README content
- Data model questions: "What columns does the requirement table have?" → grep schema.sql for the CREATE TABLE
- Tool behavior: "What does changelog_insert do?" → read the handler in write-tools.js
- Entity relationships: "How do iterations relate to phases?" → read core.md and grep schema.sql for REFERENCES

### Change Detection

While answering questions, track whether the investigation reveals issues that would benefit from changes:

- **No changes needed** — The answer is purely informational. Continue Q&A.
- **Changes identified** — Present the potential changes to the user:

```
📋 Proposed Changes

Based on this investigation, the following changes would improve the plugin:

1. [Change description + rationale + affected files]
2. [Change description + rationale + affected files]

Complexity: [Simple | Moderate | Complex]

Would you like me to implement these changes?
```

### User Decision

Use ask_user to offer choices:
- **Yes, implement** → Enter Update Mode (Step 1) with the proposed changes as the change request
- **No, continue Q&A** → Continue answering questions
- **Modify the proposal** → Let the user adjust, then re-evaluate

After changes are applied (or declined), return to Q&A mode. The conversation continues until the user is done.

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
8. **Schema audit findings go through producer-critic** — When the user wants to fix schema audit findings, each fix enters Update Mode and goes through the full producer-critic loop. The schema auditor identifies issues; the producer-critic loop implements fixes.
9. **Keep producer tasks small** — A single producer call should touch ≤3 files. Changes spanning 4+ files must be split into sequential sub-tasks. Long-running agents risk API streaming timeouts; smaller tasks complete faster and retry cleanly. Never run multiple producers in parallel — sequential execution avoids rate limiting and thundering-herd failures.
10. **Commit after every work unit** — Each approved work unit must be committed to git immediately, before starting the next one. Never batch multiple work units into a single commit. This ensures changes are independently reviewable and revertable.
