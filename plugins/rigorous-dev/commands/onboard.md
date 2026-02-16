---
description: Onboard an existing codebase to the rigorous development workflow
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---

# Onboard Existing Codebase to Rigorous Development Workflow

Bootstrap the rigorous development workflow for an existing codebase by having agents explore and document the current architecture and UX rather than designing from scratch.

## What This Command Does

1. Checks if a workflow already exists (error if it does)
2. Prompts user for project configuration
3. Creates artifacts directory
4. Initializes workflow state file
5. Explores the codebase to document existing UX design (if visual project)
6. Explores the codebase to document existing architecture
7. Finalizes state ready for first requirements iteration

## Implementation Steps

### 1. Check for Existing Workflow

First, check if `.claude/rigorous-dev-state.yaml` already exists:

```bash
if [ -f .claude/rigorous-dev-state.yaml ]; then
  echo "ERROR: A workflow already exists in this project."
  echo "Use /rigorous-dev:resume to continue the existing workflow."
  echo "Use /rigorous-dev:close to close it, then /rigorous-dev:new-iteration to start fresh."
  exit 1
fi
```

### 2. Gather Configuration

Use AskUserQuestion to prompt for:

- **Project name**: Default to current directory name if not provided
- **Artifacts directory**: Default to `.claude/rigorous-dev-artifacts`
- **Project type**: Whether the project has a visual UI (web/desktop/mobile app) or is non-visual (CLI/library/API-only). This determines whether the UX design phase runs or is skipped.

If user wants artifacts version-controlled, suggest a non-.claude path like `./docs/sdlc-artifacts`.

### 3. Create Artifacts Directory

Create the configured artifacts directory:

```bash
mkdir -p "<artifacts_directory>"
```

### 4. Initialize State File

Create `.claude/rigorous-dev-state.yaml`.

**If the project has a visual UI**, set up for UX design first:

```yaml
workflow_id: "rigorous-dev-workflow"
project_name: "<user_provided_or_inferred>"
created_at: "<current_timestamp_ISO8601>"
updated_at: "<current_timestamp_ISO8601>"
current_phase: "ux_design"
artifacts_directory: "<user_configured_path>"
iteration_number: 1
status: "active"
closed_at: null
notes: "Onboarding from existing codebase"
phase_status:
  requirements:
    status: "skipped"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: "Skipped during onboarding — requirements will be gathered in first iteration after onboarding completes"
  ux_design:
    status: "in_progress"
    started_at: "<current_timestamp_ISO8601>"
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: "Onboarding: documenting existing UX from codebase"
  architecture:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
  planning:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
  implementation:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    current_phase_number: null
    notes: ""
  qa:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
  documentation:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
  release:
    status: "pending"
    started_at: null
    completed_at: null
    artifact_path: null
    approved_by: null
    iteration_count: 0
    notes: ""
```

**If the project is non-visual**, set `current_phase: "architecture"` and mark UX design as skipped:

```yaml
# Same structure as above, but with these differences:
current_phase: "architecture"
phase_status:
  requirements:
    status: "skipped"
    notes: "Skipped during onboarding — requirements will be gathered in first iteration after onboarding completes"
  ux_design:
    status: "skipped"
    notes: "Non-visual project — no UX design needed"
  architecture:
    status: "in_progress"
    started_at: "<current_timestamp_ISO8601>"
    notes: "Onboarding: documenting existing architecture from codebase"
  # ... all other phases "pending" as above
```

### 5. Load Rigorous Dev Skill

After state file is created, load the rigorous-dev skill (`skills/rigorous-dev/SKILL.md`) for orchestration context. This provides the phase transition rules, artifact management patterns, and producer-critic loop mechanics.

### 6. Run UX Design Documentation (Visual Projects Only)

**Skip this step entirely if the project is non-visual.** Proceed directly to step 7.

#### 6a. Load UX Designer with Documentation Mode Override

Load `agents/ux_designer.md`, then apply these **Documentation Mode Overrides** that replace the agent's normal interview-driven behavior:

**DISABLED behaviors (do NOT perform these during onboarding):**
- User interviews and design direction questions
- Design variation generation (no "3 distinct variations" phase)
- User approval gates between screens
- "Show don't tell" HTML samples for preference gathering
- Proactive design suggestions and UX recommendations
- Asking the user about color preferences, aesthetic spectrums, or layout choices

