# Deployment Domain — Table Reference

**Domain:** Release / Deployment  
**Producer:** `release_engineer`  
**Critic:** `release_critic`  
**Phase:** `release` (the final phase of the release workflow)

## Overview

The deployment domain captures the full output of the Release Engineer agent. It is the most table-heavy domain (17 tables) because deployment configuration has many orthogonal concerns that must be modelled independently: CI/CD pipeline topology, per-environment configuration, build artifact inventory, code signing, local distribution channels (Homebrew, apt, Winget), secrets inventory, health checks, alerting wiring, operational runbooks, and release review checklists.

All 17 tables hang off a single `deployment_manifest` row, which is in turn scoped to an `iteration` and optionally a `revision`. The Release Critic validates the manifest and all child data before the release phase is closed.

### Table Hierarchy

```
deployment_manifest
│                                        targets → JSON array on manifest
│                                        blockers → JSON array on manifest
│
├── deployment_pipeline                 (one CI/CD platform per manifest)
│                                        config_files → JSON array on pipeline
│   └── deployment_pipeline_stage       (build / test / deploy / …)
│                                        triggers → JSON array on stage
│                                        steps → JSON array on stage
│       └── deployment_stage_quality_gate (per-stage pass/fail gate)
│
├── deployment_quality_gate             (global gate rules by category/key/value)
│
├── deployment_environment              (development | staging | production)
│   ├── deployment_env_infra            (cloud resources per environment)
│   └── deployment_env_var              (environment variables + value_source classification)
│
├── deployment_artifact                 (container-image | binary | archive | …)
│                                        platforms → JSON array on artifact
│
├── deployment_signing                  (code signing on/off + signing_method)
│
├── deployment_local_executable         (local distribution metadata)
│                                        platforms → JSON array on local_executable
│                                        channels → JSON array on local_executable
│
├── deployment_secret                   (secrets inventory — names/purposes, NOT values)
├── deployment_health_check             (endpoints + polling interval)
├── deployment_alerting                 (provider + channel)
│
├── deployment_runbook                  (named operational procedure)
│   └── deployment_runbook_step         (ordered steps; some are rollback steps)
│
└── deployment_review_checklist         (release gate items: passed | not passed)
```

---

## Table Reference

### `deployment_manifest`

**Purpose:** Root record for a release attempt. Carries readiness status and anchors all deployment sub-tables. One manifest per release iteration (or per revision if the release was rejected and re-attempted).

**Context:** Created by `release_engineer` at the start of the release phase. Status is set to `not_ready` initially, updated to `ready` when all checks pass, or `blocked` when hard blockers exist. The `release_critic` reads this row plus all children to produce its verdict.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. Referenced by all child tables. |
| `iteration_id` | INTEGER | NOT NULL, FK → `iteration(id)` | — | Links to the workflow iteration this release covers. |
| `revision_id` | INTEGER | NOT NULL, FK → `revision(id)` | — | Links to the specific producer-critic revision attempt. |
| `status` | TEXT | NOT NULL, CHECK IN (`ready`, `not_ready`, `blocked`) | — | Overall release readiness. `blocked` means hard blockers prevent deployment. |
| `targets` | TEXT | NOT NULL | `'[]'` | JSON array of deployment target strings (e.g., `["private-cloud", "local-executable"]`). Replaces the former `deployment_target` child table. |
| `blockers` | TEXT | NOT NULL | `'[]'` | JSON array of blocker description strings (e.g., `["DNS records not configured"]`). When `status` is `blocked`, this array must be non-empty. Replaces the former `deployment_manifest_blocker` child table. |
| `version` | TEXT | — | NULL | Version label for this manifest (e.g., `1.0.0`, `v2`). Formerly in `deployment_manifest_metadata`. |
| `document_date` | TEXT | — | NULL | ISO-8601 timestamp when this metadata was created. Formerly `created` in `deployment_manifest_metadata`. |
| `requirements_version` | TEXT | — | NULL | Version of the requirements specification consulted. Formerly in `deployment_manifest_metadata`. |
| `architecture_version` | TEXT | — | NULL | Version of the architecture specification consulted. Formerly in `deployment_manifest_metadata`. |
| `implementation_version` | TEXT | — | NULL | Version of the implementation manifest consulted. Formerly in `deployment_manifest_metadata`. |
| `test_report_version` | TEXT | — | NULL | Version of the QA test report consulted. NULL if QA phase was skipped. Formerly in `deployment_manifest_metadata`. |
| `created_at` | TEXT | NOT NULL | `(datetime('now'))` | ISO-8601 timestamp when the manifest was created. |

