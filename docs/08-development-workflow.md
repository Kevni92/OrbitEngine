# 08 — Development Workflow

This workflow is mandatory for repository work unless the repository is being bootstrapped before `main` has its first commit.

## 0. Classify the issue before work begins

Every issue must declare exactly one authoritative marker near the top of its body:

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

The body marker is authoritative. Matching labels and title prefixes are useful secondary signals but never replace the marker.

Routing rules:

- **Architecture** — may be executed only in the ChatGPT Architecture Project/session. Local/cloud coding agents must refuse execution.
- **Implementation** — intended for local Codex/coding-agent execution after architecture is sufficiently specified.
- **Spike** — may be executed in either environment, but local/cloud coding agents must ask for explicit confirmation once before beginning exploratory work.

If the marker is missing or ambiguous, no repository work begins until the issue is classified.

If an Implementation task reveals a non-trivial unresolved architecture decision, the coding agent must stop before making that decision and route the question back to the ChatGPT Architecture Project/session. It must not silently select an architecture or create an Architecture issue unless explicitly asked.

See `docs/10-task-types-and-agent-routing.md` for detailed expectations and outputs.

## One issue → one branch → one pull request

Every executable repository task starts from a GitHub issue. Keep the task scope aligned with that issue.

### 1. Start from clean `main`

Before creating a branch:

- fetch the latest repository state;
- switch to `main`;
- update `main` using a fast-forward-only pull/update where applicable;
- ensure the working tree is clean;
- do not base new work on another feature branch unless the issue explicitly requires stacked work.

For Architecture tasks, this step is performed by the ChatGPT architecture workflow when the architecture issue requires repository changes. Coding agents must not execute Architecture tasks themselves.

### 2. Create a dedicated branch

Create exactly one dedicated branch for the issue from the current clean `main` state.

Recommended naming:

- `feat/<issue>-<slug>`
- `fix/<issue>-<slug>`
- `docs/<issue>-<slug>`
- `chore/<issue>-<slug>`
- `arch/<issue>-<slug>`
- `spike/<issue>-<slug>`

Do not implement issue work directly on `main`.

### 3. Execute only the issue scope

- Read `AGENTS.md` and relevant files under `docs/` first.
- Keep unrelated refactors out of the PR.
- Add/update tests for behavioral changes.
- Update architectural documentation when behavior, responsibilities, contracts, or architecture changes.
- Do not cross task-type boundaries implicitly. A Spike does not become production implementation, and an Implementation task does not become an architecture-design session.

### 4. Run local checks

Before pushing completed work, run all relevant local tests, builds, type checks, linters, and native/WASM checks available for the changed area.

Do not open a completion PR while known local checks are failing. If a check is not yet available in the repository, state that explicitly in the PR instead of claiming it passed.

Architecture-only documentation changes should run all repository checks that are applicable to documentation/workflow changes. If none exist, state that explicitly.

### 5. Commit and push the issue branch

Use focused commits with descriptive messages. Push the dedicated branch; never force unrelated history onto `main`.

### 6. Open a PR to `main`

The PR body must contain a GitHub closing keyword referencing the issue, for example:

```text
Closes #123
```

The closing keyword belongs in the PR (or a merged commit), not in the issue itself. Merging the PR into the default branch then closes the linked issue automatically.

The PR should summarize the change, state the task type, and list the local checks performed.

### 7. CI must be green

Wait for all configured/required CI checks to complete successfully.

If CI fails:

- investigate the failure;
- fix it on the same issue branch;
- rerun local checks;
- push the correction;
- wait for CI again.

Do not merge while required checks are pending or failing.

### 8. Merge is part of the task

Once CI is green and the PR satisfies the issue acceptance criteria, merge the PR into `main`. Creating the PR alone does not complete the task.

After merge, verify that the `Closes #...` linkage closed the issue automatically.

## Architecture workflow outcome

An Architecture issue should normally produce durable decisions rather than an open-ended discussion. Depending on scope, this can include:

- updated architecture documentation or an ADR-like decision record;
- explicit invariants, responsibilities, and boundaries;
- selected approach and rejected alternatives with relevant trade-offs;
- public/internal contracts or interfaces at the level needed by implementation;
- numerical/performance constraints where relevant;
- a decomposition into one or more Implementation issues.

Architecture work may include small prototypes only when needed to validate a decision; larger uncertainty should become a Spike.

## Spike workflow outcome

A Spike is exploratory and should explicitly document:

- question/hypothesis;
- experiment or investigation performed;
- observations/results;
- recommendation, if justified;
- unresolved questions;
- whether follow-up Architecture or Implementation issues are needed.

A Spike result is not automatically a production decision until architecture explicitly adopts it.

## Bootstrap exception

A completely empty GitHub repository has no commit from which a feature branch can be created. The single initial repository bootstrap commit may therefore be created on `main`. Immediately after that commit, normal issue/branch/PR workflow applies.
