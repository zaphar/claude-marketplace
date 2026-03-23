# Rigorous Software Development Workflow Plugin

A Claude Code and GitHub Copilot CLI plugin that guides software projects through a structured SDLC using specialized AI agents, producer-critic validation, and a persistent SQLite audit trail.

## What Problem Does This Solve?

Ad-hoc AI-assisted development tends to skip steps, make undocumented decisions, and lose context across sessions. The rigor plugin enforces discipline:

- **Nothing ships without a critic reviewing it.** Every phase has a dedicated critic agent that can reject work and force revision.
- **Decisions are recorded, not forgotten.** Requirements, architecture decisions, implementation plans, test coverage, and audit findings are all written to an append-only SQLite database — queryable at any phase.
- **You stay in control.** After 3 failed revision loops the workflow escalates to you, not to a hallucinated compromise.
- **Full SDLC coverage.** From initial requirements interview through security and performance audit before release.

## Who Is This For?

- Developers who want AI assistance but don't want AI to skip requirements, design, or testing
- Teams building regulated or high-stakes software where traceability matters
- Solo developers who want the discipline of a full team workflow with AI standing in for each role

## Overview

Two workflows covering the complete SDLC:

**Development:** Requirements → UX Design → Architecture → Planning → Implementation → Documentation

**Release:** QA → Audit (security + performance) → Code Review (optional)

Each phase uses a **producer-critic pattern**: a producer agent creates artifacts, a critic agent validates them, with up to 3 revision loops before escalating to the user. All state and decisions are stored in an append-only SQLite database (`.claude/rigor.db`) for full traceability.

## Supported Platforms

| Platform | Status |
|----------|--------|
| Claude Code | Fully supported |
| GitHub Copilot CLI | Compatible (see `copilot-compatibility-audit.md` for known risks) |

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
claude --plugin-dir /path/to/claude-zaphar/plugins/rigor
```

Loads the plugin for the current session without installing.

## Commands

**Development Workflow:**
- `/rigor:start` — Initialize a new workflow
- `/rigor:onboard` — Bootstrap from an existing codebase
- `/rigor:resume` — Resume an existing workflow
- `/rigor:dev-status` — Display current progress
- `/rigor:skip-to <phase>` — Skip to a specific phase (advanced)
- `/rigor:replan` — Replan the current implementation plan (decompose oversized or problematic work items while preserving completed work; optionally specify WI names to target)
- `/rigor:close` — Close the current iteration
- `/rigor:import` — Import existing data (requirements, design specs, etc.)
- `/rigor:new-iteration` — Start a new iteration from a closed workflow

**Investigation:**
- `/rigor:ask` — Investigate the project and codebase; optionally write an investigation brief and create a new iteration

**Release Workflow:**
- `/rigor:start-release` — Start QA, audit, and code review
- `/rigor:resume-release` — Resume release workflow
- `/rigor:release-status` — Display release progress
- `/rigor:code-review` — Run holistic code review (standalone, without full release workflow)

## Q&A / Investigation

The `/rigor:ask` command opens an interactive Q&A session where you can investigate the project and codebase. A read-only project analyst agent handles deep exploration while protecting the orchestrator's context. When investigation reveals needed changes, say "ship it" to write an investigation brief and create a new iteration seeded with the findings. Run `/rigor:resume` to begin the standard workflow from there.

## Plan Versioning

Implementation plans can be versioned. When a plan needs revision mid-implementation — due to oversized work items, changed requirements, or developer-raised blockers — the `/rigor:replan` command triggers a new plan version (plan_version 1, 2, 3…). Old work items are **superseded**, not deleted, preserving their commit history and audit trail. Completed work items are never affected by replans. The planner explores the actual codebase when sizing work items to produce realistic estimates.

Replans can also happen automatically. When the senior developer detects an oversized work item during implementation, it signals `REPLAN_NEEDED` and the orchestrator triggers a **targeted auto-replan** — only the specific oversized WI is decomposed into smaller items while all other WIs remain unaffected. A circuit breaker (max 3 auto-replans per iteration) prevents runaway replan cascades.

## Directory Structure

```
rigor/
├── agents/                          # 25 agent personality files (10 producer-critic pairs + 3 read-only code review producers + 1 revalidation agent + 1 standalone analyst)
├── commands/                        # Slash command definitions
├── hooks/                           # PreToolUse hooks (block direct SQLite access)
│   ├── hooks.json                   # Claude Code hook config
│   └── block-sqlite.sh             # Shared hook script (Claude Code + Copilot CLI)
├── skills/
│   ├── workflow/SKILL.md            # Orchestration skill (main workflow logic)
│   ├── ask/SKILL.md                 # Q&A orchestration skill
│   └── code-review/SKILL.md         # Code review orchestration skill
└── mcp-server/                      # MCP server with SQLite changelog backend
    ├── schema.sql                   # Database schema reference (source of truth for data model)
    ├── migrate.js                   # Migration engine (applies versioned SQL migrations)
    ├── migrations/                  # Numbered migration files (001_baseline.sql, etc.)
    ├── db.js                        # Database initialization (WAL mode, foreign keys, runs migrations)
    ├── write-tools.js               # Write tools (changelog_insert, phase_transition, etc.)
    ├── read-tools.js                # Read tools (changelog_query, traceability_query, etc.)
    ├── server.js                    # MCP server entry point
    └── test/                        # Test suite