**Relationships:**
- Parent: `iteration` (via `iteration_id`), `revision` (via `revision_id`)
- Children: all 16 remaining tables in this domain
- JSON arrays: `targets`, `blockers` (inline on this table)

**MCP tool access:**
- **Write:** `changelog_insert` with `entity_type: "deployment_manifest"`. The `data` object includes `status` (required), `targets` (JSON array of strings), `blockers` (JSON array of strings), metadata fields as flat properties (`version`, `document_date`, `requirements_version`, `architecture_version`, `implementation_version`, `test_report_version`) or via a backward-compatible `metadata` object, and all child records as nested arrays (`pipelines`, `quality_gates`, `environments`, `artifacts`, `signing`, `local_executables`, `secrets`, `health_checks`, `alerting`, `runbooks`, `review_checklist`). All tables are inserted in a single transactional call.
- **Read:** `changelog_query` with `entity_type: "deployment_manifest"`, optionally filtered by `iteration_id`. Returns manifest rows with all children attached when `include_related: true`.

---

### `deployment_pipeline`

**Purpose:** Represents a CI/CD pipeline platform (e.g., GitHub Actions, GitLab CI, CircleCI, Jenkins). One row per pipeline; a manifest may in principle define multiple pipelines for different platforms.

**Context:** The pipeline is the top-level CI/CD object. All pipeline stages, their triggers, steps, and quality gates descend from this table.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. Referenced by child stage tables. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `platform` | TEXT | NOT NULL | — | CI/CD platform name (e.g., `github-actions`, `gitlab-ci`, `circleci`). Free text — no enum constraint. |
| `config_files` | TEXT | NOT NULL | `'[]'` | JSON array of file path strings for CI/CD configuration files (e.g., `[".github/workflows/release.yml"]`). Replaces the former `deployment_pipeline_config_file` child table. |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)
- Children: `deployment_pipeline_stage`
- JSON array: `config_files` (inline on this table)

**MCP tool access:**
- **Write:** Part of the manifest payload in `changelog_insert`.
- **Read:** Direct SQL — `SELECT * FROM deployment_pipeline WHERE manifest_id = ?`.

---

### `deployment_pipeline_stage`

**Purpose:** Defines a named stage within the CI/CD pipeline (e.g., `build`, `test`, `security-scan`, `deploy-staging`, `deploy-production`). Each stage has a stated purpose.

**Context:** Stages map to jobs or stages in the underlying CI/CD platform. The `purpose` field is a human-readable description used by the release critic to verify that all required deployment concerns (build, test, security, deploy, smoke-test) are covered.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. Referenced by quality-gate child table. |
| `pipeline_id` | INTEGER | NOT NULL, FK → `deployment_pipeline(id)` | — | Parent pipeline. |
| `name` | TEXT | NOT NULL | — | Stage name (e.g., `build`, `integration-test`, `deploy-production`). |
| `purpose` | TEXT | NOT NULL | — | Human-readable description of what this stage does. |
| `triggers` | TEXT | NOT NULL | `'[]'` | JSON array of trigger description strings (e.g., `["on: push to main", "manual approval required"]`). Replaces the former `deployment_stage_trigger` child table. |
| `steps` | TEXT | NOT NULL | `'[]'` | JSON array of step description strings (e.g., `["checkout", "go build", "docker push"]`). Replaces the former `deployment_stage_step` child table. |

