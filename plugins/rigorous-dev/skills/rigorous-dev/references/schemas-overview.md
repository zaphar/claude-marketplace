# Schema Overview

All artifacts produced during the rigorous development workflow must conform to YAML schemas defined in the `schemas/` directory.

## Schema Locations

All schemas are located at: `schemas/<artifact-name>.schema.yaml`

## Available Schemas

### 1. requirements.schema.yaml

**Artifact:** `requirements.yaml`
**Producer:** requirements_analyst
**Critic:** requirements_critic

**Purpose:** Validates requirements specification structure and completeness

**Key Sections:**
- Project metadata (name, version)
- Problem statement and target users
- Requirements list with:
  - Unique IDs (REQ-XXX format)
  - Title, description, priority, category
  - Acceptance criteria
- Security requirements
- Deployment requirements
- Constraints and assumptions
- Out-of-scope items

**Validation Rules:**
- All requirement IDs must follow REQ-XXX pattern
- Priority must be: must_have, should_have, could_have, or wont_have
- All requirements must have at least one acceptance criterion
- Categories: functional, security, performance, usability, operational

### 2. ux_specification.schema.yaml

**Artifact:** `ux_specification.yaml`
**Producer:** ux_designer
**Critic:** ux_critic

**Purpose:** Validates UX design specification including flows, wireframes, and design system

**Key Sections:**
- User personas
- User flows with steps
- Wireframes with component hierarchy
- Design system (colors, typography, spacing, components)
- Accessibility requirements
- Responsive design breakpoints

**Validation Rules:**
- Each user flow must have at least one step
- Wireframes must define views with components
- Design system must specify primary, secondary, and accent colors
- Typography must define at least heading and body fonts

### 3. Architecture Schemas (Modular)

The architecture specification is split across multiple schemas, each validating one concern:

**Producer:** backend_architect
**Critic:** architecture_critic

| Schema | Artifact | Purpose |
|--------|----------|---------|
| `architecture_index.schema.yaml` | `architecture_index.yaml` | Metadata, overview, technology choices, linters |
| `architecture_components.schema.yaml` | `architecture_components.yaml` | Components with interfaces, dependencies, integration test boundaries |
| `architecture_data_model.schema.yaml` | `architecture_data_model.yaml` | Data entities with attributes and relationships |
| `architecture_deployment.schema.yaml` | `architecture_deployment.yaml` | Deployment target, environments, containerization, scaling |
| `architecture_security.schema.yaml` | `architecture_security.yaml` | Authentication, authorization, data protection, secrets |
| `architecture_observability.schema.yaml` | `architecture_observability.yaml` | Logging, metrics, tracing, health checks |
| `architecture_traceability.schema.yaml` | `architecture_traceability.yaml` | Requirements-to-component mapping |
| `architecture_dependencies.schema.yaml` | `architecture_dependencies.yaml` | Dependency manifest with health assessments |
| `architecture_adr.schema.yaml` | `architecture_adr.yaml` | Architecture Decision Records with alternatives and research sources |

The architect also produces `api_spec.yaml` (OpenAPI format) as the authoritative API contract.

**Note:** The old monolithic `backend_architecture.schema.yaml` is deprecated. Use the modular schemas above.

### 4. implementation_plan.schema.yaml

**Artifact:** `implementation_plan.yaml`
**Producer:** implementation_planner
**Critic:** implementation_plan_critic

**Purpose:** Validates phased implementation plan

**Key Sections:**
- Phases with objectives and deliverables
- Dependencies between phases
- Strategic checkpoints for review
- Risk assessment
- Requirements mapping (which requirements in which phases)

**Validation Rules:**
- At least one phase defined
- Each phase has objectives and deliverables
- Checkpoints must specify when and what to review
- Requirements must be mapped to specific phases

### 5. implementation_manifest.schema.yaml

**Artifact:** `implementation_manifest.yaml`
**Producer:** senior_developer (in the implementation step, after the test_writer step has been approved)
**Critic:** senior_developer_critic

**Purpose:** Tracks implementation progress and artifacts

**Key Sections:**
- Completed phases with timestamps
- Files created/modified
- Tests implemented
- Checkpoint reviews completed
- Known issues or technical debt

**Validation Rules:**
- Each completed phase must have completion timestamp
- Files list must include paths
- Tests must specify type (unit, integration, e2e) and status

### 6. test_report.schema.yaml

**Artifact:** `test_report.yaml`
**Producer:** qa_engineer
**Critic:** qa_critic

**Purpose:** Validates comprehensive test results

