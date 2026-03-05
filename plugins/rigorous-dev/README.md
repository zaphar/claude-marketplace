# Rigorous Software Development Workflow Plugin

A comprehensive Claude Code plugin that guides you through creating or modifying software with high rigor using specialized agents, structured specifications, and producer-critic validation patterns.

## Overview

This plugin implements a complete Software Development Life Cycle (SDLC) split into two workflows:

**Development Workflow** (fast iteration):
```
Requirements → UX Design → Architecture → Planning → Implementation → Documentation
```

**Release Workflow** (pre-release verification):
```
QA → Audit → Release
```

The development workflow runs fast iteration loops. When ready to ship, the release workflow provides thorough verification. Each phase uses specialized agents with producer-critic patterns to ensure quality and completeness.

## Features

- **Structured Workflow**: Step-by-step guidance through the complete SDLC
- **Producer-Critic Pattern**: Every artifact is reviewed and validated before proceeding
- **SQLite Changelog**: All state and decisions are stored in an append-only SQLite database (WAL mode) for full traceability
- **Iterative Refinement**: Feedback loops for continuous improvement
- **Review Checkpoints**: Strategic pauses during implementation for user feedback
- **State Management**: Resume workflows across sessions
- **Parallel Execution**: Architecture and UX design can proceed in parallel

## Agents

### Development Workflow Agents

#### Requirements Phase
- **Requirements Analyst**: Conducts conversational interviews and produces formal requirements specification
- **Requirements Critic**: Validates requirements for completeness and consistency

#### Architecture/Design Phase
- **Backend Architect**: Designs backend architecture, APIs, data models
- **Architecture Critic**: Validates architectural decisions
- **UX Designer**: Creates user experience specifications and wireframes
- **UX Critic**: Validates UX design decisions

#### Planning Phase
- **Implementation Planner**: Creates phased implementation plan with strategic checkpoints
- **Implementation Plan Critic**: Validates phasing strategy and dependencies

#### Implementation Phase
- **Test Writer**: Writes failing tests before implementation following TDD principles
- **Test Writer Critic**: Validates test completeness and that tests are in failing (red) state
- **Senior Developer**: Implements code following the plan
- **Senior Developer Critic**: Reviews code quality and adherence to architecture

#### Documentation Phase
- **Documentation Master**: Creates comprehensive documentation
- **Documentation Critic**: Validates documentation completeness

### Release Workflow Agents

#### QA Phase
- **QA Engineer**: Tests implementation with E2E tests and produces test reports
- **QA Critic**: Validates test coverage and quality

#### Audit Phase
- **Security Auditor**: Deep OWASP code-level security audit
- **Security Audit Critic**: Validates security audit thoroughness
- **Performance Auditor**: Deep code-level performance audit
- **Performance Audit Critic**: Validates performance audit thoroughness

#### Release Phase
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

**Development Workflow:**
- `/rigorous-dev:start` - Initialize a new rigorous development workflow
- `/rigorous-dev:onboard` - Bootstrap workflow from an existing codebase (documents current UX and architecture)
- `/rigorous-dev:resume` - Resume an existing workflow from saved state
- `/rigorous-dev:status` - Display current workflow status and progress
- `/rigorous-dev:skip-to <phase>` - Skip to a specific phase (advanced use only)
- `/rigorous-dev:close` - Close the current workflow iteration
- `/rigorous-dev:import` — Import existing data (requirements, design specs, PRDs, etc.) into the changelog database from any file format.
- `/rigorous-dev:new-iteration` - Start a new iteration from a closed workflow

**Release Workflow:**
- `/rigorous-dev:start-release` - Start the release workflow (QA, audit, release)
- `/rigorous-dev:resume-release` - Resume an existing release workflow
- `/rigorous-dev:release-status` - Display release workflow status

### Starting a New Workflow

```
/rigorous-dev:start
```

Claude will guide you through the development workflow:
1. Project configuration (name, artifacts directory)
2. Requirements interview and analysis
3. UX design and validation
4. Backend architecture design
5. Implementation planning with checkpoints
6. Iterative implementation with review
7. Documentation generation

When ready to ship, start the release workflow with `/rigorous-dev:start-release`.

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

Valid phases: `requirements`, `ux-design`, `architecture`, `planning`, `implementation`, `documentation`

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
- Dev-owned versioned artifacts (requirements, implementation) are deleted after being committed to VCS
- All dev phase statuses reset to pending
- The workflow begins again at the Requirements phase
- Prior artifacts are retrievable from VCS history
- Release workflow artifacts (qa, audit, release) are owned by the release workflow and not affected

## Workflow Details

### Development Workflow

#### 1. Requirements Phase

The Requirements Interviewer conducts a conversational interview covering:
- Problem statement and user personas
- Inputs, outputs, and done criteria
- Security, usability, performance needs
- Deployment and operational requirements
- Constraints and assumptions

Output: Requirements stored in `.claude/rigorous-dev.db` (personas, goals, constraints, done criteria)

#### 2. Architecture/Design Phase

**Backend Track:**
- Defines technology stack, APIs, data models
- Specifies components and their interactions
- Establishes security and observability patterns

