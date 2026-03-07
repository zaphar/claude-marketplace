# Requirements Domain Tables

The requirements domain captures the full output of the **requirements_analyst** agent during the requirements phase of a workflow iteration. It models the problem space before any architectural or implementation decisions are made: who the users are, what the system must do, how success is measured, what deployment environment is targeted, and what operational and technology constraints apply.

Every record in this domain is scoped to an `iteration_id`, meaning the full set of requirements is versioned per iteration. When the **requirements_critic** validates or rejects the analyst's output, a new revision is created and linked via `revision_id` on the relevant records. This allows the system to track how requirements evolved across critic feedback cycles without losing earlier drafts.

Downstream agents — **backend_architect**, **ux_designer**, and **implementation_planner** — all read from this domain to ensure traceability. The architect maps requirements to components and ADRs. The UX designer links requirements to user flows and screens. The implementation planner uses priorities and acceptance criteria to drive story sizing and sequencing. Nothing downstream should make an assumption about system behaviour that cannot be traced back to a record in this domain.

---

## persona

**Purpose:** Represents a user archetype — a named, described role with a defined technical level and usage frequency. Personas ground the requirements in real human context, preventing the system from being designed in the abstract. Each persona is scoped to an iteration and pinned to a specific revision when the requirements_critic has approved or revised the analyst's output.

**Context:** Produced by the **requirements_analyst** agent. Validated (and potentially revised) by the **requirements_critic**. Consumed by the **ux_designer** (who associates personas with user flows) and the **requirements_analyst** itself (who links personas to requirements via `requirement_persona`). Referenced downstream by `user_flow.persona_id`.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Stable identifier for the persona, typically a slug (e.g. `"admin-user"`). |
| `iteration_id` | INTEGER | NOT NULL, REFERENCES iteration(id) | The iteration this persona belongs to. |
| `revision_id` | INTEGER | NOT NULL, REFERENCES revision(id) | The revision in which this persona was last approved or updated by the critic. |
| `name` | TEXT | NOT NULL | Human-readable name of the persona (e.g. `"Operations Engineer"`). |
| `description` | TEXT | NOT NULL | Narrative description of who this persona is, their role, and their context. |
| `technical_level` | TEXT | — | Self-reported or inferred technical proficiency (e.g. `"beginner"`, `"intermediate"`, `"expert"`). No CHECK constraint — analyst may use domain-specific values. |
| `frequency_of_use` | TEXT | — | How often this persona interacts with the system (e.g. `"daily"`, `"weekly"`, `"occasionally"`). |
| `goals` | TEXT | DEFAULT '[]' | JSON array of goal strings for this persona (e.g. `["Monitor system health without reading log files"]`). Formerly stored in the `persona_goal` child table. |
| `created_at` | TEXT | NOT NULL | ISO 8601 timestamp recording when this persona was inserted. |
| `updated_at` | TEXT | — | ISO 8601 timestamp of the last UPSERT update. NULL if never updated after initial insert. |

**Relationships:**
- Parent: `iteration` (via `iteration_id`)
- Parent: `revision` (via `revision_id`)
- Children: `requirement_persona` (via `persona_id`) — links personas to requirements
- Children: `user_flow` (via `persona_id`) — links personas to UX flows

**Note:** Goals are stored inline as a JSON array in the `goals` column (e.g., `["Monitor system health without reading log files", "Deploy updates without downtime"]`). Formerly stored in the `persona_goal` child table.

**Produced by:** `changelog_insert` with entity_type `"persona"`
**Queried by:** `changelog_query` with entity_type `"persona"`

---

## requirement

**Purpose:** The central table of this domain. Each row is a single requirement — a statement of something the system must, should, or could do — classified by category and priority. Requirements have a human-readable description, an optional rationale explaining why the requirement exists, and a category that guides which downstream agents care about it most.