**Relationships:**
- Parent: `deployment_pipeline` (via `pipeline_id`)
- Children: `deployment_stage_quality_gate`
- JSON arrays: `triggers`, `steps` (inline on this table)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT * FROM deployment_pipeline_stage WHERE pipeline_id = ?`.

---

### `deployment_stage_quality_gate`

**Purpose:** Defines a named quality gate check attached to a specific pipeline stage. Each gate has a condition expression and a `failure_action` that controls how the pipeline responds when the condition is not met.

**Context:** Per-stage gates enforce standards at the point of execution (e.g., "test coverage ≥ 80%" on the test stage, "no critical CVEs" on the security-scan stage). The `failure_action` column determines whether failure blocks the pipeline, emits a warning, or just sends a notification.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `stage_id` | INTEGER | NOT NULL, FK → `deployment_pipeline_stage(id)` | — | Parent stage. |
| `name` | TEXT | NOT NULL | — | Gate name (e.g., `coverage-threshold`, `no-critical-cves`). |
| `condition` | TEXT | NOT NULL | — | Boolean condition that must be true for the gate to pass (e.g., `coverage >= 80`, `exit_code == 0`). |
| `failure_action` | TEXT | NOT NULL, CHECK IN (`block`, `warn`, `notify`) | — | What to do when the condition is false. `block` halts the pipeline; `warn` continues with a warning; `notify` sends an alert and continues. |

**Relationships:**
- Parent: `deployment_pipeline_stage` (via `stage_id`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT * FROM deployment_stage_quality_gate WHERE stage_id = ?`.

---

### `deployment_quality_gate`

**Purpose:** Stores global, manifest-level quality gate thresholds and rules organised by category and key/value pairs. Complements the per-stage gates with project-wide standards.

**Context:** While `deployment_stage_quality_gate` attaches gates to specific pipeline stages, `deployment_quality_gate` records the overall policy (e.g., `category: test_coverage, key: minimum_percent, value: 80`). The release critic compares these global rules against the QA test report to verify the release meets the project's own declared standards.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `category` | TEXT | NOT NULL | — | Gate category (e.g., `test_coverage`, `security`, `performance`, `documentation`). Free text. |
| `key` | TEXT | NOT NULL | — | The specific metric or rule name within the category (e.g., `minimum_percent`, `max_critical_cves`). |
| `value` | TEXT | NOT NULL | — | The threshold or expected value as a string (e.g., `80`, `0`, `required`). |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT category, key, value FROM deployment_quality_gate WHERE manifest_id = ?`.

---

### `deployment_environment`

**Purpose:** Describes a named deployment environment (development, staging, or production). Captures the deployment method, access URL, and rollback procedure for that environment.

**Context:** The three-environment model (dev/staging/prod) is standard. Each environment gets its own infrastructure resources (`deployment_env_infra`) and environment variable set (`deployment_env_var`). The rollback procedure is critical — the critic verifies it is documented for staging and production.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. Referenced by infra and env-var child tables. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `name` | TEXT | NOT NULL | — | Environment name (e.g. `development`, `staging`, `production`). Free text — no enum constraint. |
| `deployment_method` | TEXT | NOT NULL | — | How software is deployed to this environment (e.g., `kubectl apply`, `helm upgrade`, `ssh + systemd`, `docker-compose`). |
| `url` | TEXT | — | NULL | Base URL for this environment (e.g., `https://staging.example.com`). NULL for dev if no stable URL. |
| `rollback_procedure` | TEXT | — | NULL | Human-readable rollback steps. NULL for development environments where rollback is informal. |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)
- Children: `deployment_env_infra`, `deployment_env_var`

**MCP tool access:**
- **Read:** Direct SQL — `SELECT * FROM deployment_environment WHERE manifest_id = ? ORDER BY CASE name WHEN 'development' THEN 1 WHEN 'staging' THEN 2 WHEN 'production' THEN 3 END`.

---

### `deployment_env_infra`

**Purpose:** Lists the cloud or infrastructure resources provisioned for a specific environment. One row per resource.

