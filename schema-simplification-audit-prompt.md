# Schema Simplification & Correctness Audit Prompt

Perform a comprehensive schema simplification and correctness audit of the entire rigorous-dev plugin schema (`plugins/rigorous-dev/mcp-server/schema.sql`, currently 141 tables).

Cross-reference every table against `write-tools.js`, `read-tools.js`, all agent files (`agents/*.agent.md`), and table documentation (`references/tables/*.md`, `references/schemas-overview.md`).

## Audit Objectives

### 1. Table Consolidation — Merge Structurally Identical Tables

Identify groups of tables that share identical or near-identical DDL and could be merged into a single table with a discriminator column (e.g., `config_type`, `kind`). We have already applied this pattern successfully:

- `security_config` + `deployment_config` + `observability_config` → `architecture_config`
- `design_system` + `accessibility_config` + `responsive_config` + `feedback_pattern` → `ux_config`

For each candidate group, report:
- Table names and their full DDL
- Column-by-column comparison (shared vs unique columns)
- Write handler comparison (are they duplicated logic?)
- Read handler comparison
- Proposed merged table DDL with discriminator
- Net table reduction

**Exclusion rule:** Do NOT merge tables that have self-referential FKs, structurally different child tables, or semantically distinct column sets where more than one column would become "conditionally relevant" (nullable and only meaningful for one discriminator value). One nullable column (like `target` on `architecture_config`) is acceptable.

### 2. Child Table Collapse — Fold Simple Lists Into Parent Columns

Identify child tables that exist solely to store a list of strings for a parent row (pattern: `parent_id FK + single TEXT column, no other meaningful columns`) and could be collapsed into a JSON array column on the parent table.

We have already applied this pattern:
- `adr_alternative_pro` + `adr_alternative_con` → `pros TEXT` and `cons TEXT` (JSON arrays) on `adr_alternative`

For each candidate, report:
- Child table name and DDL
- Parent table name
- Whether the child data is ever queried independently (e.g., COUNT, JOIN from other tables, cross-entity lookups)
- Whether any other table references the child table via FK
- Recommendation: collapse to JSON column or leave as child table

**Exclusion rules:**
- Do NOT collapse child tables that have multiple meaningful columns beyond the parent FK and the text value
- Do NOT collapse child tables that are referenced by other tables via FK
- Do NOT collapse child tables whose items are individually addressable entities (have their own `id` used elsewhere)
- Do NOT flag TEXT columns that store prose paragraphs — only flag columns where the application code explicitly serializes/deserializes arrays

### 3. Foreign Key Enforcement — Find Missing FK Constraints

Identify columns that reference other tables by name/string but lack a proper REFERENCES constraint. We have already fixed one:
- `data_entity_relationship.target_entity` (TEXT) → `target_entity_id` (INTEGER REFERENCES data_entity(id))

For each candidate, report:
- Table and column name
- What it appears to reference (target table)
- Current type and whether it uses name-based or id-based lookup
- Whether the referenced entity is guaranteed to exist at write time
- Feasibility of adding FK constraint

### 4. CHECK Constraint Audit — Remove Overly Rigid Enums

Identify CHECK constraints on columns whose value domain is open-ended and will grow over time. We have already removed constraints on:
- `component.type` (8 values → free-form)
- `integration_test_boundary.boundary_type` (4 values → free-form)

For each candidate, report:
- Table, column, and current CHECK values
- Whether the enum has an escape hatch (e.g., 'other')
- Whether the values drive application logic (e.g., branching in read/write handlers, determining JOIN targets)
- Recommendation: remove constraint, or keep (with reasoning)

**Exclusion rule:** Keep CHECK constraints where:
- The values are a genuinely closed set (e.g., status enums like 'pass'/'fail')
- The values drive query routing or handler logic
- The enum already includes an 'other' escape hatch

### 5. Schema Correctness — Find Structural Bugs

Identify schema-level correctness issues that could cause data integrity problems, silent data loss, or runtime errors.

Look for:
- **Missing NOT NULL constraints** on columns that should never be NULL based on how they're written (write handler always provides a value, never null/undefined)
- **Missing UNIQUE constraints** where duplicates would be logically invalid (e.g., natural keys, name+parent combinations that should be unique per scope)
- **Missing ON DELETE CASCADE / ON UPDATE CASCADE** on FK constraints where orphaned child rows would be meaningless without their parent
- **Inconsistent FK target types** — e.g., column is INTEGER but references a TEXT primary key, or vice versa
- **Columns typed as TEXT that should be INTEGER** (booleans stored as text, counts stored as text) or vice versa
- **Missing DEFAULT values** where the write handler always supplies the same fallback (e.g., `DEFAULT 0` for boolean flags, `DEFAULT (datetime('now'))` for timestamps)
- **Composite primary keys that should exist but don't** — junction tables using a surrogate AUTOINCREMENT id when a composite PK on the FK pair would enforce uniqueness and prevent duplicate relationships
- **Write/read asymmetry** — columns written by write-tools.js but never read by read-tools.js (dead columns), or columns read but never written (always NULL)

