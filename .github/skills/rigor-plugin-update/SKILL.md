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
Reviewer model: claude-opus-4.6 (always)
```

### Step 3: Producer-Critic Loop

**Iteration 1:**

1. Launch the `rigor_plugin_developer` agent (using the assessed model) with the confirmed change request as the prompt. Include:
   - The specific change to make (from Step 1 summary)
   - Any context about why the change is needed
   - If this is a re-run: the reviewer's feedback from the previous iteration

2. After the developer completes, launch the `rigor_plugin_reviewer` agent (always `claude-opus-4.6`) with:
   - The developer's summary of changes
   - The list of modified files
   - The revision number (starting at 1)

3. Evaluate the reviewer's verdict:
   - **`approved`** → proceed to Step 4
   - **`needs_revision`** → proceed to next iteration

**Iterations 2-3 (if needed):**

Feed the reviewer's blocking issues back to the developer agent as the change request:
```
Fix the following issues identified by the reviewer in revision [N]:

[reviewer's blocking issues and recommended changes]

Original change request: [original request]
```

**Escalation (iteration > 3):**

If the reviewer has not approved after 3 iterations, stop the loop and escalate to the user:
```
⚠️ Escalation Required

The plugin update has gone through 3 producer-critic revisions without approval.

Remaining issues from reviewer:
[list of blocking issues still present]

How would you like to proceed?
1. Provide guidance on the remaining issues and retry
2. Override the reviewer and accept current changes
3. Abandon the change
```

Use the ask_user tool to get the user's decision.

### Step 4: Final Report

```
✅ Plugin Update Complete

Change: [description]
Complexity: [Simple | Moderate | Complex]
Revisions: [N]
Files modified: [count]

Modified files:
- [file path]: [brief description of change]

Reviewer verdict: approved
```

---

## Mode 2: Deep Audit Mode

Triggered when the user asks for a full audit or analysis of the plugin's current state.

### Step 1: Launch Reviewer

Run the `rigor_plugin_reviewer` agent (always `claude-opus-4.6`) in deep audit mode. Prompt:

```
Perform a deep audit of the rigorous-dev plugin at plugins/rigorous-dev/.

Run your complete review checklist — correctness, internal consistency, and developer ergonomics — against the full plugin codebase. This is a standalone audit, not a change review.

For each checklist category, report every item as PASS or FAIL with specific details.
Produce a comprehensive audit report in your standard verdict format with mode: deep_audit.
```

### Step 2: Present Report

Display the reviewer's full audit report to the user.

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

## Mode 3: Q&A Audit Mode

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
| `rigor_plugin_developer` | Producer | Adaptive (sonnet or opus) | Makes changes to plugin files |
| `rigor_plugin_reviewer` | Critic | Always `claude-opus-4.6` | Validates changes for correctness, consistency, ergonomics |

Both agents have deep embedded knowledge of the rigorous-dev plugin's file structure, cross-reference map, and conventions. They are purpose-built for this plugin — not generic tools.

## Critical Rules

1. **Reviewer always uses Opus** — Catching subtle cross-reference bugs across 20+ files requires the strongest reasoning model.
2. **Producer defaults to Opus** — Only use Sonnet for obviously simple, single-file changes with no cross-reference impact. Correctness over cost, always.
3. **Max 3 iterations** — After 3 producer-critic loops, escalate to the user. Never loop silently.
4. **Reviewer is read-only** — The reviewer never modifies files. It only reads and reports.
5. **Changes always go through the loop** — Even in Q&A mode, proposed changes enter the full producer-critic loop. No direct edits bypass review.
6. **Deep audits are standalone** — In Deep Audit mode, the reviewer runs against the current state, not a diff. No producer is involved unless the user asks to fix issues.
