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
  - mcp__plugin_rigor_rigor-db__changelog_query
  - mcp__plugin_rigor_rigor-db__changelog_insert
---

# Migrate Rigor Artifact Layout

Scan an existing rigor project for artifacts in legacy locations and migrate them to the
current standard layout. Updates file paths in the database and any work item files that
inline mockup references.

> **project_root** is the directory containing `.claude/`. Determine it at session start
> and use it for every MCP tool call.

---

## Step 1 — Determine Target Layout

Read `.claude/rigor.local.md` (if it exists) and parse the YAML frontmatter to get
`artifacts_directory`.

**If `artifacts_directory` is not set** (file absent or field missing):

Ask the user to choose a value using `AskUserQuestion`:

> "No `artifacts_directory` is configured in `.claude/rigor.local.md`. Where should rigor
> store SDLC process artifacts (UX files, planning, QA screenshots)?"
>
> Options:
> - `.sdlc` — hidden dot-directory, easy to gitignore (recommended)
> - `sdlc` — version-controlled alongside source
> - Custom path — let the user type their own

Once the user provides a value, write it to `.claude/rigor.local.md`:

- If the file already exists: use Edit to add `artifacts_directory: "<value>"` to the
  YAML frontmatter block (inserting it after the opening `---` line).
- If the file does not exist: use Write to create it with this content:

```markdown
---
artifacts_directory: "<value>"
---
```

Confirm the write succeeded before continuing.

```
artifacts_dir = <value chosen/entered by user>
```

The target layout is:

| Artifact | New location |
|---|---|
| UX design system | `docs/ux/design-system/` |
| UX mockups | `docs/ux/mockups/` |
| Planning tree | `<artifacts_dir>/planning/` |
| QA screenshots | `<artifacts_dir>/qa/screenshots/` |
| OpenAPI spec | `docs/architecture/api_spec.yaml` |
| Architecture diagrams | `docs/architecture/diagrams/` |
| Product docs | `docs/<audience>/` (flattened — see step 2f) |

---

## Step 2 — Scan for Stale Artifacts

Check each legacy location. Record every hit as a migration action.

### a. `design-system/` at project root

Use Glob to check if `design-system/` exists at the project root.

- **Old:** `<project_root>/design-system/`
- **New:** `<project_root>/docs/ux/design-system/`
- Skip if already at the new location.

### b. `mockups/` at project root

Use Glob to check if `mockups/` exists at the project root.

- **Old:** `<project_root>/mockups/`
- **New:** `<project_root>/docs/ux/mockups/`
- Skip if already at the new location.

### c. `planning/` at project root

Use Glob to check if `planning/` exists at the project root.

- **Old:** `<project_root>/planning/`
- **New:** `<project_root>/<artifacts_dir>/planning/`
- Skip if already at the new location.

### d. `screenshots/` at project root

Use Glob to check if `screenshots/` exists at the project root.

- **Old:** `<project_root>/screenshots/`
- **New:** `<project_root>/<artifacts_dir>/qa/screenshots/`
- Skip if already at the new location.

### e. `api_spec.yaml` at project root

Check if `<project_root>/api_spec.yaml` exists.

- **Old:** `<project_root>/api_spec.yaml`
- **New:** `<project_root>/docs/architecture/api_spec.yaml`
- Skip if `docs/architecture/api_spec.yaml` already exists.

### f. Architecture diagram files not yet under `diagrams/`

Use Glob to find `docs/architecture/*.mmd` and `docs/architecture/*.png`.

- **Old:** `<project_root>/docs/architecture/<file>.mmd` (or `.png`)
- **New:** `<project_root>/docs/architecture/diagrams/<file>.mmd` (or `.png`)
- Skip any file already inside `docs/architecture/diagrams/`.

### g. Documentation with an intermediate path segment

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
`v1`). The migration flattens by removing the segment:

- **Old:** `<project_root>/docs/<segment>/<audience>/`
- **New:** `<project_root>/docs/<audience>/`
- If multiple segments exist, flag them all individually.
- Skip if target already exists at the flat location.

---

## Step 3 — Dry-Run Report

Before moving anything, print a clear migration plan:

```
Rigor artifact migration plan
artifacts_directory: <artifacts_dir>

Moves:
  design-system/  →  docs/ux/design-system/
  mockups/        →  docs/ux/mockups/
  planning/       →  <artifacts_dir>/planning/
  ...

DB updates:
  screen entities with mockup_path starting with "mockups/"           — will re-insert with updated path
  ux_asset entities with path starting with "mockups/"                — will re-insert with updated path
  ux_asset entities with path starting with "design-system/"          — will re-insert with updated path
  WI files referencing "mockups/" or "design-system/"                 — will edit in place

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
an old prefix (e.g., `mockups/`), compute the new path by replacing the old prefix with
the new one (e.g., `docs/ux/mockups/`). Re-insert using `changelog_insert` with
the same `id` and updated `mockup_path` — this performs an UPSERT:

```
changelog_insert(project_root: "<project_root>", entity_type: "screen", iteration_id: <id>, data: {
  id: "SCREEN-001",
  mockup_path: "docs/ux/mockups/dashboard.html",
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
| `mockups/` | `docs/ux/mockups/` |
| `design-system/` | `docs/ux/design-system/` |

For each `ux_asset` whose `path` starts with one of those old prefixes, replace the prefix
and re-insert with the updated `path` using `changelog_insert`. Use the same `name` field;
since `ux_asset` entries are identified by name, this will update the existing record.

---

## Step 6 — Update Work Item Files

WI files in `planning/phases/` (now `<artifacts_dir>/planning/phases/`) may inline mockup
filenames in their UX context sections.

Use Grep to search for old prefixes inside all WI files:

```bash
grep -r "mockups/" <artifacts_dir>/planning/
grep -r "design-system/" <artifacts_dir>/planning/
```

For each match, use Edit to replace the old path prefix with the new one in place.

Also check `planning/replan-log.md` (now `<artifacts_dir>/planning/replan-log.md`) for any
old path references and update them the same way.

---

## Step 7 — Report

Print a summary of everything that was done:

```
Rigor artifact migration complete

Files moved:
  design-system/             → docs/ux/design-system/
  mockups/                   → docs/ux/mockups/
  planning/                  → <artifacts_dir>/planning/
  docs/architecture/arch.mmd → docs/architecture/diagrams/arch.mmd

DB records updated:
  3 screen entities (mockup_path)
  2 ux_asset entities (path)

WI files edited:
  <artifacts_dir>/planning/phases/phase-1/WI-001.md
  <artifacts_dir>/planning/phases/phase-1/WI-002.md

Nothing found:
  screenshots/, api_spec.yaml, docs intermediate segments
```

If any step failed (file already exists at target, permission error, etc.), list the
failures separately with the reason and suggested manual remediation.
