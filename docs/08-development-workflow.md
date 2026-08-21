# 08 — Development Workflow

This workflow is mandatory for repository work unless the repository is being bootstrapped before `main` has its first commit.

## One issue → one branch → one pull request

Every implementation task starts from a GitHub issue. Keep the task scope aligned with that issue.

### 1. Start from clean `main`

Before creating a branch:

- fetch the latest repository state;
- switch to `main`;
- update `main` using a fast-forward-only pull/update where applicable;
- ensure the working tree is clean;
- do not base new work on another feature branch unless the issue explicitly requires stacked work.

### 2. Create a dedicated branch

Create exactly one dedicated branch for the issue from the current clean `main` state.

Recommended naming:

- `feat/<issue>-<slug>`
- `fix/<issue>-<slug>`
- `docs/<issue>-<slug>`
- `chore/<issue>-<slug>`

Do not implement issue work directly on `main`.

### 3. Implement only the issue scope

- Read `AGENTS.md` and relevant files under `docs/` first.
- Keep unrelated refactors out of the PR.
- Add/update tests for behavioral changes.
- Update architectural documentation when behavior, responsibilities, contracts, or architecture changes.

### 4. Run local checks

Before pushing the completed work, run all relevant local tests, builds, type checks, linters, and native/WASM checks available for the changed area.

Do not open a completion PR while known local checks are failing. If a check is not yet available in the repository, state that explicitly in the PR instead of claiming it passed.

### 5. Commit and push the issue branch

Use focused commits with descriptive messages. Push the dedicated branch; never force unrelated history onto `main`.

### 6. Open a PR to `main`

The PR body must contain a GitHub closing keyword referencing the issue, for example:

```text
Closes #123
```

The closing keyword belongs in the PR (or a merged commit), not in the issue itself. Merging the PR into the default branch then closes the linked issue automatically.

The PR should summarize the change and list the local checks performed.

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

## Bootstrap exception

A completely empty GitHub repository has no commit from which a feature branch can be created. The single initial repository bootstrap commit may therefore be created on `main`. Immediately after that commit, normal issue/branch/PR workflow applies.
