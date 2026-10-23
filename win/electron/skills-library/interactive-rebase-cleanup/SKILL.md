---
name: interactive-rebase-cleanup
description: Cleans up a local branch before review by squashing fixups, reordering and rewording commits with a scripted interactive rebase, after backing up the branch and checking the commits are not shared. Use when the user asks to squash commits, tidy branch history, reword an old commit or split one apart.
---

# Interactive rebase cleanup

## Goal

Turn a messy local branch into a short series of commits that each do one thing and read well in review. A good result has the same final tree as before the rebase, a backup branch to return to, and no rewritten history that anyone else already pulled.

## When to use

- The user wants to squash "wip" and "fix typo" commits before opening a pull request.
- A commit message needs rewording, or one commit must move earlier or later.
- One large commit should be split into logical pieces.
- If the rebase stops on conflicts, use `use_skill` with `merge-conflict-resolution`.
- To write the new messages, use `use_skill` with `commit-message`.

## Steps

1. Check state with `git_status`. The tree must be clean; stash or commit first. Note the current branch and its base (`main` or the named target).
2. Check whether the commits are shared. Run `git branch -r --contains <oldest-commit>` with `run_command`. If a remote branch holds them and others may have pulled it, stop and ask with `ask_user` before rewriting anything.
3. Make a backup: `git branch backup/<branch>-before-rebase`. Record the tree hash with `git rev-parse HEAD^{tree}` so you can compare later.
4. Read the series with `git log --oneline --reverse <base>..HEAD`. Propose a plan to the user in plain words: which commits to squash, which to move, which to reword, which to split. Get a yes before editing history.
5. Run the rebase non-interactively, since an editor would hang the shell. Write the todo list yourself and feed it through the sequence editor:
   - Create the todo file with `create_file` (lines such as `pick abc123 subject`, `fixup def456 subject`, `reword`).
   - Run `GIT_SEQUENCE_EDITOR="cp /path/to/todo" GIT_EDITOR=true git rebase -i <base>` with `run_command`.
   - For reword, supply messages through `exec git commit --amend -m "..."` lines in the todo instead of an editor.
6. For a split, mark the commit `edit`, run `git reset HEAD^`, stage and commit the pieces with `git add -p`-style paths or explicit file lists, then `git rebase --continue`.
7. Verify the result: `git rev-parse HEAD^{tree}` must equal the recorded hash unless you intentionally changed content. Check with `git diff backup/<branch>-before-rebase HEAD`, which must be empty.
8. Run the tests with `run_command`. Each commit should build on its own when the project cares about bisectability; spot check with `git rebase -x "<test command>" <base>`.
9. If the branch was already pushed and the user agreed, push with `git push --force-with-lease`, never plain `--force`.

## Gotchas

- Rewriting a commit changes its hash and the hash of everything after it. Anyone who based work on the old commits gets duplicate commits and conflicts.
- `--force-with-lease` protects against overwriting a push you have not seen, but only if you fetched first. Fetch, then push.
- `fixup` needs the fixup commit placed right after its target. A misplaced one lands in the wrong commit and may conflict.
- Squashing across a merge commit flattens it. Rebase with `--rebase-merges` or avoid mixing merges into a branch you plan to tidy.
- Splitting a commit by hunk with an interactive prompt cannot run in this shell. Use explicit file paths, or write a patch and apply it.
- The backup branch is local. If the user later deletes it, the reflog is the only way back.

## Output

- The plan that was applied, as a short before and after list of subjects.
- Confirmation that the final tree matches the backup and the tests passed.
- The name of the backup branch and the command to restore it.
- Whether a force push is still pending and what it will overwrite.
- Any commit that no longer builds alone, if the project cares about that.
- New commit messages in the project's usual style, one line each.
- When to delete the backup branch: after the pull request merges, not before.