**Context:** Produced by the **requirements_analyst**. Validated by the **requirements_critic**, which may reject and request rewriting. Once approved, requirements are referenced by virtually every downstream agent: the **backend_architect** maps them to components and ADRs via `component_requirement` and `traceability_mapping`; the **ux_designer** links them to user flows via `user_flow_requirement`; the **implementation_planner** uses priority to sequence work.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | Stable identifier, typically a short slug (e.g. `"req-auth-001"`). |
| `iteration_id` | INTEGER | NOT NULL, REFERENCES iteration(id) | The iteration this requirement belongs to. |
| `revision_id` | INTEGER | NOT NULL, REFERENCES revision(id) | The revision in which this requirement was last approved or changed. |
| `description` | TEXT | NOT NULL | Full statement of the requirement. |
| `rationale` | TEXT | — | Optional explanation of why this requirement exists or was prioritised as it was. |
| `priority` | TEXT | NOT NULL, CHECK IN (`'must-have'`, `'should-have'`, `'nice-to-have'`) | MoSCoW-style priority. The implementation planner uses this to sequence work. |
| `category` | TEXT | NOT NULL, CHECK IN (`'functional'`, `'security'`, `'usability'`, `'performance'`, `'operational'`, `'deployment'`) | Classifies the requirement type to route it to the appropriate downstream agents. |
| `acceptance_criteria` | TEXT | DEFAULT '[]' | JSON array of testable acceptance criterion strings (e.g. `["Given an unauthenticated request, the API returns HTTP 401"]`). Formerly stored in the `requirement_acceptance_criterion` child table. |
| `created_at` | TEXT | NOT NULL | ISO 8601 timestamp recording when this requirement was inserted. |
| `updated_at` | TEXT | — | ISO 8601 timestamp of the last UPSERT update. NULL if never updated after initial insert. |

**Relationships:**
- Parent: `iteration` (via `iteration_id`)
- Parent: `revision` (via `revision_id`)
- Children: `requirement_persona` (via `requirement_id`)
- Children: `requirement_dependency` (via `requirement_id` and `depends_on`)
- Children: `component_requirement` (via `requirement_id`) — architecture domain
- Children: `traceability_mapping` (via `requirement_id`) — architecture domain
- Children: `user_flow_requirement` (via `requirement_id`) — UX domain

**Note:** Acceptance criteria are stored inline as a JSON array in the `acceptance_criteria` column. Formerly stored in the `requirement_acceptance_criterion` child table.

**Produced by:** `changelog_insert` with entity_type `"requirement"`
**Queried by:** `changelog_query` with entity_type `"requirement"`

---

## requirement_persona

**Purpose:** A junction table linking requirements to the personas they serve. A single requirement may affect multiple personas, and a persona may be implicated in many requirements. This many-to-many relationship allows downstream agents to ask "which requirements matter to persona X?" or "which personas are affected by requirement Y?" without scanning free text.

**Context:** Produced by the **requirements_analyst** during requirement elaboration. Consumed by the **ux_designer** to ensure that user flows cover the requirements relevant to each persona, and by the **implementation_planner** to understand stakeholder impact when prioritising work.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `requirement_id` | TEXT | NOT NULL, REFERENCES requirement(id), part of PRIMARY KEY | The requirement in the relationship. |
| `persona_id` | TEXT | NOT NULL, REFERENCES persona(id), part of PRIMARY KEY | The persona in the relationship. |

**Relationships:**
- Parent: `requirement` (via `requirement_id`)
- Parent: `persona` (via `persona_id`)
- Children: none

**Produced by:** `changelog_insert` with entity_type `"requirement_persona"`
**Queried by:** `changelog_query` with entity_type `"requirement_persona"`

---

## requirement_dependency

**Purpose:** Records directed dependencies between requirements. A dependency row asserts that `requirement_id` cannot be satisfied without first satisfying `depends_on`. This models prerequisite relationships that the **implementation_planner** must respect when sequencing work — for example, an authentication requirement that must land before any access-controlled feature requirement.

