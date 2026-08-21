# AGENTS.md

These instructions apply to the entire repository.

## Read first

Before changing code or architecture:

1. Read `docs/README.md`.
2. Read the documents relevant to the issue.
3. Read the complete GitHub issue and its acceptance criteria.

Do not infer game-layer behavior into OrbitEngine. Keep the engine's responsibilities within the documented boundaries.

## Mandatory GitHub workflow

Every repository task must follow the issue → branch → pull request → CI → merge workflow documented in `docs/08-development-workflow.md`.

### Before implementation

- Work from a current, clean `main`.
- Create a dedicated branch from `main` for the issue.
- Never implement issue work directly on `main`.
- Keep one issue as the primary scope of one branch/PR unless the issue explicitly requires otherwise.

### During implementation

- Keep changes focused on the issue.
- Preserve documented architectural boundaries.
- Add or update tests for changed behavior.
- Update documentation in the same PR when architecture, public contracts, simulation semantics, or workflow changes.
- Do not introduce Node.js or Emscripten dependencies into the portable C++ core.
- Keep game-specific concepts out of OrbitEngine.

### Before opening a PR

Run all relevant local checks available in the repository, including as applicable:

- unit/integration tests;
- TypeScript type checking;
- lint/format checks;
- package build;
- native C++ tests/build;
- Node native binding build/tests;
- WebAssembly build/tests.

Known failing local checks must be fixed before completion. If a check does not exist yet, state that fact; never report an unrun/nonexistent check as passing.

### Pull request

- Push the dedicated branch.
- Open a PR targeting `main`.
- The PR body MUST contain `Closes #<issue-number>` (or another valid GitHub closing keyword) for the primary issue.
- Summarize what changed and what local validation was run.
- Keep unrelated changes out of the PR.

### CI and merge

- Wait for configured/required CI checks to finish.
- If CI fails, fix the issue on the same branch, rerun local checks, push, and wait again.
- Do not merge with failing or pending required CI.
- Once CI is green and acceptance criteria are satisfied, merge the PR to `main`.
- Merging is part of completing the task; opening a PR is not the end state.
- Verify the linked issue is closed by the merged PR.

## Architecture guardrails

- Public consumer surface: TypeScript/npm.
- Performance core: portable C++ where justified.
- Native Node backend and WebAssembly backend must wrap the same portable core rather than fork simulation logic.
- Backend-specific code belongs in binding/adapter layers.
- Stable object IDs are the boundary to higher game/domain systems.
- OrbitEngine registers/simulates supplied objects; it does not generate celestial systems.
- Propagation model and simulation fidelity are separate concepts.
- Avoid global all-pairs or fixed-tick work when event-driven/broad-phase approaches satisfy the requirement.

## Quality

Prefer deterministic, testable simulation behavior. Numerical algorithms must define tolerances and be validated against known/reference cases where possible. Performance optimizations must not silently change simulation semantics.

When requirements conflict with these rules, call out the conflict explicitly in the PR rather than silently violating the architecture.
