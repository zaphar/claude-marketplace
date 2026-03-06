# Deployment Domain — Table Reference

**Domain:** Release / Deployment  
**Producer:** `release_engineer`  
**Critic:** `release_critic`  
**Phase:** `release` (the final phase of the release workflow)

## Overview

The deployment domain captures the full output of the Release Engineer agent. It is the most table-heavy domain (26 tables) because deployment configuration has many orthogonal concerns that must be modelled independently: CI/CD pipeline topology, per-environment configuration, build artifact inventory, code signing, local distribution channels (Homebrew, apt, Winget), secrets inventory, health checks, alerting wiring, operational runbooks, and release review checklists.

All 26 tables hang off a single `deployment_manifest` row, which is in turn scoped to an `iteration` and optionally a `revision`. The Release Critic validates the manifest and all child data before the release phase is closed.

### Table Hierarchy

```
deployment_manifest
├── deployment_manifest_metadata        (version provenance)
├── deployment_target                   (where it deploys: private-cloud | local-executable)
├── deployment_manifest_blocker         (what prevents release)
│
├── deployment_pipeline                 (one CI/CD platform per manifest)
│   ├── deployment_pipeline_config_file (e.g. .github/workflows/release.yml)
│   └── deployment_pipeline_stage       (build / test / deploy / …)
│       ├── deployment_stage_trigger    (on: push, on: tag, manual, …)
│       ├── deployment_stage_step       (individual shell/action steps)
│       └── deployment_stage_quality_gate (per-stage pass/fail gate)
│
├── deployment_quality_gates            (global gate rules by category/key/value)
│
├── deployment_environment              (development | staging | production)
│   ├── deployment_env_infra            (cloud resources per environment)
│   └── deployment_env_var              (environment variables + source classification)
│
├── deployment_artifact                 (container-image | binary | archive | …)
│   └── deployment_artifact_platform   (linux/darwin/windows targets)
│
├── deployment_signing                  (code signing on/off + method)
│
├── deployment_local_executable         (local distribution metadata)
│   ├── deployment_local_platform       (linux-amd64 | darwin-arm64 | …)
│   └── deployment_local_channel        (homebrew-tap | apt | winget | …)
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
| `created_at` | TEXT | NOT NULL | — | ISO-8601 timestamp when the manifest was created. |

**Relationships:**
- Parent: `iteration` (via `iteration_id`), `revision` (via `revision_id`)
- Children: all 25 remaining tables in this domain

**MCP tool access:**
- **Write:** `changelog_insert` with `entity_type: "deployment_manifest"`. The `data` object includes `status` (required) and all child records as nested arrays (`metadata`, `targets`, `blockers`, `pipelines`, `quality_gates`, `environments`, `artifacts`, `signing`, `local_executables`, `secrets`, `health_checks`, `alerting`, `runbooks`, `review_checklist`). All 26 tables are inserted in a single transactional call.
- **Read:** `changelog_query` with `entity_type: "deployment_manifest"`, optionally filtered by `iteration_id`. Returns manifest rows with all children attached via `attachRelated`.

---

### `deployment_manifest_metadata`

**Purpose:** Version provenance for the manifest — records what versions of upstream artifacts (requirements, architecture, implementation, test report) the Release Engineer consulted when producing this manifest.

**Context:** Mirrors the `implementation_manifest_metadata` and `documentation_manifest_metadata` patterns. Enables the critic and future auditors to detect version drift (e.g., deployment manifest based on an older implementation version than what was actually shipped).

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `version` | TEXT | NOT NULL | — | Version label for this manifest (e.g., `1.0.0`, `v2`). |
| `created` | TEXT | NOT NULL | — | ISO-8601 timestamp when this metadata record was created. |
| `requirements_version` | TEXT | NOT NULL | — | Version of the requirements specification consulted. |
| `architecture_version` | TEXT | NOT NULL | — | Version of the architecture specification consulted. |
| `implementation_version` | TEXT | NOT NULL | — | Version of the implementation manifest consulted. |
| `test_report_version` | TEXT | — | NULL | Version of the QA test report consulted. NULL if QA phase was skipped. |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)
- No children.

**MCP tool access:**
- **Write:** `changelog_insert` with `entity_type: "deployment_manifest"`. Metadata is inserted as part of the manifest payload (the insert handler should create this row alongside the root manifest row).
- **Read:** Direct SQL — `SELECT * FROM deployment_manifest_metadata WHERE manifest_id = ?`.

---

### `deployment_target`

**Purpose:** Declares where the software will be deployed. One row per deployment target; a single manifest may target multiple destinations.

**Context:** The two current targets represent the two primary distribution models in the rigorous-dev workflow: `private-cloud` (Kubernetes, ECS, VMs) and `local-executable` (binary distributed via package managers). The target value gates which sub-tables are relevant: `private-cloud` activates the environment/infra/secret tables; `local-executable` activates the local distribution tables.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `target` | TEXT | NOT NULL, CHECK IN (`private-cloud`, `local-executable`) | — | The deployment target. Exactly one of the two recognised values. |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)

**MCP tool access:**
- **Write:** `changelog_insert` with `entity_type: "deployment_manifest"` (targets are part of the manifest payload).
- **Read:** Direct SQL — `SELECT target FROM deployment_target WHERE manifest_id = ?`.

---

### `deployment_manifest_blocker`

**Purpose:** Records hard blockers that prevent the release from proceeding. Each blocker is a distinct row so they can be enumerated, tracked, and resolved independently.

**Context:** When the manifest `status` is `blocked`, at least one row must exist in this table. The `release_critic` validates that every blocker is described clearly enough to be actionable. Blockers are typically failing quality gates, unresolved security findings, or missing sign-offs.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `blocker` | TEXT | NOT NULL | — | Human-readable description of what is blocking the release. |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)

**MCP tool access:**
- **Write:** Part of the manifest payload in `changelog_insert`.
- **Read:** Direct SQL — `SELECT blocker FROM deployment_manifest_blocker WHERE manifest_id = ?`.

---

### `deployment_pipeline`

**Purpose:** Represents a CI/CD pipeline platform (e.g., GitHub Actions, GitLab CI, CircleCI, Jenkins). One row per pipeline; a manifest may in principle define multiple pipelines for different platforms.

**Context:** The pipeline is the top-level CI/CD object. All pipeline stages, their triggers, steps, and quality gates descend from this table.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. Referenced by child stage/config-file tables. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `platform` | TEXT | NOT NULL | — | CI/CD platform name (e.g., `github-actions`, `gitlab-ci`, `circleci`). Free text — no enum constraint. |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)
- Children: `deployment_pipeline_config_file`, `deployment_pipeline_stage`

**MCP tool access:**
- **Write:** Part of the manifest payload in `changelog_insert`.
- **Read:** Direct SQL — `SELECT * FROM deployment_pipeline WHERE manifest_id = ?`.

---

### `deployment_pipeline_config_file`

**Purpose:** Lists the actual file paths of CI/CD configuration files that define the pipeline. One row per file.

**Context:** For GitHub Actions this is typically `.github/workflows/release.yml`; for GitLab CI it is `.gitlab-ci.yml`. These paths are informational — they allow the critic to verify the files exist in the implementation manifest and that they are not stale.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `pipeline_id` | INTEGER | NOT NULL, FK → `deployment_pipeline(id)` | — | Parent pipeline. |
| `file_path` | TEXT | NOT NULL | — | Repository-relative path to the pipeline config file (e.g., `.github/workflows/deploy.yml`). |

**Relationships:**
- Parent: `deployment_pipeline` (via `pipeline_id`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT file_path FROM deployment_pipeline_config_file WHERE pipeline_id = ?`.

