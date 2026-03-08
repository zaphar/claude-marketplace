# Mode 5: MCP Server Audit Mode

Triggered when the user asks to audit, review, or analyze the MCP server code specifically (e.g., "audit the MCP server", "review mcp-server code quality", "check the MCP server for bugs").

## Step 1: Scope the Audit

Determine audit scope based on the user's request:

- **Full audit** — Run all 7 audit dimensions. Use when the user says "audit the MCP server", "full code audit", or doesn't specify dimensions.
- **Focused audit** — Run specific dimensions. Use when the user asks about a specific concern (e.g., "check for SQL injection" → Dimension 1, "are the tool schemas complete?" → Dimension 4, "what's the test coverage?" → Dimension 6, "is INTERNALS.md up to date?" → Dimension 7).

If scope is ambiguous, ask the user:

```
The MCP server auditor has 7 audit dimensions. Would you like me to run all of them, or focus on specific areas?
```

Offer choices via ask_user:
- **Full audit (all 7 dimensions)** — Correctness, Data Integrity, Error Handling, MCP Protocol Compliance, Patterns & Anti-Patterns, Test Coverage, INTERNALS.md Accuracy
- **Correctness only (Dimension 1)** — SQL injection, transaction safety, parameter binding, FK ordering, edge cases
- **Data Integrity only (Dimension 2)** — Entity type sync, TEXT_PK consistency, schema↔code column alignment, JSON round-trip safety
- **Protocol Compliance only (Dimension 4)** — SDK deprecation, tool schema completeness, response format, tool routing coverage
- **Test Coverage only (Dimension 6)** — Untested entity types, error paths, read paths, snapshot/history
- **INTERNALS.md Accuracy only (Dimension 7)** — Verify every claim in INTERNALS.md against actual source code, surface conflicts with fix recommendations
- **Let me specify** — User picks individual dimensions

## Step 2: Launch MCP Server Auditor

Launch the `rigor_mcp_server_auditor` agent (always `claude-opus-4.6`) with a scoped prompt.

**For a full audit:**

```
Perform a full audit of the rigorous-dev MCP server at plugins/rigorous-dev/mcp-server/.

Run all 7 audit dimensions — Correctness, Data Integrity & Consistency, Error Handling & Robustness,
MCP Protocol Compliance, Patterns & Anti-Patterns, Test Coverage Gaps, and INTERNALS.md Documentation
Accuracy — against the complete server codebase.

Start by reading INTERNALS.md, then run all discovery commands, then work through each dimension
systematically. Persist your report to .scratch/rigor-mcp-server-auditor/<date>/<HHMMSS>_mcp-server-audit.md
```

**For a focused audit:**

```
Perform a focused audit of the rigorous-dev MCP server at plugins/rigorous-dev/mcp-server/.

Run ONLY these audit dimensions:
- Dimension N: [name]
- Dimension M: [name]

Start by reading INTERNALS.md, then run all discovery commands, then work through the specified
dimensions systematically. Persist your report to .scratch/rigor-mcp-server-auditor/<date>/<HHMMSS>_mcp-server-audit.md
```

Always use `model: "claude-opus-4.6"` — no exceptions. Correctness auditing requires the strongest model.

## Step 3: Build Findings Index with Deduplication

After the auditor completes, read its **full persisted report** from `.scratch/rigor-mcp-server-auditor/<date>/` — do NOT rely on the agent result summary returned by `read_agent`; you must read the actual file.

**Deduplication against prior decisions:**

1. Check for a prior decisions ledger at `.scratch/rigor-mcp-server-auditor/audit-decisions.md`
2. If it exists, match each finding against prior decisions using:
   - **Structural fingerprint**: `dimension` + `file(s)` — same dimension and same affected files = likely same finding
   - **Fuzzy text match**: `summary` — similar one-line description = likely same finding
3. Pre-fill the `Approved` column for matches and mark with `(prior)`:
   - Prior `approved` → `✅ (prior)`
   - Prior `rejected` → `❌ (prior)`
   - Prior `skipped` → `⏭️ (prior)`

**Build the Findings Index:**

If the auditor's report does not already contain a properly formatted Findings Index (unlikely but possible), build one from the dimension detail sections:

1. Each finding gets a monotonically increasing `#` (starting at 1)
2. Order by impact: critical severity first, then high, then medium, then low, then info
3. Use the report's existing Findings Index if it's well-formed; supplement with deduplication markers

**⚠️ MANDATORY: The report MUST use the exact Canonical Persisted Report Structure defined in `workflows/findings-review.md`. The Findings Index table (with `#`, `Dimension`, `Severity`, `Approved`, `Finding` columns) MUST be the first content section after the header.**

Update the persisted report with deduplication markers if any prior decisions were found.

**Self-check before presenting to the user:** Verify that (1) the `## Findings Index` section exists and contains a markdown table, (2) every finding from the dimension sections has a row, (3) prior decisions are marked with `(prior)`, and (4) dimension detail sections follow the index. If any of these are missing, fix the report before proceeding.

## Step 4: Enter Findings Review & Implementation Workflow

After building the Findings Index, enter the **Findings Review & Implementation Workflow** (see `workflows/findings-review.md`) starting at **Step B: Interactive Review** (the Findings Index was already built in Step 3).

The shared workflow handles: interactive approve/reject/skip review → dependency analysis → implementation plan (appended to the report only if 3+ fixes are approved) → execution with progress reporting.

**Test suggestions during interactive review:** When presenting a `critical` or `high` severity finding that includes a `**Test suggestion:**` field, highlight it to the user after showing the finding context. Use ask_user with choices:
- **Approve fix + add suggested test** — The implementation will include both the code fix and the new test
- **Approve fix only** — Fix the code but skip the test
- **Reject**
- **Skip**
- **Expand (tell me more)**

When the user approves a test addition, include it as part of the work-unit for that finding during implementation. The producer should add the test to the appropriate existing test file (never create new test files unless no suitable one exists).

**Decisions ledger path:** `.scratch/rigor-mcp-server-auditor/audit-decisions.md`

After interactive review completes, the findings-review workflow creates or updates the decisions ledger at this path. Each decision gets a ledger entry with: date, dimension, file(s), summary, decision, and action/reason. The ledger enables deduplication on future audits — findings that were already reviewed won't be re-presented unless the user overrides.

**Ledger entry format for this mode:**

```markdown
### D[N]
- **Date:** [date]
- **Dimension:** [N] ([name])
- **File(s):** [affected files]
- **Summary:** [one-line finding]
- **Decision:** approved | rejected | skipped
- **Action:** [what was done] | **Reason:** [why rejected/skipped]
```

If the user chooses to fix issues, each fix goes through the full **Producer-Critic Loop** (see `workflows/producer-critic-loop.md`). Use the `rigor_plugin_producer` for code changes (it has knowledge of the MCP server architecture) and the `rigor_mcp_server_auditor` as the critic for validation — it has specialized knowledge of SQL correctness, MCP protocol compliance, and the server's patterns that the generic `rigor_plugin_critic` lacks.