**Context:** Resources are typically cloud provider primitives (e.g., `AWS ECS Cluster`, `GCP Cloud SQL instance`, `Kubernetes namespace prod`). The `provider` field is optional because some infrastructure is provider-agnostic (e.g., a bare-metal server). This table drives infrastructure-as-code checklists in the release review.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `environment_id` | INTEGER | NOT NULL, FK → `deployment_environment(id)` | — | Parent environment. |
| `provider` | TEXT | — | NULL | Cloud or infrastructure provider name (e.g., `AWS`, `GCP`, `Azure`, `Hetzner`). NULL for self-hosted. |
| `resource` | TEXT | NOT NULL | — | Name or description of the resource (e.g., `ECS Cluster: api-prod`, `RDS PostgreSQL 15`, `Redis ElastiCache`). |

**Relationships:**
- Parent: `deployment_environment` (via `environment_id`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT provider, resource FROM deployment_env_infra WHERE environment_id = ?`.

---

### `deployment_env_var`

**Purpose:** Inventories the environment variables used by the application in a specific environment, along with their value-source classification. Does NOT store values.

**Context:** Common `value_source` values include `secret`, `config`, and `hardcoded`. `secret` vars are expected to be sourced from a secrets manager (cross-referenced with `deployment_secret`). `config` vars come from CI/CD config files or infrastructure config maps. `hardcoded` vars are baked into the image or binary — flagged for review if they contain sensitive data.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `environment_id` | INTEGER | NOT NULL, FK → `deployment_environment(id)` | — | Parent environment. |
| `name` | TEXT | NOT NULL | — | Environment variable name (e.g., `DATABASE_URL`, `JWT_SECRET`, `FEATURE_FLAG_X`). |
| `value_source` | TEXT | NOT NULL | — | Where this variable's value comes from at runtime (e.g. `secret`, `config`, `hardcoded`). |
| `description` | TEXT | — | NULL | Human-readable explanation of what this variable controls. |

**Relationships:**
- Parent: `deployment_environment` (via `environment_id`)
- Cross-reference: `deployment_secret` (vars with `value_source = 'secret'` should correspond to a row in `deployment_secret`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT name, value_source, description FROM deployment_env_var WHERE environment_id = ?`.

---

### `deployment_artifact`

**Purpose:** Describes a build artifact produced by the CI/CD pipeline. One row per artifact type (e.g., a Docker image, a statically-compiled binary, a `.tar.gz` release archive).

**Context:** Artifacts are the deployable outputs of the build process. The `registry` field points to where the artifact is stored (container registry, S3 bucket, GitHub Releases). The `versioning` field records the versioning strategy used to tag the artifact.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `name` | TEXT | NOT NULL | — | Artifact name (e.g., `api-server`, `cli-binary`, `installer.pkg`). |
| `type` | TEXT | NOT NULL | — | Free-form artifact type (e.g., `container-image`, `binary`, `archive`, `package`, `installer`). Determines expected registry and signing approach. |
| `registry` | TEXT | — | NULL | Where the artifact is stored (e.g., `ghcr.io/org/api-server`, `s3://releases-bucket`, `pypi.org`). NULL for local builds only. |
| `versioning` | TEXT | CHECK IN (`semantic`, `git-sha`, `timestamp`, `custom`) | NULL | Versioning strategy. NULL means no policy specified (unusual; critic should flag). |
| `platforms` | TEXT | NOT NULL | `'[]'` | JSON array of platform target strings (e.g., `["linux/amd64", "darwin/arm64"]`). Replaces the former `deployment_artifact_platform` child table. |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)
- JSON array: `platforms` (inline on this table)
- Cross-reference: `deployment_signing` (artifacts of type `binary` or `installer` typically require signing)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT * FROM deployment_artifact WHERE manifest_id = ?`.

---

### `deployment_signing`

**Purpose:** Records whether code signing is enabled for this release and, if so, which signing method is used.

**Context:** Code signing is required for macOS binaries (Gatekeeper), Windows executables (SmartScreen), and container images (Sigstore/cosign). A single row per manifest captures the overall signing posture. The critic verifies that `enabled = 1` when the target includes a platform that mandates signing.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `enabled` | INTEGER | — | `0` | Boolean flag. `1` = signing is active; `0` = signing is disabled or not applicable. |
| `signing_method` | TEXT | — | NULL | Signing method or tool (e.g., `apple-developer-id`, `windows-ev-cert`, `sigstore-cosign`, `gpg`). NULL when `enabled = 0`. |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)
- Cross-reference: `deployment_artifact` (signing applies to artifacts of type `binary` or `installer`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT enabled, signing_method FROM deployment_signing WHERE manifest_id = ?`.

