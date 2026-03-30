---
description: Migrate an existing rigor project's artifacts from an old inconsistent layout to the current standard layout
allowed-tools:
  - Read
  - Edit
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
  - mcp__plugin_rigor_rigor-db__project_status
  - rigor-db/project_status
  - mcp__plugin_rigor_rigor-db__changelog_query
  - rigor-db/changelog_query
  - mcp__plugin_rigor_rigor-db__changelog_insert
  - rigor-db/changelog_insert
  - mcp__plugin_rigor_rigor-db__project_update
  - rigor-db/project_update
---

# Migrate Rigor Artifact Layout

Scan an existing rigor project for artifacts in legacy locations and migrate them to the
current standard layout. Updates file paths in the database and any work item files that
inline mockup references.

> **project_root** is the directory containing `.claude/`. Determine it at session start
> and use it for every MCP tool call.

---

## Step 1 — Determine Target Layout

Call `project_status` to read the project from the DB:

```
project_status(project_root: "<project_root>")
```

**If no project exists** (the tool throws "Project not found"):

> Error: "No project found. Run /rigor:start first."

Stop. Do not proceed.

**If the project exists**, extract both directory paths from the response:

```
artifacts_dir = project.artifacts_directory
process_dir = project.process_directory
```

The target layout is:

| Artifact | New location |
|---|---|
| UX design system | `<artifacts_dir>/ux/design-system/` |
| UX mockups | `<artifacts_dir>/ux/mockups/` |
| Conventions | `<artifacts_dir>/conventions/` |
| OpenAPI spec | `<artifacts_dir>/architecture/api_spec.yaml` |
| Architecture diagrams | `<artifacts_dir>/architecture/diagrams/` |
| Architecture docs | `<artifacts_dir>/architecture/` |
| Product docs | `<artifacts_dir>/product-docs/<audience>/` |
| Planning tree | `<process_dir>/planning/` |
| QA screenshots | `<process_dir>/qa/screenshots/` |

The canonical subtree structures are:

```
<artifacts_directory>/                   ← persistent deliverables
├── conventions/               ← project rules (global + per-phase)
├── architecture/              ← backend_architect: overview, diagrams, api_spec, data-model
│   ├── overview.md
│   ├── data-model.md
│   ├── api_spec.yaml
│   └── diagrams/
│       └── *.mmd, *.png
├── ux/                        ← ux_designer: design system, mockups
│   ├── design-system/
│   └── mockups/
└── product-docs/              ← documentation_master: all audience-specific docs
        ├── user-guide/
        ├── how-to/
        ├── api/
        ├── sdk/
        ├── operator/
        └── developer/

<process_directory>/                     ← ephemeral workflow artifacts
├── planning/                  ← implementation_planner: per-iteration plans
│   └── iteration-<N>/
│       ├── index.md
│       ├── replan-log.md
│       └── phases/
│           ├── phase-1/
│           │   ├── index.md
│           │   └── WI-*.md
│           └── phase-2/
│               └── ...
├── qa/                        ← qa_engineer: test screenshots
│   └── screenshots/
├── code-review/               ← code review discovery, partitions, findings
│   └── YYYY/MM/DD/
│       └── <epoch>-{discovery,partitions,findings}.*
└── briefs/                    ← investigation briefs from /rigor:ask
    └── YYYY/MM/DD/
        └── <epoch>-<slug>.md
```

---

## Step 1b — Detect and Handle Layout Upgrade

After reading the project config, check whether the project uses the **old unified layout** where deliverables and process artifacts share a single directory with `deliverables/` and `process/` subdirectories.

### Detection

Check for these indicators of the old layout:

```bash
# Old layout: deliverables/ subdirectory under artifacts_directory
test -d "<project_root>/<artifacts_dir>/deliverables" && echo "OLD_DELIVERABLES"

# Old layout: process/ subdirectory under artifacts_directory (when process_directory
# equals artifacts_directory/process — the back-filled migration default)
test -d "<project_root>/<artifacts_dir>/process" && echo "OLD_PROCESS"

# Old layout: conventions under process/ instead of directly under artifacts_dir
test -d "<project_root>/<artifacts_dir>/process/conventions" && echo "OLD_CONVENTIONS"
```