**ENABLED behaviors (do these instead):**
- Systematically explore the codebase using Glob, Grep, and Read to discover the existing UI:
  - HTML templates, JSX/TSX components, Vue/Svelte files, template engines
  - CSS/SCSS/LESS files, Tailwind config, CSS-in-JS, styled-components
  - Design tokens, theme files, color definitions, typography settings
  - Component libraries and UI framework configs (e.g., `tailwind.config.*`, `theme.*`, `tokens.*`)
  - UI dependencies in package files (package.json, Cargo.toml, etc.)
  - Routing/navigation configuration files
  - Layout components, responsive breakpoints, media queries
  - Icon sets, image assets, font declarations
  - Form components, validation patterns, error display patterns
  - Loading states, empty states, skeleton screens

**GOAL:** Document what EXISTS in the codebase, not design what SHOULD exist.

**Output artifacts** (same structure as normal UX designer output):
- `ux_specification.yaml` — validated against `schemas/ux_specification.schema.yaml`
- `design-system/` subdirectory — HTML document showing the extracted design system (colors, typography, spacing, components found in the code)
- Screen documentation referencing source files rather than creating new mockups

**Schema compliance for onboarding:**
- `metadata.requirements_version`: set to `"onboarding-inferred"`
- `personas_addressed` (required, minItems: 1): Infer personas from the app's purpose, UI patterns, and any user-facing documentation. Create at least one placeholder persona (e.g., `PERSONA-001`) describing the apparent target user.
- `user_flows` (required, minItems: 1): Infer flows from routing configuration, navigation structure, and page/screen organization. Create at least one flow documenting a primary user journey found in the code.
- `requirements_mapping` (required, minItems: 1): Create placeholder entries with `REQ-001`, `REQ-002`, etc. describing inferred functionality areas discovered in the codebase. Each entry should describe what the code does, not what it should do.

#### 6b. Run UX Critic with Onboarding Override

Load `agents/ux_critic.md`, then apply these **Onboarding Critic Overrides**:

**SKIP these checks during onboarding:**
- Requirements traceability ("every user-facing REQ-XXX has UX coverage") — there are no real requirements yet
- "Every SCREEN-XXX has a corresponding HTML mockup file in `mockups/`" — source file references are acceptable instead of new mockups
- Verification against a requirements specification document (none exists yet)

**FOCUS on these checks instead:**
- Schema compliance: document validates against `schemas/ux_specification.schema.yaml`
- Completeness of codebase documentation: are the major UI areas captured?
- Internal consistency: do IDs cross-reference correctly, are flows coherent?
- Design system accuracy: do extracted colors/typography/spacing match what's in the code?
- Accept `"onboarding-inferred"` as a valid `requirements_version`
- Accept placeholder `REQ-XXX` entries in `requirements_mapping`
- Accept placeholder `PERSONA-XXX` entries inferred from codebase

#### 6c. Producer-Critic Loop

Run the standard producer-critic loop (up to 3 iterations):

1. UX Designer (documentation mode) produces artifact
2. UX Critic (onboarding mode) reviews
3. If approved: mark `ux_design` phase completed, record `approved_by: "ux_critic"` and `artifact_path`
4. If rejected: send feedback to designer, increment `iteration_count`, loop (max 3)
5. If 3 iterations without approval: escalate to user

After approval, transition to architecture phase: set `architecture.status: "in_progress"`, `architecture.started_at`, update `current_phase: "architecture"`.

### 7. Run Architecture Documentation

#### 7a. Load Backend Architect with Documentation Mode Override

Load `agents/backend_architect.md`, then apply these **Documentation Mode Overrides**:

