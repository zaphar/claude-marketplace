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
       mcp__plugin_rigor_rigor-db__changelog_query, rigor-db/changelog_query,
       mcp__plugin_rigor_rigor-db__changelog_insert, rigor-db/changelog_insert
```

| Format | Used by | Example |
|--------|---------|---------|
| `mcp__plugin_rigor_rigor-db__<tool>` | Claude Code | `mcp__plugin_rigor_rigor-db__changelog_query` |
| `rigor-db/<tool>` | GitHub Copilot CLI | `rigor-db/changelog_query` |

This is **intentional cross-platform compatibility**. The plugin targets both Claude Code and GitHub Copilot CLI. Each platform only recognizes its own format and silently ignores the other — so both must be present for the plugin to work on both platforms.

**When adding a new MCP tool to an agent, always add both forms.**

### 2. Critics Always Include `changelog_update`

Every critic agent must have `changelog_update` (in both naming formats). Critics use this tool to update entity statuses (e.g., marking audit findings as resolved, transitioning ADR statuses). Revision-level decisions (approved/rejected) are recorded via `revision_update`, typically by the orchestrator after critic review.

**Pattern:** All `*_critic.agent.md` files must include:
```yaml
mcp__plugin_rigor_rigor-db__changelog_update, rigor-db/changelog_update
```

Producer agents generally do **not** need `changelog_update` — that is a critic responsibility.

### 3. Orchestrator Tools vs Agent Tools

The workflow orchestrator (`plugins/rigor/skills/workflow/SKILL.md`) uses a set of **state management tools** that are NOT listed in any individual agent's frontmatter:

| Orchestrator-only tools |
|-------------------------|
| `iteration_create` |
| `phase_transition` |
| `revision_create` |
| `project_update` |
| `blocker_resolve` |
| `iteration_close` |
| `project_status` |
| `revision_history` |
| `iteration_summary` |
| `commit_link` |

Some tools appear in both orchestrator and agent contexts: `revision_update` is in all agent frontmatter (agents may self-report status), and `work_item_transition` is in `senior_developer.agent.md` (implementation tracking).

**`checkpoint` is shared between the orchestrator and file-producing agents.** The agents `backend_architect`, `ux_designer`, and `documentation_master` call `checkpoint` directly after writing file artifacts to disk. This ensures the rigor DB (WAL flush) and VCS commit happen atomically at the point of artifact creation. Implementation-phase agents (`senior_developer`, `test_writer`, `qa_engineer`) do **not** have `checkpoint` — the orchestrator manages checkpoints for the implementation sub-phase loop. `commit_link` remains orchestrator-only.

Individual agents primarily access the data-plane tools (`changelog_query`, `changelog_insert`, `changelog_update`, `traceability_query`). Do not add other orchestrator-only tools to agent frontmatter — agents have no business calling `phase_transition` or `iteration_create`.

### 4. Intentionally Read-Only Producers

`security_auditor.agent.md` and `performance_auditor.agent.md` do **not** have `Edit` or `Write` in their tools. This is intentional: audit findings go to the database only, not to files. Do not add file-editing tools to these agents.

Similarly, `codebase_design_critic.agent.md`, `codebase_idiom_critic_go.agent.md`, and `codebase_cross_cutting_critic.agent.md` are intentionally read-only: code review findings go to the database only (via `changelog_insert`), not to files. Do not add file-editing tools to these agents.

### 5. `test_writer` and `documentation_master` — Filesystem-First Producers

`test_writer.agent.md` and `documentation_master.agent.md` are **filesystem-first** producers: their primary artifacts (test files, documentation files) are written directly to the filesystem and committed to VCS, not stored as DB entries. `documentation_master` has `changelog_insert` and `changelog_query` for recording metadata (e.g., intermediate assets), while `test_writer` has only `changelog_query` (no `changelog_insert`) — it is the most filesystem-constrained producer.

### 6. No CHECK Constraints on TEXT Columns

**Do not add CHECK constraints to TEXT columns in the schema.** CHECK constraints on TEXT columns (e.g., `CHECK(status IN ('active', 'closed'))`) are explicitly prohibited. They were removed in migration 002 and must not be reintroduced.

**Why:** CHECK constraints on TEXT enum columns cause significant quality degradation when LLMs interact with the MCP server — the rigid constraint errors are opaque and unrecoverable from the agent's perspective. They also create friction in schema migrations since SQLite requires full table recreation to alter constraints. Validation of enum-like values belongs in the application layer (`write-tools.js` handlers) or is the agent's responsibility, not the database's.

The one permitted CHECK on a non-TEXT column is `CHECK(id = 1)` on `project.id` (INTEGER PK singleton enforcement).

### 7. Array Schemas Must Include `items`

**Every `type: "array"` property in MCP tool `inputSchema` definitions must include an `items` field.**

OpenAI-based clients (including GitHub Copilot CLI) perform strict JSON Schema validation and reject tool registrations where array schemas omit `items`. Claude's MCP client is lenient and accepts bare `type: "array"`, so missing `items` will silently work on Claude Code but fail on Copilot with:

```
CAPIError: 400 Invalid schema for function '...': array schema missing items
```

When defining array properties in tool schemas, always specify the element type:
```js
// ✅ Correct
exit_criteria: { type: "array", items: { type: "string" }, description: "..." }

