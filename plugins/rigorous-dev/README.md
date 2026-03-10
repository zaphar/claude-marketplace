# Rigorous Software Development Workflow Plugin

A Claude Code plugin that guides you through creating or modifying software with high rigor using specialized agents, structured specifications, and producer-critic validation patterns.

## Overview

Two workflows covering the complete SDLC:

**Development:** Requirements → UX Design → Architecture → Planning → Implementation → Documentation

**Release:** QA → Audit (security + performance)

Each phase uses a **producer-critic pattern**: a producer agent creates artifacts, a critic agent validates them, with up to 3 revision loops before escalating to the user. All state and decisions are stored in an append-only SQLite database (`.claude/rigorous-dev.db`) for full traceability.

## Installation

### Remote Marketplace Install

```
/plugin marketplace add https://dev.zaphar.net/zaphar/claude-zaphar
/plugin install rigor@claude-zaphar
```

### Local Marketplace Install

```bash
git clone https://dev.zaphar.net/zaphar/claude-zaphar.git
```

Then inside Claude Code:

```
/plugin marketplace add /path/to/claude-zaphar
/plugin install rigor@claude-zaphar
```

### Using `--plugin-dir`

```bash
claude --plugin-dir /path/to/claude-zaphar/plugins/rigorous-dev
```

Loads the plugin for the current session without installing.

## Commands

**Development Workflow:**
- `/rigor:start` — Initialize a new workflow
- `/rigor:onboard` — Bootstrap from an existing codebase
- `/rigor:resume` — Resume an existing workflow
- `/rigor:status` — Display current progress
- `/rigor:skip-to <phase>` — Skip to a specific phase (advanced)
- `/rigor:close` — Close the current iteration
- `/rigor:import` — Import existing data (requirements, design specs, etc.)
- `/rigor:new-iteration` — Start a new iteration from a closed workflow

**Release Workflow:**
- `/rigor:start-release` — Start QA and audit
- `/rigor:resume-release` — Resume release workflow
- `/rigor:release-status` — Display release progress

## Directory Structure

```
rigorous-dev/
├── agents/                          # 20 agent personality files (10 producer-critic pairs)
├── commands/                        # Slash command definitions
├── skills/rigorous-dev/SKILL.md     # Orchestration skill (main workflow logic)
└── mcp-server/                      # MCP server with SQLite changelog backend
    ├── schema.sql                   # Database schema (source of truth for data model)
    ├── write-tools.js               # Write tools (changelog_insert, phase_transition, etc.)
    ├── read-tools.js                # Read tools (changelog_query, traceability_query, etc.)
    ├── db.js                        # Database initialization
    ├── server.js                    # MCP server entry point
    └── package.json                 # Node dependencies
```

## Customization

**Modifying agents:** Edit agent files in `agents/` to customize personalities and behaviors.

**Extending the schema:** See the checklist at the top of `mcp-server/schema.sql`.

**Adding new phases:** Create producer + critic agent files, add tables to `schema.sql`, add handlers in `write-tools.js` and `read-tools.js`, and update `skills/rigorous-dev/SKILL.md`.

## Troubleshooting

- **"No project found"** — Run `/rigor:start` to initialize
- **"Database error"** — Ensure `mcp-server/node_modules` is installed (`cd mcp-server && npm install`)
- **"Too many iterations"** — After 3 producer-critic cycles, you'll be prompted for guidance

## License

MIT License — see LICENSE file for details
