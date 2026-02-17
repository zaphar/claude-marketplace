# Rigorous Software Development Workflow Plugin

A comprehensive Claude Code plugin that guides you through creating or modifying software with high rigor using specialized agents, structured specifications, and producer-critic validation patterns.

## Overview

This plugin implements a complete Software Development Life Cycle (SDLC) with the following phases:

```
Requirements → UX Design → Architecture → Planning → Implementation → QA → Audit → Documentation → Release
```

Each phase uses specialized agents with producer-critic patterns to ensure quality and completeness. UX design happens before architecture to ensure the backend is designed to support the user experience.

## Features

- **Structured Workflow**: Step-by-step guidance through the complete SDLC
- **Producer-Critic Pattern**: Every artifact is reviewed and validated before proceeding
- **Schema Validation**: All outputs conform to well-defined YAML schemas
- **Iterative Refinement**: Feedback loops for continuous improvement
- **Review Checkpoints**: Strategic pauses during implementation for user feedback
- **State Management**: Resume workflows across sessions
- **Parallel Execution**: Architecture and UX design can proceed in parallel

## Agents

### Requirements Phase
- **Requirements Analyst**: Conducts conversational interviews and produces formal requirements specification
- **Requirements Critic**: Validates requirements for completeness and consistency

### Architecture/Design Phase
- **Backend Architect**: Designs backend architecture, APIs, data models
- **Architecture Critic**: Validates architectural decisions
- **UX Designer**: Creates user experience specifications and wireframes
- **UX Critic**: Validates UX design decisions

### Planning Phase
- **Implementation Planner**: Creates phased implementation plan with strategic checkpoints
- **Implementation Plan Critic**: Validates phasing strategy and dependencies

### Implementation Phase
- **Senior Developer**: Implements code following the plan
- **Senior Developer Critic**: Reviews code quality and adherence to architecture

### QA Phase
- **QA Engineer**: Tests implementation with E2E tests and produces test reports
- **QA Critic**: Validates test coverage and quality

### Audit Phase
- **Security Auditor**: Deep OWASP code-level security audit
- **Security Audit Critic**: Validates security audit thoroughness
- **Performance Auditor**: Deep code-level performance audit
- **Performance Audit Critic**: Validates performance audit thoroughness

### Documentation Phase
- **Documentation Master**: Creates comprehensive documentation
- **Documentation Critic**: Validates documentation completeness

### Release Phase
- **Release Engineer**: Prepares deployment and release
- **Release Critic**: Validates release readiness

## Installation

### Remote Marketplace Install

Add the marketplace directly from the Gitea repo and install the plugin inside Claude Code:

```
/plugin marketplace add https://dev.zaphar.net/zaphar/claude-zaphar
/plugin install rigorous-dev@claude-zaphar
```

### Local Marketplace Install

Alternatively, clone the repository and add it as a local marketplace:

```bash
# Clone the repository
git clone https://dev.zaphar.net/zaphar/claude-zaphar.git
```

Then inside Claude Code, add the cloned repo as a local marketplace and install:

```
/plugin marketplace add /path/to/claude-zaphar
/plugin install rigorous-dev@claude-zaphar
```

### Using `--plugin-dir`

If you prefer to load the plugin for a single session without installing (useful for trying it out or plugin development):

```bash
claude --plugin-dir /path/to/claude-zaphar/plugins/rigorous-dev
```

This loads the plugin for the current session without copying anything into your project.

## Usage

### Available Commands

After installation, you'll have these commands available in Claude Code:

- `/rigorous-dev:start` - Initialize a new rigorous development workflow
- `/rigorous-dev:onboard` - Bootstrap workflow from an existing codebase (documents current UX and architecture)
- `/rigorous-dev:resume` - Resume an existing workflow from saved state
- `/rigorous-dev:status` - Display current workflow status and progress
- `/rigorous-dev:skip-to <phase>` - Skip to a specific phase (advanced use only)
- `/rigorous-dev:close` - Close the current workflow iteration
- `/rigorous-dev:new-iteration` - Start a new iteration from a closed workflow

### Starting a New Workflow

```
/rigorous-dev:start
```

Claude will guide you through:
1. Project configuration (name, artifacts directory)
2. Requirements interview and analysis
3. UX design and validation
4. Backend architecture design
5. Implementation planning with checkpoints
6. Iterative implementation with review
7. QA testing and validation
8. Security and performance auditing
9. Documentation generation
10. Release preparation

### Onboarding an Existing Codebase

```
/rigorous-dev:onboard
```

For existing projects, use `onboard` instead of `start`. This explores the codebase and documents the existing UX design and architecture rather than conducting interviews. After onboarding, the workflow is ready for its first requirements iteration where you define what to build or change next.

### Resuming an Existing Workflow

```
/rigorous-dev:resume
```

Loads your saved workflow state and continues from the current phase.