**DISABLED behaviors (do NOT perform these during onboarding):**
- Validating requirements and UX specifications as inputs (they don't exist yet, or were just produced by onboarding)
- User consultation on technology choices (the choices are already made in the code)
- Designing new architecture or proposing architectural changes
- Requirements mapping from real REQ-XXX identifiers
- Asking the user about language preferences, framework choices, or deployment targets

**ENABLED behaviors (do these instead):**
- Systematically explore the codebase using Glob, Grep, and Read to discover the existing architecture:
  - Project configuration files: `Cargo.toml`, `package.json`, `go.mod`, `pom.xml`, `build.gradle`, `pyproject.toml`, `Gemfile`, `*.csproj`, etc.
  - Source directory structure and module organization
  - API endpoint definitions (routes, controllers, handlers)
  - Database schemas, migrations, ORM models, type definitions
  - Deployment configurations: `Dockerfile`, `docker-compose.yaml`, Kubernetes manifests, CI/CD pipelines
  - Logging, metrics, and tracing setup
  - Authentication and authorization code
  - Service boundaries and communication patterns (HTTP clients, message queue consumers/producers, gRPC definitions)
  - Configuration management (env vars, config files, secrets references)
  - Test structure and testing patterns
  - Existing architecture documentation (ARCHITECTURE.md, ADRs, design docs)

**GOAL:** Document the EXISTING architecture, not design a new one.

**Specific extraction guidance:**
- Extract the actual language, frameworks, and databases from code — do not ask the user
- Map source modules/packages to `COMP-XXX` component identifiers
- Extract data models from database schemas, ORM models, or type definitions
- Look for existing ADR or ARCHITECTURE.md documents and incorporate their content
- Document actual deployment targets found in configs, not hypothetical ones
- Record architectural decisions that are evident from the code (e.g., "chose SQLite for embedded storage" evident from dependencies)

**Output artifact:**
- `backend_architecture.yaml` — validated against `schemas/backend_architecture.schema.yaml`

**Schema compliance for onboarding:**
- `metadata.requirements_version`: set to `"onboarding-inferred"`
- `metadata.ux_specification_version`: set to `"onboarding-inferred"` (or reference the version from the just-produced UX spec if one was created in step 6)
- `requirements_mapping` (required, minItems: 1): Create placeholder entries with `REQ-001`, `REQ-002`, etc. describing inferred functionality areas. Each entry maps to the components that implement it.
- `components` (required, minItems: 1): Map discovered source modules to `COMP-XXX` identifiers
- `technology_choices.language` and `technology_choices.language_rationale`: Extract from project config; rationale can note "existing codebase choice"

#### 7b. Run Architecture Critic with Onboarding Override

Load `agents/architecture_critic.md`, then apply these **Onboarding Critic Overrides**:

**SKIP these checks during onboarding:**
- Requirements traceability ("every REQ-XXX has corresponding architectural coverage") — requirements are placeholders
- UX support checks ("every SCREEN-XXX has API endpoints") — UX spec is onboarding-inferred or absent
- Verification against requirements or UX specification documents

**FOCUS on these checks instead:**
- Schema compliance: document validates against `schemas/backend_architecture.schema.yaml`
- Completeness: are the major architectural components captured?
- Accuracy: do technology choices match what's actually in the code?
- Internal consistency: do component dependencies form a valid DAG, do IDs cross-reference correctly?
- Accept `"onboarding-inferred"` as valid for `requirements_version` and `ux_specification_version`
- Accept placeholder `REQ-XXX` entries in `requirements_mapping`

#### 7c. Producer-Critic Loop

Run the standard producer-critic loop (up to 3 iterations):

1. Backend Architect (documentation mode) produces artifact
2. Architecture Critic (onboarding mode) reviews
3. If approved: mark `architecture` phase completed, record `approved_by: "architecture_critic"` and `artifact_path`
4. If rejected: send feedback to architect, increment `iteration_count`, loop (max 3)
5. If 3 iterations without approval: escalate to user

### 8. Finalize State

After both documentation phases complete (or just architecture for non-visual projects), update the state file:

```yaml
current_phase: "requirements"
updated_at: "<current_timestamp_ISO8601>"
phase_status:
  requirements:
    status: "pending"
    notes: "Ready for first requirements gathering iteration"
  ux_design:
    status: "completed"  # or "skipped" for non-visual
    completed_at: "<timestamp>"
    approved_by: "ux_critic"
    artifact_path: "<path_to_ux_design_directory>"
  architecture:
    status: "completed"
    completed_at: "<timestamp>"
    approved_by: "architecture_critic"
    artifact_path: "<path_to_architecture_directory>"
```

### 9. Success Message

Display a clear summary:

```
Onboarding Complete!

Project: <project_name>
Artifacts: <artifacts_directory>

Documented:
  UX Design: <artifact_path> (or "Skipped — non-visual project")
  Architecture: <artifact_path>

The existing codebase has been documented. The workflow is now ready
for its first requirements gathering iteration.

Next step: Use /rigorous-dev:resume to begin the Requirements phase,
where you can define what you want to build or change next.
```

## Non-Visual Project Path Summary

If the user indicates the project has no visual UI (CLI tool, library, API-only service):

1. Skip UX design entirely — mark as `"skipped"` with note `"Non-visual project — no UX design needed"`
2. Set `current_phase: "architecture"` in initial state
3. Run only the architecture documentation (step 7)
4. Finalize state with `current_phase: "requirements"` as normal
