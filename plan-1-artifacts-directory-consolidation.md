# Plan 1: Artifacts Directory Consolidation

## Problem Statement

The rigor plugin has three competing mechanisms for determining where file artifacts are written:

1. **`.claude/rigor.local.md` YAML frontmatter** — read by `implementation_planner` and `qa_engineer`, defaults to `.sdlc`
2. **`start` command prompt context** — suggests `.claude/rigor-artifacts` as default, passes it to agents as prompt text only (never stored in DB)
3. **Hardcoded paths** — `backend_architect` writes to `docs/architecture/`, `ux_designer` writes to `docs/ux/`, `documentation_master` writes to `docs/`, workflow skill references bare `planning/phases/` at project root

The `project_status` MCP tool returns **zero path information**. The `iteration_create` tool doesn't accept an artifacts directory parameter. The `project` and `iteration` tables have no path columns. The artifacts directory is not stored anywhere in the rigor database.

**Worst conflict:** The workflow skill (`SKILL.md`) runs `rm -rf planning/phases/` and `mkdir -p planning/phases/` at project root. But `implementation_planner` writes to `<artifacts_directory>/planning/phases/` where `artifacts_directory` might be `.sdlc`. They operate on different directories.

## Solution

Store `artifacts_directory` on the `project` table in the rigor database. All file-writing agents and skills read it from `project_status` and append their known subtree. One source of truth, no config files, no hardcoded absolute paths.

### Canonical Directory Structure

The `artifacts_directory` column stores the root (default: `docs/sdlc`). The subtree structure beneath it is fixed:

```
<artifacts_directory>/
├── process/
│   ├── planning/              ← implementation_planner: indexes, phase dirs, replan-log
│   │   ├── index.md
│   │   ├── replan-log.md
│   │   └── phases/
│   │       ├── phase-1/
│   │       │   ├── index.md
│   │       │   └── WI-*.md
│   │       └── phase-2/
│   │           └── ...
│   ├── qa/                    ← qa_engineer: test screenshots
│   │   └── screenshots/
│   └── briefs/                ← reserved for Plan 2 (investigation briefs)
│       └── YYYY/MM/DD/
│           └── <epoch>-<slug>.md
└── deliverables/
    ├── architecture/          ← backend_architect: overview, diagrams, api_spec, data-model
    │   ├── overview.md
    │   ├── data-model.md
    │   ├── api_spec.yaml
    │   └── diagrams/
    │       └── *.mmd, *.png
    ├── ux/                    ← ux_designer: design system, mockups
    │   ├── design-system/
    │   └── mockups/
    └── product-docs/          ← documentation_master: all audience-specific docs
        ├── user-guide/
        ├── how-to/
        ├── api/
        ├── sdk/
        ├── operator/
        └── developer/
```

### Subtree Constants (for agent instructions)

Each file-writing agent appends a fixed subtree path to `<artifacts_directory>`:

| Agent | Subtree | Full example path |
|---|---|---|
| `implementation_planner` | `process/planning/` | `docs/sdlc/process/planning/index.md` |
| `qa_engineer` | `process/qa/screenshots/` | `docs/sdlc/process/qa/screenshots/` |
| `backend_architect` | `deliverables/architecture/` | `docs/sdlc/deliverables/architecture/overview.md` |
| `ux_designer` | `deliverables/ux/` | `docs/sdlc/deliverables/ux/mockups/` |
| `documentation_master` | `deliverables/product-docs/` | `docs/sdlc/deliverables/product-docs/user-guide/` |
| `senior_developer` | (writes to source tree, not artifacts) | n/a |
| `test_writer` | (writes to source tree, not artifacts) | n/a |

---

## Implementation Steps

### Step 1: Schema Migration

**File to create:** `plugins/rigor/mcp-server/migrations/006_artifacts_directory.sql`

Add `artifacts_directory` column to the `project` table:

