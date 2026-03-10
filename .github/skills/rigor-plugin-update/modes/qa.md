# Mode 5: Q&A Audit Mode

Triggered when the user asks questions about the plugin or is exploring potential changes.

## Conversational Investigation

Answer the user's question by reading and analyzing the relevant plugin files. This is a conversational loop — continue answering follow-ups until the user is done or until changes are identified.

**Discovery Commands:** When answering questions, discover the current plugin state dynamically rather than assuming. Use these commands as needed:

| What | How |
|------|-----|
| Agent files | `ls plugins/rigorous-dev/agents/*.agent.md` |
| Command files | `ls plugins/rigorous-dev/commands/*.md` |
| MCP tool names | `grep -o 'name: "[a-z_]*"' plugins/rigorous-dev/mcp-server/write-tools.js plugins/rigorous-dev/mcp-server/read-tools.js` |
| Entity types | `grep -A 30 'const ENTITY_TABLE' plugins/rigorous-dev/mcp-server/read-tools.js` |
| Plugin-phases | `grep -A 15 'const PHASES' plugins/rigorous-dev/mcp-server/write-tools.js` |
| DB tables | `grep '^CREATE TABLE' plugins/rigorous-dev/mcp-server/schema.sql` |
| SKILL.md agent tables | `grep -A 20 'Producer Agent.*Critic Agent' plugins/rigorous-dev/skills/rigorous-dev/SKILL.md` |
| TEXT-PK entity tables | `grep -A 5 'TEXT_PK_TYPES' plugins/rigorous-dev/mcp-server/read-tools.js` |
| Full schema for a table | `grep -A 30 'CREATE TABLE <table_name>' plugins/rigorous-dev/mcp-server/schema.sql` |
| Table relationships | `grep 'REFERENCES' plugins/rigorous-dev/mcp-server/schema.sql` |
| MCP tool parameters | Read the relevant tool handler in `write-tools.js` or `read-tools.js` |
| Data model overview | Read the header block in `plugins/rigorous-dev/mcp-server/schema.sql` (design principles, domain map, new-entity checklist) |

**Key reference files for data model questions:**
- `plugins/rigorous-dev/mcp-server/schema.sql` — **Source of truth.** Full DDL with all tables, columns, constraints, foreign keys, and inline comments (`-- Domain:`, `-- Purpose:`, `-- Context:`). Also contains a header block with design principles, domain map (all 45 tables by domain), and a new-entity checklist.
- `plugins/rigorous-dev/mcp-server/write-tools.js` — Write tool handlers (shows what parameters each tool accepts and what it does)
- `plugins/rigorous-dev/mcp-server/read-tools.js` — Read tool handlers (shows query logic, entity type mappings, TEXT-PK types)
- `plugins/rigorous-dev/mcp-server/db.js` — Database initialization (WAL mode, foreign keys)

**Capabilities:**
- Trace cross-references: "What agents reference tool X?" → grep agent files for the tool name
- Check consistency: "Are there orphaned agents?" → diff `agents/` directory listing against SKILL.md tables
- Impact analysis: "What would I need to change to add a new plugin-phase?" → trace all files that would need updates
- Explain structure: "How does the implementation plugin-phase work?" → read SKILL.md section 8 and relevant agents
- Spot-check: "Is the README agent listing up to date?" → compare agents/ filenames with README content
- Data model questions: "What columns does the requirement table have?" → grep schema.sql for the CREATE TABLE
- Tool behavior: "What does changelog_insert do?" → read the handler in write-tools.js
- Entity relationships: "How do iterations relate to plugin-phases?" → read core.md and grep schema.sql for REFERENCES

#### Audit History Queries

When the user asks about audit history, findings, or decisions, query the SQLite database at `.scratch/rigor-plugin-update/audit.db`.

**Database schema:**
- `audit_run` — one row per audit session (id, mode, status, started_at, completed_at)
- `finding` — one row per finding (id, audit_run_id, critic, category, severity, summary, affected_entities, fingerprint)
- `decision` — one row per user decision (id, finding_id, decision, action, reason, supersedes, decided_at)

**All queries MUST use `sqlite3 -header -markdown` for clean output:**

Example translations:

| User Question | Query |
|---|---|
| "What did we reject last audit?" | `sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db "SELECT f.critic, f.category, f.summary, d.reason FROM decision d JOIN finding f ON d.finding_id = f.id WHERE d.decision = 'rejected' ORDER BY d.decided_at DESC;"` |
| "Show all critical findings" | `sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db "SELECT f.critic, f.category, f.summary FROM finding f WHERE f.severity = 'critical' ORDER BY f.created_at DESC;"` |
| "What's approved but not implemented?" | `sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db "SELECT f.critic, f.category, f.summary, d.action FROM finding f JOIN decision d ON d.finding_id = f.id WHERE d.decision = 'approved' AND d.implemented_at IS NULL ORDER BY f.severity;"` |
| "How many findings per critic?" | `sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db "SELECT f.critic, COUNT(*) as count FROM finding f WHERE f.audit_run_id = (SELECT id FROM audit_run ORDER BY started_at DESC LIMIT 1) GROUP BY f.critic;"` |

Translate the user's natural language question into an appropriate SQL query and present the results conversationally.

## Change Detection

While answering questions, track whether the investigation reveals issues that would benefit from changes:

- **No changes needed** — The answer is purely informational. Continue Q&A.
- **Single change identified** — Present the change to the user and offer to enter Update Mode (see `modes/update.md`) directly:

```
📋 Proposed Change

Based on this investigation, the following change would improve the plugin:

1. [Change description + rationale + affected files]

Complexity: [Simple | Moderate | Complex]

Would you like me to implement this change?
```

- **Multiple changes identified (2+)** — Present them as a numbered Findings Index inline (no persisted document) and offer to enter the shared workflow:

```
📋 Proposed Changes

Based on this investigation, the following changes would improve the plugin:

| # | Category | Severity | Finding |
|---|----------|----------|---------|
| 1 | [cat]    | [sev]    | [one-line summary + affected files] |
| 2 | [cat]    | [sev]    | [one-line summary + affected files] |

Would you like to review these interactively?
```

If the user agrees, enter the **Findings Review & Implementation Workflow** (see `workflows/findings-review.md`) at **Step B: Interactive Review** (the numbered table above serves as the Findings Index). The implementation plan is only generated when 3+ changes are approved; for 1-2 changes, skip it and go straight to execution.

## User Decision

Use ask_user to offer choices:
- **Yes, review interactively** → Enter the Findings Review & Implementation Workflow (Step B)
- **Yes, implement all** → Enter Update Mode (Step 1) with all proposed changes
- **No, continue Q&A** → Continue answering questions
- **Modify the proposal** → Let the user adjust, then re-evaluate

After changes are applied (or declined), return to Q&A mode. The conversation continues until the user is done.