**Context:** Produced by the **requirements_analyst** when dependencies are identified. Validated by the **requirements_critic**, who may challenge questionable dependency claims. Consumed by the **implementation_planner** to construct a sequenced backlog that respects the dependency graph.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `requirement_id` | TEXT | NOT NULL, REFERENCES requirement(id), part of PRIMARY KEY | The dependent requirement (the one that needs the other to be done first). |
| `depends_on` | TEXT | NOT NULL, REFERENCES requirement(id), part of PRIMARY KEY | The prerequisite requirement that must be satisfied first. |

**Relationships:**
- Parent: `requirement` (via `requirement_id`)
- Parent: `requirement` (via `depends_on`)
- Children: none

**Produced by:** `changelog_insert` with entity_type `"requirement_dependency"`
**Queried by:** `changelog_query` with entity_type `"requirement_dependency"`

---

## project_context

**Purpose:** A flexible key-value store for project-level contextual information that does not fit a more structured table. Common uses include recording the problem statement, key assumptions, explicit scope constraints, and business context. The optional `category` column allows grouping of context entries (e.g. `"assumption"`, `"constraint"`, `"context"`).

**Context:** Produced by the **requirements_analyst** during the requirements phase. Validated by the **requirements_critic**, who may challenge assumptions or flag missing context. Consumed by all downstream agents as background context when generating their artefacts, and surfaced in the final output documents.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, REFERENCES iteration(id) | The iteration this context entry belongs to. |
| `key` | TEXT | NOT NULL, part of UNIQUE(iteration_id, key, value) | The context key (e.g. `"assumption"`, `"problem_statement"`). |
| `value` | TEXT | NOT NULL, part of UNIQUE(iteration_id, key, value) | The context value. |
| `category` | TEXT | — | Optional grouping label (e.g. `"assumption"`, `"constraint"`, `"context"`). |

**Constraints:**
- `UNIQUE(iteration_id, key, value)` — prevents exact duplicate entries for the same key-value pair within an iteration.

**Relationships:**
- Parent: `iteration` (via `iteration_id`)
- Children: none

**Produced by:** `changelog_insert` with entity_type `"project_context"`
**Queried by:** `changelog_query` with entity_type `"project_context"`

---

## system_io

**Purpose:** Describes the inputs and outputs of the system in a single unified table. Each row names a single input or output, describes it, and optionally records its source, destination, and format. The `direction` column distinguishes inputs from outputs. This information is essential for the **backend_architect** when designing ingestion pipelines, output interfaces, and data contracts.

**Context:** Produced by the **requirements_analyst**. Consumed by the **backend_architect** when modelling data entities, integration boundaries, and output interfaces, and by the **implementation_planner** when identifying external dependencies that affect delivery sequencing. The **ux_designer** also reads output rows to understand what information must be surfaced in screens and flows.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, REFERENCES iteration(id) | The iteration this system I/O entry belongs to. |
| `direction` | TEXT | NOT NULL, CHECK IN (`'input'`, `'output'`) | Whether this row describes a system input or a system output. |
| `name` | TEXT | NOT NULL | Short name for the input or output (e.g. `"Customer order feed"`, `"Monthly billing report"`). |
| `description` | TEXT | NOT NULL | Narrative description of the entry's content and purpose. |
| `source` | TEXT | — | Optional. Where this input originates (e.g. `"upstream ERP system"`, `"user file upload"`). Typically populated for `direction = 'input'`. |
| `destination` | TEXT | — | Optional. Where this output is sent or stored (e.g. `"S3 bucket"`, `"webhook endpoint"`). Typically populated for `direction = 'output'`. |
| `format` | TEXT | — | Optional. The expected data format (e.g. `"JSON"`, `"CSV"`, `"PDF"`, `"Parquet"`). |

**Relationships:**
- Parent: `iteration` (via `iteration_id`)
- Children: none

**Produced by:** `changelog_insert` with entity_type `"system_io"`
**Queried by:** `changelog_query` with entity_type `"system_io"`

---

## deployment_requirement

**Purpose:** Each row is a single deployment infrastructure requirement — e.g., a specific container runtime, network isolation rule, storage class, or hardware specification. The `target` column captures the deployment target context (private-cloud, local-executable, both, or other) inline, so if multiple requirements share the same target, the target value is simply repeated. This flattened design avoids unnecessary parent-child indirection while preserving all the information agents need.

