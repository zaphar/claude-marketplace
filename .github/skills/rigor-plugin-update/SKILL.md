---
name: rigor-plugin-update
description: >
  Manage changes to the rigorous-dev plugin at plugins/rigorous-dev/.
  Use when the user wants to modify, audit, or ask questions about the rigorous-dev plugin —
  its agents, commands, skills, MCP server, or orchestration workflow.
  Triggers on: update plugin, modify agent, plugin audit, plugin consistency, rigorous-dev changes.
---

# Rigor Plugin Update

You are orchestrating changes to the rigorous-dev plugin located at `plugins/rigorous-dev/`. This skill manages five modes of interaction: making changes, auditing the plugin, auditing the schema, auditing the MCP server code, and answering questions.

**Before any mode:** Read `plugins/rigorous-dev/README.md` to understand the plugin's purpose, workflows, agents, and design conventions.

**Detailed instructions are split into focused files.** After detecting the mode, read the relevant file(s) listed below. Do NOT proceed from memory — always read the mode file before executing.

## Terminology

These terms have precise meanings throughout all skill files. Each word has exactly one meaning.

| Term | Definition |
|------|-----------|
| **Mode** | One of 5 interaction types: Update, Deep Audit, Schema Audit, MCP Server Audit, Q&A. Determined at session start from the user's request. |
| **Finding** | A raw result from an agent. Findings become issues once numbered in the Findings Index. |
| **Issue** | A numbered entry in the Findings Index, identified by a monotonically increasing `#`. |
| **Findings Index** | The numbered table of issues at the top of every audit report. Columns: `#`, `Group`/`Category`, `Severity`, `Approved`, `Finding`. **This is the most important output of any audit.** |
| **Phase** | A dependency-ordered set of work-units in the implementation plan. Never refers to plugin domain phases. |
| **Implementation plan** | The phased execution plan produced during Step D of the workflow. |
| **Work-unit** | The smallest executable chunk of implementation. Each goes through one loop cycle. |
| **Loop cycle** | One complete pass through the Producer-Critic Loop: 1+ producer calls → 1 critic review → commit. |
| **Step** | A procedural instruction within a mode or workflow. Never refers to an implementation unit. |
| **Workflow** | The Findings Review & Implementation Workflow. Never refers to plugin orchestration workflows. |
| **Report** | A persisted audit output document in `.scratch/`. |
| **Producer** | The `rigor_plugin_producer` agent. Makes changes. Never modifies files outside the plugin. |
| **Critic** | Any non-producer, read-only validation/analysis agent. For general plugin changes: `rigor_consistency_critic`. For schema analysis: `rigor_schema_critic`. For MCP server changes and analysis: `rigor_mcp_server_critic` (which has specialized MCP/SQL knowledge). |
| **Verdict** | The critic's output: `approved` or `needs_revision`. |
| **Revision** | One pass through the Producer-Critic feedback loop. Max 3 before escalation. |
| **Escalation** | When the critic hasn't approved after 3 revisions — ask the user to intervene. |
| **Change request** | The user's description of what to change, confirmed in Update Mode Step 1. |
| **Complexity** | Simple, Moderate, or Complex. Determines the producer model. |
| **Agent group** | One of 4 parallel schema critic partitions (Group A–D). |
| **Decisions ledger** | Persistent file at `.scratch/<critic-name>/audit-decisions.md` recording approve/reject/skip decisions. |
| **Consolidated report** | Merged output from all agent groups. Contains the Findings Index and group details. |
| **Orchestrator** | You, the AI running this skill. Coordinates agents and reports to the user. |
| **Deduplication** | Matching new findings against the decisions ledger to avoid re-reviewing. |

**Plugin domain concepts** always use the compound form: **plugin-phase**, **plugin-workflow**.

## Mode Detection

Determine which mode to use based on the user's request:

| Mode | Trigger | Instruction File |
|------|---------|-----------------|
| **Update** | User asks to make a specific change | `modes/update.md` |
| **Deep Audit** | User asks to audit/review the plugin broadly | `modes/deep-audit.md` |
| **Schema Audit** | User asks to audit/simplify the database schema | `modes/schema-audit.md` |
| **MCP Server Audit** | User asks to audit/review the MCP server code | `modes/mcp-server-audit.md` |
| **Q&A** | User asks a question or is exploring | `modes/qa.md` |

If the mode is ambiguous, ask the user which mode they want.

**After detecting the mode, read the mode file AND any referenced workflow files before proceeding.**

## Shared Workflow Files

These are referenced by the mode files above:

| File | Purpose |
|------|---------|
| `workflows/producer-critic-loop.md` | The execution loop for all changes: producer → critic → commit |
| `workflows/findings-review.md` | The full review lifecycle: Findings Index → interactive review → dependency analysis → implementation plan → execution. **Contains the Canonical Persisted Report Structure.** |

## Agent Reference

| Agent | Role | Default Model | Purpose |
|-------|------|---------------|---------|
| `rigor_plugin_producer` | Producer | Adaptive (sonnet or opus) | Makes changes to plugin files |
| `rigor_consistency_critic` | Critic | Always `claude-opus-4.6` | Validates changes for correctness, consistency, ergonomics |
| `rigor_schema_critic` | Critic | Always `claude-opus-4.6` | Schema simplification, correctness, and consistency analysis (20 audit categories) |
| `rigor_mcp_server_critic` | Critic | Always `claude-opus-4.6` | MCP server code quality, correctness, protocol compliance, and documentation accuracy analysis (7 audit dimensions). Also serves as the critic in the producer-critic loop for MCP server changes. |

All agents have deep embedded knowledge of the plugin's file structure, cross-reference map, and conventions.

## Critical Rules

1. **Critic always uses Opus** — Catching subtle cross-reference bugs requires the strongest model.
2. **Schema critic always uses Opus** — All 4 audit groups must use `model: "claude-opus-4.6"` — no exceptions.
3. **MCP server critic always uses Opus** — Correctness auditing requires the strongest model — no exceptions.
4. **Producer defaults to Opus** — Only use Sonnet for obviously simple, single-file changes.
4. **Max 3 iterations** — After 3 producer-critic loops, escalate to the user.
5. **Critics are read-only** — They never modify files.
6. **Changes always go through the loop** — No direct edits bypass critique.
7. **Deep audits are standalone** — Critics run against the current state, not a diff.
8. **Audit findings go through the Findings Review workflow** — See `workflows/findings-review.md`.
9. **Decompose into smallest logical chunks** — Each producer call handles one atomic change.
10. **Commit frequently and minimally** — One commit per coherent sub-change. Each independently revertable.
11. **Report progress** — At the start of each work-unit, report done/in-progress/remaining counts.
12. **All audit outputs use the Findings Index format** — See `workflows/findings-review.md` for the canonical structure. **Do NOT improvise report formats.**
13. **Schema documentation divergence is blocking** — `schema.sql` is the source of truth. Mismatches in docs are blocking issues.
14. **INTERNALS.md divergence is blocking** — Source code is the ground truth. If INTERNALS.md makes claims that disagree with the actual code, INTERNALS.md must be updated. Never change code to match stale documentation.
15. **Read the instruction files** — Always read the relevant mode file and workflow files before executing. Do not rely on memory or summaries of their contents.
