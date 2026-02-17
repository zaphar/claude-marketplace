# Agent Comparison: walljm-claude vs rigorous-dev

## 1. Requirements Analyst

**Their strengths we could adopt:**

- **"Before You Start" scanning** — They scan the workspace for READMEs, existing code, package manifests, and pre-fill obvious answers instead of asking the user what the codebase already tells them. Ours explicitly says "do NOT read the codebase" which is more purist but can lead to redundant questions.
- **Phase-based topic organization** — They organize the interview into 4 phases (Core Understanding -> Functional/Technical -> Cross-Cutting -> Prioritization) with guidance to skip irrelevant topics. Ours has a flat list.
- **Prior art discovery** — "Ask if there's an existing system being replaced or a competitor product to reference." Grounds the conversation fast.
- **MVP vs full vision** — Explicitly asks the user to separate launch needs from the full vision. Ours doesn't distinguish.
- **Proactive suggestions** — Raises concerns the user hasn't thought of (rate limiting, audit logging, etc.) rather than staying silent.
- **"Know when to stop"** — "Don't ask a solo dev building a CLI tool about multi-currency support." Prevents exhausting interviews.
- **Ongoing Activities** — Glossary, decision log, and risk identification happen *continuously* during the interview, not as a separate step.
- **Modular output files** — 8 separate files (index.md, glossary.md, risks.md, decisions.md, etc.) so downstream agents only load what they need.
- **Context Management section** — Explicit strategies for avoiding context exhaustion.
- **Escalation with BLOCKERS.md** — Writes blockers to a shared file rather than just "pausing."

**Our strengths to keep:**

- **Bug Fix Requirements** — Specific guidance for gathering requirements around bug reports (root cause vs symptom, regression criteria). Theirs has nothing for this.
- **Schema-based output** — YAML validated against schemas gives structured, machine-parseable output.

## 2. Requirements Critic

**Their strengths we could adopt:**

- **Review file tracking** — Reads previous review iterations and appends each new review with a dated heading and revision number. Gives history of the review process.
- **More comprehensive completeness checklist** — Checks for data requirements, integration requirements, scalability, error handling/resilience, i18n, and verifies all 8 expected modular files exist.
- **Writes to project-memory.md** — Records significant lessons for future workflow steps.
- **Context Management section** — Process files one at a time; on re-review, only read changed files.
- **Escalation writes to BLOCKERS.md** — Concrete shared file for blockers instead of vague "escalate to stakeholders."
- **Glossary cross-check** — Explicitly checks terminology consistency against `glossary.md`.

**Our strengths to keep:**

- **Schema validation** — Validates against YAML schema, checks required fields and ID patterns. Theirs doesn't have structured validation.
- **3-tier feedback** — Blocking / Recommended / Suggestion. Theirs only has Blocking / Suggestion, losing the useful middle ground.
- **Interview awareness** — "If the interview indicates user had no strong preference, don't require it in the spec." Prevents pedantic rejection of intentionally light sections.
- **Explicit handoff** — Clear about what happens on approval vs rejection.

## 3. Architect (theirs) vs Backend Architect (ours)

**Their strengths we could adopt:**

- **"Before You Start" scanning** — Scans workspace for existing code/frameworks/infrastructure. Reads `decisions.md` to avoid re-asking settled questions.
- **Research-Driven Technology Decisions** — Explicit requirement to do live web research before recommending any technology. Cite sources, flag uncertainty, fallback when research is inconclusive. Ours just says "select implementation language" with no research mandate.
- **Technology Interview** — Structured interview ("always ask" / "ask if relevant") before making tech decisions. Asks about team experience, existing infrastructure, hosting preferences. Ours goes straight to designing.
- **Session-based auth default** — Opinionated: "default to server-side sessions with secure cookies unless user explicitly requests JWTs" with detailed trade-off reasoning. Ours says nothing about auth defaults.
- **Linter/static analyzer selection** — Mandatory, not optional. Includes specific tool recommendations per language (ESLint, clippy, golangci-lint, etc.).
- **Integration test boundaries** — For each component, defines which inter-component interactions require integration testing (boundary type, correct behavior).
- **OpenAPI specification** — Produces machine-readable `api-spec.yaml` alongside human-readable `api-spec.md`. Useful for downstream doc generation.
- **Keyset pagination mandate** — "All list endpoints must use keyset (cursor-based) pagination, never offset/limit."
- **Dependency management** — Extensive guidance on minimizing deps, maintaining an approved manifest, assessing health (maintenance, community, transitive deps, license, single-maintainer risk).
- **Proactive suggestions** — Raises architectural concerns/ideas the user may not have considered, with concrete examples.
- **ADR file structure** — Separate `adrs/` directory with index + individual files, vs our embedded ADRs.
- **Context Management section** — What to read, what to skip, write incrementally.