### Checking Status

```
/rigorous-dev:status
```

Displays:
- Current phase and status
- Completed phases with timestamps
- Generated artifacts
- Iteration counts
- Workflow notes

### Skipping to a Phase (Advanced)

```
/rigorous-dev:skip-to architecture
```

⚠️ **Use with caution.** This bypasses validation and requires user confirmation. Only use when you have existing artifacts from previous work.

Valid phases: `requirements`, `ux-design`, `architecture`, `planning`, `implementation`, `qa`, `audit`, `documentation`, `release`

### Workflow Iterations

When you've completed (or partially completed) a workflow and want to start fresh while preserving prior work:

1. **Close the current iteration:**
   ```
   /rigorous-dev:close
   ```
   This marks the workflow as closed and snapshots the state.

2. **Start a new iteration:**
   ```
   /rigorous-dev:new-iteration
   ```
   This commits all current artifacts to VCS (preserving history), then deletes versioned artifact directories so they start fresh. Persistent artifacts stay in place.

**What stays in place:**
- Persistent artifacts (`ux_design/`, `architecture/`, `planning/`, `documentation/`) remain untouched as starting points for re-evaluation

**What starts fresh:**
- Versioned artifacts (requirements, implementation, QA, audit, release) are deleted after being committed to VCS
- All phase statuses reset to pending
- The workflow begins again at the Requirements phase
- Prior artifacts are retrievable from VCS history

## Workflow Details

### 1. Requirements Phase

The Requirements Interviewer conducts a conversational interview covering:
- Problem statement and user personas
- Inputs, outputs, and done criteria
- Security, usability, performance needs
- Deployment and operational requirements
- Constraints and assumptions

Output: `requirements.yaml` validated against `schemas/requirements.schema.yaml`

### 2. Architecture/Design Phase

**Backend Track:**
- Defines technology stack, APIs, data models
- Specifies components and their interactions
- Establishes security and observability patterns

**UX Track:**
- Creates user flows and wireframes
- Defines design system (colors, typography, spacing)
- Specifies component hierarchy

Outputs: Modular architecture YAML files (`architecture_index.yaml`, `architecture_components.yaml`, etc.), `api_spec.yaml`, and `ux_specification.yaml`

### 3. Planning Phase

The Implementation Planner creates a phased plan:
- Breaks work into iterative phases (typically 3-5)
- Prioritizes end-to-end functionality in Phase 1
- Places strategic review checkpoints
- Maps requirements to phases
- Identifies dependencies and risks

Output: `implementation_plan.yaml`

### 4. Implementation Phase

The Senior Developer implements each phase:
- Follows the plan sequentially (or in parallel where allowed)
- Writes production-ready code with zero warnings
- Implements tests (TDD preferred)
- Pauses at checkpoints for review
- Produces implementation manifest tracking progress

Output: `implementation_manifest.yaml` + working codebase

### 5. QA Phase

The QA Engineer validates the implementation:
- Implements E2E tests from planner-defined scenarios
- Verifies acceptance criteria
- Builds unified traceability matrix
- Documents bugs and issues

Output: `test_report.yaml`

### 6. Audit Phase

Security and Performance Auditors run in parallel:
- **Security Auditor**: OWASP Top 10 review, data flow tracing, dependency audit
- **Performance Auditor**: Database query analysis, memory patterns, algorithm review

Output: `security_audit.md`, `performance_audit.md`

### 7. Documentation Phase

The Documentation Master creates:
- User documentation
- API documentation
- Deployment guides
- Architecture documentation

Output: `documentation_manifest.yaml`

### 8. Release Phase

The Release Engineer prepares:
- Deployment manifest
- Release notes
- Deployment verification checklist

Output: `deployment_manifest.yaml`

## Directory Structure

```
rigorous-dev/
├── README.md                      # This file
├── rigorous-dev.md               # Main skill definition
├── agents/                        # Agent personality files
│   ├── requirements_analyst.md
│   ├── requirements_critic.md
│   ├── backend_architect.md
│   ├── architecture_critic.md
│   ├── ux_designer.md
│   ├── ux_critic.md
│   ├── implementation_planner.md
│   ├── implementation_plan_critic.md
│   ├── senior_developer.md
│   ├── senior_developer_critic.md
│   ├── qa_engineer.md
│   ├── qa_critic.md
│   ├── security_auditor.md
│   ├── security_audit_critic.md
│   ├── performance_auditor.md
│   ├── performance_audit_critic.md
│   ├── documentation_master.md
│   ├── documentation_critic.md
│   ├── release_engineer.md
│   └── release_critic.md
└── schemas/                       # YAML schemas for validation
    ├── requirements.schema.yaml
    ├── architecture_index.schema.yaml
    ├── architecture_components.schema.yaml
    ├── architecture_data_model.schema.yaml
    ├── architecture_deployment.schema.yaml
    ├── architecture_security.schema.yaml
    ├── architecture_observability.schema.yaml
    ├── architecture_traceability.schema.yaml
    ├── architecture_dependencies.schema.yaml
    ├── architecture_adr.schema.yaml
    ├── ux_specification.schema.yaml
    ├── implementation_plan.schema.yaml
    ├── implementation_manifest.schema.yaml
    ├── test_report.schema.yaml
    ├── documentation_manifest.schema.yaml
    ├── deployment_manifest.schema.yaml
    └── wireframe_comparison.schema.yaml
```