For each issue found, report:
- Table, column, and the specific problem
- Evidence from write-tools.js and/or read-tools.js
- Proposed fix
- Severity: critical (data integrity risk), medium (correctness smell), or low (minor improvement)

### 6. Redundant Tables — Eliminate Derivable or Duplicated Data

Identify tables that store data already derivable from other tables (e.g., a summary table that's just a COUNT of rows in another table, or a denormalized copy of data that exists elsewhere). These add sync burden without value.

For each candidate, report:
- Table name and DDL
- What data it stores and where the source-of-truth version lives
- Whether any agent or handler depends on it (or could trivially query the source instead)
- Recommendation: drop, or keep (with reasoning)

### 7. Orphaned Tables — Find Dead Schema

Identify tables that exist in `schema.sql` but have no write handler in `write-tools.js` and no read query in `read-tools.js`. These are dead schema with no code path to populate or consume them.

For each candidate, report:
- Table name and DDL
- Whether any agent file or documentation references it
- Whether it appears to be planned-but-unimplemented vs. accidentally abandoned
- Recommendation: drop, implement, or flag for review

### 8. Naming Consistency — Flag Convention Breaks

Identify inconsistent naming conventions across tables that could cause confusion in agent instructions or handler code.

Look for:
- Inconsistent suffixes (e.g., some use `_config`, some use `_setting`, some use `_requirement` for similar concepts)
- Inconsistent primary key strategies (some use TEXT IDs like `REQ-XXX`, some use INTEGER AUTOINCREMENT) without clear rationale for the difference
- Column names that mean different things in different tables (e.g., `category` used as a free-form grouping in one table but as a CHECK-constrained enum in another)

**Exclusion rule:** Do NOT propose renames unless the inconsistency causes actual confusion in agent instructions, handler code, or documentation. Cosmetic inconsistencies that don't affect functionality should be noted but not prioritized.

### 9. Column Redundancy Across Sibling Tables — Find Denormalization Drift

Identify cases where multiple child tables of the same parent each carry the same column (e.g., `iteration_id` on both a parent and its child when the child could inherit it through the parent FK). This is denormalization that can drift out of sync.

For each candidate, report:
- Parent table and child table(s) with the redundant column
- Whether the write handler copies the value from the parent or accepts it independently
- Whether any query relies on the child's copy of the column (e.g., filtering children by iteration without joining to parent)
- Risk level: high (values can diverge), medium (always copied but wasteful), low (intentional denormalization with clear benefit)

### 10. Index Coverage — Find Missing Indexes for Query Performance

Identify columns that are frequently used in WHERE clauses, JOIN conditions, or ORDER BY in `read-tools.js` but lack explicit indexes. SQLite auto-indexes primary keys and UNIQUE constraints, but FK columns and filter columns need explicit indexes.

Look for:
- **FK columns without indexes** — every `REFERENCES` column used in JOINs should have an index
- **Columns used in WHERE filters** in `read-tools.js` (especially in `traceability_query` which chains multiple JOINs)
- **Columns used in ORDER BY** without supporting indexes
- **Composite query patterns** that would benefit from multi-column indexes

For each candidate, report:
- Table and column(s) needing an index
- The query in read-tools.js that would benefit
- Proposed CREATE INDEX statement
- Priority: high (traceability/frequently queried), medium (occasional queries), low (rare queries)

### 11. Timestamp Consistency — Flag Inconsistent Patterns

Audit all tables for consistent timestamp handling.

Look for:
- Tables that have `created_at TEXT NOT NULL` without a `DEFAULT (datetime('now'))` when sibling tables do have the default
- Tables that lack `created_at` entirely when all peer tables in the same domain have one
- Tables that have `updated_at` but no mechanism in write-tools.js to set it on updates
- Inconsistent timestamp column names (e.g., `created_at` vs `date` vs `resolved_at` for similar concepts)

For each inconsistency, report:
- Table name and current timestamp columns
- What the convention is across peer tables in the same domain
- Proposed fix
- Severity: low (all timestamp issues are non-breaking but worth standardizing)

### 12. Nullable vs Required Alignment — Schema-to-Code Contract Mismatches

Identify mismatches between the schema's nullability constraints and what the write/read handlers actually do.

Look for:
- **Schema says NOT NULL, handler writes null** — columns marked `NOT NULL` in schema.sql but the write handler uses `?? null`, optional chaining, or conditional assignment that could produce NULL. This will cause a runtime SQLite constraint error.
- **Schema says nullable, handler always provides a value** — columns without `NOT NULL` in schema.sql but the write handler always supplies a non-null value. The constraint should be tightened to `NOT NULL` to match reality.
- **Schema says NOT NULL, but no handler writes it** — columns that are `NOT NULL` with no `DEFAULT` and are never set by any write handler (will always fail on insert).

For each mismatch, report:
- Table, column, schema constraint, and handler behavior
- Evidence from write-tools.js (line number and expression)
- Proposed fix (adjust schema or adjust handler)
- Severity: critical (will crash at runtime), medium (overly permissive schema), low (cosmetic)

### 13. Transaction Safety — Find Unprotected Multi-Table Writes

Identify write handlers in `write-tools.js` that insert into a parent table and one or more child tables but are NOT wrapped in `db.transaction()`. If the parent insert succeeds but a child insert fails, you get orphaned parent rows with incomplete data.

For each candidate, report:
- Handler function name
- Tables written (parent + children)
- Whether `db.transaction()` wraps the entire operation
- Risk: high (multiple child tables, complex logic), medium (single child table), low (simple insert)

### 14. Circular FK Dependencies — Detect Insert-Order Hazards

Identify FK reference chains that form cycles (A → B → C → A), which can make insert ordering impossible and cause cascading delete issues.

For each cycle found, report:
- The tables and columns forming the cycle
- Whether any of the FKs are nullable (which would break the cycle for insert purposes)
- Whether SQLite's deferred FK constraints are used
- Recommendation: break cycle with nullable FK, or document required insert order

### 15. Polymorphic References — Find Untyped Cross-Table Pointers

Identify columns that store an ID or name referencing different tables depending on context, without a proper FK (because the target table varies). Common pattern: a `entity_type` + `entity_id` pair where `entity_id` could point to any of several tables.

For each candidate, report:
- Table and columns involved
- Which target tables can be referenced
- Whether the read handler resolves the reference correctly for all target types
- Whether a missing or invalid `entity_type` would cause a silent failure or crash
- Recommendation: acceptable pattern (with validation) or refactor to typed FKs

### 16. Scope Leakage — Find Missing Iteration/Revision Boundaries

Identify tables that should be scoped to an iteration or revision but lack `iteration_id` or `revision_id` columns, potentially allowing data from one iteration to bleed into another.

For each candidate, report:
- Table name and its parent/domain context
- Whether peer tables in the same domain have iteration/revision scoping
- Whether the table's data is logically per-iteration or truly global
- Recommendation: add scoping columns, or document as intentionally global

### 17. Soft Delete vs Hard Delete — Find Inconsistent Deletion Patterns

Identify whether the schema uses soft deletes (status column with 'deleted' value, or `deleted_at` timestamp) vs hard deletes (DELETE FROM) inconsistently across tables.

For each inconsistency, report:
- Tables that use soft delete and tables that use hard delete
- Whether the write handler performs DELETE or UPDATE on removal
- Whether read handlers filter out soft-deleted rows
- Whether orphaned children are handled in either case

### 18. Data Type Precision — Find Lossy or Ambiguous Types

Identify columns where the SQLite type may cause data precision issues or ambiguity.

Look for:
- **Dates stored as TEXT** without a documented format (ISO 8601 vs Unix timestamp vs arbitrary string)
- **Booleans stored as TEXT** ('true'/'false') instead of INTEGER (0/1) — the schema already uses INTEGER for booleans in some places; flag inconsistencies
- **Numeric values stored as TEXT** that should be INTEGER or REAL for comparison/aggregation
- **Unbounded TEXT columns** that should have CHECK(length(...) <= N) for data quality

For each issue, report:
- Table, column, current type, and the problem
- What the write handler actually stores
- Proposed fix
- Severity: medium (potential data issues) or low (cosmetic)

### 19. Documentation-Schema Drift — Find Stale Documentation

Identify cases where table documentation in `references/tables/*.md` or `references/schemas-overview.md` has drifted from the actual schema.sql DDL.

Look for:
- Tables documented but no longer in schema.sql (or vice versa)
- Column names, types, or constraints in docs that don't match the DDL
- Table counts in documentation that don't match the actual CREATE TABLE count
- MCP tool examples in docs that reference old column names or table names
- Agent files referencing entity types that no longer exist in the handler enum

### 20. Unused Enum Values — Find Dead CHECK Constraint Values

Identify CHECK constraint enum values that no write handler ever produces and no read handler ever filters on. These are dead values in the schema that mislead readers about what states are actually reachable.

For each candidate, report:
- Table, column, and the unused enum value(s)
- All values in the CHECK constraint
- Which values are actually written by write-tools.js (with line numbers)
- Which values are queried/filtered by read-tools.js or agent instructions
- Recommendation: remove the unused value, or document it as reserved/future

## Output Format

For each of the 20 audit categories, provide:
1. A summary table of all candidates found
2. Detailed analysis for each candidate
3. Estimated impact (tables eliminated, lines of handler code saved, files affected)

End with a prioritized recommendation list ordered by impact (most tables/code eliminated first).