---

### `deployment_local_executable`

**Purpose:** Top-level metadata for locally-distributed executables — tools or CLIs shipped directly to end-user machines via package managers rather than deployed to a server.

**Context:** Applies when the manifest targets `local-executable` (as listed in the `deployment_manifest.targets` JSON array). Captures the installation method (e.g., `homebrew-tap`, `apt-repository`, `winget`, `direct-download`) and the update mechanism (e.g., `brew upgrade`, `apt-get upgrade`, `self-update`). Platform and channel lists are stored as JSON arrays on this table.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `installation_method` | TEXT | — | NULL | Primary installation method description (e.g., `homebrew tap`, `apt repository`, `winget package`, `curl script`). |
| `update_mechanism` | TEXT | — | NULL | How users update to new versions (e.g., `brew upgrade`, `apt-get upgrade`, `built-in self-update check`). |
| `platforms` | TEXT | NOT NULL | `'[]'` | JSON array of platform strings (e.g., `["linux-amd64", "darwin-arm64"]`). Values correspond to GOARCH/GOOS-style target triples. Replaces the former `deployment_local_platform` child table. |
| `channels` | TEXT | NOT NULL | `'[]'` | JSON array of distribution channel strings (e.g., `["homebrew-tap", "apt-repository", "github-releases"]`). Replaces the former `deployment_local_channel` child table. |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)
- JSON arrays: `platforms`, `channels` (inline on this table)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT * FROM deployment_local_executable WHERE manifest_id = ?`.

---

### `deployment_secret`

**Purpose:** Inventories the secrets required by the deployment — their names, purposes, managing provider, and rotation policy. Values are NEVER stored.

**Context:** This table is the deployment domain's secrets ledger. It enables the release critic to verify that every environment variable with `value_source = 'secret'` has a corresponding secret record. The `provider` points to the secrets management system (e.g., `AWS Secrets Manager`, `HashiCorp Vault`, `GitHub Actions secrets`). The `rotation_policy` drives operational runbook requirements.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `provider` | TEXT | — | NULL | Secrets management provider (e.g., `AWS Secrets Manager`, `HashiCorp Vault`, `GitHub Actions`). NULL if unmanaged (critic should flag). |
| `name` | TEXT | NOT NULL | — | Secret name as it appears in the secrets manager (e.g., `prod/database/url`, `JWT_SECRET`). |
| `purpose` | TEXT | NOT NULL | — | Human-readable description of what this secret is used for. |
| `rotation_policy` | TEXT | — | NULL | Rotation frequency or policy (e.g., `90 days`, `on-breach`, `never`). NULL means no rotation policy — critic should flag for production secrets. |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)
- Cross-reference: `deployment_env_var` (vars with `value_source = 'secret'` should match a `name` here)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT name, purpose, provider, rotation_policy FROM deployment_secret WHERE manifest_id = ?`.

---

### `deployment_health_check`

**Purpose:** Declares the health check endpoints or probes that should be polled after deployment to verify the service is running correctly.