## Workflow State

The plugin maintains state in `.claude/rigorous-dev-state.yaml`:

```yaml
workflow_id: "WORKFLOW-001"
project_name: "My Project"
current_phase: "implementation"
phase_status:
  requirements:
    status: "completed"
    artifact_path: ".claude/rigorous-dev-artifacts/WORKFLOW-001/requirements.yaml"
  architecture:
    status: "completed"
  planning:
    status: "completed"
  implementation:
    status: "in_progress"
    current_phase_number: 2
artifacts:
  - type: "requirements"
    path: ".claude/rigorous-dev-artifacts/WORKFLOW-001/requirements.yaml"
    approved_by: "requirements_critic"
```

## Artifacts

Artifacts are organized by phase with iteration history in `.claude/rigorous-dev-artifacts/<workflow-id>/`:

```
.claude/rigorous-dev-artifacts/<workflow-id>/
├── requirements/
│   ├── iteration-1/requirements.yaml
│   ├── iteration-2/requirements.yaml
│   └── requirements.yaml              # Final approved version
├── ux_design/                             # persistent — updated in-place
│   ├── ux_specification.yaml
│   ├── design-system/
│   └── mockups/
├── architecture/                          # persistent — updated in-place
│   ├── architecture_index.yaml
│   ├── architecture_components.yaml
│   ├── architecture_data_model.yaml
│   ├── architecture_deployment.yaml
│   ├── architecture_security.yaml
│   ├── architecture_observability.yaml
│   ├── architecture_traceability.yaml
│   ├── architecture_dependencies.yaml
│   ├── architecture_adr.yaml
│   └── api_spec.yaml
├── planning/                              # persistent — updated in-place
│   └── implementation_plan.yaml
├── implementation/
│   ├── phase-1/implementation_manifest.yaml
│   ├── phase-2/implementation_manifest.yaml
│   └── phase-N/implementation_manifest.yaml
├── qa/
│   └── test_report.yaml
├── audit/
│   ├── security_audit.md
│   └── performance_audit.md
├── documentation/                         # persistent — updated in-place
│   ├── documentation_manifest.yaml
│   ├── user-guide/
│   └── api/
└── release/
    └── deployment_manifest.yaml
```

**Key Points:**
- Each phase has its own directory
- **Persistent artifacts** (ux_design, architecture, planning, documentation) are updated in-place — no iteration directories
- **Versioned artifacts** (requirements, implementation, qa, audit, release) use iteration directories during producer-critic loops
- Final approved versioned artifacts are copied to the phase root level
- Implementation phase uses `phase-N` directories for sequential implementation phases

## Customization

### Modifying Agents

Edit agent files in `agents/` to customize personalities and behaviors:

```bash
vim agents/senior_developer.md
```

### Extending Schemas

Modify schema files in `schemas/` to add custom fields:

```bash
vim schemas/requirements.schema.yaml
```

### Adding New Phases

1. Create new agent files for producer and critic
2. Add schema for the phase output
3. Update `rigorous-dev.md` to include the new phase
4. Update state management logic

## Best Practices

1. **Don't skip phases**: Each phase builds on the previous one
2. **Trust the critics**: If a critic rejects, address the feedback
3. **Use checkpoints**: Review and adjust after Phase 1 implementation
4. **Iterate freely**: The producer-critic loop is designed for refinement
5. **Document assumptions**: Capture decisions in the artifacts
6. **Save frequently**: State is saved automatically, but you can manually check with `/rigorous-dev:status`

## Troubleshooting

### "Workflow state not found"
- Start a new workflow with `/rigorous-dev:start`

### "Schema validation failed"
- Check the artifact against the schema in `schemas/`
- The critic should provide specific errors

### "Too many iterations"
- After 3 producer-critic cycles, you'll be prompted for guidance
- Review the feedback and decide how to proceed

### "Agent not responding"
- Ensure the agent file exists in `agents/`
- Check that the agent file is well-formed markdown

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Add or modify agents/schemas
4. Test the workflow end-to-end
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

- **Issues**: Report bugs or request features on GitHub
- **Discussions**: Ask questions in GitHub Discussions
- **Documentation**: Full documentation at docs/

## Acknowledgments

Built for Claude Code to enable high-rigor software development with structured workflows and producer-critic validation patterns.
