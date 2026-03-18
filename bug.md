# Bug Report: `work_item` Records Are Immutable After Insertion

**Plugin:** `claude-zaphar/rigor` v0.11.0
**Discovered during:** Planning phase revision, spooky project
**Date:** 2026-03-17
**Severity:** Medium — workaround exists, but produces inconsistent DB state

---

## Summary

The rigor plugin's MCP tool suite has no mechanism for updating `work_item` records after
they are inserted. The `changelog_update` tool — the only mutation path for existing
changelog entities — only supports three entity types:

- `security_audit_finding`
- `performance_audit_finding`
- `adr`

`work_item` is absent from this list. As a result, any correction to a work item
(changing `review_checkpoint`, amending `exit_criteria`, updating `notes`, fixing
`complexity`, etc.) cannot be applied to the existing row. The only tools available
produce a new row (`changelog_insert`) or describe the intended change in a side-car
record (`intermediate_asset`). Neither approach updates the authoritative record.

---

## How the Problem Was Encountered

During the planning phase for the spooky project, the human reviewer identified that
the initial 23-work-item plan did not distinguish between:

1. **Unit tests** — pure functions with no AWS dependency; runnable by automated
   critic agents via `go test ./...`
2. **AWS integration tests** — requiring real ECS, IAM, ECR, RDS, and Secrets Manager
   infrastructure; executable only by the sole human developer on the project

The planner was invoked in revision 2 (revision_id: 9) and tasked with:

- Setting `review_checkpoint = true` on the 8 work items with real AWS dependencies
  (WI-6, WI-9, WI-13, WI-14, WI-16, WI-17, WI-18, WI-22)
- Splitting each work item's `exit_criteria` into two sections:
  `Automated (critic-runnable)` and `Human (AWS-required)`
- Adding clarifying notes about human-gated validation

The planner correctly identified the limitation and fell back to recording the intended
changes as two `intermediate_asset` records. This means the actual `work_item` rows
in the DB still carry the incorrect `review_checkpoint = false` values. The revision 9
artifacts describe what *should* be true but do not enforce it. Any agent querying
`work_item` directly — including the `rigor:senior_developer`, `rigor:test_writer`, and
`rigor:implementation_plan_critic` agents — will read stale data.

---

## Root Cause

The schema is designed as **append-only** (by explicit design principle documented in
`schema.sql`):

> *"Append-only — Revisions are never deleted or overwritten. New revisions create new
> rows. Full history is preserved."*

This is correct for immutable artifacts like requirements, ADRs, and audit findings.
However, `work_item` records are fundamentally different: they are a living plan that
legitimately changes in response to reviewer feedback between producer-critic revisions.
The append-only constraint was applied too broadly.

The `changelog_update` MCP tool acknowledges that some entities need mutation (ADRs
have a status lifecycle; audit findings move through triage states), but `work_item`
was not included in its supported type list despite having mutable fields:

```
review_checkpoint  -- boolean: should human sign off before marking complete?
exit_criteria      -- JSON array: what does "done" look like?
entry_criteria     -- JSON array: what must be true before starting?
notes              -- text: clarifications, carry-ins, constraints
complexity         -- S/M/L/XL: may be revised as understanding improves
status             -- pending/test_writing/implementing/completed
```

---

## Impact

### Immediate (this project)

The 23 work items in iteration 1 of the spooky project have incorrect
`review_checkpoint` values. Eight work items that require human AWS validation are
marked `review_checkpoint = false`. When the implementation phase begins:

- The `rigor:test_writer` and `rigor:senior_developer` critics will not know these WIs
  require human sign-off
- The workflow will auto-advance past AWS-dependent work items without pausing for the
  human developer to run integration tests
- Deployments may be marked "done" without ever being validated against real AWS
  infrastructure

### General (all rigor users)

Any user who needs to revise a plan after critic feedback — the primary purpose of the
revision loop — cannot apply those changes to the actual work item records. Every
revision that touches `work_item` content produces orphaned `intermediate_asset`
side-car records that agents must know to look for, rather than updated authoritative
rows.

---

## Proposed Fix

### Option A: Add `work_item` to `changelog_update` (recommended)

Extend the `changelog_update` MCP tool to support `work_item` as a mutable entity
type. The update payload should allow patching any subset of mutable fields:

```json
{
  "entity_type": "work_item",
  "entity_id": "WI-6",
  "updates": {
    "review_checkpoint": true,
    "exit_criteria": ["Automated: ...", "Human (AWS-required): ..."],
    "notes": "STS GetCallerIdentity requires real AWS credentials."
  }
}
```

**Implementation notes:**

- Follow the existing pattern in `changelog_update` for `adr` — validate that
  `entity_id` exists, merge the `updates` object into the existing row, write back
- Do not allow updating `phase_number`, `iteration_id`, `work_type`, or `work_order` —
  these are structural fields that define the plan's shape
- The `status` field is already mutable via the separate `work_item_transition` tool;
  `changelog_update` should not duplicate that path
- Add an `updated_at` timestamp column to `work_item` so mutation history is visible
  in queries

**Files to change (estimated):**

```
mcp-server/src/tools/changelog_update.js   -- add work_item case
mcp-server/schema.sql                      -- add updated_at to work_item
mcp-server/migrations/003_work_item_update.sql  -- ALTER TABLE work_item ADD COLUMN updated_at TEXT
```

## Affected Agents

The following agents query `work_item` and will be affected by stale data if this is
not fixed before the implementation phase begins:

```
+--------------------------------------+----------------------------------------------+
| Agent                                | How it uses work_item                        |
+--------------------------------------+----------------------------------------------+
| rigor:implementation_plan_critic     | Validates review_checkpoint placement        |
| rigor:senior_developer               | Reads exit_criteria to know what "done" is   |
| rigor:test_writer                    | Reads exit_criteria to scope test coverage   |
| rigor:senior_developer_critic        | Checks exit_criteria traceability            |
| rigor workflow orchestrator          | Reads review_checkpoint to pause for human   |
+--------------------------------------+----------------------------------------------+
```

---

## Suggested Test Case for the Fix

After implementing Option A, verify:

```
1. Insert a work_item with review_checkpoint = false
2. Call changelog_update(entity_type: "work_item", entity_id: "WI-X",
   updates: { review_checkpoint: true, notes: "updated" })
3. Query changelog_query(entity_type: "work_item", ids: ["WI-X"])
4. Assert review_checkpoint == true and notes == "updated"
5. Assert updated_at is set and created_at is unchanged
6. Assert work_type, phase_number, iteration_id are unchanged
```
