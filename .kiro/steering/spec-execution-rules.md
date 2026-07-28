---
inclusion: always
---
<!------------------------------------------------------------------------------------
   Add rules to this file or a short description and have Kiro refine them for you.
   
   Learn about inclusion modes: https://kiro.dev/docs/steering/#inclusion-modes
-------------------------------------------------------------------------------------> 

# Spec Execution Rules

## Purpose

This document defines mandatory execution rules for Kiro when implementing specifications.

The primary objective is to maximize forward progress, avoid infinite loops, reduce unnecessary changes, and deliver working software incrementally.

These rules take precedence whenever execution behavior becomes ambiguous.

---

# 1. Never Lose The Original Goal

Before starting any task:

1. Re-read the current spec.
2. Identify the exact acceptance criteria.
3. List what is explicitly in scope.
4. List what is explicitly out of scope.

At every major step, verify:

- Am I moving closer to the acceptance criteria?
- Am I solving a real requirement from the spec?
- Am I introducing work that was not requested?

If not, stop and return to the spec.

---

# 2. Avoid Infinite Fix Loops

Maximum retry count for the same problem:

- First attempt
- Second attempt
- Final attempt

After 3 failed attempts:

DO NOT continue trying random fixes.

Instead:

1. Describe the root cause discovered.
2. Describe failed attempts.
3. Describe the current blocker.
4. Propose next actions.

Never enter unlimited retry cycles.

---

# 3. Do Not Refactor Outside Scope

Unless explicitly requested:

DO NOT:

- reorganize folders
- rename files
- rename components
- rename hooks
- rename variables globally
- migrate architecture
- replace libraries

Allowed:

- minimal modifications required by the spec

Prefer the smallest change that satisfies the requirement.

---

# 4. Runtime Errors First

Priority order:

1. Build errors
2. TypeScript errors
3. Test failures
4. Runtime failures
5. Lint errors
6. Warnings

Never spend time fixing warnings while builds are failing.

Never spend time fixing lint while runtime is broken.

---

# 5. Node + Vite + React Rule

When working in React projects:

First inspect:

- package.json
- tsconfig.json
- vite.config.*
- eslint config
- src/main.*
- src/App.*

Understand the application structure before modifying code.

Do not assume architecture.

Verify it.

---

# 6. Avoid Rebuilding The Entire Application

Prefer targeted validation.

Examples:

Good:

- npm run build
- npm run test -- component.test.ts
- vitest single file

Avoid:

- repeatedly running huge E2E suites
- repeatedly running full test suites
- multiple full builds after every tiny change

Validate only what changed.

---

# 7. Prefer Existing Patterns

Before creating new:

- hooks
- services
- utilities
- context providers
- API clients

Search the codebase.

If similar code exists:

Reuse it.

Only create new patterns when necessary.

---

# 8. Minimize File Creation

Before creating a file:

Ask:

"Can an existing file be updated instead?"

Prefer:

- extending existing modules
- extending existing components

Avoid generating multiple files for small changes.

---

# 9. Stop Expanding Scope

When implementing:

Do not silently add:

- dark mode
- caching
- logging systems
- telemetry
- monitoring
- optimizations
- accessibility improvements

Unless explicitly requested in the spec.

Implement only what was asked.

---

# 10. TypeScript Rule

Do not bypass type safety by using:

- any
- unknown as
- @ts-ignore
- @ts-nocheck

Only use temporary exceptions when:

1. unavoidable
2. documented
3. accompanied by explanation

Prefer proper typing.

---

# 11. React Rule

Prefer:

- functional components
- existing project conventions
- reusable logic

Avoid:

- unnecessary abstractions
- premature optimization
- deeply nested component trees
- excessive memoization

If React.memo, useMemo, or useCallback are introduced:

justify why.

---

# 12. API Rule

Before creating API clients:

Search for:

- axios instances
- fetch wrappers
- repositories
- existing services

Reuse existing integrations.

Do not create duplicate API layers.

---

# 13. Database Rule

When working with Prisma:

Never modify:

- schema.prisma
- migrations

Unless explicitly required by the spec.

If schema changes are required:

1. Explain impact.
2. Update schema.
3. Generate migration.
4. Validate migration consistency.

Do not create speculative schema changes.

---

# 14. Dependency Rule

Before installing a package:

Check if the functionality already exists.

New dependencies require justification.

Avoid package installation when:

- native APIs solve the problem
- existing project dependencies already solve it

---

# 15. Debugging Rule

Before changing code:

Identify:

- exact error message
- file
- line
- stack trace
- reproduction steps

Never perform blind fixes.

Evidence-driven debugging only.

---

# 16. Build Validation Rule

Before considering a task complete:

Validate:

1. TypeScript compilation
2. Application build
3. Relevant tests

Do not claim success without validation.

---

# 17. Progress Reporting

After each major milestone provide:

### Completed

What was finished.

### Remaining

What still needs work.

### Risks

Potential concerns.

### Validation

Commands executed.

Keep reports concise and factual.

---

# 18. Context Recovery Rule

If execution becomes unclear:

STOP.

Re-read:

- current task
- previous progress
- acceptance criteria

Then continue.

Do not continue with assumptions.

---

# 19. Token Usage Rule

Avoid large unnecessary outputs.

Prefer:

- concise analysis
- direct implementation
- focused diffs

Do not dump large files unless necessary.

---

# 20. Definition Of Done

A task is considered complete only when:

- acceptance criteria are satisfied
- build succeeds
- no known runtime errors exist
- scope has not expanded
- requested functionality is implemented

Anything else is incomplete.

---

# 21. Anti-Loop Enforcement

If Kiro detects:

- repeated edits to the same file
- repeated failed builds
- repeated failed tests
- repeated retries of the same command

Then:

STOP.

Generate:

1. Current status
2. Root cause
3. Blocking issue
4. Recommended next step

Never continue indefinitely.

# 22. Spec Execution Budget

Maximum execution budget per task:

- 10 file modifications
- 3 build attempts
- 3 test attempts
- 3 debugging cycles

If limits are exceeded:

STOP.

Provide:

- findings
- blockers
- suggested resolution

Do not continue autonomously.

# 23. No Perfectionism Rule

Working and validated code is preferred over theoretical perfection.

Do not spend time:

- improving naming
- restructuring folders
- reformatting unrelated files
- rewriting working code

Deliver the smallest correct solution first.