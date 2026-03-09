# Producer-Critic Loop

This is the shared execution mechanism used by all modes when making changes. Every change — whether from Update Mode, audit fix, or Q&A-discovered issue — goes through this loop.

**Decompose work into the smallest logical chunks possible.** Each producer call should handle one atomic, coherent change — the smallest unit of work that leaves the codebase in a consistent state. This keeps changes reviewable, revertable, and reduces agent failure risk.

When executing work from the Findings Review & Implementation Workflow (see `workflows/findings-review.md`), break issues down at the planning stage (Step D: Implementation Phasing), not at the producer level. If an issue is large, decompose it into multiple work-units in the implementation plan — each work-unit is then a small, focused unit.

There are **three phases** to each iteration of this loop: produce, classify & validate, and commit (or revise).

## Phase 1: Produce

This controls how many producer calls run before critics review:

- **1:1** (default) — 1 producer → critics → commit. Use for standalone changes.
- **N:1** (batching) — N sequential producers → critics → commit. Use when multiple small chunks are parts of one logical change or when a single work-unit spans multiple producer tasks. The critics review the aggregate result. Never run producers in parallel — sequential only to avoid rate limiting.

Use your judgment on which pattern fits. The goal is always: smallest producer tasks, fewest wasted critic calls.

Launch the `rigor_plugin_producer` agent (using the assessed model) with the change request as the prompt. Include:
- The specific change to make
- Any context about why the change is needed

### Pre-decomposition by File Domain

Before launching a producer, assess whether the work-unit is likely to complete within the agent's execution window. Work-units that span multiple file domains — schema DDL, JavaScript handlers, and documentation — are significantly more likely to time out than single-domain tasks. Use judgment: a rename touching one line in each of 10 files is simpler than rewriting one complex function. Consider both the number of domains and the depth of changes in each.

When a work-unit is large or complex enough to risk timeout, **pre-decompose it into sequential sub-tasks scoped by file domain** and use the N:1 batching pattern. The natural dependency order is:

1. **Schema** (`schema.sql`) — DDL changes must land first; everything else depends on table structure.
2. **Write handlers** (`write-tools.js`) — Insert/upsert logic depends on the schema.
3. **Read handlers** (`read-tools.js`) — Query logic depends on the schema.
4. **Documentation** (table docs, `schemas-overview.md`, `INTERNALS.md`, agent/skill/command docs) — Docs describe the final code state, so they come last.

Each sub-task gets its own focused producer call. The critics review the aggregate result after all sub-tasks complete.

### Handling Producer Timeouts

A producer timeout is a signal that the work-unit was too large — not a failure to retry at the same scope. When a producer times out:

1. **Assess what completed.** Run `git diff --stat HEAD` to see which files were modified. Read the diffs to check for truncated or placeholder code (e.g., `PLACEHOLDER`, incomplete function bodies, half-written SQL).

2. **Triage partial results:**
   - **Clean, complete files** — keep them. If schema.sql changes are self-consistent and correct, there's no reason to redo that work.
   - **Broken or partial files** — reset them with `git checkout -- <file>`. Incomplete code is worse than no code.

3. **Decompose the remaining work.** Identify which file domains the producer didn't reach and launch focused, single-domain producer calls for each. These scoped calls are much more likely to succeed.

4. **Orchestrator self-completion.** For purely mechanical remaining work — bulk sed renames, updating counts in documentation, removing table entries from lists — the orchestrator may complete these directly rather than launching another producer. Reserve producer calls for changes requiring judgment: restructuring function logic, rewriting SQL queries, updating prose descriptions. The line is: if the change is a deterministic text transformation, the orchestrator can do it; if it requires understanding intent, use a producer.

## Phase 2: Classify & Validate (Multi-Critic)

After the producer (or all N producers in a batch) completes, it reports its summary and the list of modified files. Use that file list to determine which critic domains are affected:

| Files Modified | Critic Agent |
|---|---|
| Agent files, SKILL.md, README, commands, plugin.json | `rigor_consistency_critic` |
| schema.sql, references/tables/*.md, schemas-overview.md | `rigor_schema_critic` |
| mcp-server/*.js, mcp-server/test/*, INTERNALS.md | `rigor_mcp_server_critic` |

A single change can touch one, two, or all three domains. Select **every** critic whose file patterns match at least one modified file.

**Launch all relevant critics in parallel** (always `claude-opus-4.6`). Provide each critic with:
- The producer's summary of changes
- The list of modified files (full set, not filtered per-critic)
- The revision number (starting at 1)

**Change review scope vs audit scope:** During change reviews (this loop), each critic runs as a **single agent** with a targeted prompt scoped to the specific files and tables that changed. Critics do not fan out into sub-agent groups here — that parallelism is reserved for standalone audit modes and is defined in each mode's own workflow file, not this loop.

### Evaluating Verdicts

**All critics must approve** for the change to pass. Collect every critic's verdict:

- Every critic returned **`approved`** → commit and proceed (Phase 3).
- Any critic returned **`needs_revision`** → check for test failures first (see below), then enter a revision cycle.

When multiple critics reject, **merge their feedback** into a single combined prompt for the producer. Group the issues by critic so the producer can see which domain each issue came from:

```
Fix the following issues identified by critics in revision [N]:

## rigor_consistency_critic
[blocking issues and recommended changes]

## rigor_mcp_server_critic
[blocking issues and recommended changes]

Original change request: [original request]
```

### Test Failure Escalation

If any critic reports MCP test failures as blocking issues, these CANNOT be fed back to the producer — the producer is forbidden from modifying test files. Instead, immediately escalate to the user:
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

Use the ask_user tool to get the user's decision. If the user chooses option 1, re-enter the revision loop with the user's guidance added to the producer prompt. If the user chooses option 2, pause the loop while the user modifies the test files, then re-run the critics.

### Revision Cycles (max 3)

Feed the merged blocking issues from all rejecting critics back to the producer agent as the change request. After the producer fixes, re-run **all originally selected critics** again (not just the ones that rejected — a fix for one domain can break another). Repeat up to 3 total revisions.

**Escalation (revision > 3):**

If the critics have not all approved after 3 revisions, stop the loop and escalate to the user:
```
⚠️ Escalation Required

The plugin update has gone through 3 producer-critic revisions without full approval.

Remaining issues from critics:
[list of blocking issues still present, grouped by critic]

How would you like to proceed?
1. Provide guidance on the remaining issues and retry
2. Override the critics and accept current changes
3. Abandon the change
```

Use the ask_user tool to get the user's decision.

## Phase 3: Commit

After all critics approve, **immediately commit the changes to git** before moving to the next work-unit. Every approved change must be committed before any subsequent work begins.

**Commit frequently and minimally** — commit as fine-grained as possible, at minimum after each issue completes but preferably after each coherent sub-change. Each commit should be independently understandable and revertable.

```bash
git add -A && git commit -m "<concise description>

<details of what changed>

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
