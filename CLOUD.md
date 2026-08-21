# CLOUD.md

Cloud/local coding agents must follow `AGENTS.md` and this file. If the two differ, use the stricter rule and call out the conflict.

## Startup sequence

1. Read `AGENTS.md`.
2. Read `docs/README.md` and `docs/10-task-types-and-agent-routing.md`.
3. Read the GitHub issue completely.
4. Determine the authoritative `Task Type` marker before doing any repository work.
5. Verify repository state only if the task type permits execution.

## Task-type routing

### Architecture

Coding agents MUST refuse to execute Architecture issues. Architecture issues belong to the ChatGPT Architecture Project/session.

Do not create a branch, edit files, or make a design choice on behalf of the architecture workflow. Explain the routing rule and stop.

### Implementation

Coding agents MAY execute Implementation issues.

If implementation exposes an unresolved non-trivial architecture decision, stop before introducing that decision into the codebase. Report the exact missing decision and route it back to the ChatGPT Architecture Project/session. Do not silently pick an architecture because it makes the current implementation easier.

### Spike

Coding agents MAY execute Spike issues only after asking the user for an explicit confirmation once for that execution session. No substantive Spike work or repository mutation begins before that confirmation.

After confirmation, clearly separate experimental findings from production recommendations. Spike output does not automatically establish architecture or production behavior.

### Missing or invalid task type

If the issue does not contain exactly one valid `Task Type: Architecture|Implementation|Spike` marker, stop and ask for classification before proceeding.

## Branch discipline

For tasks that are permitted to execute:

- Start from a clean, current `main`.
- Create a dedicated issue branch from `main`.
- Do not reuse a stale branch from another task.
- Do not commit issue work directly to `main`.
- If the environment already checked out a branch, verify that it is the correct issue branch and that its base is current `main` before proceeding.

## Execution discipline

- Complete the issue in the current task; do not stop at a partial implementation unless blocked by an external constraint or required architecture escalation.
- Keep scope aligned with the issue and acceptance criteria.
- Prefer small, reviewable changes over unrelated refactors.
- Update tests and docs together with behavioral/architectural changes.
- Never claim a test/build/check was run if it was not.

## Completion sequence

A coding-agent task is not complete merely because files were changed.

1. Run all relevant local checks available in the environment.
2. Fix failures.
3. Commit the completed work to the issue branch.
4. Push the branch.
5. Open a pull request to `main`.
6. Include `Closes #<issue-number>` in the PR body.
7. Observe configured/required CI.
8. If CI fails, fix on the same branch and repeat validation.
9. When CI is green and acceptance criteria are met, merge the PR into `main`.
10. Verify the linked issue is closed.

If CI is not configured, explicitly state that there were no configured checks rather than describing CI as green. In that case, local validation remains mandatory and merge may proceed only when there are no failing/pending required checks reported by GitHub.

## Repository architecture reminders

- TypeScript is the public npm-facing API.
- Portable C++ hosts performance-critical algorithms where justified.
- Node-API and WebAssembly are adapters around the same portable core.
- OrbitEngine must not absorb economy, population, resource, ownership, or other game-layer concepts.
- External astronomical source acquisition belongs to import/build tooling rather than runtime network dependencies.
