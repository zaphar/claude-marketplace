# Data Model Tables

These three tables store the **data model designed by the `backend_architect`** during the architecture phase. They represent an ERD captured in the changelog database — the entities the target system will use, their attributes (columns/fields), and the relationships between them (foreign keys, cardinality).

> **Important distinction:** These tables describe the *target system's* database design, not the rigorous-dev system's own schema. When the `backend_architect` decides "the application needs a `User` entity with an `email` column," that decision is stored here. The `senior_developer` later reads these rows to generate actual database migrations and ORM models.

**Producer:** `backend_architect`
**Consumer:** `senior_developer` (reads during implementation to create schemas/migrations)
**Critic:** `architecture_critic`

---

## Table: `data_entity`

### Purpose

Represents a single database entity (table, collection, model) in the target system's data model. Each row captures the architect's decision to include a named entity, analogous to a node in an ERD diagram.

### Context

`data_entity` is the root of the data model sub-graph. Every entity belongs to a specific `iteration` and optionally a `revision`, providing full traceability through the producer-critic loop. Child tables `data_entity_attribute` and `data_entity_relationship` hang off this table via foreign key.

### DDL

```sql
CREATE TABLE IF NOT EXISTS data_entity (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  iteration_id INTEGER NOT NULL REFERENCES iteration(id) ON DELETE CASCADE,
  revision_id  INTEGER NOT NULL REFERENCES revision(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  description  TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(iteration_id, name)
);
```

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. Auto-assigned on insert. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | The iteration in which this entity was designed. Scopes the entity to a specific change-request cycle. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | The producer-critic revision that produced this entity. |
| `name` | TEXT | NOT NULL | — | The name of the database entity (e.g., `User`, `Order`, `ProductVariant`). Should match the naming convention of the target system. |
| `description` | TEXT | NOT NULL | — | Human-readable description of what this entity represents and what it stores. |
| `created_at` | TEXT | NOT NULL, DEFAULT `(datetime('now'))` | `(datetime('now'))` | ISO 8601 timestamp of when this row was inserted. |

### Relationships

- **Has many** `data_entity_attribute` rows via `data_entity_attribute.entity_id`
- **Has many** `data_entity_relationship` rows via `data_entity_relationship.entity_id`
- **Belongs to** `iteration` via `iteration_id`
- **Belongs to** `revision` via `revision_id`

### Notes

- `UNIQUE(iteration_id, name)` ensures no duplicate entity names within an iteration. Filter by `revision_id` or the latest revision for a given iteration to get the current model.
- `name` is free-form text; casing conventions (PascalCase, snake_case) should follow what is specified in `architecture_overview` or `technology_choice`.

---

## Table: `data_entity_attribute`

### Purpose

Represents a single attribute (column, field) on a `data_entity`. Captures the name, data type, nullability, and description for each field the architect specifies — the column-level detail of the ERD.

### Context

`data_entity_attribute` is a 1:N child of `data_entity`. The `backend_architect` populates these rows to fully specify what each entity looks like at the field level. The `senior_developer` reads these rows when generating migration files, ORM model definitions, or OpenAPI schemas. The `is_required` flag maps directly to NOT NULL / nullable in SQL or `required` in JSON Schema.

### DDL

```sql
CREATE TABLE IF NOT EXISTS data_entity_attribute (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id   INTEGER NOT NULL REFERENCES data_entity(id),
  name        TEXT    NOT NULL,
  type        TEXT    NOT NULL,
  is_required INTEGER DEFAULT 0,
  description TEXT
);
```

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `entity_id` | INTEGER | NOT NULL, FK → `data_entity(id)` | — | The entity this attribute belongs to. |
| `name` | TEXT | NOT NULL | — | Attribute name (e.g., `email`, `created_at`, `user_id`). |
| `type` | TEXT | NOT NULL | — | Data type as the architect specifies it (e.g., `UUID`, `VARCHAR(255)`, `TIMESTAMP`, `JSONB`, `INTEGER`). Intentionally free-form to be database-agnostic unless the architect ties it to a specific engine. |
| `is_required` | INTEGER | — | `0` | Boolean flag (SQLite convention): `1` = attribute is required / NOT NULL; `0` = nullable / optional. |
| `description` | TEXT | nullable | NULL | Optional clarification — e.g., "ISO 8601 UTC timestamp of last login", "FK to users.id". |

### Relationships

- **Belongs to** `data_entity` via `entity_id`

### Notes

- `type` is a free-form string. The `backend_architect` may use abstract types (`String`, `Date`, `Decimal`) or engine-specific types (`BIGSERIAL`, `TIMESTAMPTZ`) depending on the level of specificity chosen. The `senior_developer` should interpret these in the context of the chosen database from `technology_choice`.
- `is_required = 1` signals NOT NULL in SQL or a required field in a document store. `is_required = 0` (default) means the attribute is optional/nullable.
- There is no UNIQUE constraint on `name` within an entity — use `entity_id + name` together to identify a specific attribute.

---

## Table: `data_entity_relationship`

### Purpose

Represents a directional relationship from one `data_entity` to another — equivalent to a foreign key or association in an ERD. Captures cardinality (one-to-one, one-to-many, many-to-many) and a plain-language description.

### Context

`data_entity_relationship` is a 1:N child of `data_entity`. The source entity is identified by `entity_id` (FK to `data_entity`); the target is identified by `target_entity_id` (also FK to `data_entity`), enforcing referential integrity so relationships can only reference entities that actually exist in the data model. The `senior_developer` uses these rows to determine where to add foreign key constraints, junction tables (for many-to-many), or embedded references.

### DDL