**Context:** Health checks are used by load balancers, container orchestrators (Kubernetes liveness/readiness probes), and monitoring systems. The `endpoint` field is the HTTP path or command; `interval` is the polling frequency. Multiple health checks can be defined per manifest (e.g., liveness, readiness, and deep-health).

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `name` | TEXT | NOT NULL | — | Health check name (e.g., `liveness`, `readiness`, `database-connectivity`). |
| `endpoint` | TEXT | — | NULL | HTTP path or command used to probe health (e.g., `/health`, `/readyz`, `pg_isready`). NULL for non-HTTP checks. |
| `interval` | TEXT | — | NULL | Polling interval as a human-readable string (e.g., `30s`, `1m`, `5m`). NULL if interval is defined in infrastructure config. |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT * FROM deployment_health_check WHERE manifest_id = ?`.

---

### `deployment_alerting`

**Purpose:** Captures the alerting configuration for the deployed system — which alerting provider is used and which channel receives notifications.

**Context:** One row per alerting channel. A system may route different alert severities to different channels (e.g., PagerDuty for critical, Slack `#alerts` for warnings). The `provider` field names the alerting platform; `channel` is the destination identifier within that platform.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `provider` | TEXT | — | NULL | Alerting platform (e.g., `PagerDuty`, `OpsGenie`, `Slack`, `AWS SNS`). NULL if not yet configured (critic should flag). |
| `channel` | TEXT | NOT NULL | — | Destination channel or identifier (e.g., `#production-alerts`, `oncall-policy`, `arn:aws:sns:…`). |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT provider, channel FROM deployment_alerting WHERE manifest_id = ?`.

---

### `deployment_runbook`

**Purpose:** Defines a named operational runbook for a specific incident scenario (e.g., "Database connection exhaustion", "High error rate", "Rollback production"). Each runbook has ordered steps.

**Context:** Runbooks are the operational knowledge base for the deployed system. They are produced by the Release Engineer and reviewed by the Release Critic. Each runbook addresses a distinct failure scenario. Some steps are normal remediation steps; others are explicitly marked as rollback steps.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. Referenced by `deployment_runbook_step`. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `name` | TEXT | NOT NULL | — | Runbook name (e.g., `High CPU Usage`, `Database Failover`, `Emergency Rollback`). |
| `scenario` | TEXT | NOT NULL | — | Description of the incident scenario this runbook addresses. |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)
- Children: `deployment_runbook_step`

**MCP tool access:**
- **Read:** Direct SQL — `SELECT * FROM deployment_runbook WHERE manifest_id = ?`.

---

### `deployment_runbook_step`

**Purpose:** Lists the ordered steps within a runbook. Steps marked `is_rollback = 1` are specifically part of the rollback procedure within that runbook.

**Context:** The `is_rollback` flag allows runbooks to contain both diagnostic/remediation steps and rollback steps in a single ordered sequence, with rollback steps clearly distinguished. This enables the release critic to verify that every runbook addressing a production scenario includes at least one rollback step.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `runbook_id` | INTEGER | NOT NULL, FK → `deployment_runbook(id)` | — | Parent runbook. |
| `step` | TEXT | NOT NULL | — | Description of the action to take (e.g., `Check error rate in Datadog dashboard`, `kubectl rollout undo deployment/api`). |
| `is_rollback` | INTEGER | — | `0` | Boolean flag. `1` = this step is a rollback action; `0` = normal remediation step. |

**Relationships:**
- Parent: `deployment_runbook` (via `runbook_id`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT step, is_rollback FROM deployment_runbook_step WHERE runbook_id = ? ORDER BY id`.

---

### `deployment_review_checklist`

**Purpose:** Tracks the release review checklist items that the Release Engineer self-assesses and the Release Critic validates. Each item has a name and a pass/fail state.