If **any** of these detect the old layout, enter the **upgrade flow** below. Otherwise, skip to Step 2 (legacy location scan).

### Upgrade Flow

Tell the user:

```
This project uses the old unified artifact layout. The plugin now separates:
  - Persistent deliverables (architecture, ux, product-docs, conventions) → artifacts_directory
  - Ephemeral workflow files (planning, qa, briefs, code-review) → process_directory

Current configuration:
  artifacts_directory: <artifacts_dir>
  process_directory:   <process_dir>
```

#### a. Ask for new process_directory preference

Use AskUserQuestion:

```
Where should ephemeral workflow files (planning, qa, briefs, code-review) live?

  1. .sdlc (default — hidden dot-directory, keeps project root clean)
  2. <artifacts_dir>/process (keep current location, no file moves needed)
  3. Custom path

Current files are at: <artifacts_dir>/process/
```

Record their choice as `new_process_dir`.

#### b. Build upgrade migration plan

Scan for files to move based on what was detected:

**If OLD_DELIVERABLES detected** — files under `<artifacts_dir>/deliverables/` need to move up:

| Old | New |
|---|---|
| `<artifacts_dir>/deliverables/architecture/` | `<artifacts_dir>/architecture/` |
| `<artifacts_dir>/deliverables/ux/` | `<artifacts_dir>/ux/` |
| `<artifacts_dir>/deliverables/product-docs/` | `<artifacts_dir>/product-docs/` |

**If OLD_CONVENTIONS detected** — conventions need to move from process to artifacts:

| Old | New |
|---|---|
| `<artifacts_dir>/process/conventions/` | `<artifacts_dir>/conventions/` |

**If OLD_PROCESS detected and user chose a different process_directory** — process files need to move:

| Old | New |
|---|---|
| `<artifacts_dir>/process/planning/` | `<new_process_dir>/planning/` |
| `<artifacts_dir>/process/qa/` | `<new_process_dir>/qa/` |
| `<artifacts_dir>/process/briefs/` | `<new_process_dir>/briefs/` |
| `<artifacts_dir>/process/code-review/` | `<new_process_dir>/code-review/` |

If the user chose option 2 (`<artifacts_dir>/process`), skip moving process files — they're already in the right place.

#### c. Present dry-run and confirm

```
Layout upgrade plan:

Deliverable moves (dropping deliverables/ prefix):
  <artifacts_dir>/deliverables/architecture/ → <artifacts_dir>/architecture/
  <artifacts_dir>/deliverables/ux/           → <artifacts_dir>/ux/
  <artifacts_dir>/deliverables/product-docs/ → <artifacts_dir>/product-docs/

Convention move:
  <artifacts_dir>/process/conventions/       → <artifacts_dir>/conventions/

Process directory moves:
  <artifacts_dir>/process/planning/          → <new_process_dir>/planning/
  <artifacts_dir>/process/qa/                → <new_process_dir>/qa/
  <artifacts_dir>/process/briefs/            → <new_process_dir>/briefs/
  <artifacts_dir>/process/code-review/       → <new_process_dir>/code-review/

DB config update:
  process_directory: <old_value> → <new_process_dir>

Proceed? (yes/no)
```

Only show sections that have actual moves. Skip sections where files don't exist.

#### d. Execute moves

For each move in the plan:

```bash
mkdir -p "<target_parent>"
mv "<source>" "<target>"
```

After all moves, clean up empty old directories:

```bash
# Remove empty deliverables/ directory if it exists and is now empty
rmdir "<artifacts_dir>/deliverables" 2>/dev/null || true

# Remove empty process/ directory if all contents were moved
rmdir "<artifacts_dir>/process" 2>/dev/null || true
```

#### e. Update DB configuration

If the process_directory changed:

```
project_update(project_root: "<project_root>", process_directory: "<new_process_dir>")
```

#### f. Continue to Step 2

After the upgrade flow completes, continue to Step 2 to scan for any remaining legacy artifacts from even older layouts (pre-rigor locations like `design-system/` at project root, etc.).

---

## Step 2 — Scan for Stale Artifacts

Check each legacy location. Record every hit as a migration action.

### a. `design-system/` at project root

