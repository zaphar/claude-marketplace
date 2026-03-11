---
description: Import existing data into the changelog database
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
  - mcp__plugin_rigor_rigor-db__project_status
  - mcp__plugin_rigor_rigor-db__iteration_create
  - mcp__plugin_rigor_rigor-db__changelog_insert
  - mcp__plugin_rigor_rigor-db__revision_create
  - mcp__plugin_rigor_rigor-db__revision_update
  - mcp__plugin_rigor_rigor-db__phase_transition
---

# Import Existing Data into the Changelog Database

Read an existing file (requirements doc, design spec, PRD, meeting notes, YAML, JSON, markdown, or any freeform text) and bulk-import its contents into the rigor changelog database using a single `bulk_import` call.

## What This Command Does

1. Accepts a file path to import (from command argument or user prompt)
2. Reads and analyzes the file to identify entity types and phases
3. Shows a preview and asks the user to confirm before writing anything
4. Calls `bulk_import` to atomically insert all entities in a single transaction
5. Displays a summary of what was imported

## Implementation Steps

> **Always include `project_root` in every MCP tool call**, set to the absolute path of the current project's root directory.

### 1. Get File Path

If the user passed a file path as a command argument, use it directly.

Otherwise, use AskUserQuestion to ask:

```
What file would you like to import?

Provide the path to your file (absolute or relative to the project root).
Accepted formats: YAML, JSON, Markdown, plain text, PRD docs, meeting notes, design specs — any format.
```

Validate the file exists. If it does not:

```
ERROR: File not found: <file_path>

Please check the path and try again.
```

If the file is empty:

```
ERROR: The file at <file_path> is empty. Nothing to import.
```

### 2. Read and Analyze File

Read the full contents of the file using the Read tool.

Detect the format (YAML, JSON, Markdown, freeform text, etc.) from the file extension and/or content structure.

Use your reasoning to extract structured entities from the content — even if the file is freeform prose, apply judgment to identify what maps to which entity types. Do not ask the user for help identifying entities unless the content is genuinely ambiguous (see step 3).

**Entity Type → Phase Mapping:**

| Phase | Entity Types |
|-------|-------------|
| `requirements` | `persona`, `requirement`, `project_context`, `data_exchange`, `nonfunctional_requirement` |
| `ux_design` | `user_flow`, `screen`, `info_architecture`, `persona_addressed`, `ux_asset` |
| `architecture` | `adr`, `adr_decision`, `component`, `approved_dependency`, `requirement_trace` |
| `planning` | `work_item`, `plan_overview`, `plan_external_dependency` |

**ID Generation Rules:**

- Requirements: `REQ-001`, `REQ-002`, … (sequential, zero-padded to 3 digits)
- Components: `COMP-001`, `COMP-002`, …
- ADRs: `ADR-001`, `ADR-002`, …
- User flows: `FLOW-001`, `FLOW-002`, …
- Screens: `SCREEN-001`, `SCREEN-002`, …
- Personas: `PERSONA-001`, `PERSONA-002`, …

If the source file already contains IDs in a compatible format, preserve them. If IDs are missing or in an incompatible format, generate new ones.

**Traceability:** When relationships between entities are detectable (e.g., a requirement mentions a persona, an ADR references a requirement), include `requirement_trace` entries in the entities array to link them.

### 3. Show Import Preview

Before writing anything to the database, display a preview of what was detected:

```
📋 Import Preview

File: <file_path>
Format: <detected_format>

Detected entities:
  requirements phase:
    - X personas
    - Y requirements

  architecture phase:
    - Z ADRs
    - W components

  (list all detected phases and entity counts)

Total entities: <count>
```

Then use AskUserQuestion to ask:

```
Does this look correct?

1. Proceed with import
2. Adjust — let me describe what's wrong
3. Cancel import
```

If the user selects **Adjust**, ask them to describe the issue and apply corrections before showing the preview again.

If the user selects **Cancel**, stop with:

```
Import cancelled. No data was written.
```

If the detected entity count is zero for all phases, stop with:

```
No recognizable entities were found in <file_path>.

The file may not contain structured SDLC data, or the format may be unexpected.
Suggestions:
  - Check that the file contains requirements, architecture decisions, personas, or similar content
  - Try converting the file to Markdown or YAML and re-importing
```

If any content is ambiguous (e.g., unclear whether something is a persona or a requirement, or an entity spans multiple phases), ask the user for clarification before proceeding. Use AskUserQuestion to surface the specific ambiguity.

### 4. Bulk Import

Call `bulk_import` with all extracted entities in a single call:

```
bulk_import({
  project_root: "<project_root>",
  entities: [
    { entity_type: "persona", data: { id: "PERSONA-001", name: "...", ... } },
    { entity_type: "requirement", data: { id: "REQ-001", description: "...", ... } },
    { entity_type: "component", data: { id: "COMP-001", name: "...", ... } },
    { entity_type: "requirement_trace", data: { requirement_id: "REQ-001", addressed_by: "COMP-001", addressed_by_type: "component" } },
    ...
  ]
})
```

The tool handles all orchestration automatically:
- Uses the current active iteration, or bootstraps a new project and iteration if none exists
- Groups entities by phase in canonical order (requirements → ux_design → architecture → planning)
- Orders entities within each phase so dependencies are inserted first (e.g., personas before requirements)
- Creates a revision per phase, inserts entities, and approves the revision
- Completes phases that were pending; leaves in-progress or completed phases untouched
- All inserts happen in a single atomic transaction — if any entity fails, everything rolls back

**Error handling:** If `bulk_import` returns an error, display the error message to the user. The error will indicate which specific entity failed. No data was written because the transaction rolled back. The user can fix the issue and re-run the import.

### 5. Show Summary

Display the summary from the `bulk_import` response:

```
✅ Import Complete

File: <file_path>
Iteration: <result.iteration_id>

Imported:
  - X personas
  - Y requirements
  - Z ADRs
  - W components
  - ... (from result.imported object)

Total entities: <result.total_entities>
Phases processed: <result.phases_processed>
```

If `result.bootstrapped` is true, mention:

```
ℹ️  New project and iteration were created for this import.
```

Suggest next steps:

```
Next steps:
  - Use /rigor:resume to continue the workflow from where you left off
  - Use /rigor:dev-status to review the current project state
```

## Important Notes

- **Any file format is accepted.** Use reasoning to extract structured entities from freeform text, prose documents, spreadsheet exports, and any other format.
- **Only process detected phases.** If the file contains only requirements, only requirements entities are included.
- **Preserve existing data.** The import creates new revisions. Entities with existing IDs are upserted.
- **Atomic operation.** The entire import succeeds or fails as a unit. No partial imports — fix the error and retry.
- **When in doubt, ask.** If content is ambiguous, use AskUserQuestion rather than guessing.
