# Mode 3: Schema Audit Mode

Triggered when the user asks to audit, simplify, or analyze the database schema specifically.

## Step 1: Scope the Audit

Determine audit scope based on the user's request:

- **Full audit** — Run all 20 audit categories across 4 parallel agent groups. Use when the user says "audit the schema", "full schema audit", or doesn't specify categories.
- **Focused audit** — Run specific category groups. Use when the user asks about a specific concern (e.g., "find tables to consolidate" → Group A, "check FK enforcement" → Group A, "find correctness bugs" → Group B).

If scope is ambiguous, ask the user:

```
The schema critic has 20 audit categories across 4 agent groups. Would you like me to run all of them, or focus on specific areas?
```

Offer choices via ask_user:
- **Full audit (all 20 categories)** — Comprehensive analysis across 4 parallel agents
- **Simplification only (Group A: categories 1-4)** — Table consolidation, child collapse, FK enforcement, CHECK constraints
- **Correctness only (Group B: categories 5, 12-14)** — Structural bugs, nullability, transactions, circular FKs
- **Waste & Consistency (Group C: categories 6-9)** — Redundant tables, orphans, naming, column redundancy
- **Performance & Hygiene (Group D: categories 10-11, 15-20)** — Indexes, timestamps, polymorphic refs, scope leakage, deletion patterns, type precision, doc drift, unused enums
- **Let me specify** — User picks individual categories

## Step 2: Bootstrap Database & Launch Schema Critic Agents in Parallel

Before launching agents, ensure the audit database exists:

```bash
mkdir -p .scratch/rigor-plugin-update
sqlite3 .scratch/rigor-plugin-update/audit.db < .github/skills/rigor-plugin-update/audit-schema.sql
```

Create an audit run for this session:

```bash
sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db "INSERT INTO audit_run (id, mode, status) VALUES ('<date>T<HHMMSS>_schema_audit', 'schema_audit', 'running');"
```

The 20 audit categories are split across 4 agent groups that run in parallel. Each agent group uses the `rigor_schema_critic` agent (always `claude-opus-4.6`) with a scoped prompt.

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
Produce your findings in the standard audit report format. Persist results to .scratch/rigor-schema-critic/<date>/<HHMMSS>_group-a-simplification.md

Agent B prompt:
Perform a schema audit of the rigorous-dev plugin. Focus ONLY on these categories:
- Category 5: Schema Correctness
- Category 12: Nullable vs Required Alignment
- Category 13: Transaction Safety
- Category 14: Circular FK Dependencies
Produce your findings in the standard audit report format. Persist results to .scratch/rigor-schema-critic/<date>/<HHMMSS>_group-b-correctness.md

Agent C prompt:
Perform a schema audit of the rigorous-dev plugin. Focus ONLY on these categories:
- Category 6: Redundant Tables
- Category 7: Orphaned Tables
- Category 8: Naming Consistency
- Category 9: Column Redundancy
Produce your findings in the standard audit report format. Persist results to .scratch/rigor-schema-critic/<date>/<HHMMSS>_group-c-waste-consistency.md

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
Produce your findings in the standard audit report format. Persist results to .scratch/rigor-schema-critic/<date>/<HHMMSS>_group-d-performance-hygiene.md
```

**For a focused audit**, launch only the relevant agent group(s).

## Step 3: Wait for Critics

Wait for all launched agents to complete using `read_agent` with `wait: true`.

**⚠️ Do NOT delete the individual group reports.** They are preserved as the raw audit fragments.

Collect the persisted report paths from each agent's output — these are the `.scratch/rigor-schema-critic/<date>/` paths each group was told to write to. Do NOT read the reports yourself.

## Step 4: Consolidate Findings

Launch the `rigor_audit_consolidator` agent (`claude-opus-4.6`, `mode: "sync"`) with:
- `audit_run_id`: the run ID created in Step 2
- `mode`: `schema_audit`
- `report_paths`: the group report file paths (up to 4), each labeled with critic name `schema`
- `db_path`: `.scratch/rigor-plugin-update/audit.db`

The consolidation agent reads all group reports, parses findings, deduplicates against prior decisions, inserts everything into `audit.db`, and writes the consolidated report to `.scratch/rigor-schema-critic/<date>/<HHMMSS>_consolidated-audit.md`. See the agent definition for the full procedure and canonical report format.

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

Note: The `Implementation Phasing` section is NOT included in the initial consolidated report — it is appended later during the shared workflow (Step D).

## Step 5: Enter Findings Review & Implementation Workflow

Enter the **Findings Review & Implementation Workflow** (see `workflows/findings-review.md`) starting at **Step B: Interactive Review** (the Findings Index is already loaded in the database from Step 4).

The shared workflow handles: interactive approve/reject/skip review → dependency analysis → implementation plan (appended to the consolidated report only if 3+ fixes are approved) → execution with progress reporting.

If the user chooses to fix issues, each fix goes through the full **Producer-Critic Loop** (see `workflows/producer-critic-loop.md`). The schema critic identifies findings; the producer-critic loop implements fixes.