```sql
CREATE TABLE IF NOT EXISTS data_entity_relationship (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id         INTEGER NOT NULL REFERENCES data_entity(id),
  target_entity_id  INTEGER NOT NULL REFERENCES data_entity(id),
  relationship_type TEXT    CHECK(relationship_type IN ('one-to-one', 'one-to-many', 'many-to-many')),
  description       TEXT
);
```

### Column Reference

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `entity_id` | INTEGER | NOT NULL, FK → `data_entity(id)` | — | The source entity of this relationship. |
| `target_entity_id` | INTEGER | NOT NULL, FK → `data_entity(id)` | — | The target entity of this relationship. Foreign key enforcing that the target must exist as a `data_entity` row. |
| `relationship_type` | TEXT | CHECK IN (`'one-to-one'`, `'one-to-many'`, `'many-to-many'`) | NULL | Cardinality of the relationship. NULL is permitted if the architect has not yet specified cardinality. |
| `description` | TEXT | nullable | NULL | Plain-language description of the relationship (e.g., "A User has many Orders, cascades on delete"). |

### Constraints

| Constraint | Details |
|------------|---------|
| CHECK on `relationship_type` | Value must be one of `'one-to-one'`, `'one-to-many'`, `'many-to-many'`, or NULL. Any other value will be rejected by SQLite at insert time. |
| FK on `target_entity_id` | References `data_entity(id)`. The target entity must exist before the relationship can be inserted. |

### Relationships

- **Belongs to** `data_entity` (source) via `entity_id`
- **Belongs to** `data_entity` (target) via `target_entity_id`

### Notes

- `target_entity_id` is a proper foreign key referencing `data_entity(id)`. The target entity must be inserted before any relationship referencing it. When inserting via `changelog_insert`, the handler resolves the `target_entity` name (provided by the agent) to the corresponding `data_entity.id` within the same iteration.
- Because target entities must exist before relationships referencing them can be inserted, the agent should insert entities without outbound relationships first, then insert entities that reference them. Alternatively, insert all entities without `relationships` arrays first, then re-insert entities with their relationships.
- `relationship_type` is nullable — if the architect records a relationship without knowing the cardinality yet, the row is still valid.
- For **many-to-many** relationships, the `senior_developer` should infer the need for a junction table unless `description` says otherwise.
- Relationships are **directional**: a row on entity A pointing to entity B does not automatically create the reverse. The architect may add both directions if bidirectional navigation is required, or only one if the association is unidirectional.

---

## MCP Tool Access

### Reading

Use `changelog_query` with `entity_type: "data_entity"` to retrieve entities. Pass `include_related: true` to have the tool automatically attach the `attributes` and `relationships` arrays to each returned entity — this is the standard way to get a full entity definition in one call.

```json
{
  "tool": "changelog_query",
  "arguments": {
    "entity_type": "data_entity",
    "iteration_id": 3,
    "include_related": true
  }
}
```

With `include_related: true`, each result object has the shape:

```json
{
  "id": 12,
  "iteration_id": 3,
  "revision_id": 7,
  "name": "Order",
  "description": "Represents a customer purchase order.",
  "created_at": "2024-11-01T14:32:00Z",
  "attributes": [
    { "name": "id", "type": "UUID", "is_required": 1, "description": "Primary key" },
    { "name": "placed_at", "type": "TIMESTAMP", "is_required": 1, "description": null }
  ],
  "relationships": [
    { "target_entity": "User", "target_entity_id": 5, "relationship_type": "one-to-many", "description": "Each order belongs to one user" }
  ]
}
```

The `data_entity_attribute` and `data_entity_relationship` tables are not directly queryable as standalone entity types via `changelog_query` — they are always fetched as children of `data_entity` via `include_related: true`.

### Writing

Use `changelog_insert` with `entity_type: "data_entity"` to write entities. The `data` object should include the entity fields along with `attributes` and `relationships` arrays for child rows.

**Important:** Because `target_entity` names are resolved to `data_entity.id` foreign keys at insert time, target entities must already exist in the same iteration before a relationship referencing them can be inserted. Insert entities that are referenced by others first (or insert all entities without `relationships` first, then re-insert entities with their relationships).

```json
{
  "tool": "changelog_insert",
  "arguments": {
    "entity_type": "data_entity",
    "iteration_id": 3,
    "revision_id": 7,
    "data": {
      "name": "Order",
      "description": "Represents a customer purchase order.",
      "attributes": [
        { "name": "id", "type": "UUID", "is_required": 1, "description": "Primary key" },
        { "name": "user_id", "type": "UUID", "is_required": 1, "description": "FK to User" },
        { "name": "placed_at", "type": "TIMESTAMP", "is_required": 1, "description": null },
        { "name": "total_cents", "type": "INTEGER", "is_required": 1, "description": "Total in minor currency units" }
      ],
      "relationships": [
        {
          "target_entity": "User",
          "relationship_type": "one-to-many",
          "description": "Each order belongs to one user; cascades on delete"
        },
        {
          "target_entity": "OrderLine",
          "relationship_type": "one-to-many",
          "description": "An order contains one or more order lines"
        }
      ]
    }
  }
}
```

### Tool Summary

| Tool | Operation | `entity_type` value |
|------|-----------|---------------------|
| `changelog_insert` | Write a data entity with its attributes and relationships | `"data_entity"` |
| `changelog_query` | Read entities; use `include_related: true` for full detail | `"data_entity"` |
| `traceability_query` | Not directly applicable to data entities | — |
| `revision_history` | Get all revisions of the architecture phase (which produced these entities) | Use `phase_name: "architecture"` |