Use Glob to check if `design-system/` exists at the project root.

- **Old:** `<project_root>/design-system/`
- **New:** `<project_root>/<artifacts_dir>/ux/design-system/`
- Skip if already at the new location.

### b. `mockups/` at project root

Use Glob to check if `mockups/` exists at the project root.

- **Old:** `<project_root>/mockups/`
- **New:** `<project_root>/<artifacts_dir>/ux/mockups/`
- Skip if already at the new location.

### c. `planning/` at project root

Use Glob to check if `planning/` exists at the project root.

- **Old:** `<project_root>/planning/`
- **New:** `<project_root>/<process_dir>/planning/`
- Skip if already at the new location.

### d. `screenshots/` at project root

Use Glob to check if `screenshots/` exists at the project root.

- **Old:** `<project_root>/screenshots/`
- **New:** `<project_root>/<process_dir>/qa/screenshots/`
- Skip if already at the new location.

### e. `api_spec.yaml` at project root

Check if `<project_root>/api_spec.yaml` exists.

- **Old:** `<project_root>/api_spec.yaml`
- **New:** `<project_root>/<artifacts_dir>/architecture/api_spec.yaml`
- Skip if the target already exists.

### f. Architecture diagram files under `docs/architecture/`

Use Glob to find `docs/architecture/*.mmd` and `docs/architecture/*.png`.

- **Old:** `<project_root>/docs/architecture/<file>.mmd` (or `.png`)
- **New:** `<project_root>/<artifacts_dir>/architecture/diagrams/<file>.mmd` (or `.png`)
- Skip any file already inside the target location.

### g. Other architecture files under `docs/architecture/`

Use Glob to find all remaining files in `docs/architecture/` (excluding `*.mmd` and
`*.png` already handled in step 2f, and excluding the `diagrams/` subdirectory).

- **Old:** `<project_root>/docs/architecture/<file>`
- **New:** `<project_root>/<artifacts_dir>/architecture/<file>`
- Skip any file already inside the target location.

### h. UX files under `docs/ux/`

Use Glob to check for `docs/ux/design-system/` and `docs/ux/mockups/`.

- **Old:** `<project_root>/docs/ux/design-system/`
- **New:** `<project_root>/<artifacts_dir>/ux/design-system/`

- **Old:** `<project_root>/docs/ux/mockups/`
- **New:** `<project_root>/<artifacts_dir>/ux/mockups/`

- Skip if already at the new location.

### i. Documentation with an intermediate path segment

Use Glob to check for any of these patterns (one intermediate segment between `docs/` and
the audience directory):

```
docs/*/user-guide/
docs/*/how-to/
docs/*/api/
docs/*/sdk/
docs/*/operator/
docs/*/developer/
```

For each hit, record the intermediate segment (e.g., `docs/v1/user-guide/` → segment is
`v1`). The migration flattens by removing the segment and moves to the new location:

- **Old:** `<project_root>/docs/<segment>/<audience>/`
- **New:** `<project_root>/<artifacts_dir>/product-docs/<audience>/`
- If multiple segments exist, flag them all individually.
- Skip if target already exists at the new location.

### j. Bare audience directories under `docs/`

Use Glob to check for audience directories directly under `docs/` (no intermediate
segment):

```
docs/user-guide/
docs/how-to/
docs/api/
docs/sdk/
docs/operator/
docs/developer/
```

- **Old:** `<project_root>/docs/<audience>/`
- **New:** `<project_root>/<artifacts_dir>/product-docs/<audience>/`
- Skip if already at the new location.

### k. `.sdlc/` legacy directory

Use Glob to check if `.sdlc/planning/` or `.sdlc/qa/` exist at the project root.

- **Old:** `<project_root>/.sdlc/planning/`
- **New:** `<project_root>/<process_dir>/planning/`

- **Old:** `<project_root>/.sdlc/qa/`
- **New:** `<project_root>/<process_dir>/qa/`

- Skip if already at the new location.

---

## Step 3 — Dry-Run Report

Before moving anything, print a clear migration plan:

