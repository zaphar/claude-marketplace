# Rigor MCP Server — Payload Size Problem Analysis

## Summary

The `mcp__plugin_rigor_rigor-db__changelog_query` tool returns the entire result set in a
single JSON payload with no pagination or size controls. For even a modestly sized
project (68 requirements), this produces payloads of ~140k characters. Different MCP
clients (Claude Code, GitHub Copilot, etc.) handle oversized responses differently —
some dump to disk, some truncate, some fail silently. None of these outcomes are
acceptable for a rigorous SDLC workflow.

The core principle is: **the MCP server cannot know or assume anything about its
client's token budget or overflow behavior.** It is the server's responsibility to
ensure payloads are never unmanageably large in the first place. Client-side overflow
handling is not a substitute for server-side size control.

---

## Observed Behavior

```
+----------------------------------------------+---------------+--------------------+
| Query                                        | Response Size | Delivered inline?  |
+----------------------------------------------+---------------+--------------------+
| requirement, include_related=true            | ~143k chars   | No                 |
| requirement, include_related=false           | ~137k chars   | No                 |
+----------------------------------------------+---------------+--------------------+
```

Note: even `include_related=false` is too large. The `acceptance_criteria` field
appears to be embedded directly on each row (not a separate join), so the flag makes
little difference in practice.

---

## Root Cause

The `changelog_query` tool has no pagination mechanism. It accepts:

- `entity_type` — required filter
- `iteration_id` — optional filter
- `ids` — optional ID list
- `filters` — optional field filters
- `include_related` — toggle for child data

There is no `limit`, `offset`, or cursor parameter. A query for all requirements in an
iteration unconditionally returns every row with every field. The caller has no way to
know the payload will be large until after the tool call returns.

As the project grows — work items, components, ADRs, test reports all use
`changelog_query` — this problem will get progressively worse.

---

## Failure Modes

Pagination alone does not solve all cases. There are three distinct failure modes:

### Failure Mode 1 — Too Many Rows

A bulk query returns more rows than any reasonable MCP client can handle inline.
This is the primary observed problem today (68 requirements, ~137k chars).

**Fix: pagination and filtering on the MCP server** (see Server-Side Fixes below).

### Failure Mode 2 — Single Item Too Large

Even with pagination, a single entity — a detailed implementation manifest, a long
test report, a complex ADR — could produce an oversized response on its own.
Pagination does not help when the unit of data itself is too large.

**Fix: projection support so callers can request only the fields they need.**

### Failure Mode 3 — Full-Corpus Review

A critic reviewing all 68 requirements needs to hold the complete picture to identify
gaps, contradictions, and missing coverage. Even with pagination working correctly,
the agent must make multiple sequential calls and accumulate understanding before
producing a review. Without server-side support for this pattern, it is slow and
context-expensive for every agent regardless of client.

**Fix: pre-flight size signaling so agents can plan an efficient multi-call strategy
upfront rather than discovering the scope mid-flight.**

---

## Server-Side Fixes

### Option A — Pagination (Required)

Add `limit` and `offset` parameters to `changelog_query`:

```
limit:  integer, default 20, max 50
offset: integer, default 0
```

Every response includes an envelope with `total`, `limit`, `offset`, and `results`
so the caller can page through the full dataset across multiple calls. This keeps
every individual response at a predictable, manageable size regardless of client.

### Option B — Projection (Required)

Add a `fields` parameter that lets the caller specify which fields to return:

```json
{ "fields": ["id", "category", "priority"] }
```

Enables a two-pass pattern that any agent can use efficiently:
- Pass 1: list all IDs and metadata (small payload, no descriptions)
- Pass 2: fetch specific items by ID with full detail

Also addresses Failure Mode 2 — a single large entity can be fetched in field
subsets rather than as a single oversized blob.

### Option C — Explicit Overflow Error

If a query would produce a response above a defined size threshold, the server should
return a structured error rather than a large payload. This makes the contract
explicit and client-agnostic — no client can silently mishandle it:

```json
{
  "error": "PAYLOAD_TOO_LARGE",
  "message": "Query would return ~140,000 chars. Use limit/offset to paginate.",
  "total_count": 68,
  "estimated_bytes": 140000
}
```

This is a safety net for cases where pagination is available but the caller has not
used it. It prevents any client from receiving an unmanageable payload.

### Option D — Pre-Flight Size Signaling

The server should make dataset size a first-class concern so callers can plan their
query strategy before issuing any data-fetching calls. Two complementary approaches:

**D.1 — Dedicated count/metadata tool (`changelog_count`)**

A lightweight tool that returns row count and estimated payload size for a given
query without returning any data:

```json
{
  "entity_type": "requirement",
  "iteration_id": 1,
  "estimated_count": 68,
  "estimated_bytes": 140000,
  "recommended_page_size": 10
}
```

**D.2 — Size metadata in every response envelope**

Every `changelog_query` response includes `total_count` and `total_estimated_bytes`
regardless of page size, so the caller always knows the full scope of the dataset:

```json
{
  "total": 68,
  "total_estimated_bytes": 140000,
  "limit": 10,
  "offset": 0,
  "results": [...]
}
```

### Option E — Fix `include_related` Semantics

If `acceptance_criteria` and other child data are stored in separate tables,
`include_related=false` should exclude them and materially reduce payload size.
Currently the flag has negligible effect, suggesting child data is stored inline on
the row. If so, this is a schema issue — child data should be moved to separate
tables so the flag is meaningful and composable with pagination and projection.

---

## Recommended Implementation Order

```
+---+----------------------------------------------+----------+
| # | Fix                                          | Priority |
+---+----------------------------------------------+----------+
| 1 | Pagination (Option A)                        | Required |
| 2 | Projection / fields param (Option B)         | Required |
| 3 | Explicit overflow error (Option C)           | Required |
| 4 | Response size envelope (Option D.2)          | High     |
| 5 | Pre-flight count tool (Option D.1)           | Medium   |
| 6 | Fix include_related semantics (Option E)     | Medium   |
+---+----------------------------------------------+----------+
```

Items 1, 2, and 3 together establish a contract that works correctly for any MCP
client: payloads are bounded by default, callers can request only what they need, and
oversized requests fail explicitly rather than silently. Items 4 and 5 improve
efficiency for agents doing full-corpus operations like requirements reviews.

---

## Current Workaround

For the current session, while server-side fixes are pending, any agent can:

1. Extract the full ID list from whatever overflow artifact the client produces.
2. Fetch requirements in small ID batches (5 at a time) using the `ids` parameter.
3. Accumulate findings across batches before producing a review.

This is slow but correct and works across clients.