**UX Track:**
- Creates user flows and wireframes
- Defines design system (colors, typography, spacing)
- Specifies component hierarchy

Outputs: Architecture decisions, components, and ADRs written to `.claude/rigorous-dev.db` via `changelog_insert` and `revision_create` tools

#### 3. Planning Phase

The Implementation Planner creates a phased plan:
- Breaks work into iterative phases (typically 3-5)
- Prioritizes end-to-end functionality in Phase 1
- Places strategic review checkpoints
- Maps requirements to phases
- Identifies dependencies and risks

Output: Implementation plan stored in `.claude/rigorous-dev.db`

#### 4. Implementation Phase

The Senior Developer implements each phase:
- Follows the plan sequentially (or in parallel where allowed)
- Writes production-ready code with zero warnings
- Implements tests (TDD preferred)
- Pauses at checkpoints for review
- Produces implementation manifest tracking progress

Output: Implementation progress tracked in `.claude/rigorous-dev.db` (phases, revisions, commit links) + working codebase

#### 5. Documentation Phase

The Documentation Master creates:
- User documentation
- API documentation
- Deployment guides (if release workflow has run)
- Architecture documentation

Output: Documentation manifest stored in `.claude/rigorous-dev.db`

### Release Workflow

#### 1. QA Phase

The QA Engineer validates the implementation:
- Implements E2E tests from planner-defined scenarios
- Verifies acceptance criteria
- Builds unified traceability matrix
- Documents bugs and issues

Output: Test results and traceability matrix stored in `.claude/rigorous-dev.db`

#### 2. Audit Phase

Security and Performance Auditors run in parallel:
- **Security Auditor**: OWASP Top 10 review, data flow tracing, dependency audit
- **Performance Auditor**: Database query analysis, memory patterns, algorithm review

Output: `security_audit.md`, `performance_audit.md` (findings also recorded in `.claude/rigorous-dev.db`)

#### 3. Release Phase

The Release Engineer prepares:
- Deployment manifest
- Release notes
- Deployment verification checklist

Output: Deployment manifest stored in `.claude/rigorous-dev.db`

## Directory Structure

```
rigorous-dev/
├── README.md                        # This file
├── .claude-plugin/
│   └── plugin.json                  # Plugin metadata
├── agents/                          # Agent personality files
│   ├── requirements_analyst.agent.md
│   ├── requirements_critic.agent.md
│   ├── backend_architect.agent.md
│   ├── architecture_critic.agent.md
│   ├── ux_designer.agent.md
│   ├── ux_critic.agent.md
│   ├── implementation_planner.agent.md
│   ├── implementation_plan_critic.agent.md
│   ├── senior_developer.agent.md
│   ├── senior_developer_critic.agent.md
│   ├── test_writer.agent.md
│   ├── test_writer_critic.agent.md
│   ├── qa_engineer.agent.md
│   ├── qa_critic.agent.md
│   ├── security_auditor.agent.md
│   ├── security_audit_critic.agent.md
│   ├── performance_auditor.agent.md
│   ├── performance_audit_critic.agent.md
│   ├── documentation_master.agent.md
│   ├── documentation_critic.agent.md
│   ├── release_engineer.agent.md
│   └── release_critic.agent.md
├── commands/                        # Slash command definitions
│   ├── start.md
│   ├── onboard.md
│   ├── resume.md
│   ├── status.md
│   ├── skip-to.md
│   ├── close.md
│   ├── import.md
│   ├── new-iteration.md
│   ├── start-release.md
│   ├── resume-release.md
│   └── release-status.md
├── skills/rigorous-dev/             # Orchestration skill
│   ├── SKILL.md                     # Main skill definition
│   ├── references/                  # Reference documentation for agents
│   │   ├── agent-templates.md
│   │   ├── schemas-overview.md
│   │   └── tables/                  # Per-domain DB table documentation
│   │       ├── core.md
│   │       ├── requirements.md
│   │       ├── architecture.md
│   │       ├── data-model.md
│   │       ├── cross-cutting.md
│   │       ├── ux-design.md
│   │       ├── planning.md
│   │       ├── implementation.md
│   │       ├── qa-test.md
│   │       ├── documentation.md
│   │       └── deployment.md
│   └── examples/                    # Example files for agents
└── mcp-server/                      # MCP server with SQLite changelog backend
    ├── server.js                    # MCP server entry point
    ├── schema.sql                   # SQLite database schema (WAL mode)
    ├── db.js                        # Database initialization and connection
    ├── write-tools.js               # Write tools (iteration_create, phase_transition, etc.)
    └── read-tools.js                # Read tools (changelog_query, traceability_query, etc.)
```

## Workflow State

The plugin maintains all state in a SQLite database at `.claude/rigorous-dev.db` using WAL mode for reliability. The schema is defined in `mcp-server/schema.sql`.

The database is structured as an append-only changelog with normalized tables:

- **`workflow`** — top-level workflow identity and status
- **`iteration`** — each request to change the system (closed → new-iteration creates a new one)
- **`phase`** — phase status within an iteration (requirements, architecture, etc.)
- **`revision`** — producer-critic loop records within each phase

