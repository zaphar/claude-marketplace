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
Artifacts: .claude/rigorous-dev-artifacts

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

After interview completes, the Requirements Analyst produces `requirements.yaml`:

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

**Requirements Critic:** Reviewing requirements.yaml...

✓ Schema validation passed
✓ All requirement IDs follow REQ-XXX pattern
✓ Completeness check passed
✓ Consistency check passed
✓ Quality criteria met

**Verdict:** APPROVED

**Plugin:**
```
✅ Requirements Complete

Artifact: .claude/rigorous-dev-artifacts/requirements.yaml
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

The UX Designer produces `ux_specification.yaml`:

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

**UX Critic:** Reviewing ux_specification.yaml...

✗ Issues found:
- **Blocking:** Missing error response formats
- **Blocking:** Pagination not specified in detail
- **Recommended:** Add rate limiting specification

**Verdict:** NEEDS_REVISION

### UX Revision (Iteration 2)

**UX Designer:** Revising based on feedback...

*[Updates specification with error formats, detailed pagination, rate limiting]*

### UX Validation (Iteration 2)

**UX Critic:** Reviewing revised ux_specification.yaml...

✓ All previous issues addressed
✓ Error response formats defined
✓ Pagination fully specified
✓ Rate limiting included

**Verdict:** APPROVED

**Plugin:**
```
✅ UX Design Complete

Artifact: .claude/rigorous-dev-artifacts/ux_specification.yaml
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

The Backend Architect produces `backend_architecture.yaml`:

```yaml
project:
  name: "Task Management API"

technology_stack:
  language: "TypeScript"
  runtime: "Node.js 20.x"
  framework: "Express.js 4.x"
  database: "PostgreSQL 15 (AWS RDS)"
  caching: "Redis (AWS ElastiCache)"
  authentication: "JWT (jsonwebtoken library)"

system_components:
  - name: "API Gateway"
    responsibility: "Route requests, rate limiting, CORS"
    technology: "AWS API Gateway"

  - name: "Application Server"
    responsibility: "Business logic, request handling"
    technology: "Express.js on ECS Fargate"

  - name: "Database"
    responsibility: "Persistent data storage"
    technology: "PostgreSQL on RDS"

api_specifications:
  - endpoint: "/api/v1/auth/register"
    method: "POST"
    authentication: "none"
    request_body:
      email: "string"
      password: "string"
    response:
      user_id: "uuid"
      token: "jwt string"
# ... additional endpoints ...

data_models:
  - name: "User"
    table: "users"
    fields:
      - name: "id"
        type: "uuid"
        primary_key: true
      - name: "email"
        type: "string"
        unique: true
      - name: "password_hash"
        type: "string"
# ... additional models ...
```

### Architecture Validation

**Architecture Critic:** Reviewing backend_architecture.yaml...

✓ Technology stack appropriate for requirements
✓ All API endpoints from UX spec covered
✓ Data models support all requirements
✓ Security patterns comprehensive
✓ Observability strategy defined

**Verdict:** APPROVED

**Plugin:**
```
✅ Architecture Complete

Artifact: .claude/rigorous-dev-artifacts/backend_architecture.yaml
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

The Implementation Planner produces `implementation_plan.yaml`:

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

**Implementation Plan Critic:** Reviewing implementation_plan.yaml...

✓ Phases have clear objectives and deliverables
✓ All requirements mapped to phases
✓ Dependencies properly identified
✓ Checkpoints strategically placed
✓ Phase 1 delivers end-to-end value

**Verdict:** APPROVED

**Plugin:**
```
✅ Planning Complete

Artifact: .claude/rigorous-dev-artifacts/implementation_plan.yaml
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
✓ API matches backend_architecture.yaml specification
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

Artifact: .claude/rigorous-dev-artifacts/implementation_manifest.yaml
Approved by: senior_developer_critic
Phases: 2/2 completed
Duration: 10 days total

Next: QA
```

---

## Phase 6: QA

**QA Engineer:** Running comprehensive tests...

*[Executes test suites, validates requirements, performance tests]*

**QA Engineer:** Testing complete. Producing test report.

### Test Report

`test_report.yaml` generated with:
- 127 unit tests passed
- 43 integration tests passed
- All 7 requirements validated
- Performance tests: p95 < 150ms ✓
- No critical bugs found

**QA Critic:** Reviewing test_report.yaml...

✓ All requirements tested and passing
✓ Test coverage exceeds targets
✓ Performance meets requirements
✓ No critical or high-severity bugs

**Verdict:** APPROVED

---

## Phases 7-8: Documentation & Release

*[Similar pattern continues through Documentation and Release phases]*

---

## Final Status

```bash
User: /rigorous-dev:status
```

**Plugin Response:**
```
📋 Rigorous Dev Workflow Status

Project: Task Management API
Artifacts: .claude/rigorous-dev-artifacts/

Progress:
✅ Requirements (completed 2026-02-12 10:45)
✅ UX Design (completed 2026-02-12 11:15)
✅ Architecture (completed 2026-02-12 12:00)
✅ Planning (completed 2026-02-12 12:30)
✅ Implementation (completed 2026-02-12 18:00)
✅ QA (completed 2026-02-12 19:00)
✅ Documentation (completed 2026-02-12 20:00)
✅ Release (completed 2026-02-12 20:30)

Generated Artifacts:
- requirements.yaml
- ux_specification.yaml
- backend_architecture.yaml
- implementation_plan.yaml
- implementation_manifest.yaml
- test_report.yaml
- documentation_manifest.yaml
- deployment_manifest.yaml

🎉 Workflow Complete!
```

---

## Key Takeaways

1. **Producer-Critic Pattern Works** - 2 iterations on UX, everything else approved first time
2. **Checkpoints Are Valuable** - Phase 1 review prevented scope creep
3. **Schema Validation Caught Issues Early** - Prevented downstream problems
4. **State Management** - Could pause/resume at any phase
5. **Artifact Quality** - All artifacts validated and approved
6. **Total Duration** - ~10 days from requirements to deployment-ready

This rigorous process ensured high-quality, well-documented, thoroughly tested software with no surprises at the end.
