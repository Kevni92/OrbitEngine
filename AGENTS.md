# AGENTS.md

These instructions apply to the entire repository.

## Read first

Before changing code, documentation, or architecture:

1. Read `docs/README.md`.
2. Read `docs/10-task-types-and-agent-routing.md`.
3. Read the documents relevant to the issue.
4. Read the complete GitHub issue and its acceptance criteria.
5. Determine the issue's authoritative `Task Type` before doing any work.

Do not infer game-layer behavior into OrbitEngine. Keep the engine's responsibilities within the documented boundaries.

## Mandatory task classification

Every issue must contain exactly one explicit marker near the top of its body:

```text
Task Type: Architecture
```

or

```text
Task Type: Implementation
```

or

```text
Task Type: Spike
```

The body marker is authoritative. Matching GitHub labels and title prefixes are supplemental routing signals only. If the marker is missing, invalid, or ambiguous, stop and ask the user to classify the issue before making repository changes.

## Local Codex execution gate

Local Codex MUST classify the issue before creating a branch, editing files, running an implementation, or making repository changes.

### Architecture

Local Codex MUST refuse to execute an `Architecture` issue.

- Do not create an implementation branch for it.
- Do not edit repository files for it.
- Do not make the architecture decision implicitly.
- Tell the user that Architecture issues are reserved for the ChatGPT Architecture Project/session.

Architecture issues may be executed only in the ChatGPT architecture workflow. When that workflow changes repository content, it still follows the same issue → clean `main` → dedicated branch → validation → PR → CI → merge process.

### Implementation

Local Codex MAY execute an `Implementation` issue.

Implementation issues are expected to contain enough architectural direction that the agent can implement them without inventing non-trivial system design.

If an Implementation issue requires a non-trivial architecture decision that is not already specified:

1. stop before making the decision;
2. do not silently choose an approach or introduce a speculative abstraction;
3. explain exactly which architectural decision is missing and why it blocks correct implementation;
4. route the decision back to the ChatGPT Architecture Project/session;
5. resume only after the architecture is documented or the issue is clarified.

Do not create an Architecture issue autonomously unless the user explicitly asks you to; issue planning and creation are handled in ChatGPT.

### Spike

A `Spike` may be executed by ChatGPT or local Codex, but local Codex MUST ask the user for explicit confirmation once after detecting that the issue is a Spike and before substantive work begins.

Until the user confirms:

- do not create or modify repository files;
- do not start the exploratory implementation;
- do not create a PR as if the Spike had already been approved.

After confirmation, follow the normal repository workflow. Spike results must distinguish observations, experiments, recommendations, and unresolved questions. A Spike does not silently become production architecture or production implementation.

## Mandatory GitHub workflow

Every repository task that is allowed to execute must follow the issue → branch → pull request → CI → merge workflow documented in `docs/08-development-workflow.md`.

### Before implementation or repository-changing architecture work

- Work from a current, clean `main`.
- Create a dedicated branch from `main` for the issue.
- Never implement issue work directly on `main`.
- Keep one issue as the primary scope of one branch/PR unless the issue explicitly requires otherwise.

### During work

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

When requirements conflict with these rules, call out the conflict explicitly rather than silently violating the architecture.