```sql
ALTER TABLE project ADD COLUMN artifacts_directory TEXT NOT NULL DEFAULT 'docs/sdlc';
```

**File to update:** `plugins/rigor/mcp-server/schema.sql`

Add the column to the `project` CREATE TABLE statement (this file is the cumulative reference, not directly executed):

```sql
CREATE TABLE IF NOT EXISTS project (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  project_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL,
  closed_at TEXT,
  critic_model TEXT NOT NULL DEFAULT 'sonnet',
  notes TEXT NOT NULL DEFAULT '',
  artifacts_directory TEXT NOT NULL DEFAULT 'docs/sdlc'   -- ← ADD THIS
);
```

Also update the `-- Domain:` / `-- Purpose:` comment block for the `project` table to mention that `artifacts_directory` stores the root path for all SDLC file artifacts, relative to the project root.

**Migration numbering:** Check what the highest-numbered migration file is in `plugins/rigor/mcp-server/migrations/` and use the next number. The example above assumes `005` is the latest.

### Step 2: Update `iteration_create` in write-tools.js

**File:** `plugins/rigor/mcp-server/write-tools.js`

Find the `iteration_create` tool definition. It currently accepts `project_name` and `critic_model`. Add `artifacts_directory` as an optional parameter:

```javascript
properties: {
  project_name: { type: "string", description: "Project name (used if project must be created)" },
  critic_model: { type: "string", description: "Critic model name (default: sonnet)" },
  artifacts_directory: { type: "string", description: "Root directory for SDLC file artifacts, relative to project root (default: docs/sdlc). Only used when creating the project (first iteration)." },
},
```

In the handler function, find where the project row is INSERTed (this only happens on the first iteration when no project exists). Add `artifacts_directory` to the INSERT:

- If `args.artifacts_directory` is provided, use it
- Otherwise, use the default `'docs/sdlc'`
- Only set on project creation — subsequent `iteration_create` calls (for iterations 2, 3, etc.) should NOT update it

**Do not** add `artifacts_directory` to the `iteration` table or to subsequent iteration creation. It is a project-level setting.

### Step 3: Update `project_status` in read-tools.js

**File:** `plugins/rigor/mcp-server/read-tools.js`

Find the `projectStatus` function. It runs `SELECT * FROM project WHERE id = 1`. Since the column now exists on the table, `SELECT *` will automatically include `artifacts_directory` in the response.

**Verify:** Confirm that `project_status` returns the full project row and that no column filtering strips it out. If the function explicitly lists columns, add `artifacts_directory` to the list.

Also check `iteration_summary` — if it returns project-level data, ensure `artifacts_directory` is included there too.

### Step 4: Update `start` Command

**File:** `plugins/rigor/commands/start.md`

Currently the command asks the user for an artifacts directory via `AskUserQuestion` and passes it as prompt context. Change it to:

1. Still ask the user for the artifacts directory (default: `docs/sdlc`)
2. Remove the suggestion of `.claude/rigor-artifacts` — the new default is `docs/sdlc`
3. Pass `artifacts_directory` to `iteration_create` as a parameter (not just prompt text)
4. The `mkdir -p` call should create the full subtree structure:

```bash
mkdir -p "<artifacts_directory>/process/planning/phases"
mkdir -p "<artifacts_directory>/process/qa/screenshots"
mkdir -p "<artifacts_directory>/process/briefs"
mkdir -p "<artifacts_directory>/deliverables/architecture/diagrams"
mkdir -p "<artifacts_directory>/deliverables/ux/design-system"
mkdir -p "<artifacts_directory>/deliverables/ux/mockups"
mkdir -p "<artifacts_directory>/deliverables/product-docs"
```

5. Remove any references to `.claude/rigor.local.md` for artifacts configuration

### Step 5: Update `onboard` Command

**File:** `plugins/rigor/commands/onboard.md`

Same changes as the `start` command:

