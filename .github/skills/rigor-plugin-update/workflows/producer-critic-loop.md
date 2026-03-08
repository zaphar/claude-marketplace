# Producer-Critic Loop

This is the shared execution mechanism used by all modes when making changes. Every change — whether from Update Mode, audit fix, or Q&A-discovered issue — goes through this loop.

**Decompose work into the smallest logical chunks possible.** Each producer call should handle one atomic, coherent change — the smallest unit of work that leaves the codebase in a consistent state. This keeps changes reviewable, revertable, and reduces agent failure risk.

When executing work from the Findings Review & Implementation Workflow (see `workflows/findings-review.md`), break issues down at the planning stage (Step D: Implementation Phasing), not at the producer level. If an issue is large, decompose it into multiple work-units in the implementation plan — each work-unit is then a small, focused unit.

There are **two kinds of iteration** in this loop. They are orthogonal:

## Loop 1: Producer Batching (how many producers before a critic)

This controls how many producer calls run before the critic reviews:

- **1:1** (default) — 1 producer → 1 critic → commit. Use for standalone changes.
- **N:1** (batching) — N sequential producers → 1 critic → commit. Use when multiple small chunks are parts of one logical change or when a single work-unit spans multiple producer tasks. The critic reviews the aggregate result. Never run producers in parallel — sequential only to avoid rate limiting.

Use your judgment on which pattern fits. The goal is always: smallest producer tasks, fewest wasted critic calls.

## Loop 2: Revision (what happens when the critic rejects)

After the producer(s) complete and the critic reviews, the critic either approves or requests revisions. This is the feedback loop:

**Revision 1 (initial):**

1. Launch the `rigor_plugin_producer` agent (using the assessed model) with the change request as the prompt. Include:
   - The specific change to make
   - Any context about why the change is needed

2. After the producer (or all N producers in a batch) completes, launch the critic agent (always `claude-opus-4.6`) with:
   - The producer's summary of changes
   - The list of modified files
   - The revision number (starting at 1)
   
   **Which critic agent to use:** For MCP server changes, use `rigor_mcp_server_auditor` as the critic — it has specialized SQL, protocol, and server architecture knowledge. For all other plugin changes, use `rigor_plugin_critic`.

3. Evaluate the critic's verdict:
   - **`approved`** → commit and proceed
   - **`needs_revision`** → check if the blocking issues include **test failures** (see below), otherwise enter revision 2

**Test failure escalation:**

If the critic reports MCP test failures as blocking issues, these CANNOT be fed back to the producer — the producer is forbidden from modifying test files. Instead, immediately escalate to the user:
```
🧪 MCP Test Failures Detected

The critic ran `npm test` and [N] test(s) failed after the producer's changes:

[test failure details from critic]

The test harness is a user-controlled correctness contract. The producer cannot modify tests.

How would you like to proceed?
1. Direct the producer to fix its code changes (describe what's wrong)
2. Update the tests yourself to reflect intended behavior changes
3. Override the test failures and accept current changes
4. Abandon the change
```

Use the ask_user tool to get the user's decision. If the user chooses option 1, re-enter the revision loop with the user's guidance added to the producer prompt. If the user chooses option 2, pause the loop while the user modifies the test files, then re-run the critic.

**Revisions 2-3 (if needed):**

Feed the critic's blocking issues back to the producer agent as the change request:
```
Fix the following issues identified by the critic in revision [N]:

[critic's blocking issues and recommended changes]

Original change request: [original request]
```

After the producer fixes, run the critic again. Repeat up to 3 total revisions.

**Escalation (revision > 3):**

If the critic has not approved after 3 revisions, stop the loop and escalate to the user:
```
⚠️ Escalation Required

The plugin update has gone through 3 producer-critic revisions without approval.

Remaining issues from critic:
[list of blocking issues still present]

How would you like to proceed?
1. Provide guidance on the remaining issues and retry
2. Override the reviewer and accept current changes
3. Abandon the change
```

Use the ask_user tool to get the user's decision.

## Commit

After the critic approves, **immediately commit the changes to git** before moving to the next work-unit. Every approved change must be committed before any subsequent work begins.

**Commit frequently and minimally** — commit as fine-grained as possible, at minimum after each issue completes but preferably after each coherent sub-change. Each commit should be independently understandable and revertable.

```bash
git add -A && git commit -m "<concise description>

<details of what changed>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