**Context:** The review checklist is the final gate before a release is approved. It covers items such as "All quality gates pass", "Rollback procedure documented", "Secrets rotation policy defined", "Health checks configured". The Release Critic verifies that all items are `passed = 1` before issuing an approval verdict. Items with `passed = 0` correspond to entries in the `deployment_manifest.blockers` JSON array.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `check_name` | TEXT | NOT NULL | — | Name of the checklist item (e.g., `All quality gates pass`, `Secrets inventory complete`, `Rollback procedure documented`). |
| `passed` | INTEGER | — | `0` | Boolean flag. `1` = check passed; `0` = check not yet passed or failed. |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)
- Cross-reference: `deployment_manifest.blockers` JSON array (failed checklist items should correspond to blocker entries when manifest `status = 'blocked'`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT check_name, passed FROM deployment_review_checklist WHERE manifest_id = ?`.

---

## Cross-Domain Relationships

| This Domain | References | Via |
|-------------|-----------|-----|
| `deployment_manifest` | `iteration` | `iteration_id` |
| `deployment_manifest` | `revision` | `revision_id` |
| `deployment_manifest` | `implementation_manifest` (conceptually) | `implementation_version` string |
| `deployment_env_var` (value_source=secret) | `deployment_secret` | `name` match (logical, not FK) |
| `deployment_local_executable.platforms` | `deployment_artifact.platforms` | platform string match (logical, not FK) |

## MCP Tool Summary

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert deployment manifest + all children | `changelog_insert` with `entity_type: "deployment_manifest"` | All child tables are inserted in a single transactional call via nested `data` properties. `targets` and `blockers` are JSON arrays on the manifest row itself. |
| Query manifest by iteration | `changelog_query` with `entity_type: "deployment_manifest"`, `iteration_id: N` | Returns `deployment_manifest` rows with all children attached when `include_related: true` |
| Query with filters | `changelog_query` with `entity_type: "deployment_manifest"`, `filters: { status: "blocked" }` | Returns blocked manifests for a given iteration |

### Write — `changelog_insert` data shape

All child tables are nested inside the `data` object. Every array property is optional and defaults to `[]`.

```jsonc
{
  "entity_type": "deployment_manifest",
  "iteration_id": 1,
  "revision_id": 1,
  "data": {
    "status": "ready",                     // required: "ready" | "not_ready" | "blocked"
    "targets": [                           // → JSON array on deployment_manifest
      "private-cloud",
      "local-executable"
    ],
    "blockers": [                          // → JSON array on deployment_manifest
      "DNS records not configured"
    ],
    "version": "1.0.0",                   // metadata fields (flat on manifest)
    "document_date": "2025-01-15T00:00:00Z",
    "requirements_version": "1.0.0",
    "architecture_version": "1.0.0",
    "implementation_version": "1.0.0",
    "test_report_version": "1.0.0",        // optional, null if QA skipped
    "pipelines": [{                        // → deployment_pipeline
      "platform": "github-actions",
      "config_files": [                    //   → JSON array on pipeline
        ".github/workflows/release.yml"
      ],
      "stages": [{                         //   → deployment_pipeline_stage
        "name": "build",
        "purpose": "Compile and package",
        "triggers": [                      //     → JSON array on stage
          "on: push to main"
        ],
        "steps": [                         //     → JSON array on stage
          "checkout",
          "go build"
        ],
        "quality_gates": [{                //     → deployment_stage_quality_gate
          "name": "unit-tests",
          "condition": "all tests pass",
          "failure_action": "block"        // "block" | "warn" | "notify"
        }]
      }]
    }],
    "quality_gates": [{                    // → deployment_quality_gate (global)
      "category": "testing",
      "key": "coverage",
      "value": ">=80%"
    }],
    "environments": [{                     // → deployment_environment
      "name": "production",               // "development" | "staging" | "production"
      "deployment_method": "kubernetes",
      "url": "https://app.example.com",
      "rollback_procedure": "kubectl rollout undo",
      "infra": [{                          //   → deployment_env_infra
        "provider": "aws",
        "resource": "EKS cluster"
      }],
      "vars": [{                           //   → deployment_env_var
        "name": "DATABASE_URL",
        "value_source": "secret",          // e.g. "secret", "config", "hardcoded"
        "description": "PostgreSQL connection string"
      }]
    }],
    "artifacts": [{                        // → deployment_artifact
      "name": "myapp",
      "type": "container-image",           // free-form, e.g. "container-image", "binary", "archive", "package", "installer"
      "registry": "ghcr.io/org/myapp",
      "versioning": "semantic",            // "semantic" | "git-sha" | "timestamp" | "custom"
      "platforms": [                       //   → JSON array on artifact
        "linux/amd64"
      ]
    }],
    "signing": [{                          // → deployment_signing
      "enabled": true,
      "signing_method": "cosign"
    }],
    "local_executables": [{                // → deployment_local_executable
      "installation_method": "go install",
      "update_mechanism": "self-update",
      "platforms": [                       //   → JSON array on local_executable
        "linux-amd64",
        "darwin-arm64"
      ],
      "channels": [                        //   → JSON array on local_executable
        "homebrew-tap"
      ]
    }],
    "secrets": [{                          // → deployment_secret
      "provider": "github-secrets",
      "name": "DEPLOY_TOKEN",
      "purpose": "Authenticate to registry",
      "rotation_policy": "90 days"
    }],
    "health_checks": [{                    // → deployment_health_check
      "name": "readiness",
      "endpoint": "/healthz",
      "interval": "30s"
    }],
    "alerting": [{                         // → deployment_alerting
      "provider": "pagerduty",
      "channel": "#ops-alerts"
    }],
    "runbooks": [{                         // → deployment_runbook
      "name": "Database migration failure",
      "scenario": "Migration fails in production",
      "steps": [                           //   → deployment_runbook_step
        { "step": "Check migration logs", "is_rollback": false },
        { "step": "Rollback migration", "is_rollback": true }
      ]
    }],
    "review_checklist": [{                 // → deployment_review_checklist
      "check_name": "All tests passing",
      "passed": true
    }]
  }
}
```

### Read — `changelog_query` response shape

When queried via `changelog_query`, each `deployment_manifest` row is returned with all children attached as nested arrays. The shape mirrors the write `data` object with the following property names:

| Property | Source | Nesting |
|----------|--------|---------|
| `targets` | JSON array on `deployment_manifest` | inline |
| `blockers` | JSON array on `deployment_manifest` | inline |
| `pipelines` | `deployment_pipeline` | `config_files` (JSON inline), `stages` → `triggers` (JSON inline), `steps` (JSON inline), `quality_gates` |
| `quality_gates` | `deployment_quality_gate` | flat |
| `environments` | `deployment_environment` | → `infra`, `vars` |
| `artifacts` | `deployment_artifact` | `platforms` (JSON inline) |
| `signing` | `deployment_signing` | flat |
| `local_executables` | `deployment_local_executable` | `platforms` (JSON inline), `channels` (JSON inline) |
| `secrets` | `deployment_secret` | flat |
| `health_checks` | `deployment_health_check` | flat |
| `alerting` | `deployment_alerting` | flat |
| `runbooks` | `deployment_runbook` | → `steps` |
| `review_checklist` | `deployment_review_checklist` | flat |

### Common SQL Patterns

**Full manifest read (all children):**
```sql
-- Root (targets and blockers are JSON columns on the manifest itself)
SELECT *, targets, blockers FROM deployment_manifest WHERE iteration_id = ?;

-- Pipeline with config files (JSON column)
SELECT p.id, p.platform, p.config_files
FROM deployment_pipeline p
WHERE p.manifest_id = ?;

-- All stages with inline steps and triggers (JSON columns)
SELECT s.name, s.purpose, s.triggers, s.steps
FROM deployment_pipeline_stage s
JOIN deployment_pipeline p ON s.pipeline_id = p.id
WHERE p.manifest_id = ?
ORDER BY s.id;

-- Quality gate summary
SELECT s.name AS stage, qg.name, qg.condition, qg.failure_action
FROM deployment_stage_quality_gate qg
JOIN deployment_pipeline_stage s ON qg.stage_id = s.id
JOIN deployment_pipeline p ON s.pipeline_id = p.id
WHERE p.manifest_id = ?;

-- Environment + vars
SELECT e.name, e.deployment_method, v.name AS var_name, v.value_source
FROM deployment_environment e
JOIN deployment_env_var v ON v.environment_id = e.id
WHERE e.manifest_id = ?
ORDER BY e.name, v.name;

-- Secrets inventory
SELECT name, purpose, provider, rotation_policy FROM deployment_secret WHERE manifest_id = ?;

-- Review checklist pass rate
SELECT
  SUM(passed) AS passed_count,
  COUNT(*) AS total_count,
  ROUND(100.0 * SUM(passed) / COUNT(*), 1) AS pass_percent
FROM deployment_review_checklist
WHERE manifest_id = ?;
```

**Release readiness check (is the manifest fully ready?):**
```sql
SELECT
  dm.status,
  json_array_length(dm.blockers) AS blocker_count,
  COUNT(DISTINCT rc.id) FILTER (WHERE rc.passed = 0) AS failed_checks
FROM deployment_manifest dm
LEFT JOIN deployment_review_checklist rc ON rc.manifest_id = dm.id
WHERE dm.iteration_id = ?
GROUP BY dm.id;
```
