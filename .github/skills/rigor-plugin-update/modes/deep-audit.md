# Mode 2: Deep Audit Mode

Triggered when the user asks for a full audit or analysis of the plugin's current state.

## Step 1: Launch Critic

Run the `rigor_plugin_critic` agent (always `claude-opus-4.6`) in deep audit mode. Prompt:

```
Perform a deep audit of the rigorous-dev plugin at plugins/rigorous-dev/.

Run your complete review checklist — correctness, internal consistency, and developer ergonomics — against the full plugin codebase. This is a standalone audit, not a change review.

For each checklist category, report every item as PASS or FAIL with specific details.
Produce a comprehensive audit report in your standard verdict format with mode: deep_audit.
```

## Step 2: Build Findings Index

After the critic completes, read its report and build a **Findings Index** from all FAIL items:

1. **Deduplication**: Check for a prior decisions ledger at `.scratch/rigor-plugin-critic/audit-decisions.md`. Match each FAIL item against prior decisions using category + affected files (structural fingerprint) or summary (fuzzy text match). Pre-fill the `Approved` column for matches and mark with `(prior)`.
2. Each FAIL item gets a monotonically increasing `#` (starting at 1)
3. Add the Findings Index table to the critic's existing `.scratch/` report (this is an addition to the report the critic already creates — not a new file)
4. Present the report to the user with the Findings Index highlighted at the top

The Findings Index follows the format defined in `workflows/findings-review.md` (see **Canonical Persisted Report Structure**):

```
| # | Category | Severity | Approved | Finding |
|---|----------|----------|----------|---------|
| 1 | Correctness | blocking | | [FAIL item one-line summary] |
| 2 | Consistency | recommended | ✅ (prior) | [FAIL item one-line summary] |
```

## Step 3: Enter Findings Review & Implementation Workflow

Enter the **Findings Review & Implementation Workflow** (see `workflows/findings-review.md`) starting at **Step B: Interactive Review** (the Findings Index was already built in Step 2).

The shared workflow handles: interactive approve/reject/skip review → dependency analysis → implementation plan (appended to the critic's report only if 3+ fixes are approved) → execution with progress reporting. After review, the decisions ledger at `.scratch/rigor-plugin-critic/audit-decisions.md` is created or updated.

If the user chooses to fix issues, each fix goes through the full **Producer-Critic Loop** (see `workflows/producer-critic-loop.md`). The complexity assessment should account for the scope of fixes needed.
