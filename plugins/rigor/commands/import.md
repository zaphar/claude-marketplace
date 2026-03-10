---
description: Import existing data into the changelog database
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

# Import Existing Data into the Changelog Database

Read an existing file (requirements doc, design spec, PRD, meeting notes, YAML, JSON, markdown, or any freeform text) and bulk-import its contents into the rigor changelog database.

## What This Command Does

1. Accepts a file path to import (from command argument or user prompt)
2. Reads and analyzes the file to identify entity types and phases
3. Shows a preview and asks the user to confirm before writing anything
4. Checks project state and bootstraps an iteration if necessary
5. Imports entities phase by phase via `changelog_insert`
6. Displays a summary of what was imported

## Implementation Steps

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
| `requirements` | `persona`, `requirement` (with `acceptance_criteria`, `user_stories`, `dependencies`) |
| `ux_design` | `user_flow`, `screen` |
| `architecture` | `adr`, `component`, `approved_dependency` (with optional `category` for technology grouping) |
| `planning` | `work_item`, `plan_overview` |

**ID Generation Rules:**

- Requirements: `REQ-001`, `REQ-002`, … (sequential, zero-padded to 3 digits)
- Components: `COMP-001`, `COMP-002`, …
- ADRs: `ADR-001`, `ADR-002`, …
- User flows: `FLOW-001`, `FLOW-002`, …
- Screens: `SCREEN-001`, `SCREEN-002`, …
- Personas: `PERSONA-001`, `PERSONA-002`, …

If the source file already contains IDs in a compatible format, preserve them. If IDs are missing or in an incompatible format, generate new ones.

**Traceability:** When relationships between entities are detectable (e.g., a requirement mentions a persona, an ADR references a requirement), plan to create `requirement_trace` entries to link them.

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

Phases to be processed: <comma-separated list in phase order>
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

### 4. Check Project State

Call `project_status()` to determine the current state:

```
project_status()
```

**Case A — No project exists:**

Call `iteration_create` to bootstrap a new project and iteration:

```
iteration_create({
  project_name: "<inferred_from_cwd_or_file_name>",
  artifacts_directory: ".claude/rigor-artifacts",
  critic_model: "sonnet",
  starting_phase: "<first_detected_phase>"
})
```

Inform the user:

```
No project found. Bootstrapped a new project and iteration to hold the imported data.
```

**Case B — Project exists with an active iteration:**

Use the current iteration ID from `project_status`. No action needed.

**Case C — Project exists but the iteration is closed:**

Use AskUserQuestion to ask:

```
The current iteration is closed.

How would you like to proceed?
1. Create a new iteration and import into it
2. Cancel import
```

If the user selects **Create new iteration**, call `iteration_create` to open a new iteration, then continue.

If the user selects **Cancel**, stop with:

```
Import cancelled. No data was written.
```

### 5. Import Data Phase by Phase

Process detected phases in canonical order: `requirements` → `ux_design` → `architecture` → `planning`.

Only process phases for which entities were detected in step 2. Do not touch phases with no detected data.

For each phase with detected entities:

#### 5a. Transition Phase to In Progress

Check the current phase status via `project_status`. If the phase is not already `in_progress`, call:

```
phase_transition({ phase: "<phase_id>", status: "in_progress" })
```

#### 5b. Create Import Revision

```
revision_create({
  phase_id: "<phase_id>",
  producer_agent: "import"
})
```

Record the returned `revision_id` — use it when calling `revision_update` to approve the revision after entity inserts.

#### 5c. Insert Entities

For each entity extracted for this phase, call `changelog_insert`:

```
changelog_insert({
  entity_type: "<entity_type>",
  iteration_id: <current_iteration_id>,
  data: { <extracted_entity_fields> }
})
```

Insert entities in a logical order within each phase (e.g., personas before requirements, so requirements can reference them).

If a `changelog_insert` call fails:
- Record which entity failed and the error message
- Continue importing remaining entities
- Report failures in the final summary (do not abort the entire import)

After all entities for this phase are inserted, create `requirement_trace` entries for any detectable relationships:

```
changelog_insert({
  entity_type: "requirement_trace",
  iteration_id: <current_iteration_id>,
  data: {
    source_id: "<entity_id>",
    target_id: "<related_entity_id>",
    relationship: "<relationship_type>"
  }
})
```

#### 5d. Approve the Revision

```
revision_update({
  revision_id: <import_revision_id>,
  status: "approved",
  critic_agent: "import",
  critic_feedback: "Imported from user-provided file: <file_path>"
})
```

#### 5e. Mark Phase Completed

```
phase_transition({
  phase: "<phase_id>",
  status: "completed",
  approved_by: "import"
})
```

### 6. Show Summary

After all phases are processed, display the final summary:

```
✅ Import Complete

File: <file_path>
Iteration: <iteration_id>

Imported:
  - X requirements
  - Y personas
  - Z ADRs
  - W components
  - V user flows
  - ... (all imported entity types and counts)

Phases completed: <comma-separated list>

Traceability mappings created: <count>
```

If any entities failed to import, append:

```
⚠️  Partial import — some entities were not imported:

  - <entity_type> "<entity_id_or_name>": <error_message>
  - ...

Review the errors above. You can re-run the import with a corrected file,
or use /rigor:resume to continue the workflow and address gaps manually.
```

If all phases completed successfully, suggest next steps:

```
Next steps:
  - Use /rigor:resume to continue the workflow from where you left off
  - Use /rigor:dev-status to review the current project state
```

## Important Notes

- **Any file format is accepted.** The orchestrator should use its reasoning to extract structured entities from freeform text, prose documents, spreadsheet exports, and any other format. If the content clearly describes requirements, architecture decisions, or personas — extract them, even if the source document uses different terminology.
- **Only process detected phases.** If the file contains only requirements, only the `requirements` phase is processed. Other phases are left untouched.
- **Preserve existing data.** The import does not overwrite existing entries. Each import run creates a new revision, so prior entries remain intact and queryable.
- **Phase order matters.** Always process phases in canonical order (requirements → ux_design → architecture → planning) so that cross-phase traceability references are valid at insert time.
- **When in doubt, ask.** If content is ambiguous — unclear phase, ambiguous entity type, missing required fields — use AskUserQuestion rather than guessing. A targeted question is better than a wrong assumption that corrupts the data.