```
Rigor artifact migration plan
artifacts_directory: <artifacts_dir>
process_directory:  <process_dir>

Moves:
  design-system/              →  <artifacts_dir>/ux/design-system/
  mockups/                    →  <artifacts_dir>/ux/mockups/
  planning/                   →  <process_dir>/planning/
  docs/architecture/arch.mmd  →  <artifacts_dir>/architecture/diagrams/arch.mmd
  docs/ux/mockups/            →  <artifacts_dir>/ux/mockups/
  ...

DB updates:
  screen entities with mockup_path starting with old prefixes        — will re-insert with updated path
  ux_asset entities with path starting with old prefixes             — will re-insert with updated path
  WI files referencing old prefixes                                  — will edit in place

Nothing to do:
  screenshots/ — not found
  ...
```

Ask the user to confirm before proceeding. Stop if they decline.

---

## Step 4 — Move Files

For each migration action confirmed in step 3, create the target directory if needed and
move the files:

```bash
mkdir -p <target_parent>
mv <source> <target>
```

Use Bash for directory moves. Do not use Write/Edit for bulk file moves.

After moving each item, confirm the target exists before continuing.

---

## Step 5 — Update Database Path References

### 5a. Screen entities (`mockup_path`)

Query all screen entities:

```
changelog_query(project_root: "<project_root>", entity_type: "screen", include_related: false)
```

Paginate until all records are retrieved. For each screen where `mockup_path` starts with
an old prefix, compute the new path by replacing the old prefix with the new one.
Re-insert using `changelog_insert` with the same `id` and updated `mockup_path` — this
performs an UPSERT:

| Old prefix | New prefix |
|---|---|
| `mockups/` | `<artifacts_dir>/ux/mockups/` |
| `docs/ux/mockups/` | `<artifacts_dir>/ux/mockups/` |

```
changelog_insert(project_root: "<project_root>", entity_type: "screen", iteration_id: <id>, data: {
  id: "SCREEN-001",
  mockup_path: "<artifacts_dir>/ux/mockups/dashboard.html",
  // all other fields unchanged
})
```

### 5b. UX asset entities (`path`)

Query all `ux_asset` entities:

```
changelog_query(project_root: "<project_root>", entity_type: "ux_asset", include_related: false)
```

The old prefixes to check and their replacements are:

| Old prefix | New prefix |
|---|---|
| `mockups/` | `<artifacts_dir>/ux/mockups/` |
| `design-system/` | `<artifacts_dir>/ux/design-system/` |
| `docs/ux/mockups/` | `<artifacts_dir>/ux/mockups/` |
| `docs/ux/design-system/` | `<artifacts_dir>/ux/design-system/` |

For each `ux_asset` whose `path` starts with one of those old prefixes, replace the prefix
and re-insert with the updated `path` using `changelog_insert`. Use the same `name` field;
since `ux_asset` entries are identified by name, this will update the existing record.

---

## Step 6 — Update Work Item Files

WI files in `<process_dir>/planning/iteration-<iteration_id>/phases/` may inline mockup filenames in
their UX context sections.

Use Grep to search for old prefixes inside all WI files:

```bash
grep -r "mockups/" <process_dir>/planning/
grep -r "design-system/" <process_dir>/planning/
grep -r "docs/ux/" <process_dir>/planning/
grep -r "docs/architecture/" <process_dir>/planning/
```

For each match, use Edit to replace the old path prefix with the new one in place.

Also check `<process_dir>/planning/iteration-<iteration_id>/replan-log.md` for any old path references
and update them the same way.

---

## Step 7 — Report

Print a summary of everything that was done:

```
Rigor artifact migration complete

Files moved:
  design-system/             → <artifacts_dir>/ux/design-system/
  mockups/                   → <artifacts_dir>/ux/mockups/
  planning/                  → <process_dir>/planning/
  docs/architecture/arch.mmd → <artifacts_dir>/architecture/diagrams/arch.mmd

DB records updated:
  3 screen entities (mockup_path)
  2 ux_asset entities (path)

WI files edited:
  <process_dir>/planning/iteration-<N>/phases/phase-1/WI-001.md
  <process_dir>/planning/iteration-<N>/phases/phase-1/WI-002.md

Nothing found:
  screenshots/, api_spec.yaml, docs intermediate segments
```

If any step failed (file already exists at target, permission error, etc.), list the
failures separately with the reason and suggested manual remediation.
