# Example Workflow Scenario

This document walks through a complete rigorous development workflow for a sample project.

## Project: Task Management API

A simple REST API for managing tasks across multiple projects.

---

## Phase 1: Requirements

### Starting the Workflow

```bash
User: /rigorous-dev:start
```

**Plugin Response:**
```
✓ Workflow initialized successfully!

Project: Task Management API
Database: .claude/rigorous-dev.db

Starting Requirements Phase...
Loading Requirements Interviewer agent.
```

### Requirements Interview

**Requirements Interviewer:** Hello! I'm here to gather requirements for your project. Let's start with the core problem - what are you trying to solve?

**User:** We need a simple API for managing tasks. Teams can create, update, and delete tasks, and track their progress.

**Requirements Interviewer:** Great! Who will be using this API?

**User:** Software development teams, project managers, and individual contributors.

**Requirements Interviewer:** What are the key features you need?

**User:** Authentication, CRUD operations on tasks, filtering and pagination, and soft deletes with recovery.

*[Interview continues through all topics...]*

### Requirements Analysis

After interview completes, the Requirements Analyst records requirements in the changelog DB via `changelog_insert`:

```yaml
project:
  name: "Task Management API"
  version: "1.0.0"

problem_statement:
  description: "Teams need a simple, secure API for managing tasks"
  target_users:
    - "Software development teams"
    - "Project managers"

requirements:
  - id: "REQ-001"
    title: "User Authentication"
    description: "System must authenticate users via JWT tokens"
    priority: "must_have"
    category: "security"
    acceptance_criteria:
      - "Users can register with email and password"
      - "JWT tokens expire after 24 hours"
# ... additional requirements ...
```

### Requirements Validation

**Requirements Critic:** Reviewing requirements entries...

✓ Data completeness verified
✓ All requirement IDs follow REQ-XXX pattern
✓ Completeness check passed
✓ Consistency check passed
✓ Quality criteria met

**Verdict:** APPROVED

**Plugin:**
```
✅ Requirements Complete

Entities recorded in changelog DB (requirements, personas, acceptance criteria, etc.)
Approved by: requirements_critic
Duration: 45 minutes

Next: UX Design
```

---

## Phase 2: UX Design

### UX Design Interview

**UX Designer:** I'll design the user experience for your API. Since this is an API-only project, we'll focus on the API structure and response formats. Let's start - what are the primary user flows?

**User:** Users need to authenticate, then manage their tasks - create, list, update, delete.

**UX Designer:** For the task list view, what filtering options do users need?

**User:** Filter by status (pending/completed) and sort by due date or creation date.

*[Interview continues...]*

### UX Specification

The UX Designer records UX specification entries in the changelog DB via `changelog_insert`:

```yaml
project:
  name: "Task Management API"

user_personas:
  - name: "Development Team Member"
    goals:
      - "Quickly create and update tasks"
      - "Track task progress"

user_flows:
  - id: "FLOW-001"
    name: "Create Task"
    persona: "Development Team Member"
    steps:
      - "Authenticate via JWT"
      - "POST /api/tasks with task details"
      - "Receive task ID and confirmation"
# ... additional flows ...

api_design:
  base_url: "https://api.example.com"
  versioning: "URL path versioning (/v1/)"
  authentication: "Bearer token in Authorization header"
# ... additional API design ...
```

### UX Validation (Iteration 1)

**UX Critic:** Reviewing UX specification entries...

✗ Issues found:
- **Blocking:** Missing error response formats
- **Blocking:** Pagination not specified in detail
- **Recommended:** Add rate limiting specification

**Verdict:** NEEDS_REVISION

### UX Revision (Iteration 2)

**UX Designer:** Revising based on feedback...

*[Updates specification with error formats, detailed pagination, rate limiting]*

### UX Validation (Iteration 2)

**UX Critic:** Reviewing revised UX specification entries...

✓ All previous issues addressed
✓ Error response formats defined
✓ Pagination fully specified
✓ Rate limiting included

**Verdict:** APPROVED

**Plugin:**
```
✅ UX Design Complete

Entities recorded in changelog DB (user flows, screens, design system, etc.)
Approved by: ux_critic
Iterations: 2
Duration: 30 minutes

Next: Architecture
```

---

## Phase 3: Architecture

### Architecture Interview

**Backend Architect:** I'll design the backend architecture. Based on requirements, I see you need JWT auth, CRUD operations, and PostgreSQL. Let's discuss - do you have any infrastructure constraints?

**User:** Must run on AWS, budget is $500/month, prefer managed services.

**Backend Architect:** For the tech stack, are you open to Node.js with Express, or do you prefer another language?

**User:** Node.js is fine. Use TypeScript for type safety.

*[Interview continues...]*

### Architecture Specification

