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
- UX specification entries stored in changelog DB via `changelog_insert` (entity types defined in write-tools.js)
```

### Critic Agents

Critic agents validate artifacts produced by producer agents.

**Required Sections:**
- Agent name (header)
- **Personality** - Character traits (rigorous, impartial, constructive)
- **Primary Focus** - Validation responsibility
- **Inputs** - What artifact to review + data model reference
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
- Data model: Requirements entries (validated on insert via `changelog_insert`)

**What should it do:**
- Verify data completeness — the DB enforces structural constraints on insert; check that all required entity types have been populated
- Check for internal consistency (no conflicting requirements)
- Verify completeness using the checklist below
- Verify each requirement is achievable, actionable, and testable

**Review Checklist:**
- Schema validation:
    - [ ] Data completeness: all required fields populated in changelog entries
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
| Requirements | `requirements_analyst.agent.md` | `requirements_critic.agent.md` |
| UX Design | `ux_designer.agent.md` | `ux_critic.agent.md` |
| Architecture | `backend_architect.agent.md` | `architecture_critic.agent.md` |
| Planning | `implementation_planner.agent.md` | `implementation_plan_critic.agent.md` |
| Implementation (tests) | `test_writer.agent.md` | `test_writer_critic.agent.md` |
| Implementation (code) | `senior_developer.agent.md` | `senior_developer_critic.agent.md` |
| QA | `qa_engineer.agent.md` | `qa_critic.agent.md` |
| Audit (Security) | `security_auditor.agent.md` | `security_audit_critic.agent.md` |
| Audit (Performance) | `performance_auditor.agent.md` | `performance_audit_critic.agent.md` |
| Documentation | `documentation_master.agent.md` | `documentation_critic.agent.md` |

## Best Practices

1. **Clear Personality** - Define character traits that guide behavior
2. **Focused Responsibility** - Each agent has one clear job
3. **Explicit Boundaries** - State what agent is NOT responsible for
4. **Concrete Checklists** - Provide specific validation criteria
5. **Constructive Feedback** - Critics should be helpful, not just rejecting
6. **Escalation Procedures** - Clear rules for when to involve user
7. **Schema References** - Always reference the DB entity types and `changelog_insert`/`changelog_query` tools
8. **Handoff Procedures** - Explicit rules for transitions between agents
9. **Artifact Organization** - Producers that generate multiple file outputs (mockups, documentation pages) should organize them into descriptive subdirectories (e.g., `mockups/`, `screenshots/`); primary data goes into the changelog DB via `changelog_insert`

## Creating New Agents

When adding a new phase to the workflow:

1. **Create producer agent** with personality, focus, role, and guidelines
2. **Create critic agent** with validation checklist and feedback structure
3. **Add entity types** in `write-tools.js` for the new phase's data, with DB constraints for validation
4. **Update SKILL.md** to include the new phase in orchestration
5. **Update `ENTITY_TABLE`** in `read-tools.js` so entities are queryable via `changelog_query`

## Example: Adding a "Design Review" Phase

**Producer: `agents/design_reviewer.agent.md`**
```markdown
### Design Reviewer

**Personality:** Analytical, collaborative, quality-focused

**Primary Focus:** Reviewing design decisions and validating consistency across UX and architecture

**Role:**
You review the UX specification and backend architecture to ensure they align and support each other effectively.

[... additional sections ...]
```

**Critic: `agents/design_review_critic.agent.md`**
```markdown
### Design Review Critic

**Personality:** Thorough, objective, detail-oriented

**Primary Focus:** Validating that design review identifies real issues and proposes actionable solutions

**Inputs:**
- Design review report from Design Reviewer
- Data model: Design review entries (validated on insert via `changelog_insert`)
- Prior artifacts: UX specification entries and architecture entries (query via `changelog_query`)

[... additional sections ...]
```

This structure ensures consistency, clarity, and maintainability across all agent personalities.
