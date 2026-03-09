# Documentation Domain — Table Design Reference

The documentation domain previously contained seven tables for tracking documentation manifests, sections, features, requirement coverage, assets, and review checklists.

**These tables have been dropped.** Documentation quality is now enforced by the `documentation_critic` reviewing committed markdown files directly. The Documentation Master commits documentation files to the repository and the critic validates them against requirements, accuracy, and completeness standards.

**Producer:** `documentation_master`
**Critic:** `documentation_critic`
**Workflow phase:** `documentation` (phase 6 of 8)

---

## Design Decision

Documentation tracking via database tables added complexity without proportional value. The producer-critic loop already ensures documentation quality through file-based review. The critic reviews committed documentation files for:

- Coverage of all user-facing requirements
- Accuracy against code and specifications
- Accessibility compliance
- Terminology consistency with the requirements glossary
- Completeness of applicable documentation categories

No database tables are needed for this workflow — the documentation files themselves are the artifacts.
