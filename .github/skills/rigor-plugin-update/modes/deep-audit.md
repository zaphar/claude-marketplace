# Mode 2: Deep Audit Mode

Triggered when the user asks for a full audit or analysis of the plugin's current state. This mode launches **all three** specialized critics in parallel, loads their findings into SQLite, deduplicates against prior decisions, and enters interactive review.

## Step 1: Bootstrap Audit Database

Initialize the audit database and create an audit run:

```bash
mkdir -p .scratch/rigor-plugin-update
sqlite3 .scratch/rigor-plugin-update/audit.db < .github/skills/rigor-plugin-update/audit-schema.sql
```

Create the run record:

```bash
sqlite3 .scratch/rigor-plugin-update/audit.db "INSERT INTO audit_run (id, mode) VALUES ('$(date +%Y%m%dT%H%M%S)_deep_audit', 'deep_audit');"
```

## Step 2: Launch All Critics in Parallel

Launch **6 agents simultaneously** (all `claude-opus-4.6`, all `mode: "background"`):

| # | Agent Type | Focus |
|---|-----------|-------|
| 1 | `rigor_consistency_critic` | Full plugin-level audit — cross-reference consistency, structural integrity, ergonomics |
| 2 | `rigor_schema_critic` (Group A) | Categories 1–4: Table Consolidation, Child Collapse, FK Enforcement, CHECK Constraints |
| 3 | `rigor_schema_critic` (Group B) | Categories 5, 12–14: Schema Correctness, Nullable Alignment, Transaction Safety, Circular FKs |
| 4 | `rigor_schema_critic` (Group C) | Categories 6–9: Redundant Tables, Orphaned Tables, Naming Consistency, Column Redundancy |
| 5 | `rigor_schema_critic` (Group D) | Categories 10–11, 15–20: Indexes, Timestamps, Polymorphic Refs, Scope Leakage, Deletion Patterns, Type Precision, Doc Drift, Unused Enums |
| 6 | `rigor_mcp_server_critic` | Full 7-dimension MCP audit — Correctness, Data Integrity, Error Handling, Protocol Compliance, Patterns, Test Coverage, INTERNALS.md Accuracy |

Each critic receives read-only access to `audit.db` so it can query prior decisions and skip already-decided findings:

```bash
sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db \
  "SELECT f.category, f.summary, d.decision, d.action, d.reason
   FROM finding f
   JOIN decision d ON d.finding_id = f.id
   WHERE f.critic = '<critic-name>'
   ORDER BY d.decided_at DESC;"
```

Critics write their raw markdown reports to `.scratch/<critic-name>/<date>/`.

## Step 3: Wait and Load into SQLite

Wait for all 6 agents to complete using `read_agent` with `wait: true`.

Read each critic's **full persisted report** from its `.scratch/` directory — do NOT rely on agent result summaries returned by `read_agent`; you must read the actual files. Parse all findings and INSERT them into the `finding` table with the current audit run ID. The database is the consolidated view — no separate consolidated markdown report is needed.

Present the loaded findings to the user:

```bash
sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db \
  "SELECT f.id, f.critic, f.category, f.severity, f.summary
   FROM finding f
   WHERE f.audit_run_id = '<run-id>'
   ORDER BY f.severity, f.critic;"
```

## Step 4: Deduplication

Query for prior decisions on the same fingerprints and auto-carry-forward:

```bash
sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db \
  "SELECT f.id, f.critic, f.category, f.summary, d.decision, d.reason
   FROM finding f
   JOIN finding prior ON f.fingerprint = prior.fingerprint AND prior.id != f.id
   JOIN decision d ON d.finding_id = prior.id
   WHERE f.audit_run_id = '<run-id>'
   ORDER BY d.decided_at DESC;"
```

For each match, INSERT a new decision row that carries forward the prior decision and links via `supersedes`:

- Prior `approved` → auto-approve with `supersedes` pointing at the prior decision
- Prior `rejected` → auto-reject with `supersedes` pointing at the prior decision
- Prior `skipped` → auto-skip with `supersedes` pointing at the prior decision

Present the deduplication summary to the user so they can see which findings were auto-resolved and override if needed.

## Step 5: Enter Findings Review

Enter the **Findings Review & Implementation Workflow** (see `workflows/findings-review.md`) starting at **Step B: Interactive Review**. The findings are queried from `audit.db` rather than read from a markdown table — use the `finding` table as the source of truth.

The shared workflow handles: interactive approve/reject/skip review → dependency analysis → implementation plan → execution with progress reporting. Decisions are INSERTed into the `decision` table in `audit.db`.

If the user chooses to fix issues, each fix goes through the full **Producer-Critic Loop** (see `workflows/producer-critic-loop.md`). Use the appropriate critic for validation — `rigor_schema_critic` for schema findings, `rigor_mcp_server_critic` for MCP server findings, and `rigor_consistency_critic` for consistency findings.