---

### `deployment_pipeline_stage`

**Purpose:** Defines a named stage within the CI/CD pipeline (e.g., `build`, `test`, `security-scan`, `deploy-staging`, `deploy-production`). Each stage has a stated purpose.

**Context:** Stages map to jobs or stages in the underlying CI/CD platform. The `purpose` field is a human-readable description used by the release critic to verify that all required deployment concerns (build, test, security, deploy, smoke-test) are covered.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. Referenced by trigger/step/quality-gate child tables. |
| `pipeline_id` | INTEGER | NOT NULL, FK → `deployment_pipeline(id)` | — | Parent pipeline. |
| `name` | TEXT | NOT NULL | — | Stage name (e.g., `build`, `integration-test`, `deploy-production`). |
| `purpose` | TEXT | NOT NULL | — | Human-readable description of what this stage does. |

**Relationships:**
- Parent: `deployment_pipeline` (via `pipeline_id`)
- Children: `deployment_stage_trigger`, `deployment_stage_step`, `deployment_stage_quality_gate`

**MCP tool access:**
- **Read:** Direct SQL — `SELECT * FROM deployment_pipeline_stage WHERE pipeline_id = ?`.

---

### `deployment_stage_trigger`

**Purpose:** Lists the events or conditions that cause a pipeline stage to run (e.g., `push to main`, `on: release published`, `manual approval`). One row per trigger.