The Backend Architect records modular architecture entries in the changelog DB and commits architecture documents:

- Architecture overview — committed as a markdown document (e.g., `docs/architecture/overview.md`)
- `component` entries — system components with integration test boundaries
- Data model — committed as a markdown document (e.g., `docs/architecture/data-model.md`)
- Architecture configuration — committed as markdown documents:
  - deployment targets and environments (e.g., `docs/architecture/deployment.md`)
  - authentication, authorization, secrets management (e.g., `docs/architecture/security.md`)
  - logging, metrics, tracing (e.g., `docs/architecture/observability.md`)
- `requirement_trace` entries — requirements-to-component mapping
- `approved_dependency` entries — dependency manifest with health assessments and `category` for technology grouping
- `api_spec.yaml` — OpenAPI specification (file artifact)

Example `component` entry:
```yaml
components:
  - id: "COMP-001"
    name: "API Gateway"
    purpose: "Route requests, rate limiting, CORS"
    type: "infrastructure"
    integration_test_boundaries:
      - target_component: "COMP-002"
        boundary_type: "api_call"
        correct_behavior: "Routes requests to application server"

  - id: "COMP-002"
    name: "Application Server"
    purpose: "Business logic, request handling"
    type: "service"
# ... additional components ...
```

### Architecture Validation

**Architecture Critic:** Reviewing architecture entries...

✓ Technology stack appropriate for requirements
✓ All API endpoints from UX spec covered in api_spec.yaml
✓ Data model document complete with entities, attributes, and relationships
✓ Security architecture comprehensive
✓ Observability strategy defined
✓ Dependency manifest complete with health assessments
✓ Integration test boundaries defined

**Verdict:** APPROVED

**Plugin:**
```
✅ Architecture Complete

Entities recorded in changelog DB (components, ADRs, approved_dependencies, etc.)
Architecture docs committed (overview, data model, diagrams)
Approved by: architecture_critic
Duration: 40 minutes

Next: Planning
```

---

## Phase 4: Planning

### Planning Interview

**Implementation Planner:** I'll create a phased implementation plan. Let's break this into manageable chunks. What would you consider the minimal viable functionality?

**User:** Authentication and basic CRUD operations on tasks.

**Implementation Planner:** Should we include pagination and filtering in Phase 1, or defer to Phase 2?

**User:** Include pagination in Phase 1, defer advanced filtering to Phase 2.

*[Interview continues...]*

### Implementation Plan

The Implementation Planner records the plan in the changelog DB via `changelog_insert`:

```yaml
project:
  name: "Task Management API"

phases:
  - number: 1
    name: "Core MVP"
    objective: "Implement authentication and basic task CRUD with pagination"
    deliverables:
      - "User registration and login endpoints"
      - "Task CRUD endpoints"
      - "JWT authentication middleware"
      - "Basic pagination"
      - "Database schema and migrations"
      - "Unit and integration tests"
    requirements_mapping:
      - "REQ-001"  # Authentication
      - "REQ-002"  # Create tasks
      - "REQ-003"  # List tasks (basic)
      - "REQ-004"  # Update tasks
      - "REQ-005"  # Delete tasks
    estimated_duration: "1 week"
    dependencies: []

  - number: 2
    name: "Advanced Features"
    objective: "Add filtering, sorting, and task recovery"
    deliverables:
      - "Advanced filtering (status, dates)"
      - "Multiple sort options"
      - "Soft delete with recovery"
      - "Audit trail"
    requirements_mapping:
      - "REQ-003"  # List tasks (advanced)
      - "REQ-005"  # Delete tasks (soft delete)
    estimated_duration: "3 days"
    dependencies: [1]

checkpoints:
  - phase: 1
    when: "After Phase 1 completion"
    what_to_review:
      - "End-to-end functionality works"
      - "Test coverage meets standards"
      - "API design matches specification"
      - "Performance acceptable"
    decision_points:
      - "Proceed to Phase 2"
      - "Adjust Phase 2 scope based on learnings"
```

### Planning Validation

**Implementation Plan Critic:** Reviewing implementation plan entries...

✓ Phases have clear objectives and deliverables
✓ All requirements mapped to phases
✓ Dependencies properly identified
✓ Checkpoints strategically placed
✓ Phase 1 delivers end-to-end value

**Verdict:** APPROVED

**Plugin:**
```
✅ Planning Complete

Entities recorded in changelog DB (implementation phases, work items, checkpoints)
Approved by: implementation_plan_critic
Duration: 25 minutes

Next: Implementation
```

---

## Phase 5: Implementation

### Implementation Phase 1

**Senior Developer:** Starting Phase 1 implementation. I'll build the core MVP with authentication and basic task CRUD.

*[Implements database schema, migrations, models, routes, controllers, middleware, tests]*

