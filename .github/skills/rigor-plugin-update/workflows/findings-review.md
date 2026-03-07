# Findings Review & Implementation Workflow

This shared workflow is used by any mode that produces multiple findings (Schema Audit, Deep Audit, Q&A when 2+ changes surface). It covers the full lifecycle from findings presentation through implementation.

**Document scope varies by mode:**
- **Update Mode** — NO persisted report. The workflow applies when a change request is decomposed into multiple work-units. Phasing and progress are tracked in-conversation. Single changes go straight through the Producer-Critic Loop without this workflow.
- **Schema Audit Mode** — always creates a persisted consolidated report in `.scratch/`. The findings index, decisions, and implementation plan are all recorded in that document.
- **Deep Audit Mode** — the critic already creates a persisted report in `.scratch/`. The orchestrator adds a findings index table to that existing report. The implementation plan is only appended if the user approves 3+ fixes.
- **Q&A Mode** — NO persisted document. Findings are presented inline in the conversation. The conversation itself is the record.

## Canonical Persisted Report Structure

**⚠️ This is the authoritative format for all persisted audit reports. Every mode that produces a persisted report MUST follow this structure exactly. Do NOT invent alternative formats.**

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
- **⚠️ Findings Index is the first content section** — always at the top after header metadata. This is non-negotiable. Every finding from every group report must appear as a row in this table.
- The `#` column uses monotonically increasing integers — stable identifiers for referring to issues (e.g., "issue 5")
- The `Approved` column starts blank and gets filled with ✅/❌/⏭️ during interactive review. Pre-fill with prior decisions marked `(prior)` if a decisions ledger exists.
- Findings are ordered by impact (most critical / highest elimination first)
- Group detail sections preserve the full analysis from each auditor/critic agent
- **Implementation Phasing is appended later** — it is NOT part of the initial report; it gets added after Step D below
- Each phase table includes the original `#` issue numbers for traceability

**Self-check before persisting the report:** Verify that (1) the `## Findings Index` section exists and contains a markdown table, (2) every finding from the group reports has a row, (3) prior decisions are marked with `(prior)`, and (4) the group detail sections follow the index. If any of these are missing, fix the report before writing it to disk.

## Step A: Build Findings Index

**⚠️ This is the most critical step. The Findings Index IS the consolidated report's primary value. Do NOT skip or improvise this.**

- Collect all findings from agent reports (or investigation results). Read each group report in full — do not rely on agent result summaries alone.
- **Deduplication**: Before building the index, check for a prior decisions ledger at `.scratch/<auditor-name>/audit-decisions.md`. If it exists, match each finding against prior decisions using `category` + `tables` (structural fingerprint) or `summary` (fuzzy text match). Findings that match a prior decision should be pre-filled with that decision in the `Approved` column and marked with `(prior)` so the user can see they were already decided. The user can override any prior decision during interactive review.
- Assign monotonically increasing `#` starting at 1
- Build the findings table with columns: `#`, `Group`/`Category`, `Severity`, `Finding` (one-line summary), `Approved` (blank, or pre-filled from prior decisions)
- Order by impact: critical bugs first, then high-elimination changes, then medium, then low
- For persisted modes: write the full report (header + Findings Index + group details) to the report file
- For Q&A mode: present the numbered table inline in conversation

## Step B: Interactive Review

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

## Step C: Dependency Analysis

- After review, analyze dependencies between **approved** issues only
- Identify ordering constraints (e.g., "rename column before adding UNIQUE on it", "merge tables before adding indexes", "collapse child tables before adding CASCADE FKs")
- For persisted modes: record dependencies in the report
- Present dependency summary to user: which issues block which, and why

## Step D: Implementation Phasing

- Generate the implementation plan from approved issues + dependency graph:
  - **Phase 1**: No dependencies (can execute in any order)
  - **Phase 2**: Depends on Phase 1 items
  - **Phase N**: Depends on prior phases
- Each phase has work-units; each issue produces one or more work-units (trivially similar issues may be batched into one)
- Each work-unit shows original issue `#` numbers for traceability
- For persisted modes: append "Implementation Phasing" section to the report
- For Q&A mode: present the implementation plan in-conversation (only if 3+ approved changes warrant it; for 1-2 changes, skip directly to execution)
- Present implementation plan to user for confirmation before starting implementation

## Step E: Implementation Execution

Execute work-units in phase order using the **Producer-Critic Loop** (see `workflows/producer-critic-loop.md`).

- Each work-unit decomposes into the smallest logical producer tasks possible
- Use 1:1 (single producer → critic) for standalone changes; use N:1 (N sequential producers → 1 critic) when multiple small tasks are parts of one logical change
- Track and report progress at the start of each work-unit:
  ```
  📊 Progress: X/Y issues done | Z in progress | W remaining
  Current: WU-N — [description] (Issues #A, #B)
  ```
- For persisted modes: update the report as issues complete (mark steps done)
- **Commit frequently and minimally** — commit as fine-grained as possible, at minimum after each issue completes but preferably after each coherent sub-change. Each commit should be independently understandable and revertable.
