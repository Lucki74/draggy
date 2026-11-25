---
name: git-helper
description: "Helps with git beyond basic commits: resolving merge conflicts, rebasing, undoing mistakes, recovering lost work, cleaning history and understanding what happened, using safe, explained commands. Use when the user has a git problem, a merge conflict, lost commits, or asks how to do something in git."
---

# Git helper

## Goal

Fix the git problem without losing work. Look before acting, prefer reversible commands, and explain each command before running it.

## When to use

- The user has a merge conflict, a rebase in trouble, a wrong commit or a wrong branch.
- The user wants to undo, recover or clean up history, or to see what changed and who changed it.
- For writing the commit message, use `use_skill` with `commit-message`.
- For a pull request description, use `use_skill` with `pull-request`.

## Steps

1. Run `git_status` to learn the branch, the staged and unstaged changes, and whether a merge or rebase is in progress.
2. Run `git log --oneline --graph -15` with `run_command` to see history.
3. If there are uncommitted changes and the operation could touch them, suggest `git stash push -m "backup before ..."` or a temporary commit first.
4. Pick the task:
   - **Merge conflict:** list conflicted files with `git diff --name-only --diff-filter=U`. For each, `read_file` it and understand both sides (ours is the current branch, theirs is the incoming one). Resolve with `edit_file` to keep the correct combination, not blindly one side. Remove all conflict markers, then `git add <file>`. Run tests before `git merge --continue` or `git rebase --continue`.
   - **Undo the last commit, keep changes:** `git reset --soft HEAD~1`.
   - **Discard changes to one file:** `git restore <file>`. Those changes cannot be recovered, so confirm with the user using `ask_user`.
   - **Undo a pushed commit:** `git revert <sha>`, which is safe for shared branches.
   - **Recover lost commits or a deleted branch:** `git reflog`, find the sha, then `git branch recovered <sha>`.
   - **Wrong branch:** commit or stash, switch, then `git cherry-pick <sha>` or `git stash pop`.
   - **Clean up local commits before pushing:** interactive rebase cannot run here because it needs an editor. Use `git reset --soft <base>` and re-commit, or explain the interactive steps for the user to run in their terminal.
   - **What changed and who:** `git log -p -- <file>` and `git blame -L <start>,<end> <file>`.
5. Run `git_status` and `git log --oneline -5` again to confirm the resulting state.

## Gotchas

- Never run these without explicit confirmation: `git reset --hard`, `git clean -fd`, `git push --force` (suggest `--force-with-lease`), deleting branches, rewriting history that has been pushed, `git checkout -- .` on uncommitted work. State what will be lost before asking.
- Commands run with `run_command` cannot answer prompts. Pass flags like `--no-edit` for merges and set `GIT_EDITOR=true` where an editor would open.
- Keeping one side of a conflict wholesale often drops the other side's real change. Read both.
- Uncommitted work is the first thing a reset or checkout destroys. Stash it before anything that moves HEAD.

## Output

What was wrong, what you ran and why, the resulting state (`git status` and `git log --oneline -5`), and how to undo it if needed.
