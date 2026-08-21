# CLOUD.md

Cloud agents must follow `AGENTS.md` and this file. If the two differ, use the stricter rule and call out the conflict.

## Startup sequence

1. Read `AGENTS.md`.
2. Read `docs/README.md` and relevant architecture documents.
3. Read the GitHub issue completely.
4. Verify repository state before editing.

## Branch discipline

- Start from a clean, current `main`.
- Create a dedicated issue branch from `main`.
- Do not reuse a stale branch from another task.
- Do not commit issue work directly to `main`.
- If the environment already checked out a branch, verify that it is the correct issue branch and that its base is current `main` before proceeding.

## Execution discipline

- Complete the issue in the current task; do not stop at a partial implementation unless blocked by an external constraint.
- Keep scope aligned with the issue and acceptance criteria.
- Prefer small, reviewable changes over unrelated refactors.
- Update tests and docs together with behavioral/architectural changes.
- Never claim a test/build/check was run if it was not.

## Completion sequence

A cloud-agent task is not complete merely because files were changed.

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