```

### Artifact Directory Layout

File-writing agents store SDLC artifacts under a configurable root directory (default: `docs/sdlc`). This root is stored in `project.artifacts_directory` in the database and surfaced to agents via `project_status`. The canonical subtree structure:

```
<artifacts_directory>/              # default: docs/sdlc
├── process/
│   ├── planning/                   # Implementation plans, phase dirs, replan log
│   ├── qa/screenshots/             # QA test screenshots
│   └── briefs/                     # Investigation briefs from /rigor:ask
└── deliverables/
    ├── architecture/               # Architecture docs, diagrams, API spec
    ├── ux/                         # Design system, mockups
    └── product-docs/               # Audience-specific documentation
```

All agents read `artifacts_directory` from project context — no agent hardcodes paths.

## Hooks

### Block Direct SQLite Access

A `PreToolUse` hook prevents agents from running `sqlite3` (or any command starting with `sqlite`) directly. When triggered, the hook denies the tool call and directs the agent to use the rigor MCP server tools (`changelog_query`, `changelog_update`, `changelog_insert`, `traceability_query`, `export_findings`, etc.) instead.

The hook works on both supported platforms:

| Platform | Config file | Notes |
|----------|-------------|-------|
| Claude Code | `plugins/rigor/hooks/hooks.json` | Uses `matcher: "Bash"` to fire only on Bash tool calls. `${CLAUDE_PLUGIN_ROOT}` resolves to the plugin directory. |
| Copilot CLI | `.github/hooks/rigor-block-sqlite.json` | Fires on all tool calls (no matcher); the script checks `toolName` internally. |

Both platforms invoke the same shared script (`hooks/block-sqlite.sh`) which handles the different JSON input formats.

## Customization

**Modifying agents:** Edit agent files in `agents/` to customize personalities and behaviors.

**Extending the schema:** See the checklist at the top of `mcp-server/schema.sql`. Schema changes are applied via numbered migration files in `mcp-server/migrations/` — create a new `NNN_<name>.sql` file for each change. Never modify an already-applied migration; the system enforces this with SHA-256 checksum verification. See `mcp-server/migrate.js` for implementation details.

**Adding new phases:** Create producer + critic agent files, add tables to `schema.sql`, add handlers in `write-tools.js` and `read-tools.js`, and update `skills/workflow/SKILL.md`.

**Artifacts directory:** The `artifacts_directory` setting is stored on the `project` table in the rigor database (default: `docs/sdlc`). It is set during `/rigor:start` or `/rigor:onboard` and persisted via the `iteration_create` MCP tool. File-writing agents read it from `project_status` — they never hardcode artifact paths. See the Artifact Directory Layout section above for the canonical subtree structure.

## Troubleshooting

- **"No project found"** — Run `/rigor:start` to initialize
- **"Database error"** — Ensure `mcp-server/node_modules` is installed (`cd mcp-server && npm install`)
- **"Too many iterations"** — After 3 producer-critic cycles, you'll be prompted for guidance

## License

MIT License — see LICENSE file for details