// ❌ Will break on Copilot
exit_criteria: { type: "array", description: "..." }
```

### 8. Agent VCS Rules

**Agents never run raw VCS commands (`git commit`, `git add`, `jj commit`) directly.** All VCS persistence goes through the `checkpoint` MCP tool, which atomically flushes the SQLite WAL and commits to VCS (Jujutsu if available, otherwise git). This ensures the `.db` file in every commit reflects all written DB state.

**File-producing pre-implementation agents** (`backend_architect`, `ux_designer`, `documentation_master`) have `checkpoint` in their frontmatter and call it directly after writing file artifacts. This is documented in invariant #3.

**Implementation-phase agents** (`senior_developer`, `test_writer`, `qa_engineer`) write files using Edit/Write tools but do **not** have `checkpoint` — the orchestrator manages checkpoints for the implementation sub-phase loop.

Do not add raw VCS commit instructions to any agent file. Do not add `commit_link` to agent frontmatter (it remains orchestrator-only). Only add `checkpoint` to agents listed in invariant #3 — do not add it to implementation-phase agents.

### 9. `superseded` Is a Terminal Work Item Status

The `work_item_transition` tool accepts `"superseded"` as a target status. This is a **terminal** status — once a work item is superseded, it cannot transition to any other status. Additionally, **completed work items cannot be superseded** (the handler throws an error). Only non-completed WIs (pending, test_writing, implementing) can be superseded, which happens during replanning when old WIs are replaced by a new plan version.

### 10. `plan_version` Defaults to 1

The `changelog_insert` tool accepts an optional `plan_version` field for `work_item` and `plan_overview` entity types. It defaults to `1`. During replans, the orchestrator passes a higher plan_version (2, 3, …) to associate new WIs with the correct plan version. Agents should not set `plan_version` unless explicitly instructed to during a replan.

### 11. Artifacts Directory Convention

**`project.artifacts_directory`** (default `docs/sdlc`) is the single source of truth for where SDLC file artifacts are stored. All file-writing agents read it from `project_status`, never hardcode paths.

The canonical subtree structure beneath `artifacts_directory`:

| Subtree | Purpose | Agents |
|---------|---------|--------|
| `process/conventions/` | Project convention files (global + per-phase) | orchestrator (single writer) |
| `process/planning/iteration-<N>/` | Implementation plans, phase dirs, replan log (per iteration) | `implementation_planner` |
| `process/qa/screenshots/` | QA test screenshots | `qa_engineer` |
| `process/briefs/` | Investigation briefs from `/rigor:ask` | ask skill |
| `deliverables/architecture/` | Architecture docs, diagrams, API spec | `backend_architect` |
| `deliverables/ux/` | Design system, mockups | `ux_designer` |
| `deliverables/product-docs/` | Audience-specific documentation | `documentation_master` |

When adding a new file-writing agent, it must:
1. Read `artifacts_directory` from project context (sourced from `project_status`)
2. Append its fixed subtree path (never write to arbitrary locations)
3. Run `mkdir -p` before writing any file
4. Be listed in SKILL.md §8 context-passing section

---

### 12. Convention File Handling

All 24 workflow agents (every producer and critic) read convention files before starting work — the global conventions (`global.md`) and the phase-specific conventions for the current phase. Convention files live at `<artifacts_dir>/process/conventions/<phase>.md`.

If convention files are absent, agents stop immediately with a `CONVENTION_FILES_MISSING` diagnostic — there are no fallback defaults at runtime. The orchestrator is responsible for seeding convention files before the first phase (see README.md Conventions section).

**Phase name to convention filename mapping:** replace underscores with hyphens in the DB phase name to get the filename. Specifically: `ux_design` → `ux-design.md`, `code_review` → `code-review.md`, and all others map directly (e.g., `requirements` → `requirements.md`, `implementation` → `implementation.md`).

### 13. Convention Suggestions

All critic agents include `CONVENTION_SUGGESTION` instructions. When a critic observes a recurring pattern or missing rule during review, it emits a structured block:

```
CONVENTION_SUGGESTION:
  file: global.md | <phase>.md
  action: add | modify
  rule: "<proposed rule>"
  rationale: "<why this rule should exist>"
