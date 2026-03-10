# Rigor Plugin — Copilot CLI Compatibility Audit

**Date:** 2026-03-10
**Plugin:** `plugins/rigor/` (v0.11.0)
**Target:** GitHub Copilot CLI plugin system

## Summary

The rigor plugin was originally built for Claude Code. This audit verifies compatibility with GitHub Copilot CLI by cross-referencing the plugin's structure, agents, MCP config, and skill against the official Copilot documentation.

**Overall verdict:** The plugin is ~90% compatible out of the box thanks to Copilot's extensive Claude compatibility layer. Two functional risks remain that require live testing.

---

## ✅ Already Compatible (confirmed by official docs)

### Plugin Manifest & Discovery

| Component | Status | Evidence |
|-----------|--------|----------|
| **Manifest location** (`.claude-plugin/plugin.json`) | ✅ Works | Copilot explicitly searches `.claude-plugin/plugin.json` ([CLI plugin reference — File locations](https://docs.github.com/en/copilot/reference/cli-plugin-reference)) |
| **`agents/` auto-discovery** | ✅ Works | Default is `agents/` when omitted from `plugin.json` — all 20 agents will load |
| **`skills/` auto-discovery** | ✅ Works | Default is `skills/` when omitted — the `workflow` skill will load |
| **`.mcp.json` auto-discovery** | ✅ Works | Copilot looks for `.mcp.json` at plugin root by convention ([CLI plugin reference — File locations](https://docs.github.com/en/copilot/reference/cli-plugin-reference)) |

**Source:** The plugin reference documents defaults for component path fields:
> `agents` — Default: `agents/` — Path(s) to agent directories (`.agent.md` files).
> `skills` — Default: `skills/` — Path(s) to skill directories (`SKILL.md` files).
> MCP config — `.mcp.json` or `.github/mcp.json`

This means the current `plugin.json` (which lacks explicit `agents`, `skills`, and `mcpServers` fields) will still work — Copilot auto-discovers them at the default paths.

### Agent Frontmatter

| Component | Status | Evidence |
|-----------|--------|----------|
| **YAML schema** (`name`, `description`, `tools`) | ✅ Identical | [Custom agents configuration reference](https://docs.github.com/en/copilot/reference/custom-agents-configuration) |
| **Built-in tool names** | ✅ All mapped | See alias table below |

Copilot documents the following tool alias mappings ([Custom agents configuration — Tool aliases](https://docs.github.com/en/copilot/reference/custom-agents-configuration#tool-aliases)):

| Claude tool name | Copilot alias group | Maps to |
|------------------|--------------------|---------| 
| `Read` | `Read`, `NotebookRead` | `view` |
| `Edit` | `Edit`, `MultiEdit`, `Write`, `NotebookEdit` | edit tools (e.g. `str_replace`) |
| `Write` | (same group as Edit) | edit tools |
| `Bash` | `shell`, `Bash`, `powershell` | shell execution |
| `Grep` | `Grep`, `Glob` | `search` |
| `Glob` | (same group as Grep) | `search` |

All six built-in tool names used across the 20 rigor agents (`Read`, `Grep`, `Glob`, `Bash`, `Edit`, `Write`) are explicitly listed as compatible aliases.

### MCP Server Code

| Component | Status | Evidence |
|-----------|--------|----------|
| **MCP SDK** (`@modelcontextprotocol/sdk` v1.12.1) | ✅ Standard | Uses the official MCP SDK with stdio transport — fully portable |
| **`stdio` type** | ✅ Auto-mapped | Copilot docs: "the `stdio` type used by Claude Code and VS Code is mapped to coding agent's `local` type" ([Custom agents configuration — MCP server type](https://docs.github.com/en/copilot/reference/custom-agents-configuration#mcp-server-type)) |
| **Server implementation** | ✅ Portable | Pure Node.js, `better-sqlite3`, standard `ListToolsRequestSchema` / `CallToolRequestSchema` handlers |

### Skill Format

| Component | Status | Evidence |
|-----------|--------|----------|
| **`SKILL.md` structure** | ✅ Identical | YAML frontmatter (`name`, `description`) + markdown body — same format ([Creating agent skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills)) |
| **Skill directory convention** | ✅ Works | `skills/workflow/SKILL.md` follows the required pattern |

### Subagent MCP Access

| Component | Status | Evidence |
|-----------|--------|----------|
| **Subagents inherit session tools** | ✅ Confirmed | VS Code docs: "Subagents use the same tools and AI model as the main session" ([Custom agents in VS Code — Using subagents](https://code.visualstudio.com/docs/copilot/customization/custom-agents)). GitHub docs: "Your custom agent will have access to MCP server tools that have been configured in both its agent profile and/or the repository settings" ([Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration)). |
| **`tools:` acts as allowlist** | ⚠️ Gated by Risk 2 | VS Code docs: "tools: A list of tool or tool set names that are available for this custom agent" and "If a given tool is not available when using the custom agent, it is ignored" ([Agent tools in VS Code](https://code.visualstudio.com/docs/copilot/agents/agent-tools)). GitHub docs: "The `tools` list filters the set of tools that are made available to the agent" and "A specific list (`tools: [...]`) enables only those tools" ([Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration#tools-processing)). MCP tools must be **explicitly listed** in the agent's `tools:` frontmatter to be accessible. |
| **MCP tool naming format** | ⚠️ Gated by Risk 2 | GitHub docs: "Tool names from specific MCP servers can be prefixed with the server name followed by a `/`. For example, `some-mcp-server/some-tool`" and "You can also explicitly enable all tools from a specific MCP server using `some-mcp-server/*`" ([Custom agents configuration — Tools](https://docs.github.com/en/copilot/reference/custom-agents-configuration#tools)). The Claude `mcp__server__tool` format is **not listed** in the tool aliases table — only built-in tools have Claude→Copilot mappings. "All unrecognized tool names are ignored." |

Plugin-level MCP servers (from `.mcp.json`) are loaded at the session level. Subagents share the session's tool set — they get their own context window but inherit all available tools. **However**, the `tools:` frontmatter acts as an allowlist: only tools explicitly listed are available to the agent. If an MCP tool isn't listed, it's not accessible even though the server is running.

The rigor agents DO list their MCP tools — but using the Claude `mcp__rigor-db__*` format. The VS Code docs show the Copilot format is `<server-name>/*` or `<server-name>/tool_name`. If Copilot doesn't recognize the Claude naming format, the MCP tool entries are silently ignored per the docs ("If a given tool is not available... it is ignored"), effectively leaving the agents with **no MCP access**. This makes subagent MCP access fully dependent on **Risk 2** below.

### Data Storage

| Component | Status | Evidence |
|-----------|--------|----------|
| **`.claude/rigor.db` path** | ✅ Non-issue | This is a data directory the plugin creates at runtime — not a Copilot config path. The `db.js` code creates `.claude/` via `mkdirSync` if it doesn't exist. Works on any system. |
| **`.claude/rigor-artifacts`** | ✅ Non-issue | Same rationale — just a data directory. Commands offer to use alternative paths for version control. |

---

## ⚠️ Two Functional Risks Requiring Live Testing

### Risk 1: `${CLAUDE_PLUGIN_ROOT}` Environment Variable

**File:** `plugins/rigor/.mcp.json`

```json
{
  "rigor-db": {
    "command": "bash",
    "args": [
      "-c",
      "cd \"${CLAUDE_PLUGIN_ROOT}/mcp-server\" && npm install --silent --prefer-offline 2>/dev/null; exec node server.js"
    ]
  }
}
```

**Issue:** `CLAUDE_PLUGIN_ROOT` is a Claude Code environment variable that resolves to the plugin's installation directory. Copilot's documented environment variables ([CLI command reference — Environment variables](https://docs.github.com/en/copilot/reference/cli-command-reference)) include `COPILOT_HOME`, `COPILOT_MODEL`, etc. — but do **not** document `CLAUDE_PLUGIN_ROOT` or an equivalent.

**However:** Copilot has extensive Claude compatibility:
- Searches `.claude-plugin/` for manifests
- Searches `.claude/agents/` and `.claude/skills/` for components
- Maps `stdio` to `local` MCP type
- Supports Claude Code env var syntax `${VAR}` in MCP configs

Given this pattern, Copilot *likely* maps `CLAUDE_PLUGIN_ROOT` — but this is not documented and must be tested.

**Impact if broken:** The MCP server cannot start → all 20 agents lose database access → the entire workflow is non-functional.

**Severity:** Critical (but likely already handled by compat layer)

**Test:** Install the plugin via `copilot plugin install` and run `/mcp show` to check if the `rigor-db` server starts.

**Fix if broken:** Replace the env var dependency with a self-resolving wrapper script. Three options in order of preference:

**Option A — Wrapper script (recommended):**

Create `plugins/rigor/start-mcp.sh`:
```bash
#!/bin/bash
cd "$(dirname "$0")/mcp-server" && npm install --silent --prefer-offline 2>/dev/null
exec node server.js
```

Update `.mcp.json`:
```json
{ "rigor-db": { "command": "./start-mcp.sh" } }
```

`dirname "$0"` resolves to the script's own location — works on any host with no env var dependency.

The wrapper script is fully self-resolving with zero dependency on the host providing any specific env var or cwd.

### Risk 2: MCP Tool Naming Convention in Agent `tools:` Frontmatter

**Files:** All 20 files in `plugins/rigor/agents/*.agent.md`

**Current format (Claude convention):**
```yaml
tools: Read, Grep, Glob, Bash, Edit, Write, mcp__rigor-db__changelog_query, mcp__rigor-db__changelog_insert
```

**Copilot's documented format:**
```yaml
tools: ["read", "edit", "search", "rigor-db/changelog_query"]
```

Copilot uses `server-name/tool-name` notation (e.g., `github/list_issues`, `playwright/browser_navigate`) as documented in [Custom agents configuration — Tools](https://docs.github.com/en/copilot/reference/custom-agents-configuration#tools).

**Key concern from docs:**
> "All unrecognized tool names are ignored, which allows product-specific tools to be specified in an agent profile without causing problems."

This means if Copilot doesn't recognize `mcp__rigor-db__changelog_query`, it will **silently ignore** these tool entries. The agents would load and have access to `Read`, `Grep`, etc. — but would **not** be granted access to the MCP tools.

**However:** The `mcp__` naming is so fundamental to Claude Code's ecosystem that Copilot may support it as part of their compatibility layer. This is not documented either way.

**Impact if broken:** Agents load but cannot call MCP tools → no database reads/writes → workflow state management fails silently.

**Severity:** Critical (but agents would still function for non-DB tasks)

**Tools affected across all 20 agents:**
- `mcp__rigor-db__changelog_query` (20 agents)
- `mcp__rigor-db__changelog_insert` (16 agents)
- `mcp__rigor-db__changelog_update` (10 agents)
- `mcp__rigor-db__commit_link` (2 agents)
- `mcp__rigor-db__traceability_query` (1 agent)

**Test:** Invoke any agent and check if it can call MCP tools. Example: trigger the requirements-analyst agent and see if `changelog_query` is available.

**Fix if broken:** Change all agent frontmatter from `mcp__rigor-db__TOOL` to `rigor-db/TOOL`. A sed one-liner would handle all 20 files:
```bash
sed -i 's/mcp__rigor-db__/rigor-db\//g' plugins/rigor/agents/*.agent.md
```

---

## 📝 Minor Items (non-blocking)

### `commands/` Directory Needs Explicit Declaration

The `plugin.json` component path fields have no default for `commands`. Unlike `agents/` and `skills/`, the commands directory is **not** auto-discovered. The plugin should add:

```json
"commands": "commands/"
```

to `plugin.json` for Copilot to discover the slash commands (`/rigor:start`, `/rigor:resume`, etc.).

**Severity:** Low — commands may still work through Copilot's `.claude/commands/` discovery, but explicit declaration is safer.

### Agent Body Text References `.claude/`

All 20 agents contain this instruction in their body:

> **MCP Tool Note:** All `changelog_insert` and `changelog_query` calls require `project_root: <absolute path to project root>` — the directory containing `.claude/`.

This is functionally correct (the plugin does create `.claude/` for its database) but could confuse the LLM in a Copilot context. Low priority cosmetic issue.

### Local Settings File

`plugins/rigor/.claude-rigor.local.example.md` instructs users to create `.claude/rigor.local.md`. This path convention is Claude-specific but the file is just user preferences — it works anywhere.

---

## Documentation References

All findings verified against these official GitHub docs pages:

1. [CLI plugin reference](https://docs.github.com/en/copilot/reference/cli-plugin-reference) — `plugin.json` schema, file locations, loading order
2. [Creating a plugin](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-creating) — plugin structure, component discovery
3. [Custom agents configuration](https://docs.github.com/en/copilot/reference/custom-agents-configuration) — YAML properties, tool aliases, MCP server config
4. [Creating agent skills](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills) — SKILL.md format
5. [Adding MCP servers](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers) — MCP config for CLI
6. [CLI command reference](https://docs.github.com/en/copilot/reference/cli-command-reference) — env vars, tool permissions
7. [About CLI plugins](https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-cli-plugins) — plugin concepts
8. [Finding and installing plugins](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-finding-installing) — install paths, marketplace support

---

## Recommended Action Plan

| Priority | Action | Effort |
|----------|--------|--------|
| **P1** | Test plugin install + MCP server startup (`CLAUDE_PLUGIN_ROOT`) | 15 min |
| **P1** | Test MCP tool access from agents (`mcp__` naming) | 15 min |
| **P2** | Add `"commands": "commands/"` to `plugin.json` | 1 min |
| **P3** | If Risk 1 fails: refactor `.mcp.json` to use portable path | 30 min |
| **P3** | If Risk 2 fails: sed-replace tool naming in all agents | 5 min |
