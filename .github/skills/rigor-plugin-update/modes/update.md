# Mode 1: Update Mode

Triggered when the user requests a specific change to the plugin.

## Step 1: Understand the Request

Before assessing complexity or launching agents, make sure you fully understand what the user wants. Read the user's request and evaluate whether it is clear and actionable:

**If the request is clear and specific** (e.g., "rename the `backend_architect` agent to `system_architect`", "add a `deploy_config` entity type to the architecture domain"):
- Summarize your understanding back to the user in 1-2 sentences
- Proceed to Step 2

**If the request is ambiguous or underspecified** (e.g., "improve the implementation plugin-phase", "add better error handling"):
- Identify what's missing: scope, affected files, expected behavior, edge cases
- Use ask_user to ask **one focused question at a time** until the request is actionable
- Do not ask the user to re-explain what they already said — build on their input

**If the request could have unintended consequences** (e.g., "remove the ux_design plugin-phase", "change the revision escalation threshold"):
- Explain the downstream impact: what files would change, what cross-references would break, what behavior would shift
- Confirm the user wants to proceed with full awareness of the impact

Once the request is understood, confirm with the user:
```
📝 Change Request Summary

What: [1-2 sentence description of the change]
Scope: [which files/areas of the plugin are affected]
Impact: [any cross-reference updates, downstream effects, or breaking changes]

Proceed?
```

Use ask_user to confirm before moving to Step 2.

## Step 2: Complexity Assessment

Analyze the change request and classify its complexity:

| Complexity | Criteria | Producer Model |
|-----------|----------|----------------|
| **Simple** | Single-file edit, typo fix, minor wording change, frontmatter update | `claude-sonnet-4.6` |
| **Moderate** | Multi-file consistency updates, README updates, command changes | `claude-opus-4.6` |
| **Complex** | New agent pair, plugin-workflow restructuring, schema changes, MCP server modifications, new plugin-phases, SKILL.md rewrite | `claude-opus-4.6` |

**Default to Opus.** Only use Sonnet for changes that are obviously simple — a single-file edit with no cross-reference impact. Any change that touches multiple files or could affect consistency gets Opus. Correctness always takes priority over cost; a subtle cross-reference bug that slips past a weaker model costs far more to fix than the token difference.

Report the classification to the user:
```
📊 Complexity Assessment: [Simple | Moderate | Complex]
Reason: [brief explanation]
Producer model: [claude-sonnet-4.6 | claude-opus-4.6]
Critic model: claude-opus-4.6 (always)
```

## Step 3: Execute Change

Run the **Producer-Critic Loop** (see `workflows/producer-critic-loop.md`) with the confirmed change request.

## Step 4: Final Report

```
✅ Plugin Update Complete

Change: [description]
Complexity: [Simple | Moderate | Complex]
Revisions: [N]
Files modified: [count]
Commit: [hash]

Modified files:
- [file path]: [brief description of change]

Critic verdict: approved
Critic results file: [path reported by critic, e.g. .scratch/rigor-consistency-critic/2026-03-06/141530_critic-review.md]
```