All decisions, artifacts, and transitions are stored as structured rows. No YAML state files are written to disk.

### MCP Tools

**Write tools** (agents call these to record decisions):
- `iteration_create` — create a new iteration
- `phase_transition` — advance a phase status (pending → in_progress → completed)
- `revision_create` / `revision_update` — record producer-critic loops
- `changelog_insert` — append a structured decision to the changelog
- `commit_link` — associate a VCS commit with a phase/revision
- `project_update` — update project-level metadata

**Read tools** (agents call these to query state):
- `changelog_query` — query the changelog with optional filters. Set `history: true` to view how entities evolved across revisions via `entity_snapshot`
- `traceability_query` — trace requirements through to implementation and tests
- `revision_history` — view producer-critic history for a phase
- `iteration_summary` — summarize the current or a past iteration
- `project_status` — get current project status and phase overview

## Changelog & Traceability

Because all decisions are written to the append-only SQLite changelog, the workflow can answer questions like:

- **"Why are we using technology X?"** — `changelog_query` searches decision rationale across all phases
- **"Which requirements drove this architecture decision?"** — `traceability_query` links requirements → architecture → implementation → tests
- **"What changed in iteration 3?"** — `iteration_summary` returns a structured diff of decisions made
- **"How many producer-critic cycles did requirements take?"** — `revision_history` shows the full review trail

This traceability is built-in and requires no extra documentation effort from agents — every `phase_transition`, `revision_create`, and `changelog_insert` call automatically contributes to the audit trail.

## Artifacts

File artifacts (audit reports, generated documentation) are written to `.claude/rigorous-dev-artifacts/<workflow-id>/`. All structured data (requirements, architecture decisions, plans, manifests, test results) is stored in `.claude/rigorous-dev.db` instead of YAML files.

```
.claude/rigorous-dev-artifacts/<workflow-id>/
├── audit/
│   ├── security_audit.md
│   └── performance_audit.md
└── documentation/                         # persistent — updated in-place
    ├── user-guide/
    └── api/
```

**Key Points:**
- Structured phase data (requirements, architecture, planning, implementation, QA, release) lives in the SQLite DB — query it with `changelog_query`, `traceability_query`, or `iteration_summary`
- File artifacts are only written where a document format is more appropriate (audit reports, doc pages)
- Release workflow phase tracking is stored in the DB alongside development phases — no separate release state file

## Customization

### Plugin Self-Update Tooling

This repository includes a dedicated skill and agent pair for making rigorous, validated changes to the plugin itself. These live at the repo root (not inside the plugin) so they auto-load when Copilot runs in this repository.

**Agents** (in `.github/agents/`):
- **Rigor Plugin Developer** (`rigor_plugin_developer`) — Producer agent with deep knowledge of the plugin's file structure, cross-reference map, and conventions. Makes surgical changes while maintaining consistency.
- **Rigor Plugin Reviewer** (`rigor_plugin_reviewer`) — Critic agent that validates plugin changes across correctness (cross-references, frontmatter, MCP tools), internal consistency (vocabulary, agent pairs, DB schema), and developer ergonomics (structure, clarity, escalation paths). Always runs on Opus.

**Skill** (in `.github/skills/rigor-plugin-update/`):
- **rigor-plugin-update** — Orchestration skill with three modes:
  - **Update Mode**: Make a specific change via a producer-critic loop with adaptive model selection (sonnet for simple/moderate, opus for complex changes).
  - **Deep Audit Mode**: Run the reviewer against the full plugin for a comprehensive health check. No producer involved unless you choose to fix the findings.
  - **Q&A Audit Mode**: Ask questions about the plugin's internals. If the investigation reveals issues, the skill proposes changes and can enter the producer-critic loop with your approval.

**Example usage:**
```
# Update mode
"Add a new code-review phase between implementation and documentation"

# Deep audit
"Audit the rigorous-dev plugin for consistency issues"

# Q&A
"What agents reference the changelog_insert tool?"
```

### Modifying Agents

Edit agent files in `agents/` to customize personalities and behaviors:

```bash
vim agents/senior_developer.agent.md
```

### Extending the Schema

Modify `mcp-server/schema.sql` to add custom tables or columns, then update the corresponding tool handlers in `write-tools.js` and `read-tools.js`:

```bash
vim mcp-server/schema.sql
```

### Adding New Phases

1. Create new agent files for producer and critic
2. Add any new tables/columns to `mcp-server/schema.sql`
3. Add write/read tool handlers in `write-tools.js` and `read-tools.js`
4. Update `skills/rigorous-dev/SKILL.md` to include the new phase
5. Update workflow orchestration logic

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
- If `.claude/rigorous-dev.db` exists but is corrupt, back it up and re-run `/rigorous-dev:start`

### "Database error" or MCP tool failure
- Check that the MCP server is running: the `schema-validator` server in `.mcp.json` starts automatically
- Ensure `mcp-server/node_modules` is installed (`cd mcp-server && npm install`)
- Inspect the DB directly: `sqlite3 .claude/rigorous-dev.db ".tables"`

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
