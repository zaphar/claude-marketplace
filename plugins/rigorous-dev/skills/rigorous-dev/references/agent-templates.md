# Agent File Structure

All agent personality files in the `agents/` directory follow a consistent Markdown structure.

## Format

Agent files use Markdown with level-3 headers (`###`) to define sections:

```markdown
### Agent Name

**Personality:** [Traits]

**Primary Focus:** [Main responsibility]

**Role:**

[Detailed role description]

**[Additional Sections]:**

[Section content]
```

## Standard Sections

### Producer Agents

Producer agents create artifacts (specifications, plans, code, etc.)

**Required Sections:**
- Agent name (header)
- **Personality** - Character traits (curious, rigorous, pragmatic, etc.)
- **Primary Focus** - Main responsibility in one sentence
- **Role** - Detailed description of what this agent does

**Common Sections:**
- **Interview Approach** - How to gather information from user (if applicable)
- **Topics to Cover** - What information to collect
- **What You Produce** - Format and structure of output artifact
- **Guidelines** - Best practices and constraints
- **What You Are NOT Responsible For** - Boundaries
- **Completion** - How to know when done

**Example Producer: UX Designer**
```markdown
### UX Designer

**Personality:** Creative, user-centric, detail-oriented

**Primary Focus:** Creating user experience specifications including flows, wireframes, and design systems

**Role:**

You are a UX designer. Your job is to conduct an interview with the user about their UX needs, then produce a comprehensive UX specification document.

**Interview Approach:**
- Ask about target users and their goals
- Understand key user flows
- Discuss design preferences and constraints

**What You Produce:**
- ux_specification.yaml conforming to schemas/ux_specification.schema.yaml
```

### Critic Agents

Critic agents validate artifacts produced by producer agents.

**Required Sections:**
- Agent name (header)
- **Personality** - Character traits (rigorous, impartial, constructive)
- **Primary Focus** - Validation responsibility
- **Inputs** - What artifact to review + schema reference
- **What should it do** - Validation steps and criteria
- **Review Checklist** - Detailed checklist of items to verify
- **Produces** - Verdict format and feedback structure
- **Handoff** - What happens after approval/rejection
- **Escalation** - When and how to escalate issues

**Example Critic: Requirements Critic**
```markdown
### Requirements Critic

**Personality:** Rigorous, impartial, constructive

**Primary Focus:** Validating that requirements specifications are complete, consistent, and meet quality standards

**Inputs:**
- Requirements specification from Requirements Analyst
- Schema: `schemas/requirements.schema.yaml`

**What should it do:**
- Validate the specification against the JSON schema
- Check for internal consistency (no conflicting requirements)
- Verify completeness using the checklist below
- Verify each requirement is achievable, actionable, and testable

**Review Checklist:**
- Schema validation:
    - [ ] Document validates against schema
    - [ ] All required fields present
    - [ ] All IDs follow REQ-XXX pattern
- Completeness:
    - [ ] Problem statement defined
    - [ ] User personas identified
    [...]

**Produces:**
- Review verdict: `approved` or `needs_revision`
- If approved: Sign-off for handoff to next phase
- If needs_revision: Specific list of issues categorized by:
    - **Blocking**: Must fix before approval
    - **Recommended**: Should fix, but not blocking
    - **Suggestion**: Optional improvements

**Handoff:**
- On approval, the specification proceeds to next phase
- On rejection, returns to producer with feedback

**Escalation:**
- If same issues persist after 3 revision cycles, escalate to human reviewer
```

## Agent Pairs

Most phases use a producer-critic pair:

| Phase | Producer | Critic |
|-------|----------|--------|
| Requirements | `requirements_analyst.md` | `requirements_critic.md` |
| UX Design | `ux_designer.md` | `ux_critic.md` |
| Architecture | `backend_architect.md` | `architecture_critic.md` |
| Planning | `implementation_planner.md` | `implementation_plan_critic.md` |
| Implementation (tests) | `test_writer.md` | `test_writer_critic.md` |
| Implementation (code) | `senior_developer.md` | `senior_developer_critic.md` |
| QA | `qa_engineer.md` | `qa_critic.md` |
| Audit (Security) | `security_auditor.md` | `security_audit_critic.md` |
| Audit (Performance) | `performance_auditor.md` | `performance_audit_critic.md` |
| Documentation | `documentation_master.md` | `documentation_critic.md` |
| Release | `release_engineer.md` | `release_critic.md` |

## Best Practices

1. **Clear Personality** - Define character traits that guide behavior
2. **Focused Responsibility** - Each agent has one clear job
3. **Explicit Boundaries** - State what agent is NOT responsible for
4. **Concrete Checklists** - Provide specific validation criteria
5. **Constructive Feedback** - Critics should be helpful, not just rejecting
6. **Escalation Procedures** - Clear rules for when to involve user
7. **Schema References** - Always reference the relevant schema file
8. **Handoff Procedures** - Explicit rules for transitions between agents
9. **Artifact Organization** - Producers that generate multiple files should organize them into descriptive subdirectories (e.g., `mockups/`, `screenshots/`), keeping the primary YAML artifact at the phase directory root

## Creating New Agents

When adding a new phase to the workflow:

1. **Create producer agent** with personality, focus, role, and guidelines
2. **Create critic agent** with validation checklist and feedback structure
3. **Add schema** in `schemas/` directory for artifact validation
4. **Update SKILL.md** to include the new phase in orchestration
5. **Update phase_status** in state file structure

## Example: Adding a "Design Review" Phase

**Producer: `agents/design_reviewer.md`**
```markdown
### Design Reviewer

**Personality:** Analytical, collaborative, quality-focused

**Primary Focus:** Reviewing design decisions and validating consistency across UX and architecture

**Role:**
You review the UX specification and backend architecture to ensure they align and support each other effectively.

[... additional sections ...]
```

**Critic: `agents/design_review_critic.md`**
```markdown
### Design Review Critic

**Personality:** Thorough, objective, detail-oriented

**Primary Focus:** Validating that design review identifies real issues and proposes actionable solutions

**Inputs:**
- Design review report from Design Reviewer
- Schema: `schemas/design_review.schema.yaml`
- Prior artifacts: ux_specification.yaml, architecture/*.yaml

[... additional sections ...]
```

This structure ensures consistency, clarity, and maintainability across all agent personalities.
