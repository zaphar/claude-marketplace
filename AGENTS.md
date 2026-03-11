# AGENTS.md — Guidance for AI Coding Agents

This file documents conventions and invariants in this repository that AI agents should know before modifying code.

## Repository Structure

```
claude-zaphar/
├── plugins/
│   ├── rigor/      # SDLC workflow plugin (producer-critic, MCP-backed)
│   └── jj/         # Jujutsu VCS helper plugin
└── AGENTS.md       # This file
```

---

## Rigor Plugin — Critical Invariants

### 1. Dual MCP Tool Naming in Agent Frontmatter

**Do not "fix" or deduplicate MCP tool names in agent frontmatter.**

Every agent in `plugins/rigor/agents/*.agent.md` lists each MCP tool **twice** — once in each naming convention:

```yaml
tools: Read, Grep, Glob, Bash, Edit, Write,
       mcp__rigor-db__changelog_query, rigor-db/changelog_query,
       mcp__rigor-db__changelog_insert, rigor-db/changelog_insert
```

| Format | Used by | Example |
|--------|---------|---------|
| `mcp__<server>__<tool>` | Claude Code | `mcp__rigor-db__changelog_query` |
| `<server>/<tool>` | GitHub Copilot CLI | `rigor-db/changelog_query` |

This is **intentional cross-platform compatibility**. The plugin targets both Claude Code and GitHub Copilot CLI. Each platform only recognizes its own format and silently ignores the other — so both must be present for the plugin to work on both platforms.

**When adding a new MCP tool to an agent, always add both forms.**

### 2. Critics Always Include `changelog_update`

Every critic agent must have `changelog_update` (in both naming formats). This is the tool critics use to record revision decisions (approved/rejected) in the database.

**Pattern:** All `*_critic.agent.md` files must include:
```yaml
mcp__rigor-db__changelog_update, rigor-db/changelog_update
```

Producer agents generally do **not** need `changelog_update` — that is a critic responsibility.

### 3. Orchestrator Tools vs Agent Tools

The workflow orchestrator (`plugins/rigor/skills/workflow/SKILL.md`) uses a set of **state management tools** that are NOT listed in any individual agent's frontmatter:

| Orchestrator-only tools |
|-------------------------|
| `iteration_create` |
| `phase_transition` |
| `work_item_transition` |
| `revision_create` |
| `revision_update` |
| `project_update` |
| `blocker_resolve` |
| `iteration_close` |
| `project_status` |
| `revision_history` |
| `iteration_summary` |

Individual agents only access the data-plane tools (`changelog_query`, `changelog_insert`, `changelog_update`, `traceability_query`, `commit_link`). Do not add orchestrator tools to agent frontmatter — agents have no business calling `phase_transition` or `iteration_create`.

### 4. Intentionally Read-Only Producers

`security_auditor.agent.md` and `performance_auditor.agent.md` do **not** have `Edit` or `Write` in their tools. This is intentional: audit findings go to the database only, not to files. Do not add file-editing tools to these agents.

### 5. `test_writer` and `documentation_master` — No `changelog_insert`

`test_writer.agent.md` and `documentation_master.agent.md` have `changelog_query` but not `changelog_insert`. This is intentional: their artifacts (test files, documentation files) are written directly to the filesystem and committed to VCS, not stored as DB entries. Their respective critics handle any DB recording.

---

## Adding a New Agent

When creating a new agent:

1. Place the file at `plugins/rigor/agents/<name>.agent.md`
2. For MCP tools, always add both naming conventions (see invariant #1)
3. If it is a critic, include `changelog_update` in both formats (see invariant #2)
4. Do not add orchestrator-only tools (see invariant #3)
5. Update `plugins/rigor/README.md` to document the new agent

## Modifying the MCP Server

The MCP server is at `plugins/rigor/mcp-server/`. When adding a new tool:

1. Add the tool definition to `write-tools.js` (WRITE_TOOLS array) or `read-tools.js` (READ_TOOLS array)
2. Add it to any agent frontmatter that needs it — **in both naming formats**
3. Update `schema.sql` if the tool requires new tables or columns