```

This is the canonical §15.4 format from SKILL.md. **Only critics have this capability** — producer agents do NOT emit `CONVENTION_SUGGESTION` blocks.

The orchestrator is the **single writer** of convention files. Agents never edit convention files directly. Suggestions are collected during the producer-critic loop and surfaced to the user at phase transitions, where the user can accept, modify, or reject each one.

### 14. Agent Identity vs Convention Split

Agent files and convention files serve different purposes:

| Belongs in agent file (identity) | Belongs in convention file (project decision) |
|----------------------------------|-----------------------------------------------|
| Role and personality | Testing philosophy (TDD, mocking policy) |
| Workflow mechanics (revision loop, escalation) | Decomposition strategy (WI sizing, phase priorities) |
| MCP tool usage and output format | Coding standards (naming, formatting, linting) |
| Producer-critic handoff protocol | Quality criteria (coverage thresholds, review focus) |
| Escalation conditions | Domain-specific rules (API style, dependency policy) |

When adding rules to agents, classify each rule: if it's about **how the agent operates** (identity), it goes in the agent file. If it's about **what the project values** (project decision), it goes in a convention file. Mixing these concerns makes agents non-reusable across projects.

---

## Adding a New Agent

When creating a new agent:

1. Place the file at `plugins/rigor/agents/<name>.agent.md`
2. For MCP tools, always add both naming conventions (see invariant #1)
3. If it is a critic, include `changelog_update` in both formats (see invariant #2)
4. Do not add orchestrator-only tools (see invariant #3)
5. Add the `### Project Conventions` preamble that reads global + phase convention files (see invariant #12)
6. If it is a critic, add `### Convention Suggestions` with the §15.4 format block (see invariant #13)
7. Update `plugins/rigor/README.md` to document the new agent

## Modifying the MCP Server

The MCP server is at `plugins/rigor/mcp-server/`. When adding a new tool:

1. Add the tool definition to `write-tools.js` (WRITE_TOOLS array) or `read-tools.js` (READ_TOOLS array)
2. Ensure all `type: "array"` properties have an `items` field (see invariant #7)
3. Add it to any agent frontmatter that needs it — **in both naming formats**
4. Update `schema.sql` if the tool requires new tables or columns, and create a new numbered migration file in `migrations/` (never modify an already-applied migration)