**Context:** Produced by the **requirements_analyst**. Consumed by the **backend_architect** when selecting infrastructure patterns and by the **implementation_planner** when assessing delivery environment constraints.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, REFERENCES iteration(id) | The iteration this deployment requirement belongs to. |
| `target` | TEXT | — | The deployment target classification (e.g. `"private-cloud"`, `"local-executable"`, `"both"`). NULL is permitted when the target is not yet determined. |
| `description` | TEXT | NOT NULL | A single infrastructure requirement statement (e.g. `"Must run on Kubernetes 1.28+"`). |
| `notes` | TEXT | — | Optional free-text notes elaborating on the deployment target choice or constraints. |

**Relationships:**
- Parent: `iteration` (via `iteration_id`)
- Children: none

**Produced by:** `changelog_insert` with entity_type `"deployment_requirement"`
**Queried by:** `changelog_query` with entity_type `"deployment_requirement"`

---

## operational_requirement

**Purpose:** Each row captures a single operational requirement — an uptime/SLA target, a monitoring item, a logging policy, or an observability item. The `category` column classifies the row into one of four buckets (`uptime`, `monitoring`, `logging`, `observability`), allowing the architecture phase to address each concern with appropriate tooling. Uptime targets (previously stored as a dedicated `uptime_requirement` column) are now just rows with `category = 'uptime'` and the SLA value in `item`.

**Context:** Produced by the **requirements_analyst**. Consumed by the **backend_architect** when designing for reliability (SLOs, redundancy, failover), and by the **architecture_config** (config_type: observability) design in the architecture domain. The **implementation_planner** uses this to flag operational readiness tasks.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, REFERENCES iteration(id) | The iteration this operational requirement belongs to. |
| `item` | TEXT | NOT NULL | Description of the operational item (e.g. `"99.9% uptime"`, `"Track p99 API response latency"`, `"Retain application logs for 90 days"`). |
| `category` | TEXT | NOT NULL, CHECK IN (`'uptime'`, `'monitoring'`, `'logging'`, `'observability'`) | Classifies the item to route it to the appropriate design decisions during architecture. |
| `notes` | TEXT | — | Optional free-text notes providing additional context for the requirement. |

**Relationships:**
- Parent: `iteration` (via `iteration_id`)
- Children: none

**Produced by:** `changelog_insert` with entity_type `"operational_requirement"`
**Queried by:** `changelog_query` with entity_type `"operational_requirement"`

---

## technology_constraint

**Purpose:** Records hard constraints on technology choices: languages that are allowed, dependencies that are forbidden, and frameworks that are required. These constraints are non-negotiable inputs to the architecture phase — the **backend_architect** must not propose a technology that violates them, and the **approved_dependency** table in the architecture domain must respect them.

**Context:** Produced by the **requirements_analyst**, often reflecting organisational policy, security rules, or licensing restrictions. Validated by the **requirements_critic**. Consumed directly by the **backend_architect** when evaluating technology choices, and enforced by the **implementation_planner** when accepting or rejecting proposed dependencies.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Surrogate key. |
| `iteration_id` | INTEGER | NOT NULL, REFERENCES iteration(id) | The iteration this constraint belongs to. |
| `constraint_type` | TEXT | NOT NULL, CHECK IN (`'allowed_language'`, `'forbidden_dependency'`, `'required_framework'`) | The type of constraint. `allowed_language` whitelists a language; `forbidden_dependency` blacklists a package or library; `required_framework` mandates use of a specific framework. |
| `value` | TEXT | NOT NULL | The constraint value (e.g. `"Python"`, `"log4j"`, `"Django"`). |

**Relationships:**
- Parent: `iteration` (via `iteration_id`)
- Children: none — but `approved_dependency` in the architecture domain must be consistent with these rows.

**Produced by:** `changelog_insert` with entity_type `"technology_constraint"`
**Queried by:** `changelog_query` with entity_type `"technology_constraint"`