1. Pass `artifacts_directory` to `iteration_create`
2. Update default from `.claude/rigor-artifacts` to `docs/sdlc`
3. Update all hardcoded path references to use the canonical subtree structure:
   - `docs/ux/design-system/` → `<artifacts_directory>/deliverables/ux/design-system/`
   - `docs/ux/mockups/` → `<artifacts_directory>/deliverables/ux/mockups/`
   - `docs/architecture/` → `<artifacts_directory>/deliverables/architecture/`
   - etc.

### Step 6: Update `organize-artifacts` Command

**File:** `plugins/rigor/commands/organize-artifacts.md`

This command scans for artifacts at legacy locations and moves them to the canonical layout. It currently has two problems:

1. **Step 1** reads `artifacts_directory` from `.claude/rigor.local.md` YAML frontmatter, and if the file doesn't exist, prompts the user and creates it. After this plan, the source of truth is the DB — `.claude/rigor.local.md` should not be consulted or created.

2. **The target layout table** (Step 1) still uses the old structure (`docs/ux/`, `docs/architecture/`, `<artifacts_dir>/planning/`). It needs to use the new canonical structure under `<artifacts_directory>/process/` and `<artifacts_directory>/deliverables/`.

**Rewrite Step 1 of the command** to:

1. Call `project_status` to get `artifacts_directory` from the DB
2. If no project exists, error: `"No project found. Run /rigor:start first."`
3. Remove all references to `.claude/rigor.local.md` — do not read it, do not create it, do not prompt to set a value in it

**Replace the target layout table** with:

| Artifact | New location |
|---|---|
| UX design system | `<artifacts_directory>/deliverables/ux/design-system/` |
| UX mockups | `<artifacts_directory>/deliverables/ux/mockups/` |
| Planning tree | `<artifacts_directory>/process/planning/` |
| QA screenshots | `<artifacts_directory>/process/qa/screenshots/` |
| OpenAPI spec | `<artifacts_directory>/deliverables/architecture/api_spec.yaml` |
| Architecture diagrams | `<artifacts_directory>/deliverables/architecture/diagrams/` |
| Architecture docs | `<artifacts_directory>/deliverables/architecture/` |
| Product docs | `<artifacts_directory>/deliverables/product-docs/<audience>/` |

**Update all scan-and-move mappings** (Steps 2a through 2g) to target the new locations:

| Old location | New location |
|---|---|
| `design-system/` (project root) | `<artifacts_directory>/deliverables/ux/design-system/` |
| `mockups/` (project root) | `<artifacts_directory>/deliverables/ux/mockups/` |
| `planning/` (project root) | `<artifacts_directory>/process/planning/` |
| `screenshots/` (project root) | `<artifacts_directory>/process/qa/screenshots/` |
| `api_spec.yaml` (project root) | `<artifacts_directory>/deliverables/architecture/api_spec.yaml` |
| `docs/architecture/*.mmd`, `*.png` | `<artifacts_directory>/deliverables/architecture/diagrams/` |
| `docs/architecture/` (all other files) | `<artifacts_directory>/deliverables/architecture/` |
| `docs/ux/design-system/` | `<artifacts_directory>/deliverables/ux/design-system/` |
| `docs/ux/mockups/` | `<artifacts_directory>/deliverables/ux/mockups/` |
| `docs/<segment>/<audience>/` | `<artifacts_directory>/deliverables/product-docs/<audience>/` |
| `docs/user-guide/`, `docs/how-to/`, etc. | `<artifacts_directory>/deliverables/product-docs/<audience>/` |
| `.sdlc/planning/` | `<artifacts_directory>/process/planning/` |
| `.sdlc/qa/` | `<artifacts_directory>/process/qa/` |

**Update the DB path update steps** (Steps 5a, 5b) to use the new prefixes in replacements:

