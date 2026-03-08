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

Launch **6 agents simultaneously** (all `claude-opus-4.6`, all `mode: "background"`).

Each critic receives read-only access to `audit.db` so it can query prior decisions and skip already-decided findings:

```bash
sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db \
  "SELECT f.category, f.summary, d.decision, d.action, d.reason
   FROM finding f
   JOIN decision d ON d.finding_id = f.id
   WHERE f.critic = '<critic-name>'
   ORDER BY d.decided_at DESC;"
```

**Agent prompts:**

```
Agent 1 — Consistency Critic prompt:
Perform a full plugin-level audit of the rigorous-dev plugin. Review cross-reference consistency,
structural integrity, and developer ergonomics per your agent instructions.
Persist your report to .scratch/rigor-consistency-critic/<date>/<HHMMSS>_consistency-audit.md
where <date> is YYYY-MM-DD and <HHMMSS> is current time. The HHMMSS prefix is MANDATORY.

Agent 2 — Schema Critic Group A prompt:
Perform a schema audit of the rigorous-dev plugin. Focus ONLY on these categories:
- Category 1: Table Consolidation
- Category 2: Child Table Collapse
- Category 3: Foreign Key Enforcement
- Category 4: CHECK Constraint Audit
Persist results to .scratch/rigor-schema-critic/<date>/<HHMMSS>_group-a-simplification.md

Agent 3 — Schema Critic Group B prompt:
Perform a schema audit of the rigorous-dev plugin. Focus ONLY on these categories:
- Category 5: Schema Correctness
- Category 12: Nullable vs Required Alignment
- Category 13: Transaction Safety
- Category 14: Circular FK Dependencies
Persist results to .scratch/rigor-schema-critic/<date>/<HHMMSS>_group-b-correctness.md

Agent 4 — Schema Critic Group C prompt:
Perform a schema audit of the rigorous-dev plugin. Focus ONLY on these categories:
- Category 6: Redundant Tables
- Category 7: Orphaned Tables
- Category 8: Naming Consistency
- Category 9: Column Redundancy
Persist results to .scratch/rigor-schema-critic/<date>/<HHMMSS>_group-c-waste-consistency.md

Agent 5 — Schema Critic Group D prompt:
Perform a schema audit of the rigorous-dev plugin. Focus ONLY on these categories:
- Category 10: Index Coverage
- Category 11: Timestamp Consistency
- Category 15: Polymorphic References
- Category 16: Scope Leakage
- Category 17: Soft Delete vs Hard Delete
- Category 18: Data Type Precision
- Category 19: Documentation-Schema Drift
- Category 20: Unused Enum Values
Persist results to .scratch/rigor-schema-critic/<date>/<HHMMSS>_group-d-performance-hygiene.md

Agent 6 — MCP Server Critic prompt:
Perform a full 7-dimension MCP server audit of the rigorous-dev plugin: Correctness, Data Integrity,
Error Handling, Protocol Compliance, Patterns, Test Coverage, INTERNALS.md Accuracy.
Persist your report to .scratch/rigor-mcp-server-critic/<date>/<HHMMSS>_mcp-server-audit.md
where <date> is YYYY-MM-DD and <HHMMSS> is current time. The HHMMSS prefix is MANDATORY.
```

**⚠️ The `<HHMMSS>_` filename prefix is mandatory for ALL reports.** It enables multiple runs per day without overwriting. Reports without the timestamp prefix are malformed.

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
