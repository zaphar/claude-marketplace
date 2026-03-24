---
# skip_test_writing: false
# test_execution: in_loop   # in_loop | manual | ci_only
# skip_ui_validation: false
---

# Implementation Conventions

- 🔧 Write failing tests before implementation — tests define the behavioral contract
- 🔧 Do not use mocking frameworks — use fakes or in-memory doubles instead
- Test fixtures, fakes, and test helpers are test infrastructure — they are allowed
- One test per exit criterion minimum
- Assert on behavior and contracts, not implementation details
- Tests must be isolated and deterministic — no shared mutable state, no timing dependencies, no network dependencies
- Use descriptive test names that document what behavior is being verified
- Cover edge cases and error conditions, not just happy paths
- No test duplication — each test verifies a distinct behavior
- 🔧 For serialized objects, include round-trip tests (serialize → deserialize → equality check)
- 🔧 For API endpoints, include integration tests for request/response flows
- Stubs contain only signatures, panics/throws, or zero-value returns — no business logic, no data access, no handler logic
- Audit existing tests before writing new ones — decide keep, modify, or delete for each test in scope
- Classify exit criteria as test-suite-verifiable or execution-validated before writing tests
- Do not write tests that parse infrastructure configuration files (CI YAML, Dockerfiles, IaC templates)
- Write the minimum implementation code to make all failing tests pass — do not write code not driven by a failing test
- Refactor while keeping all tests green — apply coding standards, remove duplication, improve naming
- 🔧 Use the linter configuration defined in architecture
- Write modular code with small, composable interfaces
- Use types to make invalid states unrepresentable
- Avoid circular dependencies
- Use well-defined contracts for client-server interactions
- 🔧 Compare UI against mockups using Playwright screenshots after implementation
- Verify Feature-Layer Matrix completeness: every marked cell (UI, API, Data) has code
- Do not add dependencies beyond the approved dependency manifest — flag unapproved needs for the architect