| Old prefix in DB | New prefix in DB |
|---|---|
| `mockups/` | `<artifacts_directory>/deliverables/ux/mockups/` |
| `design-system/` | `<artifacts_directory>/deliverables/ux/design-system/` |
| `docs/ux/mockups/` | `<artifacts_directory>/deliverables/ux/mockups/` |
| `docs/ux/design-system/` | `<artifacts_directory>/deliverables/ux/design-system/` |

**Update the WI file grep** (Step 6 of the command) to also search for old `docs/ux/` and `docs/architecture/` prefixes, not just bare `mockups/` and `design-system/`.

**Add `project_status` to allowed-tools** in the command frontmatter (both naming formats per AGENTS.md invariant #1):

```yaml
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - mcp__plugin_rigor_rigor-db__changelog_query
  - rigor-db/changelog_query
  - mcp__plugin_rigor_rigor-db__changelog_insert
  - rigor-db/changelog_insert
  - mcp__plugin_rigor_rigor-db__project_status
  - rigor-db/project_status
```

### Step 7: Update `implementation_planner` Agent

**File:** `plugins/rigor/agents/implementation_planner.agent.md`

Find the section that reads `.claude/rigor.local.md` YAML frontmatter (around line 207). Replace it entirely:

**Remove:**
```
Before writing file artifacts, determine `artifacts_directory` by reading `.claude/rigor.local.md` YAML frontmatter. Default to `.sdlc` if the file is absent or the field is missing.
```

**Replace with:**
```
Before writing file artifacts, determine `artifacts_directory` from the project context provided by the orchestrator (sourced from `project_status`). All planning artifacts go under `<artifacts_directory>/process/planning/`. Before writing any file, ensure the target directory exists: `mkdir -p <target_directory>`.
```

Update all path references in the agent:
- `<artifacts_directory>/planning/index.md` → `<artifacts_directory>/process/planning/index.md`
- `<artifacts_directory>/planning/phases/` → `<artifacts_directory>/process/planning/phases/`
- `<artifacts_directory>/planning/replan-log.md` → `<artifacts_directory>/process/planning/replan-log.md`

### Step 8: Update `qa_engineer` Agent

**File:** `plugins/rigor/agents/qa_engineer.agent.md`

Same pattern as Step 7. Find the `.claude/rigor.local.md` reading section (around line 95).

**Remove** the `rigor.local.md` reading instruction.

**Replace with:**
```
Before writing file artifacts, determine `artifacts_directory` from the project context provided by the orchestrator (sourced from `project_status`). QA artifacts go under `<artifacts_directory>/process/qa/`. Before writing any file, ensure the target directory exists: `mkdir -p <target_directory>`.
```

Update path reference:
- `<artifacts_directory>/qa/screenshots/` → `<artifacts_directory>/process/qa/screenshots/`

### Step 9: Update `backend_architect` Agent

**File:** `plugins/rigor/agents/backend_architect.agent.md`

Currently hardcodes `docs/architecture/`. Change all references:

- `docs/architecture/overview.md` → `<artifacts_directory>/deliverables/architecture/overview.md`
- `docs/architecture/diagrams/` → `<artifacts_directory>/deliverables/architecture/diagrams/`
- `docs/architecture/data-model.md` → `<artifacts_directory>/deliverables/architecture/data-model.md`
- `docs/architecture/api_spec.yaml` → `<artifacts_directory>/deliverables/architecture/api_spec.yaml`

Add instruction:
```
Before writing file artifacts, determine `artifacts_directory` from the project context provided by the orchestrator (sourced from `project_status`). Architecture artifacts go under `<artifacts_directory>/deliverables/architecture/`. Before writing any file, ensure the target directory exists: `mkdir -p <target_directory>`.
```

Also fix the duplicate VCS commit instructions (line ~91-92) — remove the legacy `jj commit` / `git add` instruction and keep only the `checkpoint` MCP tool instruction.

### Step 10: Update `ux_designer` Agent

**File:** `plugins/rigor/agents/ux_designer.agent.md`

Currently hardcodes `docs/ux/`. Change all references:

- `docs/ux/design-system/` → `<artifacts_directory>/deliverables/ux/design-system/`
- `docs/ux/mockups/` → `<artifacts_directory>/deliverables/ux/mockups/`

Add the same artifacts_directory instruction pattern (including `mkdir -p` before writing).

### Step 11: Update `documentation_master` Agent

**File:** `plugins/rigor/agents/documentation_master.agent.md`

Currently hardcodes `docs/` with subdirectories. Change all references:

- `docs/user-guide/` → `<artifacts_directory>/deliverables/product-docs/user-guide/`
- `docs/how-to/` → `<artifacts_directory>/deliverables/product-docs/how-to/`
- `docs/api/` → `<artifacts_directory>/deliverables/product-docs/api/`
- `docs/sdk/` → `<artifacts_directory>/deliverables/product-docs/sdk/`
- `docs/operator/` → `<artifacts_directory>/deliverables/product-docs/operator/`
- `docs/developer/` → `<artifacts_directory>/deliverables/product-docs/developer/`

Add the same artifacts_directory instruction pattern (including `mkdir -p` before writing).

### Step 12: Update Workflow Skill

**File:** `plugins/rigor/skills/workflow/SKILL.md`

Find all bare `planning/` references (around lines 100-128). These are the most critical fixes:

**Lines ~103-104 (initial plan):**
```bash
rm -rf planning/phases/
mkdir -p planning/phases/
```
Must become:
```bash
rm -rf <artifacts_directory>/process/planning/phases/
mkdir -p <artifacts_directory>/process/planning/phases/
```

Where `<artifacts_directory>` comes from `project_status`.

**Lines ~111-126 (replan handling):**
All references to `planning/phases/` and `planning/replan-log.md` must be prefixed with `<artifacts_directory>/process/`.

**Also update:**
- The orchestrator prompt instructions to include `artifacts_directory` from `project_status` when invoking any file-writing producer agent
- Ensure the orchestrator passes `artifacts_directory` as part of the minimal context it gives to each producer

### Step 13: Update `replan` Command

**File:** `plugins/rigor/commands/replan.md`

Update reference to `<artifacts_directory>/planning/replan-log.md` → `<artifacts_directory>/process/planning/replan-log.md`.

### Step 14: Update Other Commands That Display Artifacts Path

**Files:** `plugins/rigor/commands/resume.md`, `plugins/rigor/commands/dev-status.md`, `plugins/rigor/commands/ask.md`

These display `Artifacts: <artifacts_directory>` to the user. They currently get this from `project_status`. Since `project_status` will now return the real value from the DB, these should work automatically. **Verify** that each command reads and displays the `artifacts_directory` field from the `project_status` response.

> **Note for existing projects:** After this migration, `artifacts_directory` will default to `docs/sdlc` but existing files will remain at their old locations (`planning/`, `.sdlc/`, `docs/architecture/`, etc.). Users should run `/rigor:organize-artifacts` to migrate files to the canonical structure. Document this in the README and in the migration file's header comment.

### Step 15: Update README

**File:** `plugins/rigor/README.md`

Update any documentation about artifact locations to reflect:
- The canonical directory structure
- That `artifacts_directory` is stored in the DB on the `project` table
- That the default is `docs/sdlc`
- That `.claude/rigor.local.md` is no longer the source for artifacts directory configuration

### Step 16: Update AGENTS.md

**File:** `AGENTS.md` (repo root)

Add a new invariant section documenting:
- The artifacts directory is stored in `project.artifacts_directory` (default `docs/sdlc`)
- All file-writing agents must read it from `project_status`, never hardcode paths
- The canonical subtree structure (process/ vs deliverables/)
- When adding a new file-writing agent, it must follow this pattern

### Step 17: Deprecate `.claude/rigor.local.md` for artifacts_directory

The `artifacts_directory` field in `.claude/rigor.local.md` is now superseded by the DB column. Update `.claude-rigor.local.example.md` in the plugin directory to:

1. Remove `artifacts_directory` from the YAML frontmatter example
2. Add a comment noting it has been moved to the project table in the DB
3. Keep any other fields in `rigor.local.md` that are still used (if any)

If `artifacts_directory` was the only field read from `rigor.local.md`, document that the file is deprecated.

---

## Validation

After implementing all changes, verify:

1. **Migration applies cleanly:** Run the MCP server against an existing rigor.db and confirm the migration adds the column with the default value
2. **project_status returns artifacts_directory:** Call `project_status` and confirm the field is present in the response
3. **iteration_create accepts artifacts_directory:** Create a new project with a custom artifacts directory and confirm it's stored
4. **No remaining hardcoded paths:** Run these grep commands and confirm zero matches for old patterns:

```bash
# Should find NO matches in agents/ or skills/ (only in this plan file and organize-artifacts legacy mappings)
grep -rn 'docs/architecture/' plugins/rigor/agents/ plugins/rigor/skills/
grep -rn 'docs/ux/' plugins/rigor/agents/ plugins/rigor/skills/
grep -rn 'docs/user-guide\|docs/how-to\|docs/api/\|docs/sdk/\|docs/operator/\|docs/developer/' plugins/rigor/agents/
grep -rn 'rigor.local.md' plugins/rigor/agents/

# Workflow skill should have no bare planning/ references
grep -n '^.*planning/phases' plugins/rigor/skills/workflow/SKILL.md
# All matches should be prefixed with <artifacts_directory>/process/
```

5. **Organize-artifacts command still works:** The legacy migration paths should be updated to target the new canonical structure

---

## Files Changed (Summary)

| File | Change Type |
|---|---|
| `plugins/rigor/mcp-server/migrations/006_artifacts_directory.sql` | **NEW** |
| `plugins/rigor/mcp-server/schema.sql` | Edit (add column + update comments) |
| `plugins/rigor/mcp-server/write-tools.js` | Edit (iteration_create params) |
| `plugins/rigor/mcp-server/read-tools.js` | Verify (project_status returns new column) |
| `plugins/rigor/commands/start.md` | Edit (new default, pass param to iteration_create) |
| `plugins/rigor/commands/onboard.md` | Edit (same as start + update path refs) |
| `plugins/rigor/commands/organize-artifacts.md` | Edit (update legacy mappings, read from DB) |
| `plugins/rigor/commands/replan.md` | Edit (update planning path) |
| `plugins/rigor/commands/resume.md` | Verify (displays artifacts_directory) |
| `plugins/rigor/commands/dev-status.md` | Verify (displays artifacts_directory) |
| `plugins/rigor/commands/ask.md` | Verify (displays artifacts_directory) |
| `plugins/rigor/agents/implementation_planner.agent.md` | Edit (remove rigor.local.md, use project_status) |
| `plugins/rigor/agents/qa_engineer.agent.md` | Edit (remove rigor.local.md, use project_status) |
| `plugins/rigor/agents/backend_architect.agent.md` | Edit (remove hardcoded paths, fix dup commit) |
| `plugins/rigor/agents/ux_designer.agent.md` | Edit (remove hardcoded paths) |
| `plugins/rigor/agents/documentation_master.agent.md` | Edit (remove hardcoded paths) |
| `plugins/rigor/skills/workflow/SKILL.md` | Edit (prefix all planning/ refs, pass artifacts_directory) |
| `plugins/rigor/README.md` | Edit (update artifact docs) |
| `AGENTS.md` | Edit (add artifacts directory invariant) |
| `plugins/rigor/.claude-rigor.local.example.md` | Edit (deprecate artifacts_directory field) |
