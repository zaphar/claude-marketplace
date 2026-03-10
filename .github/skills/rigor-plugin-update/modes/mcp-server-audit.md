# Mode 4: MCP Server Audit Mode

Triggered when the user asks to audit, review, or analyze the MCP server code specifically (e.g., "audit the MCP server", "review mcp-server code quality", "check the MCP server for bugs").

## Step 1: Scope the Audit

Determine audit scope based on the user's request:

- **Full audit** — Run all 7 audit dimensions. Use when the user says "audit the MCP server", "full code audit", or doesn't specify dimensions.
- **Focused audit** — Run specific dimensions. Use when the user asks about a specific concern (e.g., "check for SQL injection" → Dimension 1, "are the tool schemas complete?" → Dimension 4, "what's the test coverage?" → Dimension 6, "is the schema header accurate?" → Dimension 7).

If scope is ambiguous, ask the user:

```
The MCP server critic has 7 audit dimensions. Would you like me to run all of them, or focus on specific areas?
```

Offer choices via ask_user:
- **Full audit (all 7 dimensions)** — Correctness, Data Integrity, Error Handling, MCP Protocol Compliance, Patterns & Anti-Patterns, Test Coverage, Schema Header Accuracy
- **Correctness only (Dimension 1)** — SQL injection, transaction safety, parameter binding, FK ordering, edge cases
- **Data Integrity only (Dimension 2)** — Entity type sync, TEXT_PK consistency, schema↔code column alignment, JSON round-trip safety
- **Protocol Compliance only (Dimension 4)** — SDK deprecation, tool schema completeness, response format, tool routing coverage
- **Test Coverage only (Dimension 6)** — Untested entity types, error paths, read paths, snapshot/history
- **Schema Header Accuracy only (Dimension 7)** — Verify every claim in schema.sql header against actual source code, surface conflicts with fix recommendations
- **Let me specify** — User picks individual dimensions

## Step 2: Bootstrap Audit Database

Initialize the audit database and create an audit run:

```bash
mkdir -p .scratch/rigor-plugin-update
sqlite3 .scratch/rigor-plugin-update/audit.db < .github/skills/rigor-plugin-update/audit-schema.sql
```

Create the run record:

```bash
sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db \
  "INSERT INTO audit_run (id, mode) VALUES ('<timestamp>_mcp_server_audit', 'mcp_server_audit');"
```

## Step 3: Launch MCP Server Critic

Launch the `rigor_mcp_server_critic` agent (always `claude-opus-4.6`) with a scoped prompt.

**For a full audit:**

```
Perform a full audit of the rigor MCP server at plugins/rigor/mcp-server/.

Run all 7 audit dimensions — Correctness, Data Integrity & Consistency, Error Handling & Robustness,
MCP Protocol Compliance, Patterns & Anti-Patterns, Test Coverage Gaps, and Schema Header Documentation
Accuracy — against the complete server codebase.

Start by reading the schema.sql header, then run all discovery commands, then work through each dimension
systematically. Persist your report to .scratch/rigor-mcp-server-critic/<date>/<HHMMSS>_mcp-server-audit.md
```

**For a focused audit:**

```
Perform a focused audit of the rigor MCP server at plugins/rigor/mcp-server/.

Run ONLY these audit dimensions:
- Dimension N: [name]
- Dimension M: [name]

Start by reading the schema.sql header, then run all discovery commands, then work through the specified
dimensions systematically. Persist your report to .scratch/rigor-mcp-server-critic/<date>/<HHMMSS>_mcp-server-audit.md
```

Always use `model: "claude-opus-4.6"` — no exceptions. Correctness auditing requires the strongest model.

## Step 4: Consolidate Findings

After the critic completes, collect the persisted report path from its output — the `.scratch/rigor-mcp-server-critic/<date>/` path it was told to write to. Do NOT read the report yourself.

Launch the `rigor_audit_consolidator` agent (`claude-opus-4.6`, `mode: "sync"`) with:
- `audit_run_id`: the run ID created in Step 2
- `mode`: `mcp_server_audit`
- `report_paths`: the single MCP server critic report path, labeled with critic name `mcp_server`
- `db_path`: `.scratch/rigor-plugin-update/audit.db`

The consolidation agent reads the report, parses findings, deduplicates against prior decisions, and inserts everything into `audit.db`. See the agent definition for the full procedure.

After the agent completes, query the database for the findings index and present it to the user:

```bash
sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db \
  "SELECT f.id, f.category, f.severity, f.summary,
          COALESCE(d.decision, '') as prior_decision
   FROM finding f
   LEFT JOIN decision d ON d.finding_id = f.id
   WHERE f.audit_run_id = '<run-id>'
   ORDER BY
     CASE f.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'low' THEN 4 ELSE 5 END,
     f.category;"
```

## Step 5: Enter Findings Review & Implementation Workflow

Enter the **Findings Review & Implementation Workflow** (see `workflows/findings-review.md`) starting at **Step B: Interactive Review** (the Findings Index is already loaded in the database from Step 4).

The shared workflow handles: interactive approve/reject/skip review → dependency analysis → implementation plan (appended to the report only if 3+ fixes are approved) → execution with progress reporting.

**Test suggestions during interactive review:** When presenting a `critical` or `high` severity finding that includes a `**Test suggestion:**` field, highlight it to the user after showing the finding context. Use ask_user with choices:
- **Approve fix + add suggested test** — The implementation will include both the code fix and the new test
- **Approve fix only** — Fix the code but skip the test
- **Reject**
- **Skip**
- **Expand (tell me more)**

When the user approves a test addition, include it as part of the work-unit for that finding during implementation. The producer should add the test to the appropriate existing test file (never create new test files unless no suitable one exists).

If the user chooses to fix issues, each fix goes through the full **Producer-Critic Loop** (see `workflows/producer-critic-loop.md`). Use the `rigor_plugin_producer` for code changes (it has knowledge of the MCP server architecture) and the `rigor_mcp_server_critic` as the critic for validation — it has specialized knowledge of SQL correctness, MCP protocol compliance, and the server's patterns that the generic `rigor_consistency_critic` lacks.
