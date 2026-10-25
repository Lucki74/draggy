---
name: stacked-prs
description: Splits a large change into a chain of small, reviewable pull requests that each build on the previous one, and keeps the stack in sync as earlier pieces get reviewed and merged. Use when the user says a PR is too big, wants stacked pull requests, or has one PR that depends on another.
---

# Stacked pull requests

## Goal

Turn one oversized change into several small pull requests that can be reviewed in order. A good result is a plan of layers where each one compiles and passes tests alone, branches created in a chain, correct base branches on the host, and a clear way to update the stack after a merge or review fix.

## When to use

- A diff is too big for anyone to review properly.
- A second piece of work depends on a first PR that is still open.
- The user wants to ship a refactor and a feature built on it in separate reviews.
- To tidy a single branch's commits first, use `use_skill` with `interactive-rebase-cleanup`.
- To write each PR's title and text, use `use_skill` with `pull-request`.

## Steps

1. Read the whole change: `git_status`, `git diff --stat main...HEAD` with `run_command`, and `git_diff` for the detail. Group changes by purpose, for example: rename or move, new interface, new behavior, tests, docs.
2. Draft the layers in order of dependency. Each layer must build and pass tests on its own, so a layer cannot use code from a later one. Show the plan to the user with `update_plan` and confirm before touching branches. Aim for layers a reviewer can read in fifteen minutes.
3. Back up first: `git branch backup/<name>`.
4. Create the chain. Start from the base: `git switch -c stack/1-<topic> main`. Bring in only layer one's changes, by checking out chosen files from the big branch (`git checkout <big-branch> -- <paths>`) or cherry-picking commits, then commit. Branch layer two off layer one, and so on.
5. Verify every layer alone: check out each branch and run the project's build and tests through `run_command`. Fix a layer that needs something from a later one by moving that piece down.
6. Check completeness. `git diff <big-branch> stack/<last>` must be empty, so no change was lost or added.
7. Push the branches and open the pull requests with the right bases: layer one targets `main`, layer two targets layer one's branch, and so on. Use the host's CLI through `run_command` only after the user agrees. Put the stack order and links to the others at the top of each description.
8. When a lower layer changes after review, update the ones above it: `git switch stack/2` then `git rebase stack/1`, repeating up the chain. Use `git rebase --onto` when a lower branch was squash-merged (see below). Push with `git push --force-with-lease`.
9. After layer one merges, retarget layer two's PR to `main` on the host, then rebase it.

## Gotchas

- When layer one is squash-merged, its commits no longer exist on `main`. Rebasing layer two the plain way replays them and conflicts. Use `git rebase --onto main stack/1 stack/2`, which moves only layer two's own commits.
- If the host deletes a merged branch automatically, any open pull request based on it may close or retarget unpredictably. Check the setting or retarget before merging the lower layer.
- Fixing review comments in the wrong layer is the commonest mistake. A fix to code from layer one belongs in layer one, followed by a rebase of everything above.
- A stack of more than four or five layers becomes hard to keep in sync. Merge the early ones first, or reconsider the split.
- CI that runs only on the default branch's pull requests may skip the upper layers. Check that checks actually ran on each one.
- Reviewers see the whole diff against the base. If the base is wrong, each PR shows the lower layers' changes again.
- Some hosts have no concept of a stack, so the order lives only in your descriptions. Keep them updated when layers change.
- Do not rewrite branches teammates have started building on. Tell them before force-pushing.

## Output

- The layer plan: number, branch name, purpose, files, and what each depends on.
- Confirmation that each layer built and tested alone and that the final tree equals the original.
- The list of PRs with base branches and merge order.
- The exact rebase commands for the next sync after a merge.
- Which layers are safe to merge independently and which must go in order.
- The backup branch name, kept until the last layer merges.
- Branches and PRs not created yet, if the user wanted to review the plan first.