**Context:** Triggers are captured as free-text strings rather than an enum because trigger syntax is highly platform-specific. The critic checks that production deploy stages have appropriate gate triggers (e.g., not triggered on every push).

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `stage_id` | INTEGER | NOT NULL, FK → `deployment_pipeline_stage(id)` | — | Parent stage. |
| `trigger_text` | TEXT | NOT NULL | — | Human-readable trigger description (e.g., `on: push to main`, `manual approval required`). |

**Relationships:**
- Parent: `deployment_pipeline_stage` (via `stage_id`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT trigger_text FROM deployment_stage_trigger WHERE stage_id = ?`.

---

### `deployment_stage_step`

**Purpose:** Lists the ordered steps executed within a pipeline stage (e.g., `docker build`, `npm test`, `kubectl apply`). One row per step.

**Context:** Steps are free-text descriptions of the commands or actions performed. They provide enough detail for the critic to verify completeness and for engineers to trace what the pipeline does without reading raw YAML.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `stage_id` | INTEGER | NOT NULL, FK → `deployment_pipeline_stage(id)` | — | Parent stage. |
| `step` | TEXT | NOT NULL | — | Description of the step (e.g., `Run unit tests via npm test`, `Push Docker image to registry`). |

**Relationships:**
- Parent: `deployment_pipeline_stage` (via `stage_id`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT step FROM deployment_stage_step WHERE stage_id = ?`.

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

### `deployment_quality_gates`

**Purpose:** Stores global, manifest-level quality gate thresholds and rules organised by category and key/value pairs. Complements the per-stage gates with project-wide standards.

**Context:** While `deployment_stage_quality_gate` attaches gates to specific pipeline stages, `deployment_quality_gates` records the overall policy (e.g., `category: test_coverage, key: minimum_percent, value: 80`). The release critic compares these global rules against the QA test report to verify the release meets the project's own declared standards.

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
- **Read:** Direct SQL — `SELECT category, key, value FROM deployment_quality_gates WHERE manifest_id = ?`.

---

### `deployment_environment`

**Purpose:** Describes a named deployment environment (development, staging, or production). Captures the deployment method, access URL, and rollback procedure for that environment.

**Context:** The three-environment model (dev/staging/prod) is standard. Each environment gets its own infrastructure resources (`deployment_env_infra`) and environment variable set (`deployment_env_var`). The rollback procedure is critical — the critic verifies it is documented for staging and production.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. Referenced by infra and env-var child tables. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `name` | TEXT | NOT NULL, CHECK IN (`development`, `staging`, `production`) | — | Environment name. Exactly one of the three recognised values. |
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

**Purpose:** Inventories the environment variables used by the application in a specific environment, along with their source classification. Does NOT store values.

**Context:** Tracking env-var sources (`secret`, `config`, `hardcoded`) is essential for security review. `secret` vars are expected to be sourced from a secrets manager (cross-referenced with `deployment_secret`). `config` vars come from CI/CD config files or infrastructure config maps. `hardcoded` vars are baked into the image or binary — flagged for review if they contain sensitive data.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `environment_id` | INTEGER | NOT NULL, FK → `deployment_environment(id)` | — | Parent environment. |
| `name` | TEXT | NOT NULL | — | Environment variable name (e.g., `DATABASE_URL`, `JWT_SECRET`, `FEATURE_FLAG_X`). |
| `source` | TEXT | NOT NULL, CHECK IN (`secret`, `config`, `hardcoded`) | — | Where this variable's value comes from at runtime. |
| `description` | TEXT | — | NULL | Human-readable explanation of what this variable controls. |

**Relationships:**
- Parent: `deployment_environment` (via `environment_id`)
- Cross-reference: `deployment_secret` (vars with `source = 'secret'` should correspond to a row in `deployment_secret`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT name, source, description FROM deployment_env_var WHERE environment_id = ?`.

---

### `deployment_artifact`

**Purpose:** Describes a build artifact produced by the CI/CD pipeline. One row per artifact type (e.g., a Docker image, a statically-compiled binary, a `.tar.gz` release archive).

**Context:** Artifacts are the deployable outputs of the build process. The `registry` field points to where the artifact is stored (container registry, S3 bucket, GitHub Releases). The `versioning` field records the versioning strategy used to tag the artifact.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. Referenced by `deployment_artifact_platform`. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `name` | TEXT | NOT NULL | — | Artifact name (e.g., `api-server`, `cli-binary`, `installer.pkg`). |
| `type` | TEXT | NOT NULL, CHECK IN (`container-image`, `binary`, `archive`, `package`, `installer`) | — | Artifact type. Determines expected registry and signing approach. |
| `registry` | TEXT | — | NULL | Where the artifact is stored (e.g., `ghcr.io/org/api-server`, `s3://releases-bucket`, `pypi.org`). NULL for local builds only. |
| `versioning` | TEXT | CHECK IN (`semantic`, `git-sha`, `timestamp`, `custom`) | NULL | Versioning strategy. NULL means no policy specified (unusual; critic should flag). |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)
- Children: `deployment_artifact_platform`
- Cross-reference: `deployment_signing` (artifacts of type `binary` or `installer` typically require signing)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT * FROM deployment_artifact WHERE manifest_id = ?`.

---

### `deployment_artifact_platform`

**Purpose:** Lists the OS/architecture targets for which an artifact is built. One row per supported platform.

**Context:** Used primarily for cross-compiled binaries and multi-arch container images. The platform strings are free text here (e.g., `linux/amd64`, `linux/arm64`, `darwin/arm64`) rather than constrained to an enum, allowing flexibility for container manifest lists. For constrained local-distribution platforms, see `deployment_local_platform`.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `artifact_id` | INTEGER | NOT NULL, FK → `deployment_artifact(id)` | — | Parent artifact. |
| `platform` | TEXT | NOT NULL | — | Platform target string (e.g., `linux/amd64`, `darwin/arm64`, `windows/amd64`). Free text. |

**Relationships:**
- Parent: `deployment_artifact` (via `artifact_id`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT platform FROM deployment_artifact_platform WHERE artifact_id = ?`.

---

### `deployment_signing`

**Purpose:** Records whether code signing is enabled for this release and, if so, which signing method is used.

**Context:** Code signing is required for macOS binaries (Gatekeeper), Windows executables (SmartScreen), and container images (Sigstore/cosign). A single row per manifest captures the overall signing posture. The critic verifies that `enabled = 1` when the target includes a platform that mandates signing.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `enabled` | INTEGER | — | `0` | Boolean flag. `1` = signing is active; `0` = signing is disabled or not applicable. |
| `method` | TEXT | — | NULL | Signing method or tool (e.g., `apple-developer-id`, `windows-ev-cert`, `sigstore-cosign`, `gpg`). NULL when `enabled = 0`. |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)
- Cross-reference: `deployment_artifact` (signing applies to artifacts of type `binary` or `installer`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT enabled, method FROM deployment_signing WHERE manifest_id = ?`.

---

### `deployment_local_executable`

**Purpose:** Top-level metadata for locally-distributed executables — tools or CLIs shipped directly to end-user machines via package managers rather than deployed to a server.

**Context:** Applies when `deployment_target.target = 'local-executable'`. Captures the installation method (e.g., `homebrew-tap`, `apt-repository`, `winget`, `direct-download`) and the update mechanism (e.g., `brew upgrade`, `apt-get upgrade`, `self-update`). Child tables enumerate specific platforms and channels.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. Referenced by platform and channel child tables. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `installation_method` | TEXT | — | NULL | Primary installation method description (e.g., `homebrew tap`, `apt repository`, `winget package`, `curl script`). |
| `update_mechanism` | TEXT | — | NULL | How users update to new versions (e.g., `brew upgrade`, `apt-get upgrade`, `built-in self-update check`). |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)
- Children: `deployment_local_platform`, `deployment_local_channel`

**MCP tool access:**
- **Read:** Direct SQL — `SELECT * FROM deployment_local_executable WHERE manifest_id = ?`.

---

### `deployment_local_platform`

**Purpose:** Lists the specific OS/architecture combinations for which the local executable is distributed. Uses a constrained enum unlike the free-text `deployment_artifact_platform`.

**Context:** The enum values correspond to GOARCH/GOOS-style target triples standardised in the rigorous-dev workflow. The critic checks that `deployment_artifact` rows exist for each platform declared here.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `local_exec_id` | INTEGER | NOT NULL, FK → `deployment_local_executable(id)` | — | Parent local executable. |
| `platform` | TEXT | NOT NULL, CHECK IN (`linux-amd64`, `linux-arm64`, `darwin-amd64`, `darwin-arm64`, `windows-amd64`) | — | Target platform. Constrained to the five supported combinations. |

**Relationships:**
- Parent: `deployment_local_executable` (via `local_exec_id`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT platform FROM deployment_local_platform WHERE local_exec_id = ?`.

---

### `deployment_local_channel`

**Purpose:** Lists the distribution channels through which the local executable is published. One row per channel.

**Context:** A single executable may be distributed through multiple channels simultaneously (e.g., `homebrew-tap`, `apt-repository`, `github-releases`). Free text allows flexibility for emerging channels (e.g., `nix`, `scoop`, `snap`).

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `local_exec_id` | INTEGER | NOT NULL, FK → `deployment_local_executable(id)` | — | Parent local executable. |
| `channel` | TEXT | NOT NULL | — | Distribution channel name (e.g., `homebrew-tap`, `apt-repository`, `winget`, `github-releases`, `nix-flake`). |

**Relationships:**
- Parent: `deployment_local_executable` (via `local_exec_id`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT channel FROM deployment_local_channel WHERE local_exec_id = ?`.

---

### `deployment_secret`

**Purpose:** Inventories the secrets required by the deployment — their names, purposes, managing provider, and rotation policy. Values are NEVER stored.

**Context:** This table is the deployment domain's secrets ledger. It enables the release critic to verify that every environment variable with `source = 'secret'` has a corresponding secret record. The `provider` points to the secrets management system (e.g., `AWS Secrets Manager`, `HashiCorp Vault`, `GitHub Actions secrets`). The `rotation_policy` drives operational runbook requirements.

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
- Cross-reference: `deployment_env_var` (vars with `source = 'secret'` should match a `name` here)

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

**Context:** The review checklist is the final gate before a release is approved. It covers items such as "All quality gates pass", "Rollback procedure documented", "Secrets rotation policy defined", "Health checks configured". The Release Critic verifies that all items are `passed = 1` before issuing an approval verdict. Items with `passed = 0` correspond to blockers in `deployment_manifest_blocker`.

| Column | Type | Constraints | Default | Description |
|--------|------|-------------|---------|-------------|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | — | Surrogate key. |
| `manifest_id` | INTEGER | NOT NULL, FK → `deployment_manifest(id)` | — | Parent manifest. |
| `check_name` | TEXT | NOT NULL | — | Name of the checklist item (e.g., `All quality gates pass`, `Secrets inventory complete`, `Rollback procedure documented`). |
| `passed` | INTEGER | — | `0` | Boolean flag. `1` = check passed; `0` = check not yet passed or failed. |

**Relationships:**
- Parent: `deployment_manifest` (via `manifest_id`)
- Cross-reference: `deployment_manifest_blocker` (failed checklist items should correspond to blockers when manifest `status = 'blocked'`)

**MCP tool access:**
- **Read:** Direct SQL — `SELECT check_name, passed FROM deployment_review_checklist WHERE manifest_id = ?`.

---

## Cross-Domain Relationships

| This Domain | References | Via |
|-------------|-----------|-----|
| `deployment_manifest` | `iteration` | `iteration_id` |
| `deployment_manifest` | `revision` | `revision_id` |
| `deployment_manifest_metadata` | `implementation_manifest_metadata` (conceptually) | `implementation_version` string |
| `deployment_env_var` (source=secret) | `deployment_secret` | `name` match (logical, not FK) |
| `deployment_local_platform` | `deployment_artifact_platform` | platform string match (logical, not FK) |

## MCP Tool Summary

| Operation | Tool | Notes |
|-----------|------|-------|
| Insert deployment manifest + all children | `changelog_insert` with `entity_type: "deployment_manifest"` | All 25 child tables are inserted in a single transactional call via nested `data` properties |
| Query manifest by iteration | `changelog_query` with `entity_type: "deployment_manifest"`, `iteration_id: N` | Returns `deployment_manifest` rows with all children attached via `attachRelated` |
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
    "metadata": [{                         // → deployment_manifest_metadata
      "version": "1.0.0",
      "created": "2025-01-15T00:00:00Z",
      "requirements_version": "1.0.0",
      "architecture_version": "1.0.0",
      "implementation_version": "1.0.0",
      "test_report_version": "1.0.0"       // optional, null if QA skipped
    }],
    "targets": [                           // → deployment_target (string or object)
      { "target": "private-cloud" },
      "local-executable"                   // shorthand: bare string accepted
    ],
    "blockers": [                          // → deployment_manifest_blocker
      { "blocker": "DNS records not configured" }
    ],
    "pipelines": [{                        // → deployment_pipeline
      "platform": "github-actions",
      "config_files": [                    //   → deployment_pipeline_config_file
        { "file_path": ".github/workflows/release.yml" }
      ],
      "stages": [{                         //   → deployment_pipeline_stage
        "name": "build",
        "purpose": "Compile and package",
        "triggers": [                      //     → deployment_stage_trigger
          { "trigger_text": "on: push to main" }
        ],
        "steps": [                         //     → deployment_stage_step
          { "step": "checkout" },
          { "step": "go build" }
        ],
        "quality_gates": [{                //     → deployment_stage_quality_gate
          "name": "unit-tests",
          "condition": "all tests pass",
          "failure_action": "block"        // "block" | "warn" | "notify"
        }]
      }]
    }],
    "quality_gates": [{                    // → deployment_quality_gates (global)
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
        "source": "secret",               // "secret" | "config" | "hardcoded"
        "description": "PostgreSQL connection string"
      }]
    }],
    "artifacts": [{                        // → deployment_artifact
      "name": "myapp",
      "type": "container-image",           // "container-image" | "binary" | "archive" | "package" | "installer"
      "registry": "ghcr.io/org/myapp",
      "versioning": "semantic",            // "semantic" | "git-sha" | "timestamp" | "custom"
      "platforms": [                       //   → deployment_artifact_platform
        { "platform": "linux/amd64" }
      ]
    }],
    "signing": [{                          // → deployment_signing
      "enabled": true,
      "method": "cosign"
    }],
    "local_executables": [{                // → deployment_local_executable
      "installation_method": "go install",
      "update_mechanism": "self-update",
      "platforms": [                       //   → deployment_local_platform
        "linux-amd64",                     // shorthand: bare string accepted
        { "platform": "darwin-arm64" }
      ],
      "channels": [                        //   → deployment_local_channel
        { "channel": "homebrew-tap" }
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

| Property | Source Table | Nesting |
|----------|-------------|---------|
| `metadata` | `deployment_manifest_metadata` | flat |
| `targets` | `deployment_target` | flat |
| `blockers` | `deployment_manifest_blocker` | flat |
| `pipelines` | `deployment_pipeline` | → `config_files`, `stages` → `triggers`, `steps`, `quality_gates` |
| `quality_gates` | `deployment_quality_gates` | flat |
| `environments` | `deployment_environment` | → `infra`, `vars` |
| `artifacts` | `deployment_artifact` | → `platforms` |
| `signing` | `deployment_signing` | flat |
| `local_executables` | `deployment_local_executable` | → `platforms`, `channels` |
| `secrets` | `deployment_secret` | flat |
| `health_checks` | `deployment_health_check` | flat |
| `alerting` | `deployment_alerting` | flat |
| `runbooks` | `deployment_runbook` | → `steps` |
| `review_checklist` | `deployment_review_checklist` | flat |

### Common SQL Patterns

**Full manifest read (all children):**
```sql
-- Root
SELECT * FROM deployment_manifest WHERE iteration_id = ?;

-- Targets and blockers
SELECT target FROM deployment_target WHERE manifest_id = ?;
SELECT blocker FROM deployment_manifest_blocker WHERE manifest_id = ?;

-- Pipeline topology
SELECT p.*, GROUP_CONCAT(pcf.file_path) AS config_files
FROM deployment_pipeline p
LEFT JOIN deployment_pipeline_config_file pcf ON pcf.pipeline_id = p.id
WHERE p.manifest_id = ?
GROUP BY p.id;

-- All stages with steps
SELECT s.name, s.purpose, st.step
FROM deployment_pipeline_stage s
JOIN deployment_pipeline p ON s.pipeline_id = p.id
JOIN deployment_stage_step st ON st.stage_id = s.id
WHERE p.manifest_id = ?
ORDER BY s.id, st.id;

-- Quality gate summary
SELECT s.name AS stage, qg.name, qg.condition, qg.failure_action
FROM deployment_stage_quality_gate qg
JOIN deployment_pipeline_stage s ON qg.stage_id = s.id
JOIN deployment_pipeline p ON s.pipeline_id = p.id
WHERE p.manifest_id = ?;

-- Environment + vars
SELECT e.name, e.deployment_method, v.name AS var_name, v.source
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
  COUNT(DISTINCT b.id) AS blocker_count,
  COUNT(DISTINCT rc.id) FILTER (WHERE rc.passed = 0) AS failed_checks
FROM deployment_manifest dm
LEFT JOIN deployment_manifest_blocker b ON b.manifest_id = dm.id
LEFT JOIN deployment_review_checklist rc ON rc.manifest_id = dm.id
WHERE dm.iteration_id = ?
GROUP BY dm.id;
```
