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

**If the project exists**, extract `artifacts_directory` from the response:

```
artifacts_dir = project.artifacts_directory
```

The target layout is:

| Artifact | New location |
|---|---|
| UX design system | `<artifacts_dir>/deliverables/ux/design-system/` |
| UX mockups | `<artifacts_dir>/deliverables/ux/mockups/` |
| Planning tree | `<artifacts_dir>/process/planning/` |
| QA screenshots | `<artifacts_dir>/process/qa/screenshots/` |
| OpenAPI spec | `<artifacts_dir>/deliverables/architecture/api_spec.yaml` |
| Architecture diagrams | `<artifacts_dir>/deliverables/architecture/diagrams/` |
| Architecture docs | `<artifacts_dir>/deliverables/architecture/` |
| Product docs | `<artifacts_dir>/deliverables/product-docs/<audience>/` |

The canonical subtree structure beneath `artifacts_directory` is:

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

---

## Step 2 — Scan for Stale Artifacts

Check each legacy location. Record every hit as a migration action.

### a. `design-system/` at project root

Use Glob to check if `design-system/` exists at the project root.

- **Old:** `<project_root>/design-system/`
- **New:** `<project_root>/<artifacts_dir>/deliverables/ux/design-system/`
- Skip if already at the new location.

### b. `mockups/` at project root

Use Glob to check if `mockups/` exists at the project root.

- **Old:** `<project_root>/mockups/`
- **New:** `<project_root>/<artifacts_dir>/deliverables/ux/mockups/`
- Skip if already at the new location.

### c. `planning/` at project root

Use Glob to check if `planning/` exists at the project root.

- **Old:** `<project_root>/planning/`
- **New:** `<project_root>/<artifacts_dir>/process/planning/`
- Skip if already at the new location.

### d. `screenshots/` at project root

Use Glob to check if `screenshots/` exists at the project root.

- **Old:** `<project_root>/screenshots/`
- **New:** `<project_root>/<artifacts_dir>/process/qa/screenshots/`
- Skip if already at the new location.

### e. `api_spec.yaml` at project root

Check if `<project_root>/api_spec.yaml` exists.

- **Old:** `<project_root>/api_spec.yaml`
- **New:** `<project_root>/<artifacts_dir>/deliverables/architecture/api_spec.yaml`
- Skip if the target already exists.

### f. Architecture diagram files under `docs/architecture/`

Use Glob to find `docs/architecture/*.mmd` and `docs/architecture/*.png`.

- **Old:** `<project_root>/docs/architecture/<file>.mmd` (or `.png`)
- **New:** `<project_root>/<artifacts_dir>/deliverables/architecture/diagrams/<file>.mmd` (or `.png`)
- Skip any file already inside the target location.

### g. Other architecture files under `docs/architecture/`

Use Glob to find all remaining files in `docs/architecture/` (excluding `*.mmd` and
`*.png` already handled in step 2f, and excluding the `diagrams/` subdirectory).

- **Old:** `<project_root>/docs/architecture/<file>`
- **New:** `<project_root>/<artifacts_dir>/deliverables/architecture/<file>`
- Skip any file already inside the target location.

### h. UX files under `docs/ux/`

Use Glob to check for `docs/ux/design-system/` and `docs/ux/mockups/`.

- **Old:** `<project_root>/docs/ux/design-system/`
- **New:** `<project_root>/<artifacts_dir>/deliverables/ux/design-system/`

- **Old:** `<project_root>/docs/ux/mockups/`
- **New:** `<project_root>/<artifacts_dir>/deliverables/ux/mockups/`

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
- **New:** `<project_root>/<artifacts_dir>/deliverables/product-docs/<audience>/`
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
- **New:** `<project_root>/<artifacts_dir>/deliverables/product-docs/<audience>/`
- Skip if already at the new location.

### k. `.sdlc/` legacy directory

Use Glob to check if `.sdlc/planning/` or `.sdlc/qa/` exist at the project root.

- **Old:** `<project_root>/.sdlc/planning/`
- **New:** `<project_root>/<artifacts_dir>/process/planning/`

- **Old:** `<project_root>/.sdlc/qa/`
- **New:** `<project_root>/<artifacts_dir>/process/qa/`

- Skip if already at the new location.

---

## Step 3 — Dry-Run Report

Before moving anything, print a clear migration plan:

```
Rigor artifact migration plan
artifacts_directory: <artifacts_dir>

Moves:
  design-system/              →  <artifacts_dir>/deliverables/ux/design-system/
  mockups/                    →  <artifacts_dir>/deliverables/ux/mockups/
  planning/                   →  <artifacts_dir>/process/planning/
  docs/architecture/arch.mmd  →  <artifacts_dir>/deliverables/architecture/diagrams/arch.mmd
  docs/ux/mockups/            →  <artifacts_dir>/deliverables/ux/mockups/
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
| `mockups/` | `<artifacts_dir>/deliverables/ux/mockups/` |
| `docs/ux/mockups/` | `<artifacts_dir>/deliverables/ux/mockups/` |

```
changelog_insert(project_root: "<project_root>", entity_type: "screen", iteration_id: <id>, data: {
  id: "SCREEN-001",
  mockup_path: "<artifacts_dir>/deliverables/ux/mockups/dashboard.html",
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
| `mockups/` | `<artifacts_dir>/deliverables/ux/mockups/` |
| `design-system/` | `<artifacts_dir>/deliverables/ux/design-system/` |
| `docs/ux/mockups/` | `<artifacts_dir>/deliverables/ux/mockups/` |
| `docs/ux/design-system/` | `<artifacts_dir>/deliverables/ux/design-system/` |

For each `ux_asset` whose `path` starts with one of those old prefixes, replace the prefix
and re-insert with the updated `path` using `changelog_insert`. Use the same `name` field;
since `ux_asset` entries are identified by name, this will update the existing record.

---

## Step 6 — Update Work Item Files

WI files in `<artifacts_dir>/process/planning/phases/` may inline mockup filenames in
their UX context sections.

Use Grep to search for old prefixes inside all WI files:

```bash
grep -r "mockups/" <artifacts_dir>/process/planning/
grep -r "design-system/" <artifacts_dir>/process/planning/
grep -r "docs/ux/" <artifacts_dir>/process/planning/
grep -r "docs/architecture/" <artifacts_dir>/process/planning/
```

For each match, use Edit to replace the old path prefix with the new one in place.

Also check `<artifacts_dir>/process/planning/replan-log.md` for any old path references
and update them the same way.

---

## Step 7 — Report

Print a summary of everything that was done:

```
Rigor artifact migration complete

Files moved:
  design-system/             → <artifacts_dir>/deliverables/ux/design-system/
  mockups/                   → <artifacts_dir>/deliverables/ux/mockups/
  planning/                  → <artifacts_dir>/process/planning/
  docs/architecture/arch.mmd → <artifacts_dir>/deliverables/architecture/diagrams/arch.mmd

DB records updated:
  3 screen entities (mockup_path)
  2 ux_asset entities (path)

WI files edited:
  <artifacts_dir>/process/planning/phases/phase-1/WI-001.md
  <artifacts_dir>/process/planning/phases/phase-1/WI-002.md

Nothing found:
  screenshots/, api_spec.yaml, docs intermediate segments
```

If any step failed (file already exists at target, permission error, etc.), list the
failures separately with the reason and suggested manual remediation.
