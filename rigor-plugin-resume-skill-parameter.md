# Bug: `rigor:resume` Step 5 — Skill Tool Invocation Uses Wrong Parameter Name

**Plugin:** `claude-zaphar/rigor` v0.11.0
**Discovered during:** Resuming planning phase, spooky project
**Date:** 2026-03-18
**Severity:** Low — workflow fails at step 5 on every resume; easily retried once fixed

---

## Summary

When `/rigor:resume` reaches Step 5 ("Load Rigorous Dev Skill"), the instruction is
vague enough that the model guesses the wrong parameter name when calling the `Skill`
tool, causing the invocation to fail with a validation error.

---

## Error Observed

```
InputValidationError: Skill failed due to the following issue:
The required parameter `skill` is missing
```

---

## Root Cause

Step 5 in `commands/resume.md` reads:

> "Load the workflow skill with the current state context so it knows where to continue."

The `Skill` tool's required parameter is named `skill`. The model interprets "load"
as a call to the `Skill` tool but infers `name` as the parameter key (a natural
synonym), producing:

```json
{ "name": "rigor:workflow" }
```

Instead of the correct:

```json
{ "skill": "rigor:workflow" }
```

Because `skill` is required and `name` is unrecognized, the call fails.

---

## Fix

**File to edit:**

```
~/.claude/plugins/cache/claude-zaphar/rigor/<version>/commands/resume.md
```

**Find:**

```
### 5. Load Rigorous Dev Skill

Load the workflow skill with the current state context so it knows where to continue.
```

**Replace with:**

```
### 5. Load Rigorous Dev Skill

Invoke the `Skill` tool with `skill: "rigor:workflow"` to load the workflow skill.
Do not use any other parameter name (e.g. `name`) — the required parameter is `skill`.
```

---

## Verification

After applying the fix, run `/rigor:resume` on a project with an active workflow.
Step 5 should invoke the `Skill` tool without error and the `rigor:workflow` skill
should load successfully.
