# Findings Review & Implementation Workflow

This shared workflow is used by any mode that produces multiple findings (Schema Audit, Deep Audit, Q&A when 2+ changes surface). It covers the full lifecycle from findings presentation through implementation.

**State management:** All findings and decisions are stored in the SQLite database at `.scratch/rigor-plugin-update/audit.db`. This is the single source of truth — there are no markdown ledger files.

**Document scope varies by mode:**
- **Update Mode** — The workflow applies when a change request is decomposed into multiple work-units. Phasing and progress are tracked in-conversation. Single changes go straight through the Producer-Critic Loop without this workflow.
- **Schema Audit Mode** — findings are recorded in the `finding` table and decisions in the `decision` table. Raw critic reports remain in `.scratch/` for reference.
- **Deep Audit Mode** — the critic creates a raw report in `.scratch/`. The orchestrator records structured findings into the database. The implementation plan is only generated if the user approves 3+ fixes.
- **Q&A Mode** — findings are presented inline in the conversation. The conversation itself is the record.

## Step A: Build Findings Index

**⚠️ This is the most critical step. The Findings Index drives the entire review. Do NOT skip or improvise this.**

- Collect all findings from critic reports (or investigation results). Read each group report in full — do not rely on agent result summaries alone.
- For each finding, compute a fingerprint from `category` + affected entities (e.g., table names, file paths) — this is a structural key for deduplication.
- **INSERT each finding** into the database:
  ```bash
  sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db "
    INSERT INTO finding (audit_run_id, critic, category, severity, summary, affected_entities, fingerprint, report_path)
    VALUES ('<run-id>', '<critic>', '<category>', '<severity>', '<summary>', '<json-entities>', '<fingerprint>', '<report-path>');"
  ```
- **Deduplication**: For each finding, check for a prior decision on the same fingerprint:
  ```bash
  sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db "
    SELECT d.decision, d.action, d.reason, f.summary, f.audit_run_id
    FROM decision d
    JOIN finding f ON d.finding_id = f.id
    WHERE f.fingerprint = '<fingerprint>'
    ORDER BY d.decided_at DESC
    LIMIT 1;"
  ```
  If a prior decision exists, pre-fill the finding's status with that decision and mark it `(prior)` so the user can see it was already decided. The user can override any prior decision during interactive review.
- Assign monotonically increasing `#` starting at 1
- Build the findings table with columns: `#`, `Group`/`Category`, `Severity`, `Finding` (one-line summary), `Approved` (blank, or pre-filled from prior decisions)
- Order by impact: critical bugs first, then high-elimination changes, then medium, then low
- Present the numbered findings table to the user (inline in conversation)

## Step B: Interactive Review

- Present each issue one at a time to the user
- For issues with a prior decision: show the prior decision and ask if the user wants to keep it or change it
- For new issues: show context (category, severity, affected tables/files, what it means, why it matters)
- Use `ask_user` with choices: `"Approve"`, `"Reject"`, `"Skip"`, `"Expand (tell me more)"`
- On "Expand": query the finding's `report_path` from the database, read that file for the critic's full analysis, then provide deeper context (show the actual schema/code, explain tradeoffs). Re-ask for decision after expanding.
  ```bash
  sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db "
    SELECT report_path FROM finding WHERE id = <finding_id>;"
  ```
  Read the file at the returned path to get the critic's detailed analysis for this finding.
- Record decision in the Approved column: ✅ (approved), ❌ (rejected), ⏭️ (skipped)
- Report running tally after each decision: `"X approved, Y rejected, Z skipped, W remaining"`

**After each decision** (or in batches), persist the decision to the database:
```bash
sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db "
  INSERT INTO decision (finding_id, decision, action, reason)
  VALUES (<finding_id>, '<approved|rejected|skipped>', '<action text or NULL>', '<reason text or NULL>');"
```

The `decision` table is the persistent record across audit runs — it enables deduplication on future audits via the fingerprint-based lookup in Step A.

## Step C: Dependency Analysis

- After review, analyze dependencies between **approved** issues only
- Identify ordering constraints (e.g., "rename column before adding UNIQUE on it", "merge tables before adding indexes", "collapse child tables before adding CASCADE FKs")
- Present dependency summary to user: which issues block which, and why

## Step D: Implementation Phasing

- Generate the implementation plan from approved issues + dependency graph:
  - **Phase 1**: No dependencies (can execute in any order)
  - **Phase 2**: Depends on Phase 1 items
  - **Phase N**: Depends on prior phases
- Each phase has work-units; each issue produces one or more work-units (trivially similar issues may be batched into one)
- Each work-unit shows original issue `#` numbers for traceability
- For Q&A mode: present the implementation plan in-conversation (only if 3+ approved changes warrant it; for 1-2 changes, skip directly to execution)
- Present implementation plan to user for confirmation before starting implementation

## Step E: Implementation Execution

Execute work-units in phase order using the **Producer-Critic Loop** (see `workflows/producer-critic-loop.md`).

- Each work-unit decomposes into the smallest logical producer tasks possible
- Use 1:1 (single producer → critic) for standalone changes; use N:1 (N sequential producers → 1 critic) when multiple small tasks are parts of one logical change
- Track and report progress at the start of each work-unit:
  ```
  📊 Progress: X/Y issues done | Z in progress | W remaining
  Current: WU-N — [description] (Issues #A, #B)
  ```
- **After each approved finding is implemented**, mark it in the database:
  ```bash
  sqlite3 .scratch/rigor-plugin-update/audit.db "
    UPDATE decision SET implemented_at = datetime('now')
    WHERE finding_id = <finding_id> AND decision = 'approved';"
  ```
- **Commit frequently and minimally** — commit as fine-grained as possible, at minimum after each issue completes but preferably after each coherent sub-change. Each commit should be independently understandable and revertable.

## Step F: Run Completion

An audit run may only transition to `completed` when **all approved decisions have been implemented**:

```bash
-- Check for unimplemented approved decisions
sqlite3 -header -markdown .scratch/rigor-plugin-update/audit.db "
  SELECT f.id, f.critic, f.category, f.summary, d.action
  FROM decision d
  JOIN finding f ON d.finding_id = f.id
  WHERE f.audit_run_id = '<run-id>'
    AND d.decision = 'approved'
    AND d.implemented_at IS NULL;"
```

If the query returns zero rows, mark the run as completed:
```bash
sqlite3 .scratch/rigor-plugin-update/audit.db "
  UPDATE audit_run SET status = 'completed', completed_at = datetime('now')
  WHERE id = '<run-id>';"
```

If any approved decisions remain unimplemented, the run stays in `implementing` status. Report the outstanding items to the user.