**Key Sections:**
- Test summary (total, passed, failed)
- Test results by category (unit, integration, e2e)
- Requirements coverage (which requirements tested)
- Bugs found with severity and status
- Performance test results

**Validation Rules:**
- All requirements from requirements.yaml must be tested
- Each bug must have severity level and status
- Test results must specify pass/fail status

### 7. documentation_manifest.schema.yaml

**Artifact:** `documentation_manifest.yaml`
**Producer:** documentation_master
**Critic:** documentation_critic

**Purpose:** Validates documentation completeness

**Key Sections:**
- User documentation files
- API documentation files
- Deployment guides
- Architecture documentation
- Developer guides

**Validation Rules:**
- All documentation types must be represented
- Each document must have a path
- API documentation must cover all endpoints from api_spec.yaml

### 8. deployment_manifest.schema.yaml

**Artifact:** `deployment_manifest.yaml`
**Producer:** release_engineer
**Critic:** release_critic

**Purpose:** Validates deployment configuration and release readiness

**Key Sections:**
- Deployment configuration (environment, resources, scaling)
- Release notes with version and changes
- Deployment steps and verification
- Rollback procedures
- Post-deployment monitoring

**Validation Rules:**
- Deployment configuration must specify environment and resources
- Release notes must include version and categorized changes
- Deployment steps must be ordered and actionable
- Rollback procedures required

### 9. wireframe_comparison.schema.yaml

**Artifact:** `wireframe_comparison.yaml`
**Producer:** ux_designer (during revisions)
**Critic:** ux_critic

**Purpose:** Documents changes between wireframe versions

**Key Sections:**
- Comparison metadata (versions, date)
- Changes by view with descriptions
- Rationale for each change

**Validation Rules:**
- Must reference two versions being compared
- Changes must specify which view was modified
- Rationale required for each change

## Schema Validation

### Using Schemas in Workflow

When a producer creates an artifact:

1. **Reference the schema** - Know which schema applies to your artifact
2. **Follow the structure** - Create YAML that matches the schema
3. **Validate** - Critic validates against schema before approval

### Validation Tools

**YAML Validation:**
```bash
# Check YAML syntax
python -c "import yaml; yaml.safe_load(open('artifact.yaml'))"
```

**Schema Validation:**
```bash
# Using Python with jsonschema (for YAML)
pip install pyyaml jsonschema
python -c "
import yaml
import jsonschema

with open('artifact.yaml') as f:
    data = yaml.safe_load(f)
with open('schema.yaml') as f:
    schema = yaml.safe_load(f)

jsonschema.validate(data, schema)
print('Valid!')
"
```

## Common Schema Patterns

### Required vs Optional Fields

Schemas use `required: []` arrays to specify mandatory fields:

```yaml
required:
  - project
  - requirements
  - security_requirements
```

Fields not in the `required` array are optional.

### Enumerated Values

Schemas use `enum: []` for fixed value sets:

```yaml
priority:
  type: string
  enum: ["must_have", "should_have", "could_have", "wont_have"]
```

### Pattern Validation

Schemas use `pattern:` for regex validation:

```yaml
id:
  type: string
  pattern: "^REQ-[0-9]{3}$"  # Matches REQ-001, REQ-042, etc.
```

### Nested Objects

Schemas define nested structures:

```yaml
requirements:
  type: array
  items:
    type: object
    properties:
      id: {type: string}
      title: {type: string}
      acceptance_criteria:
        type: array
        items: {type: string}
```

## Extending Schemas

When customizing the workflow, you may need to extend schemas:

1. **Copy existing schema** as a starting point
2. **Add new fields** to `properties` section
3. **Update `required` array** if fields are mandatory
4. **Update agent checklists** to verify new fields
5. **Test validation** with sample artifacts

## Best Practices

1. **Always validate** - Never skip schema validation
2. **Provide examples** - Include example artifacts for reference
3. **Clear error messages** - When validation fails, explain what's wrong
4. **Version schemas** - Track schema changes over time
5. **Document extensions** - Note any custom fields added
6. **Test thoroughly** - Validate with both valid and invalid data

## Schema Format

All schemas follow JSON Schema Draft 2020-12 specification:

```yaml
$schema: "https://json-schema.org/draft/2020-12/schema"
$id: "https://example.com/schemas/artifact.schema.yaml"
title: "Artifact Name"
description: "Description of what this artifact represents"
type: object
properties:
  # ... field definitions ...
required:
  # ... required fields ...
```

This ensures compatibility with standard validation tools and provides clear structure for artifacts.