**Senior Developer:** Phase 1 implementation complete. Created:
- Database schema with users and tasks tables
- User registration and login endpoints
- Task CRUD endpoints with authentication
- JWT middleware
- Unit tests (85% coverage)
- Integration tests for all endpoints

### Code Review

**Senior Developer Critic:** Reviewing Phase 1 code...

✓ All files follow TypeScript best practices
✓ Zero warnings in build
✓ Test coverage exceeds 80%
✓ API matches api_spec.yaml specification
✓ Security patterns correctly implemented
✓ Error handling comprehensive

**Verdict:** APPROVED

### Checkpoint Review

**Plugin:**
```
⏸️  Checkpoint: Phase 1 Complete

Review the implementation before proceeding to Phase 2.

Completed:
- Authentication system
- Task CRUD endpoints
- Database schema
- Tests (85% coverage)

Review Questions:
1. Does the API meet your expectations?
2. Is performance acceptable?
3. Should we adjust Phase 2 scope?
```

**User:** Looks great! Performance is good. Let's proceed to Phase 2.

### Implementation Phase 2

**Senior Developer:** Starting Phase 2 implementation. Adding advanced filtering, sorting, and soft delete.

*[Implements additional features]*

**Senior Developer Critic:** Reviewing Phase 2 code...

✓ All new features implemented correctly
✓ Tests updated (87% coverage)
✓ No regressions in Phase 1 functionality

**Verdict:** APPROVED

**Plugin:**
```
✅ Implementation Complete

Implementation manifest recorded in changelog DB
Approved by: senior_developer_critic
Phases: 2/2 completed
Duration: 10 days total

Next: Documentation
```

---

## Phase 6: Documentation

*[Similar producer-critic pattern for technical documentation]*

---

## Phase 7: QA

**QA Engineer:** Running comprehensive tests...

*[Executes test suites, validates requirements, performance tests]*

**QA Engineer:** Testing complete. Producing test report.

### Test Report

Test report entries recorded in changelog DB with:
- 127 unit tests passed
- 43 integration tests passed
- All 7 requirements validated
- Performance tests: p95 < 150ms ✓
- No critical bugs found

**QA Critic:** Reviewing test report entries...

✓ All requirements tested and passing
✓ Test coverage exceeds targets
✓ Performance meets requirements
✓ No critical or high-severity bugs

**Verdict:** APPROVED

---

## Phase 8: Audit

**Security Auditor:** Auditing codebase for vulnerabilities...

*[OWASP Top 10 review, data flow tracing, dependency audit, configuration review]*

**Security Audit Critic:** Reviewing security audit findings...

✓ All OWASP categories examined
✓ Findings backed by evidence with file:line locations
✓ Remediation suggestions are technically correct

**Verdict:** APPROVED

**Performance Auditor:** Auditing codebase for performance issues...

*[Database query analysis, memory patterns, API response analysis]*

**Performance Audit Critic:** Reviewing performance audit findings...

✓ All performance areas covered
✓ Findings include impact estimates
✓ No high/critical severity issues found

**Verdict:** APPROVED

---

## Final Status

```bash
User: /rigorous-dev:status
```

**Plugin Response:**
```
📋 Rigorous Dev Workflow Status

Project: Task Management API
Database: .claude/rigorous-dev.db

Progress:
✅ Requirements (completed 2026-02-12 10:45)
✅ UX Design (completed 2026-02-12 11:15)
✅ Architecture (completed 2026-02-12 12:00)
✅ Planning (completed 2026-02-12 12:30)
✅ Implementation (completed 2026-02-12 18:00)
✅ Documentation (completed 2026-02-12 19:00)
✅ QA (completed 2026-02-12 19:45)
✅ Audit (completed 2026-02-12 20:00)

Recorded Entities (in changelog DB):
- requirements (personas, acceptance criteria, glossary, constraints)
- ux_specification (user flows, screens, design system)
- architecture (components, ADRs, approved dependencies, security, observability)
- architecture file artifacts (overview, data model, diagrams — committed as markdown docs)
- api_spec.yaml (file artifact)
- implementation_plan (phases, work items, checkpoints)
- implementation_manifest
- test_report
- security_audit_findings
- performance_audit_findings

🎉 Workflow Complete!
```

---

## Key Takeaways

1. **Producer-Critic Pattern Works** - 2 iterations on UX, everything else approved first time
2. **Checkpoints Are Valuable** - Phase 1 review prevented scope creep
3. **DB Constraint Validation Caught Issues Early** - Prevented downstream problems
4. **State Management** - Could pause/resume at any phase
5. **Data Quality** - All entities validated and approved
6. **Total Duration** - ~10 days from requirements to audit-complete

This rigorous process ensured high-quality, well-documented, thoroughly tested software with no surprises at the end.
