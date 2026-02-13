# Rigorous Software Development Workflow Plugin

A comprehensive Claude Code plugin that guides you through creating or modifying software with high rigor using specialized agents, structured specifications, and producer-critic validation patterns.

## Overview

This plugin implements a complete Software Development Life Cycle (SDLC) with the following phases:

```
Requirements → UX Design → Architecture → Planning → Implementation → QA → Documentation → Release
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
- **Requirements Interviewer**: Conducts conversational interviews to gather requirements
- **Requirements Analyst**: Produces formal requirements specification
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
- **QA Engineer**: Tests implementation and produces test reports
- **QA Critic**: Validates test coverage and quality

### Documentation Phase
- **Documentation Master**: Creates comprehensive documentation
- **Documentation Critic**: Validates documentation completeness

### Release Phase
- **Release Engineer**: Prepares deployment and release
- **Release Critic**: Validates release readiness

## Installation

### Quick Install (Recommended)

1. Clone this repository:
   ```bash
   git clone https://github.com/zaphar/claude-rigor-plugin.git
   cd claude-rigor-plugin
   ```

2. Run the installer from your project directory:
   ```bash
   cd /path/to/your/project
   /path/to/claude-rigor-plugin/install.sh
   ```

3. Restart Claude Code

The installer will:
- ✅ Install commands, agents, and skills into your project's `.claude/` directory
- ✅ Copy validation schemas
- ✅ Create example settings file
- ✅ Update `.gitignore`

### Uninstall

To remove the plugin from a project:

```bash
cd /path/to/your/project
/path/to/claude-rigor-plugin/uninstall.sh
```

This preserves your workflow state and artifacts by default.

### Manual Installation

If you prefer manual setup, you can symlink the components directly:

```bash
cd your-project
mkdir -p .claude/{commands,agents,skills}

# Link commands
ln -s /path/to/claude-rigor-plugin/commands/*.md .claude/commands/

# Link agents
ln -s /path/to/claude-rigor-plugin/agents/*.md .claude/agents/

# Link skill
ln -s /path/to/claude-rigor-plugin/skills/rigorous-dev .claude/skills/

# Copy schemas
cp -r /path/to/claude-rigor-plugin/schemas .claude/rigorous-dev-schemas
```

## Usage

### Available Commands

After installation, you'll have these commands available in Claude Code:

- `/rigorous-dev-start` - Initialize a new rigorous development workflow
- `/rigorous-dev-resume` - Resume an existing workflow from saved state
- `/rigorous-dev-status` - Display current workflow status and progress
- `/rigorous-dev-skip-to <phase>` - Skip to a specific phase (advanced use only)

### Starting a New Workflow

```
/rigorous-dev-start
```

Claude will guide you through:
1. Project configuration (name, artifacts directory)
2. Requirements interview and analysis
3. UX design and validation
4. Backend architecture design
5. Implementation planning with checkpoints
6. Iterative implementation with review
7. QA testing and validation
8. Documentation generation
9. Release preparation

### Resuming an Existing Workflow

```
/rigorous-dev-resume
```

Loads your saved workflow state and continues from the current phase.

### Checking Status

```
/rigorous-dev-status
```

Displays:
- Current phase and status
- Completed phases with timestamps
- Generated artifacts
- Iteration counts
- Workflow notes

### Skipping to a Phase (Advanced)

```
/rigorous-dev-skip-to architecture
```

⚠️ **Use with caution.** This bypasses validation and requires user confirmation. Only use when you have existing artifacts from previous work.

Valid phases: `requirements`, `ux-design`, `architecture`, `planning`, `implementation`, `qa`, `documentation`, `release`

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

Outputs: `backend_architecture.yaml` and `ux_specification.yaml`

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
- Executes test suites
- Verifies acceptance criteria
- Documents bugs and issues
- Confirms all requirements are met

Output: `test_report.yaml`

### 6. Documentation Phase

The Documentation Master creates:
- User documentation
- API documentation
- Deployment guides
- Architecture documentation

Output: `documentation_manifest.yaml`

### 7. Release Phase

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
│   ├── requirements_interviewer.md
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
│   ├── documentation_master.md
│   ├── documentation_critic.md
│   ├── release_engineer.md
│   └── release_critic.md
└── schemas/                       # YAML schemas for validation
    ├── requirements.schema.yaml
    ├── backend_architecture.schema.yaml
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

All artifacts are stored in `.claude/rigorous-dev-artifacts/<workflow-id>/`:

- `requirements.yaml` - Formal requirements specification
- `backend_architecture.yaml` - Backend architecture specification
- `ux_specification.yaml` - UX design specification
- `implementation_plan.yaml` - Phased implementation plan
- `implementation_manifest.yaml` - Implementation tracking
- `test_report.yaml` - QA test results
- `documentation_manifest.yaml` - Documentation manifest
- `deployment_manifest.yaml` - Deployment configuration

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
6. **Save frequently**: State is saved automatically, but you can manually save with `/rigorous-dev status`

## Troubleshooting

### "Workflow state not found"
- Start a new workflow with `/rigorous-dev start`

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
