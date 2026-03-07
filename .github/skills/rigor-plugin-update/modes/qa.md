# Mode 4: Q&A Audit Mode

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

**Capabilities:**
- Trace cross-references: "What agents reference tool X?" → grep agent files for the tool name
- Check consistency: "Are there orphaned agents?" → diff `agents/` directory listing against SKILL.md tables
- Impact analysis: "What would I need to change to add a new plugin-phase?" → trace all files that would need updates
- Explain structure: "How does the implementation plugin-phase work?" → read SKILL.md section 8 and relevant agents
- Spot-check: "Is the README agent listing up to date?" → compare agents/ filenames with README content
- Data model questions: "What columns does the requirement table have?" → grep schema.sql for the CREATE TABLE
- Tool behavior: "What does changelog_insert do?" → read the handler in write-tools.js
- Entity relationships: "How do iterations relate to plugin-phases?" → read core.md and grep schema.sql for REFERENCES

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