**Our strengths to keep:**

- **Bug Fix Architecture** — Specific guidance for designing around bug fix iterations (root cause analysis, preventing the class of bug, type system enforcement). Theirs has nothing for this.
- **Persistent Artifact** — Living document updated in-place across iterations. Preserves prior decisions.
- **Schema-based output** — Validated YAML gives structure.

## 5. UX Designer

**Their strengths we could adopt:**

- **Work & Mental Model Questions** — A whole pre-design interview section: grounded task walkthroughs ("walk me through the last time you did X"), conceptual model extraction (nouns/verbs/relationships), tool reflection (what works/doesn't in current tool), user-perspective failure points. This deeply shapes IA and flows. Ours goes straight to design direction.
- **Clickable flow prototypes** — SVG wireframes with `<a href>` links between screens in a `flows/` directory. Users can open in browser and click through key flows.
- **Known Limitations section** — Honest about LLM-generated SVG quality: "functional, not polished" with recommended workflow for importing structural output into real design tools. Sets realistic expectations.
- **Modular output files** — Separate markdown files for user-flows, info-arch, accessibility, responsive, error-states, traceability (vs our single YAML).

**Our strengths to keep:**

- **HTML mockups** — More realistic rendering and interactivity than their SVGs. Linked navigation between screens works better in browser.
- **User approval gate in Phase 2** — Explicit "stop and present to user" after every mockup, not just Phase 1.
- **Mockup completeness rule** — Every SCREEN-XXX must have a corresponding HTML file. Prevents screens from existing only on paper.
- **Persistent Artifact** — Living document updated in-place across iterations.
- **Schema-based YAML output** — Structured, machine-parseable.
- **Destructive action clarity** — "When the impact of a destructive action is not clear to the user, it should be made clear."

## 6. UX Critic

**Their strengths we could adopt:**

- **Two-phase review** — Phase 1 reviews design direction only (design system + sample screens, skip completeness). Phase 2 reviews the full wireframe set. Ours reviews everything at once, which can happen before wireframes exist.
- **Peer-level screen consistency check** — "If one section uses tabs, peer sections should too unless justified." Catches inconsistency across parallel screens.
- **Explicit file presence checks** — Verifies all expected UX output files are present.
- **Review file tracking** — Appends dated revisions with revision numbers.

**Our strengths to keep:**

- **Schema validation** — Validates against YAML schema with ID pattern checks (FLOW-XXX, SCREEN-XXX, PERSONA-XXX).
- **3-tier feedback** — Blocking / Recommended / Suggestion.
- **HTML mockup verification** — Checks that mockups link to each other and that navigation was updated when new screens were added.

## 7. Planner (theirs) vs Implementation Planner (ours)

**Their strengths we could adopt:**

- **Two-pass structure** — Pass 1 (Phase Skeleton) does all cross-referencing and produces phase index files. Pass 2 (WI Elaboration) mechanically expands each phase into self-contained WI files. Designed to survive context exhaustion across sessions.
- **Work Items (WIs)** — Each phase is decomposed into self-contained work item files (`WI-NN-slug.md`) with inlined upstream context (requirements, architecture, UX) so the developer reads only one file per task.
- **Feature-Layer Matrix** — Table per phase showing feature x UI/API/Data/WI mapping. Serves as completeness checklist — every ✓ cell must be implemented.
- **E2E test scenarios** — Defined at phase level with action sequences, expected outcomes, and requirement traceability. QA implements as Playwright tests.
- **Integration test scenarios** — Defined at phase level referencing specific component boundaries from `components.md`.
- **WI design principles** — Vertical slices, tight coupling kept together, foundation WIs for shared setup, sized for single conversation (~3 files created, ~5 modified).
- **WI scope boundaries** — Explicit DO/DO NOT lists per WI to prevent scope creep.
- **Consistency Watch** — Flags peer/analogous features split across phases so later phases reference earlier ones for structural consistency.

**Our strengths to keep:**

- **Delivery expectations interview** — 7 structured questions covering critical functionality, vertical vs horizontal preference, review frequency, hard deadlines, risk appetite, Phase 1 non-negotiables, involvement level. Theirs consults on Phase 1 strategy but less structured.
- **Schema-based YAML output** — Validated against schema.
- **3-tier feedback** — Blocking / Recommended / Suggestion on critic side.

## 8. Planner Critic (theirs) vs Implementation Plan Critic (ours)

**Their strengths we could adopt:**

- **Two-pass awareness** — Adjusts review scope depending on whether reviewing Pass 1 only (phase structure) or both passes (including WI files). Ours always reviews the single YAML.
- **Feature-Layer Matrix checks** — Verifies every feature in the matrix is assigned to a WI and every requirement in a phase is covered.
- **E2E/integration test scenario checks** — Verifies scenarios are specific (action sequence, expected outcome, requirement IDs), not vague.
- **WI quality checks** — Verifies vertical slices, single-session sizing, self-containedness, scope boundaries, foundation WIs, flags XL complexity.
- **WI dependency checks** — No circular dependencies within phases; independent WIs identified for parallel execution.
- **Spot-check approach** — Picks 2-3 WI files per phase to verify self-containedness rather than reading everything.

**Our strengths to keep:**

- **Schema validation** — Validates plan against YAML schema with ID pattern checks.
- **3-tier feedback** — Blocking / Recommended / Suggestion.

## 9. Developer (theirs) vs Senior Developer (ours)

**Their strengths we could adopt:**

- **WI-based workflow** — Works one work item at a time, reads only the WI file, updates WI status headers. On session start, scans for next unblocked `not_started` WI. Very structured context management.
- **Feature-Layer Matrix as completeness checklist** — Checks every ✓ cell (UI, API, Data) has corresponding code before marking a phase done. Catches the most common source of missed work.
- **Dependency manifest enforcement** — Won't introduce new third-party deps beyond the Architect's approved manifest. Prefers building in-house. Flags additions for Architect to formalize.
- **Peer feature consistency** — Before implementing a feature, checks if analogous features exist and matches their patterns (nav, buttons, state management, error display).
- **Visual verification with Playwright** — Uses Playwright as a visual inspection tool during development (screenshots vs wireframes), distinct from QA test authoring.
- **Linter enforcement** — "Treat analyzer warnings as errors — do not suppress without documented justification."
- **Naming from glossary** — Uses `glossary.md` for variable names, API paths, UI labels, and code comments.

**Our strengths to keep:**

- **Bug Fix Implementation** — Specific guidance: study root pattern, search for other instances of same vulnerable pattern, prefer structural over behavioral fixes, test pattern prevention not just the specific bug.
- **Code quality principles** — "Small composable interfaces", "types to make invalid states unrepresentable", "avoids circular dependencies", "well-defined contracts for server-client interactions."
- **Serialization round-trip tests** — Specific requirement for objects that go over the wire or get stored.
- **Review Checkpoints protocol** — Detailed steps for checkpoint handling: pause, QA validation, stakeholder review, spec updates, plan revision.
- **Storage consistency** — "Use the appropriate consistency enforcement for our storage (e.g., transactions and constraints for RDBMS)."

## 10. Code Reviewer (theirs) vs Senior Developer Critic (ours)

**Their strengths we could adopt:**

- **Feature-Layer Matrix verification** — Checks every ✓ cell has corresponding implementation. Every API endpoint that serves a UI screen has a corresponding UI component calling it, etc.
- **Peer-level structural consistency** — "Consistent structural/behavioral patterns across peer features (not just code formatting — navigation patterns, button placement, save/cancel flows, error display, loading states)."
- **Dependency manifest check** — "Dependencies match the Architect's approved manifest — no unapproved additions."
- **Keyset pagination check** — "All list endpoints use keyset (cursor-based) pagination, not offset/limit."
- **Context Management** — Reviews code file-by-file, writes findings incrementally, prioritizes checklist items if context is tight.
- **Escalation with BLOCKERS.md** — Concrete file for recurring issues, security vulnerabilities, architectural root causes.

**Our strengths to keep:**

- **Bug Fix Review** — Verifies fix addresses root pattern, developer searched for other instances, tests cover pattern prevention, structural vs behavioral fix preference.
- **Schema validation** — Validates manifest against YAML schema.
- **3-tier feedback** — Blocking / Recommended / Suggestion (theirs only has Blocking / Suggestion).
- **Serialization round-trip test verification** — Checks that wire/storage objects have round-trip tests.
- **Review Feedback Format** — Structured template with verdict, revision cycle, files reviewed, and categorized issues.

## 11. QA Engineer

**Their strengths we could adopt:**

- **Unified traceability matrix** — Builds `planning/qa/phase-N/traceability.md` showing for each requirement: UX screens, architecture components, source code locations, and test IDs. Single place for full requirement-to-verification traceability.
- **E2E test ownership clarity** — "You are the sole owner of E2E tests." Phase index defines scenarios, QA implements as Playwright tests. Clear boundary with developer (who only does unit tests).
- **Planner-defined test scenarios** — QA implements specific scenarios from the phase index (action sequences, expected outcomes, requirement IDs), then adds edge cases beyond what the planner specified.
- **QA-Developer remediation loop** — Structured: document failures → hand to developer → re-test → repeat until no failures → submit to critic. Only escalate to user after 3 failed developer attempts.
- **Cross-feature consistency testing** — Compares peer/analogous screens against each other (not just wireframes) for structural consistency in navigation, buttons, save/cancel flows.
- **Separation from security/performance** — "Do NOT perform security testing or performance benchmarking — owned by Security and Performance Auditors." Clean separation of concerns.
- **Context Management** — Work requirement-by-requirement, read source selectively, write tests and report incrementally.

**Our strengths to keep:**

- **Security testing built-in** — Our QA does dependency scanning and OWASP top 10. Theirs delegates to separate auditor agents (which we don't have yet).
- **Performance testing built-in** — Our QA benchmarks against performance thresholds. Theirs delegates to performance auditor.
- **Schema-based YAML output** — Test report validated against schema.
- **Screenshot organization** — `screenshots/` subdirectory.

## 12. QA Critic

**Their strengths we could adopt:**

- **E2E test coverage checks** — Verifies QA wrote Playwright tests for every planner-defined scenario, added edge cases, cross-feature tests, error recovery tests, and no flaky tests remain.
- **Integration test coverage checks** — Verifies tests for every planner-defined integration scenario and component boundaries.
- **Visual/cross-feature consistency checks** — Verifies screenshots taken and compared, peer screens compared for structural consistency.
- **Traceability matrix verification** — Checks the unified traceability matrix exists, is complete, and consistent with test report.

**Our strengths to keep:**

- **Security testing review** — Verifies dependency scan, no critical vulnerabilities, OWASP checks.
- **Performance testing review** — Verifies benchmarks exist and meet thresholds.
- **Schema validation** — Validates report against YAML schema.
- **3-tier feedback** — Blocking / Recommended / Suggestion.

## 13. Documentation Master

**Their strengths we could adopt:**

- **Documentation scope determination** — Before writing, determines which doc categories apply (user docs, how-to guides, API reference, library/SDK reference, operator docs, developer docs) and skips inapplicable ones with documented reasoning. Ours always produces all categories.
- **How-to guides** — Separate task-oriented guides organized by user intent (e.g., "How to configure SSO") distinct from feature documentation. Ours doesn't have this category.
- **Library/SDK Reference** — Specific category for libraries/frameworks with public types, usage guide, migration guides, changelog. Ours treats everything as an application.
- **Glossary as authoritative terminology source** — Uses `glossary.md` for all user-facing terms, explains technical terms using requirements-defined definitions.
- **Per-phase incremental updates** — Runs once per phase, updating docs for features delivered in that phase. Consistency review checks previous phases' docs. Ours produces docs once.
- **OpenAPI-generated API reference** — Generates from `api-spec.yaml` machine-readable spec, supplements with human context from `api-spec.md`.
- **Context Management** — One section at a time, selective upstream file reads, incremental manifest updates.

**Our strengths to keep:**

- **Schema-based YAML manifest** — Validated against schema.
- **Artifact Organization** — Subdirectories by audience (`user-guide/`, `api/`, `operator/`, `developer/`).
- **3-tier feedback on critic side** — Blocking / Recommended / Suggestion.

## 14. Documentation Critic

**Their strengths we could adopt:**

- **Scope-aware completeness** — Checks that doc manifest lists which categories apply and which were skipped with reasoning, then verifies all applicable categories have docs. Ours always checks for everything.
- **How-to guide checks** — Verifies task-oriented guides exist for key multi-step workflows.
- **Peer feature doc coverage** — "If Settings has a detailed walkthrough with screenshots, Admin should too." Catches inconsistent documentation depth.
- **Context Management** — Reviews one doc file at a time, loads one upstream file per review, prioritizes Accuracy over Clarity if context is tight.

**Our strengths to keep:**

- **Schema validation** — Validates manifest against YAML schema.
- **3-tier feedback** — Blocking / Recommended / Suggestion.

## 15. Release Engineer

**Their strengths we could adopt:**

- **CHANGELOG.md creation** — Creates and maintains project-level `CHANGELOG.md` at repo root using Keep a Changelog format, grouped by phase. Ours doesn't produce a changelog.
- **Runbook ownership clarity** — Clear separation: Release Engineer owns deployment/rollback/infrastructure troubleshooting. Documentation Master owns user-facing troubleshooting. Prevents duplication.
- **Context Management** — Read only specific upstream files, test report summary only, source code for build config only.

**Our strengths to keep:**

- **Schema validation in CI** — Quality gates include schema validation of all upstream artifacts.
- **Schema-based deployment manifest** — Validated YAML output.

## 16. Release Critic

**Their strengths we could adopt:**

- **Lint pass check** — Explicitly checks linter pass in quality gates. Ours checks zero warnings build but not lint separately.
- **Coverage threshold enforcement** — Checks that pipeline *enforces* thresholds, not just that tests pass.
- **Context Management** — Read release config in full, selectively read constraints and quality standards.

**Our strengths to keep:**

- **Schema validation** — Validates deployment manifest against YAML schema.
- **3-tier feedback** — Blocking / Recommended / Suggestion.
- **Schema validation of upstream artifacts** in quality gate checks.

---

## Cross-Cutting Themes

### Patterns they have consistently that we lack:

1. **Context Management sections** — Every agent has explicit strategies for managing context window limits. Our agents have none.
2. **BLOCKERS.md** — All agents write blockers to a shared file. Our agents just say "escalate to X."
3. **project-memory.md** — Critics write significant lessons for future steps. Creates institutional memory across the workflow.
4. **Review file tracking** — Critics append dated revisions with revision numbers. Gives history of the review process.
5. **Modular file output** — Their agents write many small focused files. Ours write single YAML files per phase.
6. **Glossary-driven naming** — Multiple agents reference `glossary.md` for consistent domain terminology throughout.
7. **Peer/analogous feature consistency** — Developer, code reviewer, QA, and docs all check that similar features follow consistent patterns.

### Patterns we have that they lack:

1. **Schema-based YAML output** — Structured, machine-parseable, validated output at every phase.
2. **Bug Fix guidance** — Requirements, architecture, developer, and code reviewer all have specific bug-fix sections.
3. **3-tier feedback** — Blocking / Recommended / Suggestion on all critics. Theirs mostly use Blocking / Suggestion only.
4. **Persistent Artifacts** — Living documents updated in-place across iterations for architecture and UX.

### Their unique agents (not in our workflow):

- **Security Auditor + Security Critic** — Deep OWASP code audit (separate from QA security testing)
- **Performance Auditor + Performance Critic** — Deep code-level performance audit (separate from QA benchmarks)
- **Code Reviewer** (as distinct from Developer Critic) — Their code reviewer is separate from the developer's critic
- **Artist** — (not reviewed, user declined)

