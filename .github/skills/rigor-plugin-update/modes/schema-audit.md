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

## Step 3: Wait for All Agents and Consolidate

Wait for all launched agents to complete using `read_agent` with `wait: true`.

**⚠️ Do NOT delete the individual group reports.** They are preserved as the raw audit fragments.

Once ALL agents have completed, **you (the skill orchestrator) create the consolidated report** by:

1. Reading each agent group's **full persisted report** from `.scratch/rigor-schema-critic/<date>/` — do NOT rely on the agent result summaries returned by `read_agent`; you must read the actual files
2. **Deduplication via SQLite**: Query the audit database for prior decisions on schema findings:
   ```bash
   sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db "SELECT f.category, f.summary, d.decision, d.action, d.reason FROM finding f JOIN decision d ON d.finding_id = f.id WHERE f.critic = 'schema' ORDER BY d.decided_at DESC;"
   ```
   Match each new finding against prior decisions using `fingerprint` (structural match) or `summary` (fuzzy text match). Findings that match a prior decision should be pre-filled with that decision in the `Approved` column and marked with `(prior)`.
3. **Insert findings into the database**: For each finding in the consolidated report, insert a row:
   ```bash
   sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db "INSERT INTO finding (audit_run_id, critic, category, severity, summary, affected_entities, fingerprint, report_path) VALUES ('<run_id>', 'schema', '<category>', '<severity>', '<summary>', '<affected_json>', 'schema::<category>::<sorted_entities>', '<report_path>');"
   ```
4. Merging all findings into a single prioritized list ordered by impact (most tables/code eliminated, most critical bugs first)
5. Writing the consolidated report to `.scratch/rigor-schema-critic/<date>/<HHMMSS>_consolidated-audit.md`

**⚠️ MANDATORY: The consolidated report MUST use the exact Canonical Persisted Report Structure defined in `workflows/findings-review.md`. Do NOT invent your own format. The Findings Index table (with `#`, `Group`, `Severity`, `Approved`, `Finding` columns) MUST be the first content section after the header. If you find yourself writing a report without this table, STOP — you are doing it wrong.**

The consolidated report format:

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
- .scratch/rigor-schema-critic/<date>/<HHMMSS>_group-a-simplification.md
- .scratch/rigor-schema-critic/<date>/<HHMMSS>_group-b-correctness.md
- .scratch/rigor-schema-critic/<date>/<HHMMSS>_group-c-waste-consistency.md
- .scratch/rigor-schema-critic/<date>/<HHMMSS>_group-d-performance-hygiene.md
```

Note: The `Approved` column starts blank. The `Implementation Phasing` section is NOT included in the initial report — it is appended later during the shared workflow (Step D).

**Self-check before persisting the report:** Verify that (1) the `## Findings Index` section exists and contains a markdown table, (2) every finding from the group reports has a row, (3) prior decisions are marked with `(prior)`, and (4) the group detail sections follow the index. If any of these are missing, fix the report before writing it to disk.

## Step 4: Enter Findings Review & Implementation Workflow

After creating the consolidated report, enter the **Findings Review & Implementation Workflow** (see `workflows/findings-review.md`) starting at **Step B: Interactive Review** (the Findings Index is already built in Step 3 above).

The shared workflow handles: interactive approve/reject/skip review → dependency analysis → implementation plan (appended to the consolidated report) → execution with progress reporting.

If the user chooses to fix issues, each fix goes through the full **Producer-Critic Loop** (see `workflows/producer-critic-loop.md`). The schema critic identifies findings; the producer-critic loop implements fixes.
